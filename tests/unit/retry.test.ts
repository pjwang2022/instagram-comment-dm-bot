import { describe, expect, it } from 'vitest';
import { isRetryable } from '../../src/meta/errors';
import { MAX_RETRIES, nextRetryDelaySeconds, shouldRetry } from '../../src/queue/retry-policy';

describe('isRetryable', () => {
  it('treats 429 and 5xx as retryable', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isRetryable({ httpStatus: status })).toBe(true);
    }
  });

  it('treats network errors and timeouts as retryable', () => {
    expect(isRetryable({ networkError: true })).toBe(true);
    expect(isRetryable({ timeout: true })).toBe(true);
  });

  it('treats token/permission/policy errors as non-retryable', () => {
    expect(isRetryable({ nonRetryableReason: 'token_invalid' })).toBe(false);
    expect(isRetryable({ nonRetryableReason: 'permission_denied' })).toBe(false);
    expect(isRetryable({ nonRetryableReason: 'policy_restricted' })).toBe(false);
    expect(isRetryable({ nonRetryableReason: 'user_not_allowed' })).toBe(false);
  });

  it('treats 4xx (non-429) as non-retryable', () => {
    expect(isRetryable({ httpStatus: 400 })).toBe(false);
    expect(isRetryable({ httpStatus: 403 })).toBe(false);
    expect(isRetryable({ httpStatus: 404 })).toBe(false);
  });

  it('non-retryable reason overrides an otherwise-retryable status', () => {
    expect(isRetryable({ httpStatus: 500, nonRetryableReason: 'bad_request' })).toBe(false);
  });
});

describe('retry policy schedule', () => {
  it('follows 30s / 2min / 10min for the three retries', () => {
    expect(nextRetryDelaySeconds(0)).toBe(30);
    expect(nextRetryDelaySeconds(1)).toBe(120);
    expect(nextRetryDelaySeconds(2)).toBe(600);
  });

  it('stops after MAX_RETRIES', () => {
    expect(MAX_RETRIES).toBe(3);
    expect(nextRetryDelaySeconds(3)).toBeNull();
    expect(shouldRetry(2)).toBe(true);
    expect(shouldRetry(3)).toBe(false);
  });
});
