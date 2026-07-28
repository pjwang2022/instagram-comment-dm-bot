import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const app = createApp();
    const res = await app.request('/api/health');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
