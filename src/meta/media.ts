// 貼文/Reels 同步（spec.md 第 16.7、20 節）。
// 從 Meta Graph API 抓近期媒體，upsert 進 instagram_media；IG 上已刪除的貼文
// 逐篇向 Meta 查證後標記 deleted_at（軟刪除，保留自動化設定與發送紀錄）。
import { and, eq, isNull, ne } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { AppBindings } from '../app';
import { createDb } from '../database/client';
import * as schema from '../database/schema';
import { automations, instagramAccounts, instagramMedia } from '../database/schema';
import { bindNextPostAutomation } from '../automation/apply-scope';
import { MetaClient, type MetaClient as MetaClientType } from './client';

type SchemaDb = BaseSQLiteDatabase<'sync' | 'async', unknown, typeof schema>;

export interface RawMediaItem {
  id: string;
  media_type?: string;
  caption?: string;
  thumbnail_url?: string;
  media_url?: string;
  permalink?: string;
  timestamp?: string;
}

// 從 Meta 回應同步媒體到 D1。回傳新增/更新筆數。
export async function syncMediaItems(
  db: SchemaDb,
  accountInternalId: string,
  items: RawMediaItem[],
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  const now = new Date().toISOString();

  for (const item of items) {
    if (!item.id) continue;
    const existing = await db
      .select()
      .from(instagramMedia)
      .where(eq(instagramMedia.instagramMediaId, item.id))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(instagramMedia)
        .set({
          caption: item.caption ?? existing[0].caption,
          thumbnailUrl: item.thumbnail_url ?? item.media_url ?? existing[0].thumbnailUrl,
          permalink: item.permalink ?? existing[0].permalink,
          lastSyncedAt: now,
          updatedAt: now,
          // 出現在動態清單＝貼文存在；先前誤標（或使用者復原）就解除刪除標記。
          deletedAt: null,
        })
        .where(eq(instagramMedia.id, existing[0].id));
      updated += 1;
    } else {
      await db.insert(instagramMedia).values({
        id: crypto.randomUUID(),
        instagramAccountId: accountInternalId,
        instagramMediaId: item.id,
        mediaType: item.media_type ?? 'UNKNOWN',
        caption: item.caption ?? null,
        thumbnailUrl: item.thumbnail_url ?? item.media_url ?? null,
        permalink: item.permalink ?? null,
        publishedAt: item.timestamp ?? null,
        lastSyncedAt: now,
      });
      inserted += 1;
    }
  }

  return { inserted, updated };
}

// 從 Meta 抓媒體清單（GET /{ig-account-id}/media）。
export async function fetchRecentMedia(
  client: MetaClientType,
  instagramAccountId: string,
): Promise<{ ok: boolean; items: RawMediaItem[]; status: number; reason?: string; detail?: string }> {
  const fields = 'id,media_type,caption,thumbnail_url,media_url,permalink,timestamp';
  const res = await client.get<{ data?: RawMediaItem[] }>(`${instagramAccountId}/media`, { fields });
  if (!res.ok) {
    return {
      ok: false,
      items: [],
      status: res.status,
      reason: res.failure?.nonRetryableReason ?? (res.failure?.networkError ? 'network_error' : 'http_error'),
      detail: res.failure?.metaErrorMessage
        ? `(code ${res.failure?.metaErrorCode ?? '?'}) ${res.failure.metaErrorMessage}`
        : undefined,
    };
  }
  return { ok: true, items: res.data?.data ?? [], status: res.status };
}

export interface RawStoryItem {
  id: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  timestamp?: string;
}

// 進行中的限時動態清單（GET /{ig-account-id}/stories）。此端點只回 24 小時內的限動，
// 是「是否仍存活」的權威來源（不像貼文清單只涵蓋近期第一頁）。
export async function fetchActiveStories(
  client: MetaClientType,
  instagramAccountId: string,
): Promise<{ ok: boolean; items: RawStoryItem[]; status: number; reason?: string; detail?: string }> {
  const fields = 'id,media_type,media_url,thumbnail_url,timestamp';
  const res = await client.get<{ data?: RawStoryItem[] }>(`${instagramAccountId}/stories`, { fields });
  if (!res.ok) {
    return {
      ok: false,
      items: [],
      status: res.status,
      reason: res.failure?.nonRetryableReason ?? (res.failure?.networkError ? 'network_error' : 'http_error'),
      detail: res.failure?.metaErrorMessage
        ? `(code ${res.failure?.metaErrorCode ?? '?'}) ${res.failure.metaErrorMessage}`
        : undefined,
    };
  }
  return { ok: true, items: res.data?.data ?? [], status: res.status };
}

