import { describe, expect, it } from 'vitest';
import { selectPublicReply } from '../../src/automation/public-reply';

const variants = [
  { id: 'a', message: '訊息 A', enabled: true },
  { id: 'b', message: '訊息 B', enabled: false },
  { id: 'c', message: '訊息 C', enabled: true },
];

describe('selectPublicReply', () => {
  it('only ever picks an enabled variant', () => {
    for (let r = 0; r < 100; r += 1) {
      const picked = selectPublicReply(variants, () => r / 100);
      expect(picked?.enabled).toBe(true);
    }
  });

  it('is deterministic given an injected random source', () => {
    expect(selectPublicReply(variants, () => 0)?.id).toBe('a');
    expect(selectPublicReply(variants, () => 0.99)?.id).toBe('c');
  });

  it('returns null when no variant is enabled', () => {
    expect(selectPublicReply([{ id: 'x', message: 'x', enabled: false }])).toBeNull();
  });

  it('handles randomFn returning exactly 1 without going out of bounds', () => {
    expect(selectPublicReply(variants, () => 1)?.id).toBe('c');
  });
});
