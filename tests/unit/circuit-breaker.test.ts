import { describe, expect, it } from 'vitest';
import { evaluateCircuitBreaker, type AttemptOutcome } from '../../src/monitoring/circuit-breaker';

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
const ok = (at: number): AttemptOutcome => ({ ok: true, at });
const err = (reason: AttemptOutcome['reason'], at: number): AttemptOutcome => ({ ok: false, reason, at });

describe('evaluateCircuitBreaker', () => {
  it('stays closed on healthy traffic', () => {
    const attempts = Array.from({ length: 12 }, (_, i) => ok(NOW - i * 1000));
    expect(evaluateCircuitBreaker({ recentAttempts: attempts, now: NOW, dailySentCount: 5, dailyLimit: 2000 })).toEqual({
      open: false,
      reason: null,
    });
  });

  it('opens on daily limit exceeded', () => {
    const d = evaluateCircuitBreaker({ recentAttempts: [], now: NOW, dailySentCount: 2001, dailyLimit: 2000 });
    expect(d).toEqual({ open: true, reason: 'daily_limit_exceeded' });
  });

  it('opens on any explicit policy restriction', () => {
    const d = evaluateCircuitBreaker({
      recentAttempts: [ok(NOW - 1000), err('policy_restricted', NOW)],
      now: NOW,
      dailySentCount: 0,
      dailyLimit: null,
    });
    expect(d.open).toBe(true);
    expect(d.reason).toBe('policy_restricted');
  });

  it('opens after 5 consecutive token-invalid errors', () => {
    const attempts = [ok(NOW - 6000), ...Array.from({ length: 5 }, (_, i) => err('token_invalid', NOW - (4 - i) * 1000))];
    const d = evaluateCircuitBreaker({ recentAttempts: attempts, now: NOW, dailySentCount: 0, dailyLimit: null });
    expect(d).toEqual({ open: true, reason: 'consecutive_token_invalid' });
  });

  it('does not open on 4 consecutive token errors', () => {
    const attempts = [ok(NOW - 6000), ...Array.from({ length: 4 }, (_, i) => err('token_invalid', NOW - (3 - i) * 1000))];
    expect(evaluateCircuitBreaker({ recentAttempts: attempts, now: NOW, dailySentCount: 0, dailyLimit: null }).open).toBe(false);
  });

  it('opens on >20% error rate over 10+ calls in 5 min', () => {
    // 10 calls, 3 errors (30%) — but not consecutive/policy
    const attempts = [
      ...Array.from({ length: 7 }, (_, i) => ok(NOW - i * 1000)),
      err('other', NOW - 8000),
      err('other', NOW - 9000),
      err('other', NOW - 10000),
    ];
    const d = evaluateCircuitBreaker({ recentAttempts: attempts, now: NOW, dailySentCount: 0, dailyLimit: null });
    expect(d).toEqual({ open: true, reason: 'error_rate_exceeded' });
  });

  it('ignores errors outside the 5-minute window', () => {
    const attempts = [
      ...Array.from({ length: 10 }, (_, i) => ok(NOW - i * 1000)),
      err('other', NOW - 6 * 60 * 1000), // 6 min ago
    ];
    expect(evaluateCircuitBreaker({ recentAttempts: attempts, now: NOW, dailySentCount: 0, dailyLimit: null }).open).toBe(false);
  });
});
