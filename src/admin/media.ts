// 貼文列表 Admin API（spec.md 第 16.6 節）。唯讀 GET，需登入。
import { and, desc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppBindings } from '../app';
import { createDb } from '../database/client';
import { automations, instagramMedia } from '../database/schema';
import { runScheduledSync } from '../meta/media';
import { csrfMiddleware } from '../security/csrf';
import { adminApiRateLimitMiddleware } from '../security/rate-limit';
import { requireAdminAuth } from './auth';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function createMediaRoutes() {
  const app = new Hono<{ Bindings: AppBindings; Variables: { adminUserId: string } }>();

  app.use('*', requireAdminAuth(), adminApiRateLimitMiddleware());

  // POST /api/admin/media/sync（spec §16.7）：手動觸發貼文同步。
  app.post('/sync', csrfMiddleware(), async (c) => {
    try {
      const summary = await runScheduledSync(c.env);
      return c.json({ ok: true, ...summary });
    } catch (e) {
      return c.json({ ok: false, error: (e as Error)?.message ?? 'sync failed' }, 500);
    }
  });

  // GET /api/admin/media?page&limit&mediaType&automationStatus
  app.get('/', async (c) => {
    const db = createDb(c.env.DB);
    const q = c.req.query();
    const limit = Math.min(Number.parseInt(q.limit ?? '', 10) || DEFAULT_LIMIT, MAX_LIMIT);
    const page = Math.max(Number.parseInt(q.page ?? '', 10) || 1, 1);

    // IG 上已刪除的貼文預設隱藏；?includeDeleted=1 可查回（發送紀錄仍保留）。
    const mediaRows = await db
      .select()
      .from(instagramMedia)
      .where(
        and(
          q.mediaType ? eq(instagramMedia.mediaType, q.mediaType) : undefined,
          q.includeDeleted === '1' ? undefined : isNull(instagramMedia.deletedAt),
        ),
      )
      .orderBy(desc(instagramMedia.publishedAt))
      .limit(limit)
      .offset((page - 1) * limit);

    // 附上每篇的自動化狀態。
    const autos = await db.select().from(automations);
    const autoByMedia = new Map(autos.map((a) => [a.instagramMediaId, a]));

    let items = mediaRows.map((m) => ({
      ...m,
      automationStatus: autoByMedia.get(m.id)?.status ?? 'none',
      automationId: autoByMedia.get(m.id)?.id ?? null,
    }));

    if (q.automationStatus) {
      items = items.filter((i) => i.automationStatus === q.automationStatus);
    }

    return c.json({ page, limit, media: items });
  });

  return app;
}
