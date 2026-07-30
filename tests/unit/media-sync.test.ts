import { join } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../src/database/schema';
import { MetaClient } from '../../src/meta/client';
import { ensureAccountRegistered, syncMediaItems } from '../../src/meta/media';
import { applyMigrations } from '../helpers/d1-shim';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

function metaClient(fetchImpl: typeof fetch) {
  return new MetaClient({ accessToken: 'tok', graphApiVersion: 'v21.0', fetchImpl });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

beforeEach(async () => {
  const sqlite = new Database(':memory:');
  applyMigrations(sqlite, join(__dirname, '../../drizzle/migrations'));
  db = drizzle(sqlite, { schema });
  await db.insert(schema.instagramAccounts).values({ id: 'acct', instagramAccountId: 'ig-acct' });
});

describe('syncMediaItems', () => {
  it('inserts new media', async () => {
    const r = await syncMediaItems(db, 'acct', [
      { id: 'm1', media_type: 'IMAGE', caption: 'hi', permalink: 'https://x/1', timestamp: '2026-01-01T00:00:00Z' },
      { id: 'm2', media_type: 'REELS', caption: 'reel' },
    ]);
    expect(r).toEqual({ inserted: 2, updated: 0 });
    expect(await db.select().from(schema.instagramMedia)).toHaveLength(2);
  });

  it('updates existing media without creating duplicates and without deleting history', async () => {
    await syncMediaItems(db, 'acct', [{ id: 'm1', media_type: 'IMAGE', caption: 'old' }]);
    const r = await syncMediaItems(db, 'acct', [{ id: 'm1', media_type: 'IMAGE', caption: 'new caption' }]);
    expect(r).toEqual({ inserted: 0, updated: 1 });

    const rows = await db.select().from(schema.instagramMedia);
    expect(rows).toHaveLength(1);
    expect(rows[0].caption).toBe('new caption');
    expect(rows[0].lastSyncedAt).toBeTruthy();
  });

  it('skips items with no id', async () => {
    const r = await syncMediaItems(db, 'acct', [{ id: '' }, { id: 'm3' }]);
    expect(r.inserted).toBe(1);
  });
});

describe('ensureAccountRegistered（帳號自動註冊）', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let emptyDb: any;

  beforeEach(() => {
    const sqlite = new Database(':memory:');
    applyMigrations(sqlite, join(__dirname, '../../drizzle/migrations'));
    emptyDb = drizzle(sqlite, { schema });
  });

  it('registers the account from GET /me when the table is empty', async () => {
    const fetchImpl = mockFetch(200, {
      id: '17841400000000001',
      username: 'my_shop',
      account_type: 'BUSINESS',
    });
    const err = await ensureAccountRegistered(emptyDb, metaClient(fetchImpl));
    expect(err).toBeNull();

    const rows = await emptyDb.select().from(schema.instagramAccounts);
    expect(rows).toHaveLength(1);
    expect(rows[0].instagramAccountId).toBe('17841400000000001');
    expect(rows[0].username).toBe('my_shop');
  });

  it('does not call Meta when an account already exists', async () => {
    await emptyDb.insert(schema.instagramAccounts).values({ id: 'acct', instagramAccountId: 'ig-acct' });
    const fetchImpl = mockFetch(200, { id: 'should-not-be-used' });
    const err = await ensureAccountRegistered(emptyDb, metaClient(fetchImpl));
    expect(err).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await emptyDb.select().from(schema.instagramAccounts)).toHaveLength(1);
  });

  it('returns a descriptive error when the token is invalid', async () => {
    const err = await ensureAccountRegistered(
      emptyDb,
      metaClient(mockFetch(401, { error: { code: 190 } })),
    );
    expect(err).toContain('token_invalid');
    expect(await emptyDb.select().from(schema.instagramAccounts)).toHaveLength(0);
  });
});
