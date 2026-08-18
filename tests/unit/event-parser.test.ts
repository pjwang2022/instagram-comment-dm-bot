import { describe, expect, it } from 'vitest';
import {
  deriveEventKey,
  extractStoryReplyEvents,
  findStoryReplyEvent,
} from '../../src/webhook/event-parser';

describe('deriveEventKey', () => {
  it('uses the stable event id verbatim when present', async () => {
    const key = await deriveEventKey({ stableEventId: 'evt_abc', instagramCommentId: 'c1' });
    expect(key).toBe('evt_abc');
  });

  it('derives a stable SHA-256 hex when no stable id is present', async () => {
    const input = {
      instagramAccountId: 'acct',
      instagramMediaId: 'media',
      instagramCommentId: 'comment',
      eventType: 'comments',
      eventTimestamp: 1700000000,
    };
    const a = await deriveEventKey(input);
    const b = await deriveEventKey(input);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different keys for different comment ids', async () => {
    const base = { instagramAccountId: 'a', instagramMediaId: 'm', eventType: 'comments', eventTimestamp: 1 };
    const k1 = await deriveEventKey({ ...base, instagramCommentId: 'c1' });
    const k2 = await deriveEventKey({ ...base, instagramCommentId: 'c2' });
    expect(k1).not.toBe(k2);
  });
});

// 限動回應 webhook 範例：messages 欄位、messaging 陣列、reply_to.story。
function storyPayload(overrides: Record<string, unknown> = {}) {
  return {
    object: 'instagram',
    entry: [
      {
        id: 'acct-1',
        time: 1700000000,
        messaging: [
          {
            sender: { id: 'user-9' },
            recipient: { id: 'acct-1' },
            timestamp: 1700000001234,
            message: {
              mid: 'mid.abc',
              text: '關鍵字',
              reply_to: { story: { id: 'story-1', url: 'https://cdn.example/story.jpg' } },
              ...overrides,
            },
          },
        ],
      },
    ],
  };
}

describe('extractStoryReplyEvents', () => {
  it('extracts a story reply with account/story/mid/sender/text', () => {
    const events = extractStoryReplyEvents(storyPayload());
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      instagramAccountId: 'acct-1',
      storyId: 'story-1',
      messageId: 'mid.abc',
      senderId: 'user-9',
      text: '關鍵字',
      eventType: 'story_reply',
      eventTimestamp: '1700000001234',
    });
  });

  it('ignores plain DMs without reply_to.story', () => {
    const payload = storyPayload();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (payload.entry[0].messaging[0].message as any).reply_to;
    expect(extractStoryReplyEvents(payload)).toHaveLength(0);
  });

  it('ignores echo messages (our own outgoing DMs)', () => {
    expect(extractStoryReplyEvents(storyPayload({ is_echo: true }))).toHaveLength(0);
  });

  it('ignores comment-style payloads entirely', () => {
    const payload = {
      object: 'instagram',
      entry: [{ id: 'a', time: 1, changes: [{ field: 'comments', value: { id: 'c1' } }] }],
    };
    expect(extractStoryReplyEvents(payload)).toHaveLength(0);
  });
});

describe('findStoryReplyEvent', () => {
  it('finds by message id and returns null when absent', () => {
    const payload = storyPayload();
    expect(findStoryReplyEvent(payload, 'mid.abc')?.storyId).toBe('story-1');
    expect(findStoryReplyEvent(payload, 'mid.nope')).toBeNull();
  });
});
