import { describe, expect, it } from 'vitest';
import { normalizeCommentText } from '../../src/automation/normalizer';

describe('normalizeCommentText', () => {
  it('matches the spec example (fullwidth + trim + lowercase + collapse)', () => {
    expect(normalizeCommentText('  我想要 ＡＤＨＤ 連結  ')).toBe('我想要 adhd 連結');
  });

  it('lowercases ASCII letters', () => {
    expect(normalizeCommentText('ADHD GitHub')).toBe('adhd github');
  });

  it('converts fullwidth alphanumerics to halfwidth', () => {
    expect(normalizeCommentText('ＡＢＣ１２３')).toBe('abc123');
  });

  it('collapses consecutive whitespace into a single space', () => {
    expect(normalizeCommentText('a\t\tb   c\nd')).toBe('a b c d');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeCommentText('   hello   ')).toBe('hello');
  });

  it('preserves Chinese characters', () => {
    expect(normalizeCommentText('我想要連結')).toBe('我想要連結');
  });

  it('preserves emoji', () => {
    expect(normalizeCommentText('想要 📩 連結')).toBe('想要 📩 連結');
  });

  it('handles fullwidth space (U+3000)', () => {
    expect(normalizeCommentText('我想要　連結')).toBe('我想要 連結');
  });
});
