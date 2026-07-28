// D1 資料表定義（Drizzle schema），對應 spec.md 第 14 節（11 張表）與第 15 節（索引）。
// login_rate_limits 是 spec.md 未列出的第 12 張表：架構審查判定 TASK-008 的登入頻率限制
// （每 IP 15 分鐘 10 次）無法用 Cloudflare 原生 Rate Limiting binding 表示（binding 週期只
// 支援 10/60 秒），因此新增這張小型計數表作為混合方案的一部分（已與使用者確認）。
//
// created_at/updated_at（以及同性質的 received_at/last_received_at/api_attempts.started_at）
// 一律在 schema 層級用 $defaultFn 給預設值，insert 時可省略。
import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

const nowIso = () => new Date().toISOString();

export const adminUsers = sqliteTable('admin_users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
  updatedAt: text('updated_at').notNull().$defaultFn(nowIso),
});

export const systemSettings = sqliteTable('system_settings', {
  id: text('id').primaryKey(),
  emergencyStop: integer('emergency_stop').notNull().default(0),
  maxPublicRepliesPerMinute: integer('max_public_replies_per_minute'),
  maxPrivateRepliesPerMinute: integer('max_private_replies_per_minute'),
  maxPublicRepliesPerDay: integer('max_public_replies_per_day'),
  maxPrivateRepliesPerDay: integer('max_private_replies_per_day'),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
  updatedAt: text('updated_at').notNull().$defaultFn(nowIso),
});

export const instagramAccounts = sqliteTable('instagram_accounts', {
  id: text('id').primaryKey(),
  instagramAccountId: text('instagram_account_id').notNull().unique(),
  username: text('username'),
  profilePictureUrl: text('profile_picture_url'),
  accountType: text('account_type'),
  tokenExpiresAt: text('token_expires_at'),
  webhookSubscribed: integer('webhook_subscribed').notNull().default(0),
  automationEnabled: integer('automation_enabled').notNull().default(1),
  circuitBreakerStatus: text('circuit_breaker_status').notNull().default('closed'),
  lastWebhookReceivedAt: text('last_webhook_received_at'),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
  updatedAt: text('updated_at').notNull().$defaultFn(nowIso),
});

export const instagramMedia = sqliteTable(
  'instagram_media',
  {
    id: text('id').primaryKey(),
    instagramAccountId: text('instagram_account_id')
      .notNull()
      .references(() => instagramAccounts.id),
    instagramMediaId: text('instagram_media_id').notNull().unique(),
    mediaType: text('media_type').notNull(),
    caption: text('caption'),
    thumbnailUrl: text('thumbnail_url'),
    permalink: text('permalink'),
    publishedAt: text('published_at'),
    lastSyncedAt: text('last_synced_at'),
    createdAt: text('created_at').notNull().$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().$defaultFn(nowIso),
  },
  (table) => [index('idx_media_account').on(table.instagramAccountId)],
);

export const automations = sqliteTable('automations', {
  id: text('id').primaryKey(),
  instagramMediaId: text('instagram_media_id')
    .notNull()
    .unique()
    .references(() => instagramMedia.id),
  name: text('name').notNull(),
  status: text('status').notNull().default('draft'),
  matchType: text('match_type').notNull().default('contains_any'),
  publicReplyEnabled: integer('public_reply_enabled').notNull().default(1),
  privateReplyEnabled: integer('private_reply_enabled').notNull().default(1),
  openingDm: text('opening_dm'),
  buttonText: text('button_text'),
  buttonUrl: text('button_url'),
  dailyLimit: integer('daily_limit'),
  excludeOwnComments: integer('exclude_own_comments').notNull().default(1),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
  updatedAt: text('updated_at').notNull().$defaultFn(nowIso),
});

export const automationKeywords = sqliteTable(
  'automation_keywords',
  {
    id: text('id').primaryKey(),
    automationId: text('automation_id')
      .notNull()
      .references(() => automations.id),
    keyword: text('keyword').notNull(),
    normalizedKeyword: text('normalized_keyword').notNull(),
    createdAt: text('created_at').notNull().$defaultFn(nowIso),
  },
  (table) => [
    uniqueIndex('automation_keywords_automation_id_normalized_keyword_unique').on(
      table.automationId,
      table.normalizedKeyword,
    ),
    index('idx_keywords_automation').on(table.automationId),
  ],
);

