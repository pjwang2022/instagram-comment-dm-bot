import { join } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';
import { syncStories } from '../../src/meta/media';
import { bindNextPostAutomation } from '../../src/automation/apply-scope';
import { applyMigrations } from '../helpers/d1-shim';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

beforeEach(async () => {
  const sqlite = new Database(':memory:');
  applyMigrations(sqlite, join(__dirname, '../../drizzle/migrations'));
  db = drizzle(sqlite, { schema });
  await db.insert(schema.instagramAccounts).values({ id: 'acct', instagramAccountId: 'ig-acct' });
});

describe('syncStories', () => {
  it('upserts stories with mediaType forced to STORY', async () => {
    const r = await syncStories(db, 'acct', [
      { id: 's1', media_type: 'IMAGE', media_url: 'https://cdn/s1.jpg', timestamp: '2026-08-18T01:00:00+0000' },
    ]);
    expect(r).toMatchObject({ inserted: 1, updated: 0, expired: 0 });
    const rows = await db.select().from(schema.instagramMedia);
    expect(rows).toHaveLength(1);
    expect(rows[0].mediaType).toBe('STORY');
    expect(rows[0].thumbnailUrl).toBe('https://cdn/s1.jpg');
  });

  it('marks stories missing from the active list as expired and pauses their automations', async () => {
    await syncStories(db, 'acct', [{ id: 's1', media_url: 'https://cdn/s1.jpg' }]);
    const media = (await db.select().from(schema.instagramMedia))[0];
    await db.insert(schema.automations).values({
      id: 'auto-s1',
      instagramMediaId: media.id,
      name: '限動',
      status: 'active',
    });

    const r = await syncStories(db, 'acct', []);
    expect(r.expired).toBe(1);
    const after = (await db.select().from(schema.instagramMedia))[0];
    expect(after.deletedAt).not.toBeNull();
    const auto = (await db.select().from(schema.automations))[0];
    expect(auto.status).toBe('paused');
  });

  it('does not touch non-STORY media when expiring', async () => {
    await db.insert(schema.instagramMedia).values({
      id: 'post-1',
      instagramAccountId: 'acct',
      instagramMediaId: 'ig-post-1',
      mediaType: 'IMAGE',
    });
    const r = await syncStories(db, 'acct', []);
    expect(r.expired).toBe(0);
    expect((await db.select().from(schema.instagramMedia))[0].deletedAt).toBeNull();
  });
});

describe('bindNextPostAutomation — STORY 排除', () => {
  it('never binds a next_post automation to a story', async () => {
    await db.insert(schema.automations).values({
      id: 'pending',
      applyScope: 'next_post',
      name: '待命',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await db.insert(schema.instagramMedia).values({
      id: 'story-row',
      instagramAccountId: 'acct',
      instagramMediaId: 's1',
      mediaType: 'STORY',
      publishedAt: '2026-08-18T01:00:00.000Z',
    });
    const media = (await db.select().from(schema.instagramMedia))[0];
    const bound = await bindNextPostAutomation(db, media);
    expect(bound).toBeNull();
    const auto = (await db.select().from(schema.automations))[0];
    expect(auto.instagramMediaId).toBeNull();
  });
});
