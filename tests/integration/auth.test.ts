import { join } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import * as schema from '../../src/database/schema';
import { adminUsers, auditLogs } from '../../src/database/schema';
import { hashPassword } from '../../src/security/password';
import { applyMigrations, createD1Shim } from '../helpers/d1-shim';

const alwaysAllowLimiter = { limit: async () => ({ success: true }) };

const BASE_ENV = {
  ADMIN_SESSION_SECRET: 'integration-test-secret',
  APP_BASE_URL: 'https://igbot.example.com',
  ADMIN_RATE_LIMITER: alwaysAllowLimiter,
} as const;

let sqlite: Database.Database;
let env: Record<string, unknown>;

async function seedAdmin(email: string, password: string) {
  const db = drizzle(sqlite, { schema });
  await db.insert(adminUsers).values({
    id: 'admin-1',
    email,
    passwordHash: await hashPassword(password),
  });
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  applyMigrations(sqlite, join(__dirname, '../../drizzle/migrations'));
  env = { ...BASE_ENV, DB: createD1Shim(sqlite) };
});

function loginRequest(body: object) {
  return new Request('https://igbot.example.com/api/admin/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://igbot.example.com' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/auth/login', () => {
  it('logs in with correct credentials and sets a session cookie', async () => {
    await seedAdmin('admin@example.com', 'correct-password-123');
    const app = createApp();
    const res = await app.fetch(loginRequest({ email: 'admin@example.com', password: 'correct-password-123' }), env);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain('ig_admin_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
  });

  it('rejects a wrong password with a generic 401', async () => {
    await seedAdmin('admin@example.com', 'correct-password-123');
    const app = createApp();
    const res = await app.fetch(loginRequest({ email: 'admin@example.com', password: 'wrong' }), env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Email 或密碼錯誤' });
  });

  it('rejects a non-existent email with the same 401 shape', async () => {
    await seedAdmin('admin@example.com', 'correct-password-123');
    const app = createApp();
    const res = await app.fetch(loginRequest({ email: 'nobody@example.com', password: 'whatever12345' }), env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Email 或密碼錯誤' });
  });

  it('writes an audit log for both success and failure without secrets', async () => {
    await seedAdmin('admin@example.com', 'correct-password-123');
    const app = createApp();
    await app.fetch(loginRequest({ email: 'admin@example.com', password: 'correct-password-123' }), env);
    await app.fetch(loginRequest({ email: 'admin@example.com', password: 'wrong' }), env);

    const db = drizzle(sqlite, { schema });
    const logs = await db.select().from(auditLogs);
    const actions = logs.map((l) => l.action).sort();
    expect(actions).toEqual(['admin.login.failure', 'admin.login.success']);
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain('correct-password-123');
    expect(serialized).not.toContain('$argon2');
  });
});

describe('protected routes and logout', () => {
  it('rejects logout without a valid session cookie', async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request('https://igbot.example.com/api/admin/auth/logout', {
        method: 'POST',
        headers: { Origin: 'https://igbot.example.com' },
      }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('rejects a cross-origin logout even with a valid cookie (CSRF)', async () => {
    await seedAdmin('admin@example.com', 'correct-password-123');
    const app = createApp();
    const loginRes = await app.fetch(
      loginRequest({ email: 'admin@example.com', password: 'correct-password-123' }),
      env,
    );
    const cookie = (loginRes.headers.get('Set-Cookie') ?? '').split(';')[0];

    const res = await app.fetch(
      new Request('https://igbot.example.com/api/admin/auth/logout', {
        method: 'POST',
        headers: { Origin: 'https://evil.example.com', Cookie: cookie },
      }),
      env,
    );
    expect(res.status).toBe(403);
  });

  it('accepts logout with a valid session cookie and clears it', async () => {
    await seedAdmin('admin@example.com', 'correct-password-123');
    const app = createApp();

    const loginRes = await app.fetch(
      loginRequest({ email: 'admin@example.com', password: 'correct-password-123' }),
      env,
    );
    const cookie = (loginRes.headers.get('Set-Cookie') ?? '').split(';')[0];

    const logoutRes = await app.fetch(
      new Request('https://igbot.example.com/api/admin/auth/logout', {
        method: 'POST',
        headers: { Origin: 'https://igbot.example.com', Cookie: cookie },
      }),
      env,
    );
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.headers.get('Set-Cookie') ?? '').toContain('Max-Age=0');
  });
});
