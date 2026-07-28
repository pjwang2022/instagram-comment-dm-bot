import { describe, expect, it } from 'vitest';
import { deriveEventKey } from '../../src/webhook/event-parser';

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