export const publicReplyVariants = sqliteTable('public_reply_variants', {
  id: text('id').primaryKey(),
  automationId: text('automation_id')
    .notNull()
    .references(() => automations.id),
  message: text('message').notNull(),
  enabled: integer('enabled').notNull().default(1),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
  updatedAt: text('updated_at').notNull().$defaultFn(nowIso),
});

export const webhookEvents = sqliteTable(
  'webhook_events',
  {
    id: text('id').primaryKey(),
    eventKey: text('event_key').notNull().unique(),
    eventType: text('event_type').notNull(),
    instagramAccountId: text('instagram_account_id'),
    instagramMediaId: text('instagram_media_id'),
    instagramCommentId: text('instagram_comment_id'),
    rawPayload: text('raw_payload').notNull(),
    signatureValid: integer('signature_valid').notNull(),
    status: text('status').notNull().default('received'),
    duplicateCount: integer('duplicate_count').notNull().default(0),
    receivedAt: text('received_at').notNull().$defaultFn(nowIso),
    lastReceivedAt: text('last_received_at').notNull().$defaultFn(nowIso),
    processedAt: text('processed_at'),
  },
  (table) => [
    index('idx_webhook_comment').on(table.instagramCommentId),
    index('idx_webhook_received').on(table.receivedAt),
  ],
);

export const automationRuns = sqliteTable(
  'automation_runs',
  {
    id: text('id').primaryKey(),
    automationId: text('automation_id')
      .notNull()
      .references(() => automations.id),
    webhookEventId: text('webhook_event_id').references(() => webhookEvents.id),
    instagramCommentId: text('instagram_comment_id').notNull(),
    instagramMediaId: text('instagram_media_id').notNull(),
    commenterId: text('commenter_id'),
    commenterUsername: text('commenter_username'),
    originalCommentText: text('original_comment_text'),
    normalizedCommentText: text('normalized_comment_text'),
    matchedKeyword: text('matched_keyword'),
    status: text('status').notNull(),
    publicReplyMessage: text('public_reply_message'),
    publicReplyStatus: text('public_reply_status'),
    privateReplyStatus: text('private_reply_status'),
    retryCount: integer('retry_count').notNull().default(0),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    createdAt: text('created_at').notNull().$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().$defaultFn(nowIso),
  },
  (table) => [
    uniqueIndex('automation_runs_automation_id_instagram_comment_id_unique').on(
      table.automationId,
      table.instagramCommentId,
    ),
    index('idx_runs_status').on(table.status),
    index('idx_runs_created').on(table.createdAt),
    index('idx_runs_media').on(table.instagramMediaId),
  ],
);

export const apiAttempts = sqliteTable(
  'api_attempts',
  {
    id: text('id').primaryKey(),
    automationRunId: text('automation_run_id')
      .notNull()
      .references(() => automationRuns.id),
    actionType: text('action_type').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    httpStatus: integer('http_status'),
    metaErrorCode: text('meta_error_code'),
    metaErrorSubcode: text('meta_error_subcode'),
    metaErrorMessage: text('meta_error_message'),
    metaTraceId: text('meta_trace_id'),
    requestPayloadRedacted: text('request_payload_redacted'),
    responsePayloadRedacted: text('response_payload_redacted'),
    startedAt: text('started_at').notNull().$defaultFn(nowIso),
    completedAt: text('completed_at'),
  },
  (table) => [index('idx_attempts_run').on(table.automationRunId)],
);

export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  adminUserId: text('admin_user_id'),
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  metadata: text('metadata'),
  ipAddress: text('ip_address'),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
});

// 非 spec.md 原始 11 表之一，見檔案頂端說明。
export const loginRateLimits = sqliteTable(
  'login_rate_limits',
  {
    id: text('id').primaryKey(),
    ipAddress: text('ip_address').notNull(),
    windowStart: text('window_start').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    createdAt: text('created_at').notNull().$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().$defaultFn(nowIso),
  },
  (table) => [index('idx_login_rate_limits_ip').on(table.ipAddress)],
);
