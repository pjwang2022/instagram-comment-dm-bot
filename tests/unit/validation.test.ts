import { describe, expect, it } from 'vitest';
import { isValidHttpsUrl, validateActivation } from '../../src/shared/validation';

describe('isValidHttpsUrl', () => {
  it('accepts https urls only', () => {
    expect(isValidHttpsUrl('https://example.com')).toBe(true);
    expect(isValidHttpsUrl('http://example.com')).toBe(false);
    expect(isValidHttpsUrl('not a url')).toBe(false);
    expect(isValidHttpsUrl(null)).toBe(false);
  });
});

describe('validateActivation', () => {
  const ok = {
    automationExists: true,
    matchType: 'contains_any',
    keywordCount: 2,
    publicReplyEnabled: true,
    privateReplyEnabled: true,
    openingDm: '你好',
    buttonUrl: 'https://example.com',
    tokenHealthy: true,
    emergencyStop: false,
  };

  it('passes a fully valid automation', () => {
    expect(validateActivation(ok)).toEqual([]);
  });

  it('requires keywords unless all_comments', () => {
    expect(validateActivation({ ...ok, keywordCount: 0 })).toContain('keywords_required');
    expect(validateActivation({ ...ok, matchType: 'all_comments', keywordCount: 0 })).not.toContain(
      'keywords_required',
    );
  });

  it('requires at least one reply channel', () => {
    expect(
      validateActivation({ ...ok, publicReplyEnabled: false, privateReplyEnabled: false }),
    ).toContain('at_least_one_reply_required');
  });

  it('requires opening DM when private reply is enabled', () => {
    expect(validateActivation({ ...ok, openingDm: '  ' })).toContain('opening_dm_required');
  });

  it('rejects an invalid button URL', () => {
    expect(validateActivation({ ...ok, buttonUrl: 'http://insecure.com' })).toContain(
      'button_url_invalid',
    );
  });

  it('blocks activation under emergency stop or unhealthy token', () => {
    expect(validateActivation({ ...ok, emergencyStop: true })).toContain('emergency_stop_active');
    expect(validateActivation({ ...ok, tokenHealthy: false })).toContain('token_unhealthy');
  });
});