// 限動 upsert＋過期標記。media_type 一律強制寫 'STORY'（Meta 回的是 IMAGE/VIDEO，
// 若照抄會與貼文混在一起）。不在 active 清單＝已過期 → 標 deleted_at 並暫停其自動化。
export async function syncStories(
  db: SchemaDb,
  accountInternalId: string,
  items: RawStoryItem[],
): Promise<{ inserted: number; updated: number; expired: number }> {
  let inserted = 0;
  let updated = 0;
  const now = new Date().toISOString();

  for (const item of items) {
    if (!item.id) continue;
    const existing = await db
      .select()
      .from(instagramMedia)
      .where(eq(instagramMedia.instagramMediaId, item.id))
      .limit(1);
    if (existing.length > 0) {
      await db
        .update(instagramMedia)
        .set({
          thumbnailUrl: item.thumbnail_url ?? item.media_url ?? existing[0].thumbnailUrl,
          lastSyncedAt: now,
          updatedAt: now,
          deletedAt: null,
        })
        .where(eq(instagramMedia.id, existing[0].id));
      updated += 1;
    } else {
      await db.insert(instagramMedia).values({
        id: crypto.randomUUID(),
        instagramAccountId: accountInternalId,
        instagramMediaId: item.id,
        mediaType: 'STORY',
        thumbnailUrl: item.thumbnail_url ?? item.media_url ?? null,
        publishedAt: item.timestamp ?? null,
        lastSyncedAt: now,
      });
      inserted += 1;
    }
  }

  const activeIds = new Set(items.map((i) => i.id).filter(Boolean));
  const candidates = await db
    .select()
    .from(instagramMedia)
    .where(
      and(
        eq(instagramMedia.instagramAccountId, accountInternalId),
        eq(instagramMedia.mediaType, 'STORY'),
        isNull(instagramMedia.deletedAt),
      ),
    );
  let expired = 0;
  for (const story of candidates) {
    if (activeIds.has(story.instagramMediaId)) continue;
    await db
      .update(instagramMedia)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(instagramMedia.id, story.id));
    await db
      .update(automations)
      .set({ status: 'paused', updatedAt: now })
      .where(and(eq(automations.instagramMediaId, story.id), eq(automations.status, 'active')));
    expired += 1;
  }
  return { inserted, updated, expired };
}

// 媒體清單只涵蓋近期貼文（第一頁），「不在清單」不代表「已刪除」——可能只是
// 較舊的貼文。因此對每篇候選逐一 GET /{media-id} 查證，只有 Meta 明確回覆
// 物件不存在（code 100 → bad_request）才標記；網路錯誤、限流、token 失效都
// 不能當成刪除證據。標記時一併暫停綁定該貼文的 active 自動化。
export async function markDeletedMedia(
  db: SchemaDb,
  client: MetaClientType,
  accountInternalId: string,
  fetchedMediaIds: Set<string>,
): Promise<{ deleted: number }> {
  const candidates = await db
    .select()
    .from(instagramMedia)
    .where(
      and(
        eq(instagramMedia.instagramAccountId, accountInternalId),
        isNull(instagramMedia.deletedAt),
        // 限動的存活由 syncStories 以 /stories 清單判斷，逐篇查證只適用貼文。
        ne(instagramMedia.mediaType, 'STORY'),
      ),
    );

  let deleted = 0;
  for (const media of candidates) {
    if (fetchedMediaIds.has(media.instagramMediaId)) continue;
    const res = await client.get(media.instagramMediaId, { fields: 'id' });
    if (res.ok) continue;
    if (res.failure?.nonRetryableReason !== 'bad_request') continue;

    const now = new Date().toISOString();
    await db
      .update(instagramMedia)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(instagramMedia.id, media.id));
    await db
      .update(automations)
      .set({ status: 'paused', updatedAt: now })
      .where(and(eq(automations.instagramMediaId, media.id), eq(automations.status, 'active')));
    deleted += 1;
  }
  return { deleted };
}

export interface SyncSummary {
  accounts: number;
  inserted: number;
  updated: number;
  deleted: number;
  expiredStories: number;
  errors: string[];
}

