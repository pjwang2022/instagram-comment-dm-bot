import { describe, expect, it } from 'vitest';
import { matchKeywords, matchRawComment } from '../../src/automation/matcher';

describe('matchKeywords', () => {
  const keywords = ['adhd', 'github', '想要'];

  it('contains_any triggers when any keyword is a substring', () => {
    const r = matchKeywords('我想要 adhd 的 github', keywords, 'contains_any');
    expect(r.matched).toBe(true);
    expect(r.matchedKeyword).toBe('adhd'); // first match by keyword-list order
  });

  it('contains_any does not trigger when no keyword present', () => {
    expect(matchKeywords('完全不相關', keywords, 'contains_any').matched).toBe(false);
  });

  it('exact_any triggers only on exact equality', () => {
    expect(matchKeywords('adhd', ['adhd'], 'exact_any').matched).toBe(true);
    expect(matchKeywords('我想要 adhd', ['adhd'], 'exact_any').matched).toBe(false);
  });

  it('all_comments always matches with a null keyword', () => {
    const r = matchKeywords('anything at all', [], 'all_comments');
    expect(r.matched).toBe(true);
    expect(r.matchedKeyword).toBeNull();
  });

  it('ignores empty keyword entries', () => {
    expect(matchKeywords('hello', ['', 'hello'], 'exact_any').matched).toBe(true);
  });
});

describe('matchRawComment (normalizes first)', () => {
  it('matches case-insensitively via normalization', () => {
    expect(matchRawComment('我想要 ADHD', ['adhd'], 'contains_any').matched).toBe(true);
  });

  it('matches fullwidth input against halfwidth keyword', () => {
    expect(matchRawComment('  ＡＤＨＤ  ', ['adhd'], 'exact_any').matched).toBe(true);
  });
});
