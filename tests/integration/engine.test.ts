import { join } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../src/database/schema';
import { processCommentEvent } from '../../src/automation/engine';
import { MetaClient } from '../../src/meta/client';
import { applyMigrations } from '../helpers/d1-shim';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

function payload(commentId: string, text: string, opts: { commenterId?: string } = {}) {
  return {
    object: 'instagram',
    entry: [
      {
        id: 'ig-acct',
        time: 1700000000,
        changes: [
          {
            field: 'comments',
            value: {
              id: commentId,
              text,
              from: { id: opts.commenterId ?? 'user-9', username: 'someone' },
              media: { id: 'ig-media' },
            },
          },
        ],
      },
    ],
  };
}

async function seedWebhookEvent(commentId: string, text: string, opts: { commenterId?: string } = {}) {
  const id = 'evt-' + commentId;
  await db.insert(schema.webhookEvents).values({
    id,
    eventKey: 'key-' + commentId,
    eventType: 'comments',
    instagramAccountId: 'ig-acct',
    instagramMediaId: 'ig-media',
    instagramCommentId: commentId,
    rawPayload: JSON.stringify(payload(commentId, text, opts)),
    signatureValid: 1,
  });
  return id;
}

async function seedAutomation(overrides: Partial<typeof schema.automations.$inferInsert> = {}) {
  await db.insert(schema.instagramAccounts).values({ id: 'acct', instagramAccountId: 'ig-acct' });
  await db.insert(schema.instagramMedia).values({
    id: 'media',
    instagramAccountId: 'acct',
    instagramMediaId: 'ig-media',
    mediaType: 'IMAGE',
  });
  await db.insert(schema.automations).values({
    id: 'auto',
    instagramMediaId: 'media',
    name: 'adhd',
    status: 'active',
    matchType: 'contains_any',
    publicReplyEnabled: 1,
    privateReplyEnabled: 1,
    openingDm: '這是連結',
    buttonText: '開啟',
    buttonUrl: 'https://example.com',
    ...overrides,
  });
  await db.insert(schema.automationKeywords).values({
    id: 'kw1',
    automationId: 'auto',
    keyword: 'adhd',
    normalizedKeyword: 'adhd',
  });
  await db.insert(schema.publicReplyVariants).values({
    id: 'v1',
    automationId: 'auto',
    message: '已私訊你囉',
    enabled: 1,
  });
}

function okClient() {
  const fetchImpl = vi.fn(async () =>
    new Response(JSON.stringify({ id: 'x', message_id: 'm' }), { status: 200 }),
  ) as unknown as typeof fetch;
  return { client: new MetaClient({ accessToken: 't', graphApiVersion: 'v21.0', fetchImpl }), fetchImpl };
}

const msg = (commentId: string, webhookEventId: string) => ({
  webhookEventId,
  eventKey: 'key',
  instagramAccountId: 'ig-acct',
  instagramMediaId: 'ig-media',
  instagramCommentId: commentId,
});

beforeEach(() => {
  const sqlite = new Database(':memory:');
  applyMigrations(sqlite, join(__dirname, '../../drizzle/migrations'));
  db = drizzle(sqlite, { schema });
});

describe('processCommentEvent — happy path', () => {
  it('matches, publicly replies and sends a DM, exactly once', async () => {
    await seedAutomation();
    const evt = await seedWebhookEvent('c1', '我想要 ADHD');
    const { client, fetchImpl } = okClient();

    const outcome = await processCommentEvent({ db, metaClient: client }, msg('c1', evt));
    expect(outcome.kind).toBe('completed');
    if (outcome.kind === 'completed') {
      expect(outcome.publicReplyStatus).toBe('success');
      expect(outcome.privateReplyStatus).toBe('success');
    }
    // 一次公開回覆 + 一次 DM = 兩次 Meta 呼叫
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2);

    const runs = await db.select().from(schema.automationRuns);
    expect(runs).toHaveLength(1);
    const attempts = await db.select().from(schema.apiAttempts);
    expect(attempts).toHaveLength(2);
  });

  it('is idempotent: reprocessing the same comment sends nothing more', async () => {
    await seedAutomation();
    const evt = await seedWebhookEvent('c1', '我想要 ADHD');
    const { client, fetchImpl } = okClient();

    await processCommentEvent({ db, metaClient: client }, msg('c1', evt));
    const second = await processCommentEvent({ db, metaClient: client }, msg('c1', evt));

    expect(second.kind).toBe('completed');
    // 仍然只有兩次呼叫（第二次沒再送）
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2);
    expect(await db.select().from(schema.automationRuns)).toHaveLength(1);
  });
});

