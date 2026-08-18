import { join } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import * as schema from '../../src/database/schema';
import { hashPassword } from '../../src/security/password';
import { SESSION_COOKIE_NAME, createSessionCookie } from '../../src/security/session';
import { applyMigrations, createD1Shim } from '../helpers/d1-shim';

const SECRET = 'system-test-secret';
let sqlite: Database.Database;
let env: Record<string, unknown>;
let cookie: string;

beforeEach(async () => {
  sqlite = new Database(':memory:');
  applyMigrations(sqlite, join(__dirname, '../../drizzle/migrations'));
  const db = drizzle(sqlite, { schema });
  await db.insert(schema.adminUsers).values({ id: 'admin-1', email: 'a@b.com', passwordHash: await hashPassword('x') });
  await db.insert(schema.instagramAccounts).values({ id: 'acct', instagramAccountId: 'ig-acct', circuitBreakerStatus: 'closed' });
  env = {
    DB: createD1Shim(sqlite),
    ADMIN_SESSION_SECRET: SECRET,
    ADMIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };
  cookie = `${SESSION_COOKIE_NAME}=${await createSessionCookie(SECRET, 'admin-1', 3600)}`;
});

function post(path: string) {
  return new Request(`https://igbot.example.com/api/admin/system${path}`, {
    method: 'POST',
    headers: { Origin: 'https://igbot.example.com', Cookie: cookie },
  });
}
function get(path: string) {
  return new Request(`https://igbot.example.com/api/admin/system${path}`, { headers: { Cookie: cookie } });
}

describe('system control API', () => {
  it('requires auth for status', async () => {
    const res = await createApp().fetch(
      new Request('https://igbot.example.com/api/admin/system/status'),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('toggles emergency stop and reflects it in status', async () => {
    const app = createApp();

    let status = await (await app.fetch(get('/status'), env)).json();
    expect(status.emergencyStop).toBe(false);

    const stop = await app.fetch(post('/emergency-stop'), env);
    expect(stop.status).toBe(200);
    status = await (await app.fetch(get('/status'), env)).json();
    expect(status.emergencyStop).toBe(true);

    const resume = await app.fetch(post('/resume'), env);
    expect(resume.status).toBe(200);
    status = await (await app.fetch(get('/status'), env)).json();
    expect(status.emergencyStop).toBe(false);
  });

  it('writes audit logs for stop and resume', async () => {
    const app = createApp();
    await app.fetch(post('/emergency-stop'), env);
    await app.fetch(post('/resume'), env);
    const logs = (await drizzle(sqlite, { schema }).select().from(schema.auditLogs)).map((l) => l.action);
    expect(logs).toContain('system.emergency_stop');
    expect(logs).toContain('system.resume');
  });

  it('reports circuit breaker status', async () => {
    const status = await (await createApp().fetch(get('/status'), env)).json();
    expect(status.circuitBreakerStatus).toBe('closed');
  });

  it('resets an open circuit breaker and writes an audit log', async () => {
    const db = drizzle(sqlite, { schema });
    sqlite.prepare("UPDATE instagram_accounts SET circuit_breaker_status = 'open'").run();

    const app = createApp();
    const res = await app.fetch(post('/circuit-breaker/reset'), env);
    expect(res.status).toBe(200);

    const account = (await db.select().from(schema.instagramAccounts))[0];
    expect(account.circuitBreakerStatus).toBe('closed');
    const logs = (await db.select().from(schema.auditLogs)).map((l) => l.action);
    expect(logs).toContain('system.circuit_breaker_reset');

    const status = await (await app.fetch(get('/status'), env)).json();
    expect(status.circuitBreakerStatus).toBe('closed');
  });

  it('requires auth for circuit breaker reset', async () => {
    const res = await createApp().fetch(
      new Request('https://igbot.example.com/api/admin/system/circuit-breaker/reset', {
        method: 'POST',
        headers: { Origin: 'https://igbot.example.com' },
      }),
      env,
    );
    expect(res.status).toBe(401);
  });
});

describe('status — account info', () => {
  it('returns the account username and profile picture', async () => {
    sqlite
      .prepare("UPDATE instagram_accounts SET username = 'octave', profile_picture_url = 'https://cdn/p.jpg'")
      .run();
    const status = await (await createApp().fetch(get('/status'), env)).json();
    expect(status.account).toEqual({ username: 'octave', profilePictureUrl: 'https://cdn/p.jpg' });
  });

  it('returns null account when none is registered', async () => {
    sqlite.prepare('DELETE FROM instagram_accounts').run();
    const status = await (await createApp().fetch(get('/status'), env)).json();
    expect(status.account).toBeNull();
  });
});
describe('status — today（台北時區）與 total 統計', () => {
  it('counts old runs in total but not in today', async () => {
    const db = drizzle(sqlite, { schema });
    await db.insert(schema.automationRuns).values({
      id: 'run-old',
      automationId: 'auto',
      instagramCommentId: 'c-old',
      instagramMediaId: 'ig-media',
      status: 'completed',
      publicReplyStatus: 'success',
      privateReplyStatus: 'success',
      createdAt: '2020-01-01T00:00:00.000Z',
    });
    await db.insert(schema.automationRuns).values({
      id: 'run-now',
      automationId: 'auto',
      instagramCommentId: 'c-now',
      instagramMediaId: 'ig-media',
      status: 'completed',
      privateReplyStatus: 'success',
    });
    const status = await (await createApp().fetch(get('/status'), env)).json();
    expect(status.total.matched).toBe(2);
    expect(status.total.dmSuccess).toBe(2);
    expect(status.today.matched).toBe(1);
    expect(status.today.publicReplySuccess).toBe(0);
  });
});
describe('status — series 日/週/月 DM 趨勢序列', () => {
  it('returns daily(30)/weekly(12)/monthly(12) with runs bucketed by Taipei date', async () => {
    const db = drizzle(sqlite, { schema });
    await db.insert(schema.automationRuns).values({
      id: 'run-1',
      automationId: 'auto',
      instagramCommentId: 'c-1',
      instagramMediaId: 'ig-media',
      status: 'completed',
      privateReplyStatus: 'success',
    });
    const status = await (await createApp().fetch(get('/status'), env)).json();
    expect(status.series.daily).toHaveLength(30);
    expect(status.series.weekly).toHaveLength(12);
    expect(status.series.monthly).toHaveLength(12);
    // 今天的 run 落在每個粒度的最後一桶
    expect(status.series.daily[29].dmSuccess).toBe(1);
    expect(status.series.weekly[11].dmSuccess).toBe(1);
    expect(status.series.monthly[11].dmSuccess).toBe(1);
    expect(status.series.daily[29].label).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(status.series.monthly[11].label).toMatch(/^\d{4}-\d{2}$/);
    // 很久以前的 run 不會出現在近 30 天
    expect(status.series.daily.slice(0, 29).every((d: { dmSuccess: number }) => d.dmSuccess === 0)).toBe(true);
  });
});