// 帳號自動註冊：instagram_accounts 為空時，用 access token 打 GET /me 取得帳號
// 資訊並寫入。token 本身就足以識別帳號，使用者不需另外提供帳號 ID。
// 回傳 null 表示成功或不需註冊；否則回傳錯誤描述。
export async function ensureAccountRegistered(
  db: SchemaDb,
  client: MetaClientType,
): Promise<string | null> {
  const existing = await db.select().from(instagramAccounts).limit(1);
  if (existing.length > 0) return null;

  const res = await client.get<{
    id?: string;
    username?: string;
    account_type?: string;
    profile_picture_url?: string;
  }>('me', { fields: 'id,username,account_type,profile_picture_url' });
  if (!res.ok || !res.data?.id) {
    const reason = res.failure?.nonRetryableReason ?? (res.failure?.networkError ? 'network_error' : 'http_error');
    const detail = res.failure?.metaErrorMessage
      ? `｜Meta：(code ${res.failure?.metaErrorCode ?? '?'}) ${res.failure.metaErrorMessage}`
      : '';
    return `自動註冊 Instagram 帳號失敗 (HTTP ${res.status}, ${reason})${detail}——請確認 INSTAGRAM_ACCOUNT_ACCESS_TOKEN 是否有效`;
  }
  await db
    .insert(instagramAccounts)
    .values({
      id: crypto.randomUUID(),
      instagramAccountId: res.data.id,
      username: res.data.username ?? null,
      accountType: res.data.account_type ?? null,
      profilePictureUrl: res.data.profile_picture_url ?? null,
    })
    .onConflictDoNothing();
  return null;
}

// 完整的同步流程（手動 API 與 cron 共用）：對每個帳號抓媒體並 upsert。
export async function runScheduledSync(env: AppBindings): Promise<SyncSummary> {
  const db = createDb(env.DB);
  const client = new MetaClient({
    accessToken: env.INSTAGRAM_ACCOUNT_ACCESS_TOKEN,
    graphApiVersion: env.META_GRAPH_API_VERSION,
    baseUrl: env.META_BASE_URL || undefined,
  });

  const registerError = await ensureAccountRegistered(db, client);
  if (registerError) {
    return { accounts: 0, inserted: 0, updated: 0, deleted: 0, expiredStories: 0, errors: [registerError] };
  }

  const accounts = await db.select().from(instagramAccounts);
  const summary: SyncSummary = {
    accounts: accounts.length,
    inserted: 0,
    updated: 0,
    deleted: 0,
    expiredStories: 0,
    errors: [],
  };

  for (const account of accounts) {
    const res = await fetchRecentMedia(client, account.instagramAccountId);
    if (!res.ok) {
      summary.errors.push(
        `account ${account.instagramAccountId}: 抓取媒體失敗 (HTTP ${res.status}, ${res.reason})${res.detail ? `｜Meta：${res.detail}` : ''}`,
      );
      continue;
    }
    const counts = await syncMediaItems(db, account.id, res.items);
    summary.inserted += counts.inserted;
    summary.updated += counts.updated;

    // 清單抓取成功才做刪除偵測——清單失敗時「不在清單」沒有意義。
    const fetchedIds = new Set(res.items.map((i) => i.id).filter(Boolean));
    const removed = await markDeletedMedia(db, client, account.id, fetchedIds);
    summary.deleted += removed.deleted;

    // 限時動態：抓進行中清單 → upsert ＋ 過期標記。抓取失敗不中斷貼文同步，但要讓使用者看到。
    const storiesRes = await fetchActiveStories(client, account.instagramAccountId);
    if (!storiesRes.ok) {
      summary.errors.push(
        `account ${account.instagramAccountId}: 抓取限時動態失敗 (HTTP ${storiesRes.status}, ${storiesRes.reason})${storiesRes.detail ? `｜Meta：${storiesRes.detail}` : ''}`,
      );
    } else {
      const s = await syncStories(db, account.id, storiesRes.items);
      summary.inserted += s.inserted;
      summary.updated += s.updated;
      summary.expiredStories += s.expired;
    }
  }

  // 同步後：讓待命自動化（next_post）綁定新發現、尚無自動化的貼文。
  // 首則留言的 webhook 也會觸發同樣的綁定；這裡補跑一次是為了讓管理者
  // 不必等留言進來，就能在後台看到「排程貼文已接上待命自動化」。
  const allMedia = await db.select().from(instagramMedia);
  const byPublishedAt = allMedia
    .filter((m) => m.publishedAt && !m.deletedAt)
    .sort((a, b) => (a.publishedAt! < b.publishedAt! ? -1 : 1));
  for (const media of byPublishedAt) {
    await bindNextPostAutomation(db, media);
  }

  return summary;
}
