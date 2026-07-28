// 自動化規則 CRUD Admin API（spec.md 第 16.8–16.11 節）。
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppBindings } from '../app';
import { normalizeCommentText } from '../automation/normalizer';
import { createDb } from '../database/client';
import {
  automationKeywords,
  automationRuns,
  automations,
  instagramAccounts,
  instagramMedia,
  publicReplyVariants,
  systemSettings,
} from '../database/schema';
import { csrfMiddleware } from '../security/csrf';
import { adminApiRateLimitMiddleware } from '../security/rate-limit';
import { VALID_MATCH_TYPES, validateActivation } from '../shared/validation';
import { requireAdminAuth } from './auth';

interface CreateBody {
  instagramMediaId?: string;
  name?: string;
  matchType?: string;
  keywords?: unknown;
  publicReplyEnabled?: boolean;
  publicReplyVariants?: unknown;
  privateReplyEnabled?: boolean;
  openingDm?: string;
  buttonText?: string;
  buttonUrl?: string;
  dailyLimit?: number;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function replaceKeywords(db: any, automationId: string, keywords: string[]): Promise<void> {
  await db.delete(automationKeywords).where(eq(automationKeywords.automationId, automationId));
  const seen = new Set<string>();
  for (const kw of keywords) {
    const normalized = normalizeCommentText(kw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    await db.insert(automationKeywords).values({
      id: crypto.randomUUID(),
      automationId,
      keyword: kw,
      normalizedKeyword: normalized,
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function replaceVariants(db: any, automationId: string, messages: string[]): Promise<void> {
  await db.delete(publicReplyVariants).where(eq(publicReplyVariants.automationId, automationId));
  for (const message of messages.slice(0, 5)) {
    await db.insert(publicReplyVariants).values({
      id: crypto.randomUUID(),
      automationId,
      message,
      enabled: 1,
    });
  }
}

export function createAutomationRoutes() {
  const app = new Hono<{ Bindings: AppBindings; Variables: { adminUserId: string } }>();

  // 所有修改型 Admin API：CSRF → 驗證登入 → 一般限流。
  app.use('*', csrfMiddleware(), requireAdminAuth(), adminApiRateLimitMiddleware());

  // POST /api/admin/automations
  app.post('/', async (c) => {
    let body: CreateBody;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: '請求格式錯誤' }, 400);
    }

    if (!body.instagramMediaId || !body.name) {
      return c.json({ error: '缺少必要欄位' }, 400);
    }
    const matchType = body.matchType ?? 'contains_any';
    if (!VALID_MATCH_TYPES.includes(matchType as never)) {
      return c.json({ error: '比對模式無效' }, 400);
    }

    const db = createDb(c.env.DB);
    const media = await db
      .select()
      .from(instagramMedia)
      .where(eq(instagramMedia.id, body.instagramMediaId))
      .limit(1);
    if (media.length === 0) return c.json({ error: '貼文不存在' }, 404);

    const automationId = crypto.randomUUID();
    await db.insert(automations).values({
      id: automationId,
      instagramMediaId: body.instagramMediaId,
      name: body.name,
      status: 'draft',
      matchType,
      publicReplyEnabled: body.publicReplyEnabled === false ? 0 : 1,
      privateReplyEnabled: body.privateReplyEnabled === false ? 0 : 1,
      openingDm: body.openingDm ?? null,
      buttonText: body.buttonText ?? null,
      buttonUrl: body.buttonUrl ?? null,
      dailyLimit: typeof body.dailyLimit === 'number' ? body.dailyLimit : null,
    });

    await replaceKeywords(db, automationId, asStringArray(body.keywords));
    await replaceVariants(db, automationId, asStringArray(body.publicReplyVariants));

    return c.json({ id: automationId }, 201);
  });

  // GET /api/admin/automations/overview —— 已設定自動化的貼文 + 每篇統計（供儀表板）。
  // 註：必須註冊在 GET /:id 之前，否則 "overview" 會被當成 id。
  app.get('/overview', async (c) => {
    const db = createDb(c.env.DB);
    const autos = await db.select().from(automations);
    const mediaRows = await db.select().from(instagramMedia);
    const runs = await db.select().from(automationRuns);
    const kws = await db.select().from(automationKeywords);

    const mediaById = new Map(mediaRows.map((m: { id: string }) => [m.id, m]));

    const items = autos
      .map((a: typeof automations.$inferSelect) => {
        const media = mediaById.get(a.instagramMediaId) as typeof instagramMedia.$inferSelect | undefined;
        const myRuns = runs.filter((r: { automationId: string }) => r.automationId === a.id);
        return {
          automationId: a.id,
          name: a.name,
          status: a.status,
          matchType: a.matchType,
          keywordCount: kws.filter((k: { automationId: string }) => k.automationId === a.id).length,
          media: media
            ? {
                id: media.id,
                mediaType: media.mediaType,
                caption: media.caption,
                thumbnailUrl: media.thumbnailUrl,
                permalink: media.permalink,
              }
            : null,
          stats: {
            triggered: myRuns.length,
            publicReplySuccess: myRuns.filter(
              (r: { publicReplyStatus: string | null }) => r.publicReplyStatus === 'success',
            ).length,
            dmSuccess: myRuns.filter(
              (r: { privateReplyStatus: string | null }) => r.privateReplyStatus === 'success',
            ).length,
            failures: myRuns.filter((r: { status: string }) => r.status === 'completed_with_errors').length,
          },
        };
      })
      // 啟用中排前面，其次暫停、草稿。
      .sort((x, y) => {
        const order: Record<string, number> = { active: 0, paused: 1, draft: 2 };
        return (order[x.status] ?? 9) - (order[y.status] ?? 9);
      });

    return c.json({ automations: items });
  });

  // GET /api/admin/automations/:id —— 供編輯器預填
  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const db = createDb(c.env.DB);
    const rows = await db.select().from(automations).where(eq(automations.id, id)).limit(1);
    if (rows.length === 0) return c.json({ error: '自動化不存在' }, 404);
    const keywords = await db
      .select()
      .from(automationKeywords)
      .where(eq(automationKeywords.automationId, id));
    const variants = await db
      .select()
      .from(publicReplyVariants)
      .where(eq(publicReplyVariants.automationId, id));
    return c.json({
      automation: rows[0],
      keywords: keywords.map((k: { keyword: string }) => k.keyword),
      publicReplyVariants: variants.map((v: { message: string }) => v.message),
    });
  });

  // PATCH /api/admin/automations/:id
  app.patch('/:id', async (c) => {
    const id = c.req.param('id');
    let body: Partial<CreateBody>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: '請求格式錯誤' }, 400);
    }

