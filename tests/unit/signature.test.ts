import { describe, expect, it } from 'vitest';
import { verifyWebhookSignature } from '../../src/webhook/signature';

const SECRET = 'meta-app-secret';
const encoder = new TextEncoder();

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
  return 'sha256=' + Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('verifyWebhookSignature', () => {
  const body = '{"object":"instagram","entry":[]}';

  it('accepts a correct signature', async () => {
    const header = await sign(SECRET, body);
    expect(await verifyWebhookSignature(SECRET, encoder.encode(body), header)).toBe(true);
  });

  it('rejects a signature made with the wrong secret', async () => {
    const header = await sign('wrong-secret', body);
    expect(await verifyWebhookSignature(SECRET, encoder.encode(body), header)).toBe(false);
  });

  it('rejects when the body has been tampered with', async () => {
    const header = await sign(SECRET, body);
    expect(await verifyWebhookSignature(SECRET, encoder.encode(body + ' '), header)).toBe(false);
  });

  it('rejects a missing or malformed header', async () => {
    expect(await verifyWebhookSignature(SECRET, encoder.encode(body), undefined)).toBe(false);
    expect(await verifyWebhookSignature(SECRET, encoder.encode(body), 'notasig')).toBe(false);
    expect(await verifyWebhookSignature(SECRET, encoder.encode(body), 'sha256=zz')).toBe(false);
    expect(await verifyWebhookSignature(SECRET, encoder.encode(body), 'sha256=')).toBe(false);
  });

  it('accepts an ArrayBuffer body as well as Uint8Array', async () => {
    const header = await sign(SECRET, body);
    const buf = encoder.encode(body).buffer;
    expect(await verifyWebhookSignature(SECRET, buf, header)).toBe(true);
  });
});
