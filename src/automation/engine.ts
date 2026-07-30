// Queue Consumer 核心處理鏈（spec.md 第 7.2、12.2 節）。
// 查 automation → 排除檢查 → 正規化 → 比對 → 冪等 run → 公開回覆 → Private Reply → 寫結果。
//
// 冪等關鍵：同一 (automation, comment) 只有一個 run；queue 重試時只重試「尚未成功」的動作
// （靠 run 上的 public_reply_status / private_reply_status），確保每個 Comment ID 最多各發一次。
import { eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from '../database/schema';
import {
  apiAttempts,
  automationKeywords,
  instagramAccounts,
  instagramMedia,
  systemSettings,
  webhookEvents,
} from '../database/schema';
import type { MetaClient } from '../meta/client';
import { PERMANENT_REASONS, isRetryable } from '../meta/errors';
import { replyToComment } from '../meta/comments';
import { sendPrivateReply } from '../meta/private-replies';
import type { CommentEventMessage } from '../queue/producer';
import { nextRetryDelaySeconds } from '../queue/retry-policy';
import { resolveAutomationForMedia } from './apply-scope';
import { matchKeywords, type MatchType } from './matcher';
import { normalizeCommentText } from './normalizer';
import { ensureAutomationRun } from './idempotency';
import { selectPublicReply } from './public-reply';
import { findCommentEvent } from '../webhook/event-parser';

type SchemaDb = BaseSQLiteDatabase<'sync' | 'async', unknown, typeof schema>;

export type EngineOutcome =
  | { kind: 'skipped'; reason: string }
  | { kind: 'no_match' }
  | { kind: 'completed'; runId: string; publicReplyStatus: string; privateReplyStatus: string }
  | { kind: 'retry'; delaySeconds: number | null; runId: string; reason: string };

export type Platform = 'instagram' | 'facebook';

// 向 Meta 補抓單篇貼文資訊並寫入 instagram_media（本地尚未同步到的新貼文）。
// IG 與 FB 的欄位名稱不同（caption/message、permalink/permalink_url…），在此統一映射。
async function discoverMedia(
  db: SchemaDb,
  metaClient: MetaClient,
  instagramMediaId: string,
  platform: Platform,
): Promise<typeof instagramMedia.$inferSelect | null> {
  const account = (
    await db.select().from(instagramAccounts).where(eq(instagramAccounts.platform, platform)).limit(1)
  )[0];
  if (!account) return null;

  const fields =
    platform === 'facebook'
      ? 'id,message,permalink_url,created_time,full_picture'
      : 'id,media_type,caption,thumbnail_url,media_url,permalink,timestamp';
  const res = await metaClient.get<{
    id?: string;
    media_type?: string;
    caption?: string;
    message?: string;
    thumbnail_url?: string;
    media_url?: string;
    full_picture?: string;
    permalink?: string;
    permalink_url?: string;
    timestamp?: string;
    created_time?: string;
  }>(instagramMediaId, { fields });
  if (!res.ok || !res.data?.id) return null;

  await db
    .insert(instagramMedia)
    .values({
      id: crypto.randomUUID(),
      platform,
      instagramAccountId: account.id,
      instagramMediaId: res.data.id,
      mediaType: platform === 'facebook' ? 'POST' : (res.data.media_type ?? 'UNKNOWN'),
      caption: res.data.caption ?? res.data.message ?? null,
      thumbnailUrl: res.data.thumbnail_url ?? res.data.media_url ?? res.data.full_picture ?? null,
      permalink: res.data.permalink ?? res.data.permalink_url ?? null,
      publishedAt: res.data.timestamp ?? res.data.created_time ?? null,
      lastSyncedAt: new Date().toISOString(),
    })
    .onConflictDoNothing();
  const rows = await db
    .select()
    .from(instagramMedia)
    .where(eq(instagramMedia.instagramMediaId, res.data.id))
    .limit(1);
  return rows[0] ?? null;
}

export interface EngineDeps {
  db: SchemaDb;
  metaClient: MetaClient;
  // Facebook 粉專用的 client（graph.facebook.com + Page Access Token）。
  // 未設定 FACEBOOK_PAGE_ACCESS_TOKEN 時為 undefined，FB 事件會以 skipped 處理。
  fbMetaClient?: MetaClient;
}

async function recordAttempt(
  db: SchemaDb,
  runId: string,
  actionType: string,
  attemptNumber: number,
  result: {
    status: number;
    failure?: { httpStatus?: number; metaErrorCode?: string; metaErrorMessage?: string };
  },
): Promise<void> {
  await db.insert(apiAttempts).values({
    id: crypto.randomUUID(),
    automationRunId: runId,
    actionType,
    attemptNumber,
    httpStatus: result.status || result.failure?.httpStatus || null,
    metaErrorCode: result.failure?.metaErrorCode ?? null,
    metaErrorMessage: result.failure?.metaErrorMessage ?? null,
    completedAt: new Date().toISOString(),
  });
}

export async function processCommentEvent(
  deps: EngineDeps,
  message: CommentEventMessage,
): Promise<EngineOutcome> {
  const { db } = deps;
  const msgPlatform: Platform = message.platform ?? 'instagram';

  // 1. Webhook event + 留言內容
  const eventRows = await db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.id, message.webhookEventId))
    .limit(1);
  if (eventRows.length === 0) return { kind: 'skipped', reason: 'webhook_event_not_found' };
  let payload: unknown;
  try {
    payload = JSON.parse(eventRows[0].rawPayload);
  } catch {
    return { kind: 'skipped', reason: 'payload_parse_error' };
  }
  const comment = findCommentEvent(payload, message.instagramCommentId);
  if (!comment || !comment.instagramCommentId || !comment.instagramMediaId) {
    return { kind: 'skipped', reason: 'comment_not_in_payload' };
  }

  // 2. 緊急停止
  const settings = await db.select().from(systemSettings).limit(1);
  if (settings.length > 0 && settings[0].emergencyStop === 1) {
    return { kind: 'skipped', reason: 'emergency_stop' };
  }

  // 3. Media——本地沒有時向 Meta 補抓（排程貼文上線後的首則留言可能早於每日同步；
  //    這也是待命自動化「零時差綁定」的入口）。抓不到才視為 media_not_found。
  let mediaRows = await db
    .select()
    .from(instagramMedia)
    .where(eq(instagramMedia.instagramMediaId, message.instagramMediaId))
    .limit(1);
  if (mediaRows.length === 0) {
    const discoveryClient = msgPlatform === 'facebook' ? deps.fbMetaClient : deps.metaClient;
    if (!discoveryClient) return { kind: 'skipped', reason: 'facebook_not_configured' };
    const discovered = await discoverMedia(db, discoveryClient, message.instagramMediaId, msgPlatform);
    if (!discovered) return { kind: 'skipped', reason: 'media_not_found' };
    mediaRows = [discovered];
  }
  const media = mediaRows[0];
  const platform = (media.platform ?? 'instagram') as Platform;
  const metaClient = platform === 'facebook' ? deps.fbMetaClient : deps.metaClient;
  if (!metaClient) return { kind: 'skipped', reason: 'facebook_not_configured' };

  // 4. 帳號（停用 / 熔斷）
  const accountRows = await db
    .select()
    .from(instagramAccounts)
    .where(eq(instagramAccounts.id, media.instagramAccountId))
    .limit(1);
  if (accountRows.length === 0) return { kind: 'skipped', reason: 'account_not_found' };
  const account = accountRows[0];
  if (account.automationEnabled === 0) return { kind: 'skipped', reason: 'account_disabled' };
  if (account.circuitBreakerStatus !== 'closed') return { kind: 'skipped', reason: 'circuit_open' };

  // 5. Active automation：專屬 → 待命（next_post）綁定 → 全帳號預設（account_default）。
  const automation = await resolveAutomationForMedia(db, media);
  if (!automation) return { kind: 'skipped', reason: 'no_active_automation' };

  // 6. 排除：自己的留言
  if (
    automation.excludeOwnComments === 1 &&
    comment.commenterId &&
    comment.commenterId === comment.instagramAccountId
  ) {
    return { kind: 'skipped', reason: 'own_comment' };
  }

  // 7. 正規化 + 比對
  const normalized = normalizeCommentText(comment.text);
  const kwRows = await db
    .select()
    .from(automationKeywords)
    .where(eq(automationKeywords.automationId, automation.id));
  const normalizedKeywords = kwRows.map((k) => k.normalizedKeyword);
  const match = matchKeywords(normalized, normalizedKeywords, automation.matchType as MatchType);
  if (!match.matched) return { kind: 'no_match' };

  // 8. 冪等 run（queue 重試時 created=false，但仍要接續尚未完成的動作）
  const { run } = await ensureAutomationRun(db, {
    automationId: automation.id,
    webhookEventId: message.webhookEventId,
    instagramCommentId: comment.instagramCommentId,
    instagramMediaId: media.instagramMediaId,
    commenterId: comment.commenterId,
    commenterUsername: comment.commenterUsername,
    originalCommentText: comment.text,
    normalizedCommentText: normalized,
    matchedKeyword: match.matchedKeyword,
    status: 'matched',
  });

  let publicStatus = run.publicReplyStatus ?? 'pending';
  let privateStatus = run.privateReplyStatus ?? 'pending';
  let retryable = false;
  const attemptNumber = run.retryCount + 1;

  // 9. 公開回覆（每 Comment ID 最多一次；已成功/略過就不再送）
  if (publicStatus === 'pending') {
    if (automation.publicReplyEnabled === 0) {
      publicStatus = 'skipped';
    } else {
      const variants = await db
        .select()
        .from(schema.publicReplyVariants)
        .where(eq(schema.publicReplyVariants.automationId, automation.id));
      const chosen = selectPublicReply(
        variants.map((v) => ({ id: v.id, message: v.message, enabled: v.enabled === 1 })),
      );
      if (!chosen) {
        publicStatus = 'skipped';
      } else {
        const res = await replyToComment(metaClient, comment.instagramCommentId, chosen.message, platform);
        await recordAttempt(db, run.id, 'public_reply', attemptNumber, res);
        if (res.ok) {
          publicStatus = 'success';
          await db
            .update(schema.automationRuns)
            .set({ publicReplyMessage: chosen.message })
            .where(eq(schema.automationRuns.id, run.id));
        } else if (res.failure && isRetryable(res.failure)) {
          retryable = true; // 保持 pending 供下次重試
        } else {
          publicStatus = 'failed';
        }
      }
    }
  }

  // 10. Private Reply（每 Comment ID 最多一次）
  if (privateStatus === 'pending') {
    if (automation.privateReplyEnabled === 0 || !automation.openingDm) {
      privateStatus = 'skipped';
    } else {
      const res = await sendPrivateReply(metaClient, {
        instagramAccountId: comment.instagramAccountId,
        commentId: comment.instagramCommentId,
        text: automation.openingDm,
        buttonText: automation.buttonText,
        buttonUrl: automation.buttonUrl,
      });
      await recordAttempt(db, run.id, 'private_reply', attemptNumber, res);
      if (res.ok) {
        privateStatus = 'success';
      } else if (res.failure && isRetryable(res.failure)) {
        retryable = true;
      } else if (
        res.failure &&
        res.failure.httpStatus === 400 &&
        !PERMANENT_REASONS.has(res.failure.nonRetryableReason ?? '')
      ) {
        // 實測發現：對「非常新的留言」立即發 private reply，Meta 偶爾回暫時性 400
        // （同一請求數十秒後重打即成功）。因此 DM 的 400（非 token/權限/政策）
        // 走重試路徑（30s/2m/10m 最多三次），而不是立刻放棄。
        retryable = true;
      } else {
        privateStatus = 'failed';
      }
    }
  }

  // 11. 收尾：更新 run 狀態
  const pendingAfter = publicStatus === 'pending' || privateStatus === 'pending';
  if (retryable && pendingAfter) {
    const delay = nextRetryDelaySeconds(run.retryCount);
    await db
      .update(schema.automationRuns)
      .set({
        retryCount: run.retryCount + 1,
        publicReplyStatus: publicStatus,
        privateReplyStatus: privateStatus,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.automationRuns.id, run.id));
    return { kind: 'retry', delaySeconds: delay, runId: run.id, reason: 'retryable_meta_error' };
  }

  // 沒有可重試的 pending：把仍 pending 的視為 failed（重試已用盡或非重試路徑）。
  const finalPublic = publicStatus === 'pending' ? 'failed' : publicStatus;
  const finalPrivate = privateStatus === 'pending' ? 'failed' : privateStatus;
  const overall =
    finalPublic === 'failed' || finalPrivate === 'failed' ? 'completed_with_errors' : 'completed';
  await db
    .update(schema.automationRuns)
    .set({
      status: overall,
      publicReplyStatus: finalPublic,
      privateReplyStatus: finalPrivate,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.automationRuns.id, run.id));

  return {
    kind: 'completed',
    runId: run.id,
    publicReplyStatus: finalPublic,
    privateReplyStatus: finalPrivate,
  };
}
