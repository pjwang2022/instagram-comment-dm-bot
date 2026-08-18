import { join } from 'path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../src/database/schema';
import { MetaClient } from '../../src/meta/client';
import { ensureAccountRegistered, markDeletedMedia, syncMediaItems } from '../../src/meta/media';
import { applyMigrations } from '../helpers/d1-shim';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

// 依 URL 中的 media id 回應不同結果，模擬逐篇查證。
function mockFetchByMediaId(responses: Record<string, { status: number; body: unknown }>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [id, r] of Object.entries(responses)) {
      if (url.includes(`/${id}?`)) {
        return new Response(JSON.stringify(r.body), {
          status: r.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

const NOT_FOUND_BODY = {
  error: { message: 'Unsupported get request. Object does not exist', code: 100 },
};

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

  it('clears deleted_at when a previously deleted media reappears in the feed', async () => {
    await syncMediaItems(db, 'acct', [{ id: 'm1', media_type: 'IMAGE' }]);
    await db
      .update(schema.instagramMedia)
      .set({ deletedAt: '2026-08-01T00:00:00Z' })
      .where(eq(schema.instagramMedia.instagramMediaId, 'm1'));

    await syncMediaItems(db, 'acct', [{ id: 'm1', media_type: 'IMAGE' }]);
    const rows = await db.select().from(schema.instagramMedia);
    expect(rows[0].deletedAt).toBeNull();
  });
});

describe('markDeletedMedia（IG 已刪貼文偵測）', () => {
  async function seedMedia(instagramMediaId: string) {
    await syncMediaItems(db, 'acct', [{ id: instagramMediaId, media_type: 'IMAGE' }]);
  }

  it('marks media missing from the feed after Meta confirms it no longer exists', async () => {
    await seedMedia('m1');
    await seedMedia('m2');
    const fetchImpl = mockFetchByMediaId({ m2: { status: 400, body: NOT_FOUND_BODY } });

    const r = await markDeletedMedia(db, metaClient(fetchImpl), 'acct', new Set(['m1']));
    expect(r.deleted).toBe(1);

    const rows = await db.select().from(schema.instagramMedia);
    const byId = new Map(rows.map((m: { instagramMediaId: string }) => [m.instagramMediaId, m]));
    expect(byId.get('m1').deletedAt).toBeNull();
    expect(byId.get('m2').deletedAt).toBeTruthy();
  });

  it('does not mark media that still exists (merely absent from the first page)', async () => {
    await seedMedia('m2');
    const fetchImpl = mockFetchByMediaId({ m2: { status: 200, body: { id: 'm2' } } });

    const r = await markDeletedMedia(db, metaClient(fetchImpl), 'acct', new Set());
    expect(r.deleted).toBe(0);
    const rows = await db.select().from(schema.instagramMedia);
    expect(rows[0].deletedAt).toBeNull();
  });

  it('does not treat retryable failures (5xx / rate limit / network) as deletion evidence', async () => {
    await seedMedia('m2');
    const fetchImpl = mockFetchByMediaId({ m2: { status: 500, body: { error: { code: 1 } } } });

    const r = await markDeletedMedia(db, metaClient(fetchImpl), 'acct', new Set());
    expect(r.deleted).toBe(0);
    const rows = await db.select().from(schema.instagramMedia);
    expect(rows[0].deletedAt).toBeNull();
  });

  it('does not treat token failures as deletion evidence', async () => {
    await seedMedia('m2');
    const fetchImpl = mockFetchByMediaId({ m2: { status: 401, body: { error: { code: 190 } } } });

    const r = await markDeletedMedia(db, metaClient(fetchImpl), 'acct', new Set());
    expect(r.deleted).toBe(0);
  });

  it('skips media already marked deleted (no repeated verification calls)', async () => {
    await seedMedia('m2');
    await db
      .update(schema.instagramMedia)
      .set({ deletedAt: '2026-08-01T00:00:00Z' })
      .where(eq(schema.instagramMedia.instagramMediaId, 'm2'));
    const fetchImpl = mockFetchByMediaId({});

    const r = await markDeletedMedia(db, metaClient(fetchImpl), 'acct', new Set());
    expect(r.deleted).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('pauses the active automation bound to a deleted media', async () => {
    await seedMedia('m2');
    const [media] = await db.select().from(schema.instagramMedia);
    await db.insert(schema.automations).values({
      id: 'auto-1',
      instagramMediaId: media.id,
      name: 'A',
      status: 'active',
    });
    const fetchImpl = mockFetchByMediaId({ m2: { status: 400, body: NOT_FOUND_BODY } });

    await markDeletedMedia(db, metaClient(fetchImpl), 'acct', new Set());
    const [auto] = await db.select().from(schema.automations);
    expect(auto.status).toBe('paused');
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
