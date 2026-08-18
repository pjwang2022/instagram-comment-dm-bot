// 系統控制 Admin API（spec.md 第 16.3–16.5 節）：緊急停止/恢復、系統狀態。
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppBindings } from '../app';
import { createDb } from '../database/client';
import { auditLogs, automationRuns, instagramAccounts, systemSettings } from '../database/schema';
import { csrfMiddleware } from '../security/csrf';
import { adminApiRateLimitMiddleware } from '../security/rate-limit';
import { requireAdminAuth } from './auth';

const SETTINGS_ID = 'default';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureSettings(db: any) {
  const rows = await db.select().from(systemSettings).where(eq(systemSettings.id, SETTINGS_ID)).limit(1);
  if (rows.length === 0) {
    await db.insert(systemSettings).values({ id: SETTINGS_ID, emergencyStop: 0 });
    return { id: SETTINGS_ID, emergencyStop: 0 };
  }
  return rows[0];
}

async function setEmergencyStop(
  env: AppBindings,
  adminUserId: string,
  ip: string | null,
  stop: boolean,
): Promise<void> {
  const db = createDb(env.DB);
  await ensureSettings(db);
  await db
    .update(systemSettings)
    .set({ emergencyStop: stop ? 1 : 0, updatedAt: new Date().toISOString() })
    .where(eq(systemSettings.id, SETTINGS_ID));
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    adminUserId,
    action: stop ? 'system.emergency_stop' : 'system.resume',
    entityType: 'system_settings',
    entityId: SETTINGS_ID,
    ipAddress: ip,
  });
}

export function createSystemRoutes() {
  const app = new Hono<{ Bindings: AppBindings; Variables: { adminUserId: string } }>();

  app.use('*', requireAdminAuth());

  // GET status（唯讀，不需 CSRF/限流以外的保護）
  app.get('/status', adminApiRateLimitMiddleware(), async (c) => {
    const db = createDb(c.env.DB);
    const settings = await ensureSettings(db);
    const accounts = await db.select().from(instagramAccounts).limit(1);

    // 「今日」以台北時區（UTC+8）為界——created_at 存 UTC ISO 字串，取台北當日 00:00
    // 對應的 UTC 時刻當下界後用字串比較（ISO UTC 字串的字典序＝時間序）。
    // 用 UTC 日界會讓台北早上 8 點前的觸發被算到「昨天」，頁首顯示 0 造成誤判。
    const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
    const taipeiDay = new Date(Date.now() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
    const dayStartUtc = new Date(Date.parse(`${taipeiDay}T00:00:00Z`) - TAIPEI_OFFSET_MS).toISOString();

    const runs = await db.select().from(automationRuns);
    const todayRuns = runs.filter((r: { createdAt: string }) => r.createdAt >= dayStartUtc);

    // 近 14 天逐日統計（台北時區），供首頁趨勢圖。以 run 的 created_at 換算台北日期分桶。
    const toTaipeiDate = (iso: string) =>
      new Date(Date.parse(iso) + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
    const byDate = new Map<string, Array<(typeof runs)[number]>>();
    for (const r of runs) {
      const d = toTaipeiDate(r.createdAt);
      const bucket = byDate.get(d);
      if (bucket) bucket.push(r);
      else byDate.set(d, [r]);
    }
    const daily: Array<{ date: string; matched: number; dmSuccess: number; failures: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const date = new Date(Date.parse(`${taipeiDay}T00:00:00Z`) - i * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const bucket = byDate.get(date) ?? [];
      daily.push({
        date,
        matched: bucket.length,
        dmSuccess: bucket.filter((r) => r.privateReplyStatus === 'success').length,
        failures: bucket.filter((r) => r.status === 'completed_with_errors').length,
      });
    }
    const countStats = (rows: Array<{ publicReplyStatus: string | null; privateReplyStatus: string | null; status: string }>) => ({
      matched: rows.length,
      publicReplySuccess: rows.filter((r) => r.publicReplyStatus === 'success').length,
      dmSuccess: rows.filter((r) => r.privateReplyStatus === 'success').length,
      failures: rows.filter((r) => r.status === 'completed_with_errors').length,
    });

    return c.json({
      emergencyStop: settings.emergencyStop === 1,
      circuitBreakerStatus: accounts[0]?.circuitBreakerStatus ?? 'unknown',
      // 首頁 IG 個人頁式頁首用。
      account: accounts[0]
        ? { username: accounts[0].username, profilePictureUrl: accounts[0].profilePictureUrl }
        : null,
      tokenExpiresAt: accounts[0]?.tokenExpiresAt ?? null,
      lastWebhookReceivedAt: accounts[0]?.lastWebhookReceivedAt ?? null,
      today: countStats(todayRuns),
      total: countStats(runs),
      daily,
    });
  });

  // 修改型：CSRF + 限流
  app.post('/emergency-stop', csrfMiddleware(), adminApiRateLimitMiddleware(), async (c) => {
    await setEmergencyStop(c.env, c.get('adminUserId'), c.req.header('CF-Connecting-IP') ?? null, true);
    return c.json({ ok: true, emergencyStop: true });
  });

  app.post('/resume', csrfMiddleware(), adminApiRateLimitMiddleware(), async (c) => {
    await setEmergencyStop(c.env, c.get('adminUserId'), c.req.header('CF-Connecting-IP') ?? null, false);
    return c.json({ ok: true, emergencyStop: false });
  });

  // 熔斷復歸：把帳號的熔斷狀態設回 closed（單帳號系統，直接更新全部帳號列）。
  app.post('/circuit-breaker/reset', csrfMiddleware(), adminApiRateLimitMiddleware(), async (c) => {
    const db = createDb(c.env.DB);
    await db
      .update(instagramAccounts)
      .set({ circuitBreakerStatus: 'closed', updatedAt: new Date().toISOString() });
    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      adminUserId: c.get('adminUserId'),
      action: 'system.circuit_breaker_reset',
      entityType: 'instagram_accounts',
      ipAddress: c.req.header('CF-Connecting-IP') ?? null,
    });
    return c.json({ ok: true, circuitBreakerStatus: 'closed' });
  });

  return app;
}
