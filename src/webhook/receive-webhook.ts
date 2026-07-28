// Webhook 事件接收（spec.md 第 11.2 節）：POST /api/webhooks/meta/instagram。
// 順序：讀 raw body → 驗簽 → 解析 → 驗欄位 → 事件鍵 → 冪等寫 webhook_events → 送 Queue → 200。
// 禁止在此等待任何 Meta API 呼叫（spec §11.2）。
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import type { AppBindings } from '../app';
import { createDb } from '../database/client';
import { webhookEvents } from '../database/schema';
import { createLogger } from '../monitoring/logger';
import { enqueueCommentEvent } from '../queue/producer';
import { deriveEventKey, extractCommentEvents } from './event-parser';
import { verifyWebhookSignature } from './signature';

export async function handleWebhookReceive(
  c: Context<{ Bindings: AppBindings }>,
): Promise<Response> {
  const logger = createLogger(c.env.LOG_LEVEL as never);
  const rawBody = await c.req.arrayBuffer();
  const signature = c.req.header('X-Hub-Signature-256');

  const valid = await verifyWebhookSignature(c.env.META_APP_SECRET, rawBody, signature);
  if (!valid) {
    // 驗證失敗不得進入 Queue，寫安全 log（不記 body 內容）。
    logger.warn({ action: 'webhook.signature_invalid', httpStatus: 401 });
    return c.text('invalid signature', 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return c.text('bad request', 400);
  }

  const events = extractCommentEvents(payload);
  const db = createDb(c.env.DB);

  for (const ev of events) {
    // 缺 Comment ID／Media ID 的事件不處理（spec §8.3 排除條件之一）。
    if (!ev.instagramCommentId || !ev.instagramMediaId) continue;

    const eventKey = await deriveEventKey({
      instagramAccountId: ev.instagramAccountId,
      instagramMediaId: ev.instagramMediaId,
      instagramCommentId: ev.instagramCommentId,
      eventType: ev.eventType,
      eventTimestamp: ev.eventTimestamp,
    });

    const existing = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.eventKey, eventKey))
      .limit(1);

    if (existing.length > 0) {
      // 重送：duplicate_count 加一，不再次入列（Consumer 端另有 automation_run 冪等）。
      await db
        .update(webhookEvents)
        .set({
          duplicateCount: existing[0].duplicateCount + 1,
          lastReceivedAt: new Date().toISOString(),
        })
        .where(eq(webhookEvents.id, existing[0].id));
      continue;
    }

    const id = crypto.randomUUID();
    await db.insert(webhookEvents).values({
      id,
      eventKey,
      eventType: ev.eventType,
      instagramAccountId: ev.instagramAccountId,
      instagramMediaId: ev.instagramMediaId,
      instagramCommentId: ev.instagramCommentId,
      rawPayload: JSON.stringify(payload),
      signatureValid: 1,
      status: 'received',
    });

    await enqueueCommentEvent(c.env.COMMENT_QUEUE, {
      webhookEventId: id,
      eventKey,
      instagramAccountId: ev.instagramAccountId,
      instagramMediaId: ev.instagramMediaId,
      instagramCommentId: ev.instagramCommentId,
    });
  }

  // 一律快速回 200，即使沒有可處理的事件（避免 Meta 重送）。
  return c.text('ok', 200);
}
