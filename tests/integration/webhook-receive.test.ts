import { join } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import * as schema from '../../src/database/schema';
import { webhookEvents } from '../../src/database/schema';
import { applyMigrations, createD1Shim } from '../helpers/d1-shim';

const SECRET = 'meta-app-secret';
const encoder = new TextEncoder();

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
  return 'sha256=' + Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

function commentPayload(commentId: string, mediaId = 'media-1') {
  return JSON.stringify({
    object: 'instagram',
    entry: [
      {
        id: 'acct-1',
        time: 1700000000,
        changes: [
          {
            field: 'comments',
            value: {
              id: commentId,
              text: '我想要 ADHD',
              from: { id: 'user-9', username: 'someone' },
              media: { id: mediaId },
            },
          },
        ],
      },
    ],
  });
}

let sqlite: Database.Database;
let enqueued: unknown[];
let env: Record<string, unknown>;

beforeEach(() => {
  sqlite = new Database(':memory:');
  applyMigrations(sqlite, join(__dirname, '../../drizzle/migrations'));
  enqueued = [];
  env = {
    DB: createD1Shim(sqlite),
    META_APP_SECRET: SECRET,
    LOG_LEVEL: 'error',
    COMMENT_QUEUE: { send: async (m: unknown) => void enqueued.push(m) },
  };
});

async function post(body: string, signature?: string) {
  return createApp().fetch(
    new Request('https://igbot.example.com/api/webhooks/meta/instagram', {
      method: 'POST',
      headers: signature ? { 'X-Hub-Signature-256': signature } : {},
      body,
    }),
    env,
  );
}

describe('POST /api/webhooks/meta/instagram', () => {
  it('rejects an invalid signature and does not enqueue', async () => {
    const body = commentPayload('c1');
    const res = await post(body, 'sha256=deadbeef');
    expect(res.status).toBe(401);
    expect(enqueued).toHaveLength(0);
    const rows = drizzle(sqlite, { schema });
    expect(await rows.select().from(webhookEvents)).toHaveLength(0);
  });

  it('stores the event and enqueues on a valid signature', async () => {
    const body = commentPayload('c1');
    const res = await post(body, await sign(body));
    expect(res.status).toBe(200);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      instagramCommentId: 'c1',
      instagramMediaId: 'media-1',
      instagramAccountId: 'acct-1',
    });
    const rows = await drizzle(sqlite, { schema }).select().from(webhookEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0].signatureValid).toBe(1);
  });

  it('is idempotent on a redelivered event (duplicate_count++ , no re-enqueue)', async () => {
    const body = commentPayload('c1');
    const sig = await sign(body);
    await post(body, sig);
    await post(body, sig);
    expect(enqueued).toHaveLength(1); // only enqueued once
    const rows = await drizzle(sqlite, { schema }).select().from(webhookEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0].duplicateCount).toBe(1);
  });

  it('returns 200 even when there is nothing to process', async () => {
    const body = JSON.stringify({ object: 'instagram', entry: [] });
    const res = await post(body, await sign(body));
    expect(res.status).toBe(200);
    expect(enqueued).toHaveLength(0);
  });
});
