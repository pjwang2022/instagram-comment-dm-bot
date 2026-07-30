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
  it('shows the admin account email as the contact address', async () => {
    const db = drizzle(sqlite, { schema });
    await db.insert(schema.adminUsers).values({
      id: 'admin-1',
      email: 'owner@example.com',
      passwordHash: 'x',
    });

    const app = createApp();
    const res = await app.fetch(new Request('https://igbot.example.com/privacy'), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('owner@example.com');
  });

  it('still renders with a fallback before any admin exists', async () => {
    const app = createApp();
    const res = await app.fetch(new Request('https://igbot.example.com/privacy'), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('（尚未設定）');
  });
});
