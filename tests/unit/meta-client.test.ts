import { describe, expect, it, vi } from 'vitest';
import { MetaClient, isRetryable } from '../../src/meta/client';
import { replyToComment } from '../../src/meta/comments';
import { sendPrivateReply } from '../../src/meta/private-replies';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

function client(fetchImpl: typeof fetch) {
  return new MetaClient({ accessToken: 'tok', graphApiVersion: 'v21.0', fetchImpl });
}

describe('MetaClient error classification', () => {
  it('returns ok on a 200 response', async () => {
    const r = await replyToComment(client(mockFetch(200, { id: 'reply-1' })), 'c1', 'hi');
    expect(r.ok).toBe(true);
    expect(r.data?.id).toBe('reply-1');
  });

  it('maps token error (code 190) to non-retryable', async () => {
    const r = await replyToComment(client(mockFetch(400, { error: { code: 190 } })), 'c1', 'hi');
    expect(r.ok).toBe(false);
    expect(isRetryable(r.failure!)).toBe(false);
  });

  it('maps permission error (code 10) to non-retryable', async () => {
    const r = await replyToComment(client(mockFetch(403, { error: { code: 10 } })), 'c1', 'hi');
    expect(isRetryable(r.failure!)).toBe(false);
  });

  it('maps a 500 with no error code to retryable', async () => {
    const r = await replyToComment(client(mockFetch(500, {})), 'c1', 'hi');
    expect(isRetryable(r.failure!)).toBe(true);
  });

  it('treats a thrown fetch (network error) as retryable', async () => {
    const throwing = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const r = await replyToComment(client(throwing), 'c1', 'hi');
    expect(r.ok).toBe(false);
    expect(isRetryable(r.failure!)).toBe(true);
  });
});

describe('sendPrivateReply payload', () => {
  it('builds a button template when button text and url are present', async () => {
    let captured: string | undefined;
    const capturing = vi.fn(async (_url: string, init: RequestInit) => {
      captured = init.body as string;
      return new Response(JSON.stringify({ message_id: 'm1' }), { status: 200 });
    }) as unknown as typeof fetch;

    const r = await sendPrivateReply(client(capturing), {
      instagramAccountId: 'acct-1',
      commentId: 'c1',
      text: '看這裡',
      buttonText: '開啟 GitHub',
      buttonUrl: 'https://github.com/x/y',
    });
    expect(r.ok).toBe(true);
    // application/x-www-form-urlencoded 把空格編成 '+'，還原成空格再比對。
    const decoded = decodeURIComponent(captured!.replace(/\+/g, ' '));
    expect(decoded).toContain('template');
    expect(decoded).toContain('web_url');
    expect(decoded).toContain('開啟 GitHub');
    expect(decoded).toContain('comment_id');
  });

  it('builds a plain text message when no button is provided', async () => {
    let captured: string | undefined;
    const capturing = vi.fn(async (_url: string, init: RequestInit) => {
      captured = init.body as string;
      return new Response(JSON.stringify({ message_id: 'm1' }), { status: 200 });
    }) as unknown as typeof fetch;

    await sendPrivateReply(client(capturing), {
      instagramAccountId: 'acct-1',
      commentId: 'c1',
      text: '純文字',
    });
    const decoded = decodeURIComponent(captured!);
    expect(decoded).toContain('純文字');
    expect(decoded).not.toContain('template');
  });
});
