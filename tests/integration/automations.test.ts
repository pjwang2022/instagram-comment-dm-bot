import { join } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import * as schema from '../../src/database/schema';
import { hashPassword } from '../../src/security/password';
import { createSessionCookie, SESSION_COOKIE_NAME } from '../../src/security/session';
import { applyMigrations, createD1Shim } from '../helpers/d1-shim';

const SECRET = 'automations-test-secret';
let sqlite: Database.Database;
let env: Record<string, unknown>;
let cookie: string;

beforeEach(async () => {
  sqlite = new Database(':memory:');
  applyMigrations(sqlite, join(__dirname, '../../drizzle/migrations'));
  const db = drizzle(sqlite, { schema });
  await db.insert(schema.adminUsers).values({ id: 'admin-1', email: 'a@b.com', passwordHash: await hashPassword('x') });
  await db.insert(schema.instagramAccounts).values({ id: 'acct', instagramAccountId: 'ig-acct' });
  await db.insert(schema.instagramMedia).values({ id: 'media', instagramAccountId: 'acct', instagramMediaId: 'ig-media', mediaType: 'IMAGE' });

  env = {
    DB: createD1Shim(sqlite),
    ADMIN_SESSION_SECRET: SECRET,
    ADMIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };
  cookie = `${SESSION_COOKIE_NAME}=${await createSessionCookie(SECRET, 'admin-1', 3600)}`;
});

function req(path: string, body?: object) {
  return new Request(`https://igbot.example.com/api/admin/automations${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://igbot.example.com', Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('automations CRUD + activation', () => {
  it('requires auth', async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request('https://igbot.example.com/api/admin/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://igbot.example.com' },
        body: '{}',
      }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('creates an automation with keywords and variants', async () => {
    const app = createApp();
    const res = await app.fetch(
      req('', {
        instagramMediaId: 'media',
        name: 'adhd',
        matchType: 'contains_any',
        keywords: ['ADHD', 'adhd', '想要'], // dup normalizes away
        publicReplyVariants: ['已私訊你囉'],
        openingDm: '這是連結',
        buttonUrl: 'https://example.com',
        buttonText: '開啟',
      }),
      env,
    );
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    const db = drizzle(sqlite, { schema });
    const allKws = (await db.select().from(schema.automationKeywords)).filter((k) => k.automationId === id);
    expect(allKws).toHaveLength(2); // ADHD + adhd collapse to one, plus 想要
    const variants = (await db.select().from(schema.publicReplyVariants)).filter((v) => v.automationId === id);
    expect(variants).toHaveLength(1);
  });

  it('activates a valid automation, rejects an invalid one', async () => {
    const app = createApp();
    const created = await app.fetch(
      req('', {
        instagramMediaId: 'media',
        name: 'adhd',
        keywords: ['adhd'],
        publicReplyVariants: ['已私訊你囉'],
        privateReplyEnabled: true,
        openingDm: '這是連結',
        buttonUrl: 'https://example.com',
      }),
      env,
    );
    const { id } = (await created.json()) as { id: string };

    const ok = await app.fetch(req(`/${id}/activate`), env);
    expect(ok.status).toBe(200);
    const db = drizzle(sqlite, { schema });
    expect((await db.select().from(schema.automations))[0].status).toBe('active');

    // pause
    const paused = await app.fetch(req(`/${id}/pause`), env);
    expect(paused.status).toBe(200);
    expect((await db.select().from(schema.automations))[0].status).toBe('paused');
  });

  it('blocks activation when keywords are missing', async () => {
    const app = createApp();
    const created = await app.fetch(
      req('', { instagramMediaId: 'media', name: 'x', privateReplyEnabled: true, openingDm: 'hi', keywords: [] }),
      env,
    );
    const { id } = (await created.json()) as { id: string };
    const res = await app.fetch(req(`/${id}/activate`), env);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { reasons: string[] };
    expect(body.reasons).toContain('keywords_required');
  });
});
