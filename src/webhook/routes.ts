// Webhook 路由掛載（spec.md 第 11 節）。
import { Hono } from 'hono';
import type { AppBindings } from '../app';
import { handleWebhookReceive } from './receive-webhook';
import { handleWebhookVerification } from './verify-webhook';

export function createWebhookRoutes() {
  const webhook = new Hono<{ Bindings: AppBindings }>();

  // GET：Meta 端點驗證挑戰。
  webhook.get('/meta/instagram', (c) => handleWebhookVerification(c));

  // POST：事件接收（驗簽 → 冪等儲存 → 入列 → 200）。
  webhook.post('/meta/instagram', (c) => handleWebhookReceive(c));

  return webhook;
}