    const db = createDb(c.env.DB);
    const existing = await db.select().from(automations).where(eq(automations.id, id)).limit(1);
    if (existing.length === 0) return c.json({ error: '自動化不存在' }, 404);

    const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (typeof body.name === 'string') patch.name = body.name;
    if (body.matchType && VALID_MATCH_TYPES.includes(body.matchType as never)) {
      patch.matchType = body.matchType;
    }
    if (typeof body.publicReplyEnabled === 'boolean') {
      patch.publicReplyEnabled = body.publicReplyEnabled ? 1 : 0;
    }
    if (typeof body.privateReplyEnabled === 'boolean') {
      patch.privateReplyEnabled = body.privateReplyEnabled ? 1 : 0;
    }
    if (body.openingDm !== undefined) patch.openingDm = body.openingDm;
    if (body.buttonText !== undefined) patch.buttonText = body.buttonText;
    if (body.buttonUrl !== undefined) patch.buttonUrl = body.buttonUrl;
    if (typeof body.dailyLimit === 'number') patch.dailyLimit = body.dailyLimit;

    await db.update(automations).set(patch).where(eq(automations.id, id));

    // 有帶 keywords / publicReplyVariants 就整批替換。
    if (body.keywords !== undefined) {
      await replaceKeywords(db, id, asStringArray(body.keywords));
    }
    if (body.publicReplyVariants !== undefined) {
      await replaceVariants(db, id, asStringArray(body.publicReplyVariants));
    }
    return c.json({ ok: true });
  });

  // POST /api/admin/automations/:id/activate
  app.post('/:id/activate', async (c) => {
    const id = c.req.param('id');
    const db = createDb(c.env.DB);

    const rows = await db.select().from(automations).where(eq(automations.id, id)).limit(1);
    const automation = rows[0];
    const keywordRows = automation
      ? await db.select().from(automationKeywords).where(eq(automationKeywords.automationId, id))
      : [];
    const settings = await db.select().from(systemSettings).limit(1);

    // Token 健康度：以帳號的 circuit_breaker_status 與 token_expires_at 粗略判斷（MVP）。
    let tokenHealthy = true;
    if (automation) {
      const media = await db
        .select()
        .from(instagramMedia)
        .where(eq(instagramMedia.id, automation.instagramMediaId))
        .limit(1);
      if (media[0]) {
        const acct = await db
          .select()
          .from(instagramAccounts)
          .where(eq(instagramAccounts.id, media[0].instagramAccountId))
          .limit(1);
        if (acct[0]) tokenHealthy = acct[0].circuitBreakerStatus === 'closed';
      }
    }

    const errors = validateActivation({
      automationExists: Boolean(automation),
      matchType: automation?.matchType ?? '',
      keywordCount: keywordRows.length,
      publicReplyEnabled: automation?.publicReplyEnabled === 1,
      privateReplyEnabled: automation?.privateReplyEnabled === 1,
      openingDm: automation?.openingDm ?? null,
      buttonUrl: automation?.buttonUrl ?? null,
      tokenHealthy,
      emergencyStop: settings[0]?.emergencyStop === 1,
    });

    if (errors.length > 0) {
      return c.json({ error: 'activation_failed', reasons: errors }, 422);
    }

    await db
      .update(automations)
      .set({ status: 'active', updatedAt: new Date().toISOString() })
      .where(eq(automations.id, id));
    return c.json({ ok: true });
  });

  // POST /api/admin/automations/:id/pause
  app.post('/:id/pause', async (c) => {
    const id = c.req.param('id');
    const db = createDb(c.env.DB);
    const existing = await db.select().from(automations).where(eq(automations.id, id)).limit(1);
    if (existing.length === 0) return c.json({ error: '自動化不存在' }, 404);
    await db
      .update(automations)
      .set({ status: 'paused', updatedAt: new Date().toISOString() })
      .where(and(eq(automations.id, id)));
    return c.json({ ok: true });
  });

  return app;
}
