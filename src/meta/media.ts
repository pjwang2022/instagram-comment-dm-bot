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
): Promise<{ ok: boolean; items: RawMediaItem[]; status: number; reason?: string }> {
  const fields = 'id,media_type,caption,thumbnail_url,media_url,permalink,timestamp';
  const res = await client.get<{ data?: RawMediaItem[] }>(`${instagramAccountId}/media`, { fields });
  if (!res.ok) {
    return {
      ok: false,
      items: [],
      status: res.status,
      reason: res.failure?.nonRetryableReason ?? (res.failure?.networkError ? 'network_error' : 'http_error'),
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
    return `自動註冊 Instagram 帳號失敗 (HTTP ${res.status}, ${reason})——請確認 INSTAGRAM_ACCOUNT_ACCESS_TOKEN 是否有效`;
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
    return { accounts: 0, inserted: 0, updated: 0, errors: [registerError] };
  }

  const accounts = await db.select().from(instagramAccounts);
  const summary: SyncSummary = { accounts: accounts.length, inserted: 0, updated: 0, errors: [] };

  for (const account of accounts) {
    const res = await fetchRecentMedia(client, account.instagramAccountId);
    if (!res.ok) {
      summary.errors.push(
        `account ${account.instagramAccountId}: 抓取媒體失敗 (HTTP ${res.status}, ${res.reason})`,
      );
      continue;
    }
    const counts = await syncMediaItems(db, account.id, res.items);
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
