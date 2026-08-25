import { join } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import * as schema from '../../src/database/schema';
import { applyMigrations, createD1Shim } from '../helpers/d1-shim';

let sqlite: Database.Database;
let env: Record<string, unknown>;

beforeEach(async () => {
  sqlite = new Database(':memory:');
  applyMigrations(sqlite, join(__dirname, '../../drizzle/migrations'));
  env = { DB: createD1Shim(sqlite) };
  // 頁面不得洩漏的兩種身分資訊都先種進資料庫。
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
});

describe('GET /privacy', () => {
  it('shows a generic contact line; never the admin email nor the IG username', async () => {
    const app = createApp();
    const res = await app.fetch(new Request('https://igbot.example.com/privacy'), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Instagram 帳號的私訊');
    // 管理者 Email 是登入憑證的一半；IG 帳號名會讓任何訪客把這個網址連結到你的身分。
    expect(html).not.toContain('owner@example.com');
    expect(html).not.toContain('myshop');
  });

  it('shows PRIVACY_CONTACT when configured, HTML-escaped', async () => {
    const app = createApp();
    const res = await app.fetch(new Request('https://igbot.example.com/privacy'), {
      ...env,
      PRIVACY_CONTACT: 'privacy@brand.example <b>bold</b>',
    });
    const html = await res.text();
    expect(html).toContain('privacy@brand.example');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(html).not.toContain('<b>bold</b>');
  });
});
