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
});

