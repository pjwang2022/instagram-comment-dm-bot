// 冪等性檢查與 Automation Run 建立（spec.md 第 13.2 節）。
// 靠 UNIQUE(automation_id, instagram_comment_id) 保證同一留言只建立一次 run。
import { and, eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from '../database/schema';
import { automationRuns } from '../database/schema';

type SchemaDb = BaseSQLiteDatabase<'sync' | 'async', unknown, typeof schema>;

export type AutomationRunRow = typeof automationRuns.$inferSelect;

export interface CreateRunInput {
  automationId: string;
  webhookEventId: string | null;
  instagramCommentId: string;
  instagramMediaId: string;
  commenterId?: string | null;
  commenterUsername?: string | null;
  originalCommentText?: string | null;
  normalizedCommentText?: string | null;
  matchedKeyword?: string | null;
  status: string;
}

export interface EnsureRunResult {
  run: AutomationRunRow;
  created: boolean; // true = 這次新建；false = 已存在（重複事件）
}

// 若 (automationId, commentId) 已存在則回傳既有 run 且 created=false；
// 否則新建並回傳 created=true。呼叫端據此決定是否要實際發送回覆/DM。
export async function ensureAutomationRun(
  db: SchemaDb,
  input: CreateRunInput,
): Promise<EnsureRunResult> {
  const existing = await db
    .select()
    .from(automationRuns)
    .where(
      and(
        eq(automationRuns.automationId, input.automationId),
        eq(automationRuns.instagramCommentId, input.instagramCommentId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return { run: existing[0], created: false };
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(automationRuns).values({
    id,
    automationId: input.automationId,
    webhookEventId: input.webhookEventId,
    instagramCommentId: input.instagramCommentId,
    instagramMediaId: input.instagramMediaId,
    commenterId: input.commenterId ?? null,
    commenterUsername: input.commenterUsername ?? null,
    originalCommentText: input.originalCommentText ?? null,
    normalizedCommentText: input.normalizedCommentText ?? null,
    matchedKeyword: input.matchedKeyword ?? null,
    status: input.status,
    startedAt: now,
  });

  const inserted = await db
    .select()
    .from(automationRuns)
    .where(eq(automationRuns.id, id))
    .limit(1);
  return { run: inserted[0], created: true };
}
