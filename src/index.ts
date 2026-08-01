import { createApp, type AppBindings } from './app';
import { createDb } from './database/client';
import { runDataCleanup, scheduledJobForCron } from './maintenance/cleanup';
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

  // Cron：每日貼文同步（04:00 台北 = 20:00 UTC）、Token 檢查（08:00 台北 = 00:00 UTC）、
  // 資料清理（03:00 台北 = 19:00 UTC，spec §20）。
  async scheduled(controller: ScheduledController, env: AppBindings, _ctx: ExecutionContext): Promise<void> {
    try {
      if (scheduledJobForCron(controller.cron) === 'cleanup') {
        await runDataCleanup(createDb(env.DB));
      } else {
        await runScheduledSync(env);
      }
    } catch (e) {
      console.error('[scheduled] job failed:', (e as Error)?.stack ?? e);
      throw e;
    }
  },
} satisfies ExportedHandler<AppBindings, CommentEventMessage>;