describe('processCommentEvent — exclusions and no-match', () => {
  it('skips when the comment does not match', async () => {
    await seedAutomation();
    const evt = await seedWebhookEvent('c1', '完全不相關');
    const { client } = okClient();
    const outcome = await processCommentEvent({ db, metaClient: client }, msg('c1', evt));
    expect(outcome.kind).toBe('no_match');
    expect(await db.select().from(schema.automationRuns)).toHaveLength(0);
  });

  it('skips own comments when exclude_own_comments is on', async () => {
    await seedAutomation();
    const evt = await seedWebhookEvent('c1', '我想要 ADHD', { commenterId: 'ig-acct' });
    const { client } = okClient();
    const outcome = await processCommentEvent({ db, metaClient: client }, msg('c1', evt));
    expect(outcome).toEqual({ kind: 'skipped', reason: 'own_comment' });
  });

  it('skips when emergency stop is on', async () => {
    await seedAutomation();
    await db.insert(schema.systemSettings).values({ id: 's', emergencyStop: 1 });
    const evt = await seedWebhookEvent('c1', '我想要 ADHD');
    const { client } = okClient();
    const outcome = await processCommentEvent({ db, metaClient: client }, msg('c1', evt));
    expect(outcome).toEqual({ kind: 'skipped', reason: 'emergency_stop' });
  });

  it('skips when there is no active automation', async () => {
    await seedAutomation({ status: 'paused' });
    const evt = await seedWebhookEvent('c1', '我想要 ADHD');
    const { client } = okClient();
    const outcome = await processCommentEvent({ db, metaClient: client }, msg('c1', evt));
    expect(outcome).toEqual({ kind: 'skipped', reason: 'no_active_automation' });
  });
});

