import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';

const env = { META_VERIFY_TOKEN: 'my-verify-token' } as Record<string, unknown>;

function verifyRequest(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return new Request(`https://igbot.example.com/api/webhooks/meta/instagram?${qs}`);
}

describe('GET /api/webhooks/meta/instagram', () => {
  it('echoes the challenge when the verify token matches', async () => {
    const app = createApp();
    const res = await app.fetch(
      verifyRequest({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'my-verify-token',
        'hub.challenge': '1234567890',
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('1234567890');
  });

  it('returns 403 when the verify token is wrong', async () => {
    const app = createApp();
    const res = await app.fetch(
      verifyRequest({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': '1234567890',
      }),
      env,
    );
    expect(res.status).toBe(403);
  });

  it('returns 403 when hub.mode is not subscribe', async () => {
    const app = createApp();
    const res = await app.fetch(
      verifyRequest({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'my-verify-token' }),
      env,
    );
    expect(res.status).toBe(403);
  });
});
