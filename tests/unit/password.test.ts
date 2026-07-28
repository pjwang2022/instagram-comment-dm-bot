import { describe, expect, it } from 'vitest';
import {
  PBKDF2_ITERATIONS,
  PBKDF2_ITERATIONS_FLOOR,
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

  it('never lowers the PBKDF2 iterations below the OWASP floor', () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(PBKDF2_ITERATIONS_FLOOR);
    expect(PBKDF2_ITERATIONS_FLOOR).toBe(600_000);
  });

  it('produces a self-describing pbkdf2-encoded hash', async () => {
    const hash = await hashPassword('encode-me');
    expect(hash.startsWith('pbkdf2$sha256$600000$')).toBe(true);
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
