import { join } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import * as schema from '../../src/database/schema';
import { hashPassword } from '../../src/security/password';
import { SESSION_COOKIE_NAME, createSessionCookie } from '../../src/security/session';
import { applyMigrations, createD1Shim } from '../helpers/d1-shim';

const SECRET = 'read-test-secret';
let sqlite: Database.Database;
let env: Record<string, unknown>;
let cookie: string;

beforeEach(async () => {
  sqlite = new Database(':memory:');
  applyMigrations(sqlite, join(__dirname, '../../drizzle/migrations'));
  const db = drizzle(sqlite, { schema });
  await db.insert(schema.adminUsers).values({ id: 'admin-1', email: 'a@b.com', passwordHash: await hashPassword('x') });
  await db.insert(schema.instagramAccounts).values({ id: 'acct', instagramAccountId: 'ig-acct' });
  await db.insert(schema.instagramMedia).values({ id: 'media', instagramAccountId: 'acct', instagramMediaId: 'ig-media', mediaType: 'IMAGE', publishedAt: '2026-01-01T00:00:00Z' });
  await db.insert(schema.automations).values({ id: 'auto', instagramMediaId: 'media', name: 'a', status: 'active' });
  await db.insert(schema.automationRuns).values({ id: 'run1', automationId: 'auto', instagramCommentId: 'c1', instagramMediaId: 'ig-media', status: 'completed', publicReplyStatus: 'success', privateReplyStatus: 'success' });
  await db.insert(schema.apiAttempts).values({ id: 'att1', automationRunId: 'run1', actionType: 'public_reply', attemptNumber: 1, httpStatus: 200 });

  env = {
    DB: createD1Shim(sqlite),
    ADMIN_SESSION_SECRET: SECRET,
    APP_BASE_URL: 'https://igbot.example.com',
    ADMIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };
  cookie = `${SESSION_COOKIE_NAME}=${await createSessionCookie(SECRET, 'admin-1', 3600)}`;
});

const get = (path: string) => new Request(`https://igbot.example.com${path}`, { headers: { Cookie: cookie } });

describe('admin read APIs', () => {
  it('lists automation-runs (auth required)', async () => {
    const app = createApp();
    expect((await app.fetch(new Request('https://igbot.example.com/api/admin/automation-runs'), env)).status).toBe(401);

    const res = await app.fetch(get('/api/admin/automation-runs'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: unknown[] };
    expect(body.runs).toHaveLength(1);
  });

  it('filters automation-runs by status', async () => {
    const res = await createApp().fetch(get('/api/admin/automation-runs?status=nonexistent'), env);
    const body = (await res.json()) as { runs: unknown[] };
    expect(body.runs).toHaveLength(0);
  });

  it('returns run detail with attempts', async () => {
    const res = await createApp().fetch(get('/api/admin/automation-runs/run1'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: { id: string }; attempts: unknown[] };
    expect(body.run.id).toBe('run1');
    expect(body.attempts).toHaveLength(1);
  });

  it('lists media with automation status', async () => {
    const res = await createApp().fetch(get('/api/admin/media'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { media: { automationStatus: string }[] };
    expect(body.media).toHaveLength(1);
    expect(body.media[0].automationStatus).toBe('active');
  });

  it('filters media by automationStatus', async () => {
    const res = await createApp().fetch(get('/api/admin/media?automationStatus=none'), env);
    const body = (await res.json()) as { media: unknown[] };
    expect(body.media).toHaveLength(0);
  });
});
