// 系統控制 Admin API（spec.md 第 16.3–16.5 節）：緊急停止/恢復、系統狀態。
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppBindings } from '../app';
import { createDb } from '../database/client';
import {
  auditLogs,
  automationRuns,
  automations,
  instagramAccounts,
  systemSettings,
} from '../database/schema';
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
    const accounts = await db.select().from(instagramAccounts);
    const autos = await db.select().from(automations);
    const platformByAuto = new Map(
      autos.map((a: { id: string; platform: string | null }) => [a.id, a.platform ?? 'instagram']),
    );

    // 今日統計（以 automation_runs.created_at 當天），可依平台切分。
    const todayPrefix = new Date().toISOString().slice(0, 10);
    const runs = await db
      .select()
      .from(automationRuns)
      .where(sql`substr(${automationRuns.createdAt}, 1, 10) = ${todayPrefix}`);

    type Run = { automationId: string; publicReplyStatus: string | null; privateReplyStatus: string | null; status: string };
    const summarize = (rs: Run[]) => ({
      matched: rs.length,
      publicReplySuccess: rs.filter((r) => r.publicReplyStatus === 'success').length,
      dmSuccess: rs.filter((r) => r.privateReplyStatus === 'success').length,
      failures: rs.filter((r) => r.status === 'completed_with_errors').length,
    });

    return c.json({
      emergencyStop: settings.emergencyStop === 1,
      // 相容欄位（沿用第一個帳號）；新版 UI 請改用 platforms 陣列。
      circuitBreakerStatus: accounts[0]?.circuitBreakerStatus ?? 'unknown',
      tokenExpiresAt: accounts[0]?.tokenExpiresAt ?? null,
      lastWebhookReceivedAt: accounts[0]?.lastWebhookReceivedAt ?? null,
      today: summarize(runs as Run[]),
      // 每個已連接平台一筆：帳號資訊 + 該平台的今日統計（IG/FB 完全分開監控）。
      platforms: accounts.map((a) => {
        const platform = a.platform ?? 'instagram';
        return {
          platform,
          username: a.username,
          circuitBreakerStatus: a.circuitBreakerStatus,
          tokenExpiresAt: a.tokenExpiresAt,
          lastWebhookReceivedAt: a.lastWebhookReceivedAt,
          automationEnabled: a.automationEnabled === 1,
          today: summarize(
            (runs as Run[]).filter((r) => platformByAuto.get(r.automationId) === platform),
          ),
        };
      }),
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

  return app;
}
