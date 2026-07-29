import { describe, expect, it } from 'vitest';
import {
  PBKDF2_EFFECTIVE_FLOOR,
  PBKDF2_EFFECTIVE_ITERATIONS,
  PBKDF2_ITERATIONS_PER_ROUND,
  getDummyHash,
  hashPassword,
  verifyPassword,
} from '../../src/security/password';

describe('password hashing', () => {
  it('hashes and verifies a correct password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('wrong password', hash)).resolves.toBe(false);
  });

  it('produces a different hash each time due to random salt', async () => {
    const hashA = await hashPassword('same-password');
    const hashB = await hashPassword('same-password');
    expect(hashA).not.toBe(hashB);
  });

  it('keeps effective iterations at/above the OWASP floor while staying within the Workers per-call cap', () => {
    expect(PBKDF2_EFFECTIVE_ITERATIONS).toBeGreaterThanOrEqual(PBKDF2_EFFECTIVE_FLOOR);
    expect(PBKDF2_EFFECTIVE_FLOOR).toBe(600_000);
    // Cloudflare Workers 正式 runtime 硬上限：單次呼叫不得超過 100,000。
    expect(PBKDF2_ITERATIONS_PER_ROUND).toBeLessThanOrEqual(100_000);
  });

  it('produces a self-describing iterated-pbkdf2 hash', async () => {
    const hash = await hashPassword('encode-me');
    expect(hash.startsWith('pbkdf2$sha256$100000x6$')).toBe(true);
    expect(hash.split('$')).toHaveLength(5);
  });

  it('measures single hashPassword duration for CPU-time risk assessment', async () => {
    const start = performance.now();
    await hashPassword('measure-this-please');
    const durationMs = performance.now() - start;
    console.log(`[perf] hashPassword duration: ${durationMs.toFixed(1)}ms (Node, not Workers isolate)`);
    expect(durationMs).toBeGreaterThan(0);
  });

  it('provides a stable dummy hash for timing equalization', async () => {
    const dummyHash = await getDummyHash();
    await expect(verifyPassword('anything', dummyHash)).resolves.toBe(false);
    const dummyHashAgain = await getDummyHash();
    expect(dummyHashAgain).toBe(dummyHash);
  });
});
