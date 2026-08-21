import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';

// 根路徑導向後台：靜態資產的 index.html 在 / 會渲染空白（SPA base 是 /admin），
// 因此 wrangler.jsonc 以 run_worker_first 讓 / 先進 Worker，由這條路由 302 到 /admin。
describe('GET /', () => {
  it('redirects to /admin', async () => {
    const res = await createApp().fetch(
      new Request('https://igbot.example.com/'),
      {} as never,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/admin');
  });
});
