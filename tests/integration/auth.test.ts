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

describe('GET /api/admin/auth/me', () => {
  it('returns the logged-in admin email', async () => {
    await seedAdmin('owner@example.com', 'correct-password-123');
    const app = createApp();
    const loginRes = await app.fetch(
      loginRequest({ email: 'owner@example.com', password: 'correct-password-123' }),
      env,
    );
    const cookie = (loginRes.headers.get('Set-Cookie') ?? '').split(';')[0];

    const res = await app.fetch(
      new Request('https://igbot.example.com/api/admin/auth/me', { headers: { Cookie: cookie } }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: 'owner@example.com' });
  });

  it('rejects the request without a session', async () => {
    const app = createApp();
    const res = await app.fetch(new Request('https://igbot.example.com/api/admin/auth/me'), env);
    expect(res.status).toBe(401);
  });
});

function setupRequest(body: object) {
  return new Request('https://igbot.example.com/api/admin/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://igbot.example.com' },
    body: JSON.stringify(body),
  });
}

describe('first-run setup（GET setup-status / POST setup）', () => {
  it('reports needsSetup=true only while no admin exists', async () => {
    const app = createApp();
    const before = await app.fetch(
      new Request('https://igbot.example.com/api/admin/auth/setup-status'),
      env,
    );
    expect(await before.json()).toEqual({ needsSetup: true });

    await seedAdmin('admin@example.com', 'correct-password-123');
    const after = await app.fetch(
      new Request('https://igbot.example.com/api/admin/auth/setup-status'),
      env,
    );
    expect(await after.json()).toEqual({ needsSetup: false });
  });

  it('creates the first admin, sets a session cookie, and allows subsequent login', async () => {
    const app = createApp();
    const res = await app.fetch(
      setupRequest({ email: 'first@example.com', password: 'long-enough-password' }),
      env,
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain('ig_admin_session=');
    expect(setCookie).toContain('HttpOnly');

    const db = drizzle(sqlite, { schema });
    const admins = await db.select().from(adminUsers);
    expect(admins).toHaveLength(1);
    expect(admins[0].email).toBe('first@example.com');

    const loginRes = await app.fetch(
      loginRequest({ email: 'first@example.com', password: 'long-enough-password' }),
      env,
    );
    expect(loginRes.status).toBe(200);
  });

  it('permanently rejects setup once an admin exists', async () => {
    await seedAdmin('admin@example.com', 'correct-password-123');
    const app = createApp();
    const res = await app.fetch(
      setupRequest({ email: 'intruder@example.com', password: 'long-enough-password' }),
      env,
    );
    expect(res.status).toBe(403);

    const db = drizzle(sqlite, { schema });
    const admins = await db.select().from(adminUsers);
    expect(admins).toHaveLength(1);
    expect(admins[0].email).toBe('admin@example.com');
  });

  it('only lets one of two competing setup requests win', async () => {
    const app = createApp();
    const first = await app.fetch(
      setupRequest({ email: 'first@example.com', password: 'long-enough-password' }),
      env,
    );
    const second = await app.fetch(
      setupRequest({ email: 'second@example.com', password: 'long-enough-password' }),
      env,
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(403);

    const db = drizzle(sqlite, { schema });
    const admins = await db.select().from(adminUsers);
    expect(admins).toHaveLength(1);
    expect(admins[0].email).toBe('first@example.com');
  });

  it('rejects a short password and a malformed email with 400', async () => {
    const app = createApp();
    const shortPw = await app.fetch(
      setupRequest({ email: 'first@example.com', password: 'short' }),
      env,
    );
    expect(shortPw.status).toBe(400);

    const badEmail = await app.fetch(
      setupRequest({ email: 'not-an-email', password: 'long-enough-password' }),
      env,
    );
    expect(badEmail.status).toBe(400);

    const db = drizzle(sqlite, { schema });
    expect(await db.select().from(adminUsers)).toHaveLength(0);
  });

  it('rejects cross-origin setup (CSRF) and writes audit logs without secrets', async () => {
    const app = createApp();
    const crossOrigin = await app.fetch(
      new Request('https://igbot.example.com/api/admin/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
        body: JSON.stringify({ email: 'first@example.com', password: 'long-enough-password' }),
      }),
      env,
    );
    expect(crossOrigin.status).toBe(403);

    await app.fetch(setupRequest({ email: 'first@example.com', password: 'long-enough-password' }), env);
    await app.fetch(setupRequest({ email: 'second@example.com', password: 'long-enough-password' }), env);

    const db = drizzle(sqlite, { schema });
    const logs = await db.select().from(auditLogs);
    const actions = logs.map((l) => l.action).sort();
    expect(actions).toEqual(['admin.setup.rejected', 'admin.setup.success']);
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain('long-enough-password');
    expect(serialized).not.toContain('pbkdf2$');
  });
});
