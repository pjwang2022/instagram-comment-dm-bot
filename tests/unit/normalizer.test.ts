import { describe, expect, it } from 'vitest';
import { normalizeCommentText } from '../../src/automation/normalizer';

describe('normalizeCommentText', () => {
  it('matches the spec example (fullwidth + trim + lowercase + collapse)', () => {
    expect(normalizeCommentText('  我想要 ＡＤＨＤ 連結  ')).toBe('我想要 adhd 连结');
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

  it('normalizes Chinese to simplified as the canonical form', () => {
    expect(normalizeCommentText('我想要連結')).toBe('我想要连结');
  });

  it('makes traditional and simplified forms interchangeable', () => {
    // 關鍵字與留言兩側都經過本函式：繁體關鍵字 ↔ 簡體留言（反之亦然）都要相等。
    expect(normalizeCommentText('連結')).toBe(normalizeCommentText('连结'));
    expect(normalizeCommentText('電腦網路')).toBe(normalizeCommentText('电脑网路'));
  });

  it('keeps uppercase keywords matching lowercase comments (both sides lowercased)', () => {
    expect(normalizeCommentText('GITHUB')).toBe(normalizeCommentText('github'));
  });

  it('preserves emoji', () => {
    expect(normalizeCommentText('想要 📩 連結')).toBe('想要 📩 连结');
  });

  it('handles fullwidth space (U+3000)', () => {
    expect(normalizeCommentText('我想要　連結')).toBe('我想要 连结');
  });
});
