import { join } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../src/database/schema';
import { processStoryReplyEvent } from '../../src/automation/engine';
import { MetaClient } from '../../src/meta/client';
import { applyMigrations } from '../helpers/d1-shim';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

function storyPayload(mid: string, text: string, opts: { senderId?: string } = {}) {
  return {
    object: 'instagram',
    entry: [
      {
        id: 'ig-acct',
        time: 1700000000,
        messaging: [
          {
            sender: { id: opts.senderId ?? 'user-9' },
            recipient: { id: 'ig-acct' },
            timestamp: 1700000001234,
            message: { mid, text, reply_to: { story: { id: 'ig-story' } } },
          },
        ],
      },
    ],
  };
}

async function seedStoryEvent(mid: string, text: string, opts: { senderId?: string } = {}) {
  const id = 'evt-' + mid;
  await db.insert(schema.webhookEvents).values({
    id,
    eventKey: mid,
    eventType: 'story_reply',
    instagramAccountId: 'ig-acct',
    instagramMediaId: 'ig-story',
    instagramCommentId: mid,
    rawPayload: JSON.stringify(storyPayload(mid, text, opts)),
    signatureValid: 1,
  });
  return id;
}

async function seedStoryAutomation(overrides: Partial<typeof schema.automations.$inferInsert> = {}) {
  await db.insert(schema.instagramAccounts).values({ id: 'acct', instagramAccountId: 'ig-acct' });
  await db.insert(schema.instagramMedia).values({
    id: 'story',
    instagramAccountId: 'acct',
    instagramMediaId: 'ig-story',
    mediaType: 'STORY',
  });
  await db.insert(schema.automations).values({
    id: 'auto',
    instagramMediaId: 'story',
    name: '限動回覆',
    status: 'active',
    matchType: 'contains_any',
    publicReplyEnabled: 0,
    privateReplyEnabled: 1,
    openingDm: '這是你要的連結',
    ...overrides,
  });
  await db.insert(schema.automationKeywords).values({
    id: 'kw1',
    automationId: 'auto',
    keyword: '連結',
    normalizedKeyword: '连结',  // 正規形為簡體（繁簡互通）
  });
}

function okClient() {
  const fetchImpl = vi.fn(async () =>
    new Response(JSON.stringify({ recipient_id: 'user-9', message_id: 'm' }), { status: 200 }),
  ) as unknown as typeof fetch;
  return { client: new MetaClient({ accessToken: 't', graphApiVersion: 'v21.0', fetchImpl }), fetchImpl };
}

const msg = (mid: string, webhookEventId: string) => ({
  webhookEventId,
  eventKey: mid,
  instagramAccountId: 'ig-acct',
  instagramMediaId: 'ig-story',
  instagramCommentId: mid,
  eventType: 'story_reply' as const,
});

beforeEach(() => {
  const sqlite = new Database(':memory:');
  applyMigrations(sqlite, join(__dirname, '../../drizzle/migrations'));
  db = drizzle(sqlite, { schema });
});

describe('processStoryReplyEvent', () => {
  it('matches a keyword and sends exactly one DM, no public reply', async () => {
    await seedStoryAutomation();
    const evt = await seedStoryEvent('mid.1', '請給我連結');
    const { client, fetchImpl } = okClient();

    const outcome = await processStoryReplyEvent({ db, metaClient: client }, msg('mid.1', evt));
    expect(outcome.kind).toBe('completed');
    if (outcome.kind === 'completed') {
      expect(outcome.publicReplyStatus).toBe('skipped');
      expect(outcome.privateReplyStatus).toBe('success');
    }
    // 只有一次 Meta 呼叫（DM），沒有公開回覆。
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);

    const runs = await db.select().from(schema.automationRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0].instagramCommentId).toBe('mid.1');
  });

  it('is idempotent: reprocessing the same mid sends nothing more', async () => {
    await seedStoryAutomation();
    const evt = await seedStoryEvent('mid.1', '請給我連結');
    const { client, fetchImpl } = okClient();
    await processStoryReplyEvent({ db, metaClient: client }, msg('mid.1', evt));
    await processStoryReplyEvent({ db, metaClient: client }, msg('mid.1', evt));
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
    expect(await db.select().from(schema.automationRuns)).toHaveLength(1);
  });

  it('returns no_match when the reply does not contain a keyword', async () => {
    await seedStoryAutomation();
    const evt = await seedStoryEvent('mid.1', '早安');
    const { client } = okClient();
    const outcome = await processStoryReplyEvent({ db, metaClient: client }, msg('mid.1', evt));
    expect(outcome.kind).toBe('no_match');
    expect(await db.select().from(schema.automationRuns)).toHaveLength(0);
  });

  it('skips expired stories', async () => {
    await seedStoryAutomation();
    await db
      .update(schema.instagramMedia)
      .set({ deletedAt: '2026-08-18T00:00:00.000Z' })
      .where(eq(schema.instagramMedia.id, 'story'));
    const evt = await seedStoryEvent('mid.1', '請給我連結');
    const { client } = okClient();
    const outcome = await processStoryReplyEvent({ db, metaClient: client }, msg('mid.1', evt));
    expect(outcome).toEqual({ kind: 'skipped', reason: 'story_expired' });
  });

  it('does not fall back to account_default automations', async () => {
    await db.insert(schema.instagramAccounts).values({ id: 'acct', instagramAccountId: 'ig-acct' });
    await db.insert(schema.instagramMedia).values({
      id: 'story',
      instagramAccountId: 'acct',
      instagramMediaId: 'ig-story',
      mediaType: 'STORY',
    });
    await db.insert(schema.automations).values({
      id: 'default-auto',
      applyScope: 'account_default',
      name: '全帳號',
      status: 'active',
      matchType: 'all_comments',
      privateReplyEnabled: 1,
      openingDm: 'hi',
    });
    const evt = await seedStoryEvent('mid.1', '任何字');
    const { client } = okClient();
    const outcome = await processStoryReplyEvent({ db, metaClient: client }, msg('mid.1', evt));
    expect(outcome).toEqual({ kind: 'skipped', reason: 'no_active_automation' });
  });

  it('skips when emergency stop is on', async () => {
    await seedStoryAutomation();
    await db.insert(schema.systemSettings).values({ id: 's', emergencyStop: 1 });
    const evt = await seedStoryEvent('mid.1', '請給我連結');
    const { client } = okClient();
    const outcome = await processStoryReplyEvent({ db, metaClient: client }, msg('mid.1', evt));
    expect(outcome).toEqual({ kind: 'skipped', reason: 'emergency_stop' });
  });
});
