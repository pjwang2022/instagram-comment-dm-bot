// 執行紀錄 Admin API（spec.md 第 16.12–16.13 節）。唯讀 GET，需登入。
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppBindings } from '../app';
import { createDb } from '../database/client';
import { apiAttempts, automationRuns } from '../database/schema';
import { adminApiRateLimitMiddleware } from '../security/rate-limit';
import { requireAdminAuth } from './auth';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function createRunsRoutes() {
  const app = new Hono<{ Bindings: AppBindings; Variables: { adminUserId: string } }>();

  app.use('*', requireAdminAuth(), adminApiRateLimitMiddleware());

  // GET /api/admin/automation-runs?dateFrom&dateTo&mediaId&automationId&status&page&limit
  app.get('/', async (c) => {
    const db = createDb(c.env.DB);
    const q = c.req.query();

    const conds = [];
    if (q.mediaId) conds.push(eq(automationRuns.instagramMediaId, q.mediaId));
    if (q.automationId) conds.push(eq(automationRuns.automationId, q.automationId));
    if (q.status) conds.push(eq(automationRuns.status, q.status));
    if (q.publicReplyStatus) conds.push(eq(automationRuns.publicReplyStatus, q.publicReplyStatus));
    if (q.privateReplyStatus) conds.push(eq(automationRuns.privateReplyStatus, q.privateReplyStatus));
    if (q.dateFrom) conds.push(gte(automationRuns.createdAt, q.dateFrom));
    if (q.dateTo) conds.push(lte(automationRuns.createdAt, q.dateTo));

    const limit = Math.min(Number.parseInt(q.limit ?? '', 10) || DEFAULT_LIMIT, MAX_LIMIT);
    const page = Math.max(Number.parseInt(q.page ?? '', 10) || 1, 1);

    const rows = await db
      .select()
      .from(automationRuns)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(automationRuns.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    return c.json({ page, limit, runs: rows });
  });

  // GET /api/admin/automation-runs/:id
  app.get('/:id', async (c) => {
    const db = createDb(c.env.DB);
    const id = c.req.param('id');
    const runRows = await db.select().from(automationRuns).where(eq(automationRuns.id, id)).limit(1);
    if (runRows.length === 0) return c.json({ error: '紀錄不存在' }, 404);

    const attempts = await db
      .select()
      .from(apiAttempts)
      .where(eq(apiAttempts.automationRunId, id))
      .orderBy(apiAttempts.attemptNumber);

    // api_attempts 只存 *_redacted 欄位，Token 等敏感資訊本就不落地，回傳安全。
    return c.json({ run: runRows[0], attempts });
  });

  return app;
}