describe('processCommentEvent — retry semantics', () => {
  it('retries a DM 400 (fresh-comment race) instead of failing permanently', async () => {
    await seedAutomation();
    const evt = await seedWebhookEvent('c1', '我想要 ADHD');

    // public reply 成功；DM 回 400（無已知永久錯誤碼）→ 應排重試而非 failed
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/messages')) {
        return new Response(JSON.stringify({ error: { message: 'transient', code: 1 } }), { status: 400 });
      }
      return new Response(JSON.stringify({ id: 'r' }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new MetaClient({ accessToken: 't', graphApiVersion: 'v21.0', fetchImpl });

    const first = await processCommentEvent({ db, metaClient: client }, msg('c1', evt));
    expect(first.kind).toBe('retry');
    if (first.kind === 'retry') expect(first.delaySeconds).toBe(30);

    // 重試時 DM 成功 → completed，且公開回覆不再重送
    const okFetch = vi.fn(async () => new Response(JSON.stringify({ message_id: 'm' }), { status: 200 })) as unknown as typeof fetch;
    const second = await processCommentEvent(
      { db, metaClient: new MetaClient({ accessToken: 't', graphApiVersion: 'v21.0', fetchImpl: okFetch }) },
      msg('c1', evt),
    );
    expect(second.kind).toBe('completed');
    if (second.kind === 'completed') expect(second.privateReplyStatus).toBe('success');
    const publicCalls = (fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls.filter((c) => c[0].includes('/replies'));
    expect(publicCalls).toHaveLength(1);
  });

  it('does NOT retry a DM 400 with a permanent reason (permission denied)', async () => {
    await seedAutomation();
    const evt = await seedWebhookEvent('c1', '我想要 ADHD');
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/messages')) {
        return new Response(JSON.stringify({ error: { message: 'no perm', code: 10 } }), { status: 400 });
      }
      return new Response(JSON.stringify({ id: 'r' }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new MetaClient({ accessToken: 't', graphApiVersion: 'v21.0', fetchImpl });

    const outcome = await processCommentEvent({ db, metaClient: client }, msg('c1', evt));
    expect(outcome.kind).toBe('completed');
    if (outcome.kind === 'completed') expect(outcome.privateReplyStatus).toBe('failed');
  });

  it('retries on a retryable DM failure without re-sending the public reply', async () => {
    await seedAutomation();
    const evt = await seedWebhookEvent('c1', '我想要 ADHD');

    const fetchImpl = vi.fn(async (url: string) => {
      // public reply (/replies) succeeds; DM (/messages) fails with 500 (retryable)
      if (url.includes('/messages')) return new Response('{}', { status: 500 });
      return new Response(JSON.stringify({ id: 'r' }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new MetaClient({ accessToken: 't', graphApiVersion: 'v21.0', fetchImpl });

    const first = await processCommentEvent({ db, metaClient: client }, msg('c1', evt));
    expect(first.kind).toBe('retry');
    if (first.kind === 'retry') expect(first.delaySeconds).toBe(30);

    // 重試：public 已成功不再送，只重試 DM。這次讓 DM 成功。
    const okFetch = vi.fn(async () => new Response(JSON.stringify({ message_id: 'm' }), { status: 200 })) as unknown as typeof fetch;
    const okClient2 = new MetaClient({ accessToken: 't', graphApiVersion: 'v21.0', fetchImpl: okFetch });
    const second = await processCommentEvent({ db, metaClient: okClient2 }, msg('c1', evt));
    expect(second.kind).toBe('completed');
    if (second.kind === 'completed') {
      expect(second.publicReplyStatus).toBe('success');
      expect(second.privateReplyStatus).toBe('success');
    }
    // 公開回覆只被呼叫一次（第一輪），DM 兩次（失敗＋成功）
    const publicCalls = (fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls.filter((c) => c[0].includes('/replies'));
    expect(publicCalls).toHaveLength(1);
  });
});

describe('processCommentEvent — apply scope（待命與全帳號預設）', () => {
  async function seedAccountAndMedia(publishedAt: string | null = '2026-07-30T00:00:00Z') {
    await db.insert(schema.instagramAccounts).values({ id: 'acct', instagramAccountId: 'ig-acct' });
    await db.insert(schema.instagramMedia).values({
      id: 'media',
      instagramAccountId: 'acct',
      instagramMediaId: 'ig-media',
      mediaType: 'IMAGE',
      publishedAt,
    });
  }

  async function seedScopedAutomation(
    overrides: Partial<typeof schema.automations.$inferInsert> = {},
  ) {
    await db.insert(schema.automations).values({
      id: 'auto',
      instagramMediaId: null,
      applyScope: 'next_post',
      name: 'scoped',
      status: 'active',
      matchType: 'contains_any',
      publicReplyEnabled: 1,
      privateReplyEnabled: 1,
      openingDm: '這是連結',
      buttonText: '開啟',
      buttonUrl: 'https://example.com',
      createdAt: '2026-07-29T00:00:00Z',
      updatedAt: '2026-07-29T00:00:00Z',
      ...overrides,
    });
    await db.insert(schema.automationKeywords).values({
      id: 'kw1',
      automationId: 'auto',
      keyword: 'adhd',
      normalizedKeyword: 'adhd',
    });
    await db.insert(schema.publicReplyVariants).values({
      id: 'v1',
      automationId: 'auto',
      message: '已私訊你囉',
      enabled: 1,
    });
  }

  it('binds the pending next_post automation to a newer post on its first comment and replies', async () => {
    await seedAccountAndMedia('2026-07-30T00:00:00Z'); // 晚於 automation createdAt
    await seedScopedAutomation();
    const evt = await seedWebhookEvent('c1', '我想要 ADHD');
    const { client } = okClient();

    const outcome = await processCommentEvent({ db, metaClient: client }, msg('c1', evt));
    expect(outcome.kind).toBe('completed');

    const auto = (await db.select().from(schema.automations))[0];
    expect(auto.instagramMediaId).toBe('media');
    expect(auto.applyScope).toBe('media'); // 綁定後轉為一般單篇自動化
  });

  it('does not bind next_post to a post published before the automation existed', async () => {
    await seedAccountAndMedia('2026-07-01T00:00:00Z'); // 早於 automation createdAt
    await seedScopedAutomation();
    const evt = await seedWebhookEvent('c1', '我想要 ADHD');
    const { client } = okClient();

    const outcome = await processCommentEvent({ db, metaClient: client }, msg('c1', evt));
    expect(outcome.kind).toEqual('skipped');

    const auto = (await db.select().from(schema.automations))[0];
    expect(auto.instagramMediaId).toBeNull(); // 仍待命
  });

  it('falls back to the account_default automation without binding it', async () => {
    await seedAccountAndMedia();
    await seedScopedAutomation({ applyScope: 'account_default' });
    const evt = await seedWebhookEvent('c1', '我想要 ADHD');
    const { client } = okClient();

    const outcome = await processCommentEvent({ db, metaClient: client }, msg('c1', evt));
    expect(outcome.kind).toBe('completed');

    const auto = (await db.select().from(schema.automations))[0];
    expect(auto.instagramMediaId).toBeNull(); // 預設自動化不綁定、持續服務所有貼文
    expect(auto.applyScope).toBe('account_default');
  });

  it('auto-discovers an unknown media from Meta and applies the account default', async () => {
    // 只有帳號、沒有 media row——模擬排程貼文剛上線、尚未同步就有留言。
    await db.insert(schema.instagramAccounts).values({ id: 'acct', instagramAccountId: 'ig-acct' });
    await seedScopedAutomation({ applyScope: 'account_default' });
    const evt = await seedWebhookEvent('c1', '我想要 ADHD');

    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (!init || init.method !== 'POST') {
        // GET media 資訊（自動補抓）
        return new Response(
          JSON.stringify({
            id: 'ig-media',
            media_type: 'IMAGE',
            caption: '新貼文',
            timestamp: '2026-07-30T01:00:00Z',
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ id: 'x', message_id: 'm' }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new MetaClient({ accessToken: 't', graphApiVersion: 'v21.0', fetchImpl });

    const outcome = await processCommentEvent({ db, metaClient: client }, msg('c1', evt));
    expect(outcome.kind).toBe('completed');

    const mediaRows = await db.select().from(schema.instagramMedia);
    expect(mediaRows).toHaveLength(1);
    expect(mediaRows[0].instagramMediaId).toBe('ig-media');
    expect(mediaRows[0].caption).toBe('新貼文');
  });
});
