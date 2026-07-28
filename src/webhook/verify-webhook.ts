// Webhook 驗證端點（spec.md 第 11.1 節）：GET /api/webhooks/meta/instagram。
// Meta 用 hub.mode=subscribe + hub.verify_token + hub.challenge 來驗證 endpoint。
import type { Context } from 'hono';
import type { AppBindings } from '../app';

export function handleWebhookVerification(c: Context<{ Bindings: AppBindings }>): Response {
  const mode = c.req.query('hub.mode');
  const token = c.req.query('hub.verify_token');
  const challenge = c.req.query('hub.challenge');

  if (mode === 'subscribe' && token && token === c.env.META_VERIFY_TOKEN) {
    // 正確時原樣回傳 challenge（純文字）。
    return c.text(challenge ?? '', 200);
  }

  return c.text('Forbidden', 403);
}
