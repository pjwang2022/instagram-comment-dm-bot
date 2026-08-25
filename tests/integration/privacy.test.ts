import { join } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import * as schema from '../../src/database/schema';
import { applyMigrations, createD1Shim } from '../helpers/d1-shim';

let sqlite: Database.Database;
let env: Record<string, unknown>;

beforeEach(() => {
  sqlite = new Database(':memory:');
  applyMigrations(sqlite, join(__dirname, '../../drizzle/migrations'));
  env = { DB: createD1Shim(sqlite) };
});

describe('GET /privacy', () => {
  it('uses the Instagram account DM as the contact method (no email exposed)', async () => {
    const db = drizzle(sqlite, { schema });
    await db.insert(schema.adminUsers).values({
      id: 'admin-1',
      email: 'owner@example.com',
      passwordHash: 'x',
    });
    await db.insert(schema.instagramAccounts).values({
      id: 'acct',
      instagramAccountId: 'ig-acct',
      username: 'myshop',
    });

    const app = createApp();
    const res = await app.fetch(new Request('https://igbot.example.com/privacy'), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('@myshop');
    expect(html).toContain('https://www.instagram.com/myshop');
    // 管理者登入 Email 是憑證的一半，不得出現在公開頁面。
    expect(html).not.toContain('owner@example.com');
  });

  it('still renders with a generic fallback before the account is synced', async () => {
    const app = createApp();
    const res = await app.fetch(new Request('https://igbot.example.com/privacy'), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Instagram 帳號的私訊');
    expect(html).not.toContain('@example.com');
  });
});
