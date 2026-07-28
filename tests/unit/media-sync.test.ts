import { join } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';
import { syncMediaItems } from '../../src/meta/media';
import { applyMigrations } from '../helpers/d1-shim';

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
