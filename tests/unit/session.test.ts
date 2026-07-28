import { describe, expect, it } from 'vitest';
import { createSessionCookie, verifySessionCookie } from '../../src/security/session';

const SECRET = 'test-session-secret-value';

describe('session cookie', () => {
  it('verifies a valid, unexpired cookie', async () => {
    const cookie = await createSessionCookie(SECRET, 'admin-1', 3600);
    const result = await verifySessionCookie(SECRET, cookie);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.sub).toBe('admin-1');
      expect(result.payload.kid).toBe('1');
    }
  });

  it('rejects a tampered payload', async () => {
    const cookie = await createSessionCookie(SECRET, 'admin-1', 3600);
    const [payloadB64, sig] = cookie.split('.');
    const tampered = `${payloadB64}x.${sig}`;
    const result = await verifySessionCookie(SECRET, tampered);
    expect(result.valid).toBe(false);
  });

  it('rejects a tampered signature', async () => {
    const cookie = await createSessionCookie(SECRET, 'admin-1', 3600);
    const [payloadB64, sig] = cookie.split('.');
    // 翻轉「第一個」字元：它承載完整 6 個有效位元，一定會改到解碼後的 byte0，
    // 保證簽章 bytes 不同（翻最後一個字元可能只動到被丟棄的低位元 → 誤判為未竄改）。
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    const result = await verifySessionCookie(SECRET, `${payloadB64}.${flipped}`);
    expect(result.valid).toBe(false);
  });

  it('rejects a cookie signed with a different secret', async () => {
    const cookie = await createSessionCookie(SECRET, 'admin-1', 3600);
    const result = await verifySessionCookie('another-secret', cookie);
    expect(result.valid).toBe(false);
  });

  it('rejects an expired cookie', async () => {
    const cookie = await createSessionCookie(SECRET, 'admin-1', -1);
    const result = await verifySessionCookie(SECRET, cookie);
    expect(result.valid).toBe(false);
  });

  it('rejects a payload with a missing exp (fail-closed)', async () => {
    // 手動組一個沒有 exp 的 payload，用正確 secret 簽章。
    const encoder = new TextEncoder();
    const b64url = (bytes: Uint8Array) => {
      let s = '';
      for (const b of bytes) s += String.fromCharCode(b);
      return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };
    const payloadB64 = b64url(encoder.encode(JSON.stringify({ sub: 'admin-1', kid: '1', iat: 1 })));
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64)));
    const result = await verifySessionCookie(SECRET, `${payloadB64}.${b64url(sig)}`);
    expect(result.valid).toBe(false);
  });

  it('rejects malformed cookies', async () => {
    for (const bad of ['', 'no-dot', 'a.b.c', '.', 'abc.']) {
      expect((await verifySessionCookie(SECRET, bad)).valid).toBe(false);
    }
  });
});
