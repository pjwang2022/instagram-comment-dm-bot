// 自動化的套用範圍（apply_scope）解析：
// - media：綁定單篇貼文（原本唯一的模式）。
// - next_post：待命自動化——排程/未來貼文上線後，第一次被發現（首則留言 webhook
//   或貼文同步）時自動綁定成該貼文的 media 自動化。解決 Meta API 看不到
//   排程中貼文、無法事先設定的限制。
// - account_default：全帳號預設——貼文沒有專屬自動化時的 fallback，直接套用、
//   不做綁定（同一組設定服務所有新貼文）。
//
// 優先序：media 專屬 > next_post 綁定 > account_default。
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from '../database/schema';
import { automations } from '../database/schema';

type SchemaDb = BaseSQLiteDatabase<'sync' | 'async', unknown, typeof schema>;
type AutomationRow = typeof automations.$inferSelect;
type MediaRow = typeof schema.instagramMedia.$inferSelect;

// next_post 只綁「比自動化晚發布」的貼文，避免舊貼文的第一則留言誤觸綁定。
// publishedAt 缺失時不綁（fail-safe，寧可落到 account_default）。
function isEligibleForNextPost(automation: AutomationRow, media: MediaRow): boolean {
  return Boolean(media.publishedAt && media.publishedAt > automation.createdAt);
}

// 嘗試把最早建立的待命自動化綁到這篇貼文。回傳綁定成功的自動化（或 null）。
// 以「UPDATE ... WHERE instagram_media_id IS NULL」的條件式更新保證原子性：
// 兩篇新貼文同時搶同一個待命自動化時，只有一篇會綁定成功。
export async function bindNextPostAutomation(
  db: SchemaDb,
  media: MediaRow,
): Promise<AutomationRow | null> {
  // 已有專屬自動化的貼文不重複綁定（讓本函式對兩個呼叫端——engine 與同步——都冪等）。
  const existingForMedia = await db
    .select()
    .from(automations)
    .where(eq(automations.instagramMediaId, media.id))
    .limit(1);
  if (existingForMedia[0]) return null;

  const pending = await db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.applyScope, 'next_post'),
        isNull(automations.instagramMediaId),
        eq(automations.platform, media.platform),
      ),
    )
    .orderBy(asc(automations.createdAt));

  for (const candidate of pending) {
    if (!isEligibleForNextPost(candidate, media)) continue;
    await db
      .update(automations)
      .set({
        instagramMediaId: media.id,
        applyScope: 'media',
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(automations.id, candidate.id), isNull(automations.instagramMediaId)));
    const after = await db
      .select()
      .from(automations)
      .where(eq(automations.id, candidate.id))
      .limit(1);
    if (after[0]?.instagramMediaId === media.id) return after[0];
    // 沒綁到（被別篇貼文搶先）→ 試下一個待命自動化。
  }
  return null;
}

// 找出應套用到這篇貼文的 active 自動化：專屬 → 待命綁定 → 全帳號預設。
export async function resolveAutomationForMedia(
  db: SchemaDb,
  media: MediaRow,
): Promise<AutomationRow | null> {
  const bound = await db
    .select()
    .from(automations)
    .where(and(eq(automations.instagramMediaId, media.id), eq(automations.status, 'active')))
    .limit(1);
  if (bound[0]) return bound[0];

  const justBound = await bindNextPostAutomation(db, media);
  if (justBound && justBound.status === 'active') return justBound;
  // 待命自動化綁定後若尚未啟用（draft/paused），不 fallback 到 account_default——
  // 使用者已明確為這篇貼文保留了設定，只是還沒啟用。
  if (justBound) return null;

  const fallback = await db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.applyScope, 'account_default'),
        eq(automations.status, 'active'),
        eq(automations.platform, media.platform),
      ),
    )
    .limit(1);
  return fallback[0] ?? null;
}
