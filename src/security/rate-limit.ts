// 頻率限制（混合方案，依 spec.md 第 18.4 節與架構審查）：
// - Admin API（每 Session 每分鐘 120 次）：Cloudflare 原生 Rate Limiting binding（period=60）。
// - 登入（每 IP 15 分鐘 10 次）：原生 binding 週期只支援 10/60 秒，無法表示 15 分鐘窗口，
//   改用 login_rate_limits D1 計數表做固定窗口計數。
// - 兩者故障一律 fail-closed（回 429），不得默默放行。
import { and, eq, lt, sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { createMiddleware } from 'hono/factory';
import type { AppBindings } from '../app';
import { createDb } from '../database/client';
import * as schema from '../database/schema';
import { loginRateLimits } from '../database/schema';

export const LOGIN_WINDOW_SECONDS = 15 * 60;
export const LOGIN_MAX_ATTEMPTS = 10;
export const ADMIN_API_LIMIT = 120;
export const ADMIN_API_PERIOD_SECONDS = 60;

// 同時相容 drizzle-orm/d1（async）與 better-sqlite3（測試用）的資料庫型別。
type SchemaDb = BaseSQLiteDatabase<'sync' | 'async', unknown, typeof schema>;

// 對齊到 15 分鐘窗口起點，回傳 ISO 字串。
export function loginWindowStart(nowMs: number): string {
  const windowStartSec = Math.floor(nowMs / 1000 / LOGIN_WINDOW_SECONDS) * LOGIN_WINDOW_SECONDS;
  return new Date(windowStartSec * 1000).toISOString();
}

// 登入頻率限制核心邏輯（可被單元測試以 better-sqlite3 db 直接呼叫）。
// 回傳 true = 允許本次嘗試；false = 已達上限或發生錯誤（fail-closed）。
export async function checkLoginRateLimit(
  db: SchemaDb,
  ip: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  try {
    const windowStart = loginWindowStart(nowMs);

    // 機會性清掉這個 IP 的過期窗口（全域過期清理由每日 cleanup cron 負責）。
    await db
      .delete(loginRateLimits)
      .where(and(eq(loginRateLimits.ipAddress, ip), lt(loginRateLimits.windowStart, windowStart)));

    // 原子 upsert：同一 (ip, window) 靠 unique index 保證單列，遞增與取回新值是
    // 同一條語句，併發請求無法像舊的 SELECT-then-UPDATE 那樣覆蓋彼此的計數。
    const rows = await db
      .insert(loginRateLimits)
      .values({ id: crypto.randomUUID(), ipAddress: ip, windowStart, attemptCount: 1 })
      .onConflictDoUpdate({
        target: [loginRateLimits.ipAddress, loginRateLimits.windowStart],
        set: {
          attemptCount: sql`${loginRateLimits.attemptCount} + 1`,
          updatedAt: new Date().toISOString(),
        },
      })
      .returning({ attemptCount: loginRateLimits.attemptCount });

    const count = rows[0]?.attemptCount;
    if (typeof count !== 'number') return false; // fail-closed
    return count <= LOGIN_MAX_ATTEMPTS;
  } catch {
    // fail-closed：限流元件出錯時視為已達限制。
    return false;
  }
}

// 登入端點的頻率限制 middleware（以 CF-Connecting-IP 當 key）。
export function loginRateLimitMiddleware() {
  return createMiddleware<{ Bindings: AppBindings }>(async (c, next) => {
    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
    const allowed = await checkLoginRateLimit(createDb(c.env.DB), ip);
    if (!allowed) {
      return c.json({ error: '登入嘗試次數過多，請稍後再試。' }, 429);
    }
    return next();
  });
}

// 一般 Admin API 的頻率限制 middleware（原生 binding，key 優先用 session 的 adminUserId）。
export function adminApiRateLimitMiddleware() {
  return createMiddleware<{ Bindings: AppBindings; Variables: { adminUserId?: string } }>(
    async (c, next) => {
      const key = c.get('adminUserId') ?? c.req.header('CF-Connecting-IP') ?? 'anonymous';
      try {
        const { success } = await c.env.ADMIN_RATE_LIMITER.limit({ key });
        if (!success) {
          return c.json({ error: '請求過於頻繁，請稍後再試。' }, 429);
        }
      } catch {
        // fail-closed：binding 不可用時拒絕，不放行。
        return c.json({ error: '頻率限制檢查失敗。' }, 429);
      }
      return next();
    },
  );
}
