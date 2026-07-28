// Queue Consumer 進入點：把 Cloudflare Queue batch 逐則餵給引擎，並依結果 ack / retry。
import type { MessageBatch } from '@cloudflare/workers-types';
import type { AppBindings } from '../app';
import { processCommentEvent, type EngineDeps } from '../automation/engine';
import { MetaClient } from '../meta/client';
import type { CommentEventMessage } from './producer';

export async function consumeCommentEvents(
  batch: MessageBatch<CommentEventMessage>,
  env: AppBindings,
): Promise<void> {
  const { createDb } = await import('../database/client');
  const deps: EngineDeps = {
    db: createDb(env.DB),
    metaClient: new MetaClient({
      accessToken: env.INSTAGRAM_ACCESS_TOKEN,
      graphApiVersion: env.META_GRAPH_API_VERSION,
    }),
  };

  for (const msg of batch.messages) {
    try {
      const outcome = await processCommentEvent(deps, msg.body);
      if (outcome.kind === 'retry' && outcome.delaySeconds !== null) {
        msg.retry({ delaySeconds: outcome.delaySeconds });
      } else {
        msg.ack();
      }
    } catch {
      // 未預期錯誤：交回 Queue 重試（Cloudflare 的 max_retries 上限保護）。
      msg.retry();
    }
  }
}
