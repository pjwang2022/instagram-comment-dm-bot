// 貼文/Reels 同步（spec.md 第 16.7、20 節）。
// 從 Meta Graph API 抓近期媒體，upsert 進 instagram_media（不刪除既有歷史）。
import { eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { AppBindings } from '../app';
import { createDb } from '../database/client';
import * as schema from '../database/schema';
import { instagramAccounts, instagramMedia } from '../database/schema';
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
  platform: 'instagram' | 'facebook' = 'instagram',
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
        })
        .where(eq(instagramMedia.id, existing[0].id));
      updated += 1;
    } else {
      await db.insert(instagramMedia).values({
        id: crypto.randomUUID(),
        platform,
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

// 從 Meta 抓媒體清單：IG 用 GET /{account-id}/media；FB 粉專用 GET /{page-id}/posts，
// 並把 FB 欄位（message/permalink_url/created_time/full_picture）映射成統一的 RawMediaItem。
export async function fetchRecentMedia(
  client: MetaClientType,
  instagramAccountId: string,
  platform: 'instagram' | 'facebook' = 'instagram',
): Promise<{ ok: boolean; items: RawMediaItem[]; status: number; reason?: string; detail?: string }> {
  if (platform === 'facebook') {
    const res = await client.get<{
      data?: { id: string; message?: string; permalink_url?: string; created_time?: string; full_picture?: string }[];
    }>(`${instagramAccountId}/posts`, { fields: 'id,message,permalink_url,created_time,full_picture' });
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
    const items: RawMediaItem[] = (res.data?.data ?? []).map((p) => ({
      id: p.id,
      media_type: 'POST',
      caption: p.message,
      thumbnail_url: p.full_picture,
      permalink: p.permalink_url,
      timestamp: p.created_time,
    }));
    return { ok: true, items, status: res.status };
  }

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

export interface SyncSummary {
  accounts: number;
  inserted: number;
  updated: number;
  errors: string[];
}

// 帳號自動註冊：該平台尚無帳號資料列時，用 access token 打 GET /me 取得帳號
// 資訊並寫入。token 本身就足以識別帳號，使用者不需另外提供帳號/粉專 ID。
// 回傳 null 表示成功或不需註冊；否則回傳錯誤描述。
export async function ensureAccountRegistered(
  db: SchemaDb,
  client: MetaClientType,
  platform: 'instagram' | 'facebook' = 'instagram',
): Promise<string | null> {
  const existing = await db
    .select()
    .from(instagramAccounts)
    .where(eq(instagramAccounts.platform, platform))
    .limit(1);
  if (existing.length > 0) return null;

  const fields =
    platform === 'facebook' ? 'id,name' : 'id,username,account_type,profile_picture_url';
  const res = await client.get<{
    id?: string;
    username?: string;
    name?: string;
    account_type?: string;
    profile_picture_url?: string;
  }>('me', { fields });
  if (!res.ok || !res.data?.id) {
    const reason = res.failure?.nonRetryableReason ?? (res.failure?.networkError ? 'network_error' : 'http_error');
    const tokenName =
      platform === 'facebook' ? 'FACEBOOK_PAGE_ACCESS_TOKEN' : 'INSTAGRAM_ACCOUNT_ACCESS_TOKEN';
    // 附上 Meta 的原始錯誤碼與訊息，否則「bad_request」之類的粗分類難以除錯。
    const detail = res.failure?.metaErrorMessage
      ? `｜Meta：(code ${res.failure?.metaErrorCode ?? '?'}) ${res.failure.metaErrorMessage}`
      : '';
    return `自動註冊${platform === 'facebook' ? ' Facebook 粉專' : ' Instagram 帳號'}失敗 (HTTP ${res.status}, ${reason})${detail}——請確認 ${tokenName} 是否有效`;
  }
  await db
    .insert(instagramAccounts)
    .values({
      id: crypto.randomUUID(),
      platform,
      instagramAccountId: res.data.id,
      username: res.data.username ?? res.data.name ?? null,
      accountType: res.data.account_type ?? (platform === 'facebook' ? 'PAGE' : null),
      profilePictureUrl: res.data.profile_picture_url ?? null,
    })
    .onConflictDoNothing();
  return null;
}

// 完整的同步流程（手動 API 與 cron 共用）：對每個帳號抓媒體並 upsert。
export async function runScheduledSync(env: AppBindings): Promise<SyncSummary> {
  const db = createDb(env.DB);
  const igClient = new MetaClient({
    accessToken: env.INSTAGRAM_ACCOUNT_ACCESS_TOKEN,
    graphApiVersion: env.META_GRAPH_API_VERSION,
    baseUrl: env.META_BASE_URL || undefined,
  });
  const fbClient = env.FACEBOOK_PAGE_ACCESS_TOKEN
    ? new MetaClient({
        accessToken: env.FACEBOOK_PAGE_ACCESS_TOKEN,
        graphApiVersion: env.META_GRAPH_API_VERSION,
        baseUrl: 'https://graph.facebook.com',
      })
    : null;

  const summary: SyncSummary = { accounts: 0, inserted: 0, updated: 0, errors: [] };

  const registerError = await ensureAccountRegistered(db, igClient, 'instagram');
  if (registerError) summary.errors.push(registerError);
  if (fbClient) {
    const fbRegisterError = await ensureAccountRegistered(db, fbClient, 'facebook');
    if (fbRegisterError) summary.errors.push(fbRegisterError);
  }

  const accounts = await db.select().from(instagramAccounts);
  summary.accounts = accounts.length;

  for (const account of accounts) {
    const platform = (account.platform ?? 'instagram') as 'instagram' | 'facebook';
    const client = platform === 'facebook' ? fbClient : igClient;
    if (!client) {
      summary.errors.push(`account ${account.instagramAccountId}: 未設定 FACEBOOK_PAGE_ACCESS_TOKEN，略過同步`);
      continue;
    }
    const res = await fetchRecentMedia(client, account.instagramAccountId, platform);
    if (!res.ok) {
      summary.errors.push(
        `account ${account.instagramAccountId}: 抓取媒體失敗 (HTTP ${res.status}, ${res.reason})${res.detail ? `｜Meta：${res.detail}` : ''}`,
      );
      continue;
    }
    const counts = await syncMediaItems(db, account.id, res.items, platform);
    summary.inserted += counts.inserted;
    summary.updated += counts.updated;
  }

  // 同步後：讓待命自動化（next_post）綁定新發現、尚無自動化的貼文。
  // 首則留言的 webhook 也會觸發同樣的綁定；這裡補跑一次是為了讓管理者
  // 不必等留言進來，就能在後台看到「排程貼文已接上待命自動化」。
  const allMedia = await db.select().from(instagramMedia);
  const byPublishedAt = allMedia
    .filter((m) => m.publishedAt)
    .sort((a, b) => (a.publishedAt! < b.publishedAt! ? -1 : 1));
  for (const media of byPublishedAt) {
    await bindNextPostAutomation(db, media);
  }

  return summary;
}
