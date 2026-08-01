// 統一送出 gate（spec.md 第 19 節的限額面 + 緊急停止貼近 sink 的重查）。
// 每次外發（公開回覆 / Private Reply）前呼叫：
//   1. 重讀 emergency stop——修掉「job 開頭查一次、之後不再查」的 TOCTOU 窗口。
//   2. 自動化每日觸發上限（automations.daily_limit）：以當日（台北時間）該自動化的 run 數判斷。
//   3. 系統每分鐘/每日上限（system_settings.max_*）：以 send_counters 原子 upsert「先保留再發送」，
//      保留了但最後沒發出的名額只會讓實際量更保守，永遠不會超限（fail-closed）。
import { and, eq, gte, sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from '../database/schema';
import { automationRuns, sendCounters, systemSettings } from '../database/schema';

type SchemaDb = BaseSQLiteDatabase<'sync' | 'async', unknown, typeof schema>;

export type SendActionType = 'public_reply' | 'private_reply';

export type SendGateDenialReason =
  | 'emergency_stop'
  | 'automation_daily_limit'
  | 'system_minute_limit'
  | 'system_daily_limit';

export interface SendGateResult {
  allowed: boolean;
  reason: SendGateDenialReason | null;
}

// 台灣不使用日光節約時間，固定 UTC+8。
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function minuteWindowStart(nowMs: number): string {
  return new Date(Math.floor(nowMs / MINUTE_MS) * MINUTE_MS).toISOString();
}

// 「每日」以台北日界線計（營運者視角的一天），回傳該日 00:00 台北的 UTC ISO。
export function taipeiDayWindowStart(nowMs: number): string {
  const dayStartShifted = Math.floor((nowMs + TAIPEI_OFFSET_MS) / DAY_MS) * DAY_MS;
  return new Date(dayStartShifted - TAIPEI_OFFSET_MS).toISOString();
}

// 原子保留一個名額：同一 (scope, window) 單列 upsert 遞增並取回新值。
// 回傳遞增後的 count；呼叫端以 count > cap 判定超限。
async function reserveCounter(db: SchemaDb, scopeKey: string, windowStart: string): Promise<number> {
  const now = new Date().toISOString();
  const rows = await db
    .insert(sendCounters)
    .values({ id: crypto.randomUUID(), scopeKey, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [sendCounters.scopeKey, sendCounters.windowStart],
      set: { count: sql`${sendCounters.count} + 1`, updatedAt: now },
    })
    .returning({ count: sendCounters.count });
  const count = rows[0]?.count;
  if (typeof count !== 'number') throw new Error('send counter reservation failed');
  return count;
}

export interface SendGateInput {
  actionType: SendActionType;
  automationId: string;
  automationDailyLimit: number | null;
  nowMs?: number;
}

export async function acquireSendPermission(
  db: SchemaDb,
  input: SendGateInput,
): Promise<SendGateResult> {
  const nowMs = input.nowMs ?? Date.now();

  // 1. 緊急停止（貼近 sink 重查）。
  const settings = (await db.select().from(systemSettings).limit(1))[0];
  if (settings && settings.emergencyStop === 1) {
    return { allowed: false, reason: 'emergency_stop' };
  }

  // 2. 自動化每日觸發上限。run 在 gate 之前已建立，count 含當前 run；
  //    超過（> limit）才拒絕，等於 limit 的第 N 個 run 仍可送。
  if (input.automationDailyLimit != null) {
    const dayStart = taipeiDayWindowStart(nowMs);
    const rows = await db
      .select({ n: sql<number>`count(*)` })
      .from(automationRuns)
      .where(
        and(eq(automationRuns.automationId, input.automationId), gte(automationRuns.createdAt, dayStart)),
      );
    if ((rows[0]?.n ?? 0) > input.automationDailyLimit) {
      return { allowed: false, reason: 'automation_daily_limit' };
    }
  }

  // 3. 系統層分鐘/每日上限（依動作類型取對應設定）。
  const minuteCap =
    input.actionType === 'public_reply'
      ? (settings?.maxPublicRepliesPerMinute ?? null)
      : (settings?.maxPrivateRepliesPerMinute ?? null);
  const dayCap =
    input.actionType === 'public_reply'
      ? (settings?.maxPublicRepliesPerDay ?? null)
      : (settings?.maxPrivateRepliesPerDay ?? null);

  if (minuteCap != null) {
    const count = await reserveCounter(db, `${input.actionType}:minute`, minuteWindowStart(nowMs));
    if (count > minuteCap) return { allowed: false, reason: 'system_minute_limit' };
  }
  if (dayCap != null) {
    const count = await reserveCounter(db, `${input.actionType}:day`, taipeiDayWindowStart(nowMs));
    if (count > dayCap) return { allowed: false, reason: 'system_daily_limit' };
  }

  return { allowed: true, reason: null };
}
