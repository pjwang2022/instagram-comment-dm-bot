import { createApp, type AppBindings } from './app';
import { runScheduledSync } from './meta/media';
import { consumeCommentEvents } from './queue/consumer';
import type { CommentEventMessage } from './queue/producer';

const app = createApp();

export default {
  fetch: app.fetch,

  // Queue Consumer：留言比對與自動回覆引擎。
  async queue(batch: MessageBatch<CommentEventMessage>, env: AppBindings): Promise<void> {
    await consumeCommentEvents(batch, env);
  },

  // Cron：每日貼文同步（04:00 台北 = 20:00 UTC）與 Token 檢查（08:00 台北 = 00:00 UTC）。
  async scheduled(_controller: ScheduledController, env: AppBindings, _ctx: ExecutionContext): Promise<void> {
    try {
      await runScheduledSync(env);
    } catch (e) {
      console.error('[scheduled] runScheduledSync failed:', (e as Error)?.stack ?? e);
      throw e;
    }
  },
} satisfies ExportedHandler<AppBindings, CommentEventMessage>;
