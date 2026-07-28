import { join } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';
import { ensureAutomationRun } from '../../src/automation/idempotency';
import { applyMigrations } from '../helpers/d1-shim';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

beforeEach(async () => {
  const sqlite = new Database(':memory:');
  applyMigrations(sqlite, join(__dirname, '../../drizzle/migrations'));
  db = drizzle(sqlite, { schema });
  // 建立最小的 account → media → automation 供 FK。
  await db.insert(schema.instagramAccounts).values({ id: 'acct', instagramAccountId: 'ig-acct' });
  await db.insert(schema.instagramMedia).values({
    id: 'media',
    instagramAccountId: 'acct',
    instagramMediaId: 'ig-media',
    mediaType: 'IMAGE',
  });
  await db.insert(schema.automations).values({ id: 'auto', instagramMediaId: 'media', name: 'a' });
});

const baseInput = {
  automationId: 'auto',
  webhookEventId: null,
  instagramCommentId: 'c1',
  instagramMediaId: 'media',
  status: 'matched',
};

describe('ensureAutomationRun', () => {
  it('creates a run the first time (created=true)', async () => {
    const r = await ensureAutomationRun(db, baseInput);
    expect(r.created).toBe(true);
    expect(r.run.instagramCommentId).toBe('c1');
  });

  it('returns the existing run on a duplicate comment (created=false)', async () => {
    const first = await ensureAutomationRun(db, baseInput);
    const second = await ensureAutomationRun(db, baseInput);
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);

    const all = await db.select().from(schema.automationRuns);
    expect(all).toHaveLength(1);
  });

  it('allows the same comment id under a different automation', async () => {
    await db.insert(schema.instagramMedia).values({
      id: 'media2',
      instagramAccountId: 'acct',
      instagramMediaId: 'ig-media-2',
      mediaType: 'IMAGE',
    });
    await db.insert(schema.automations).values({ id: 'auto2', instagramMediaId: 'media2', name: 'b' });

    await ensureAutomationRun(db, baseInput);
    const other = await ensureAutomationRun(db, { ...baseInput, automationId: 'auto2', instagramMediaId: 'media2' });
    expect(other.created).toBe(true);

    const all = await db.select().from(schema.automationRuns);
    expect(all).toHaveLength(2);
  });
});
