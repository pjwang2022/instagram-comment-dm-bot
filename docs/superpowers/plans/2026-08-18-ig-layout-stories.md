# IG 風格單頁後台 ＋ 限時動態自動化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 後台合併為單一 IG 個人頁式版面，並支援「限時動態收到含關鍵字的回應即自動私訊」（逐則限動設定）。

**Architecture:** 限動重用 `instagram_media`（`media_type = 'STORY'`，零 migration）；限動回應走 Meta `messages` webhook（只接受 `reply_to.story` 事件），沿用既有冪等／Queue／send-gate／runs 基礎設施，引擎加一條 story 專用路徑（跳過公開回覆、DM recipient 改用回應者 IGSID）。前端把 Dashboard＋Media 合併成 HomePage（頁首＋限動列＋九宮格）。

**Tech Stack:** Cloudflare Workers（Hono）、D1/Drizzle、Queues、React 19 + react-router 8、Vitest（better-sqlite3 shim）。

**設計文件：** `docs/superpowers/specs/2026-08-18-ig-layout-stories-design.md`

## Global Constraints

- 所有註解與 UI 文案用繁體中文；程式識別字用英文。
- 機密永不進版控、不進 log、不傳前端（CLAUDE.md）。
- 測試指令：`npm run test`（vitest run）；型別：`npm run typecheck`；建置：`npm run build`。
- 測試用 in-memory better-sqlite3 + `tests/helpers/d1-shim`（`applyMigrations`）。
- 工作區已有未提交的 deleted_at 變更——每個 task 只 `git add` 自己動到的檔案，不可 `git add -A`。
- 限動不套用 `next_post` 綁定與 `account_default` fallback（那是留言語意）。
- 限動自動化沒有公開回覆（限動無留言串）。

---

### Task 1: Story webhook 事件解析

**Files:**
- Modify: `src/webhook/event-parser.ts`
- Test: `tests/unit/event-parser.test.ts`

**Interfaces:**
- Produces: `interface StoryReplyEvent { instagramAccountId: string; storyId: string; messageId: string; senderId: string; text: string; eventType: string; eventTimestamp: string }`、`extractStoryReplyEvents(payload: any): StoryReplyEvent[]`、`findStoryReplyEvent(payload: any, messageId: string): StoryReplyEvent | null`（Task 2、5 使用）。

- [ ] **Step 1: 寫失敗測試**（附加到 `tests/unit/event-parser.test.ts` 末尾；檔頭 import 改為 `import { deriveEventKey, extractStoryReplyEvents, findStoryReplyEvent } from '../../src/webhook/event-parser';`）

```ts
// 限動回應 webhook 範例：messages 欄位、messaging 陣列、reply_to.story。
function storyPayload(overrides: Record<string, unknown> = {}) {
  return {
    object: 'instagram',
    entry: [
      {
        id: 'acct-1',
        time: 1700000000,
        messaging: [
          {
            sender: { id: 'user-9' },
            recipient: { id: 'acct-1' },
            timestamp: 1700000001234,
            message: {
              mid: 'mid.abc',
              text: '關鍵字',
              reply_to: { story: { id: 'story-1', url: 'https://cdn.example/story.jpg' } },
              ...overrides,
            },
          },
        ],
      },
    ],
  };
}

describe('extractStoryReplyEvents', () => {
  it('extracts a story reply with account/story/mid/sender/text', () => {
    const events = extractStoryReplyEvents(storyPayload());
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      instagramAccountId: 'acct-1',
      storyId: 'story-1',
      messageId: 'mid.abc',
      senderId: 'user-9',
      text: '關鍵字',
      eventType: 'story_reply',
      eventTimestamp: '1700000001234',
    });
  });

  it('ignores plain DMs without reply_to.story', () => {
    const payload = storyPayload();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (payload.entry[0].messaging[0].message as any).reply_to;
    expect(extractStoryReplyEvents(payload)).toHaveLength(0);
  });

  it('ignores echo messages (our own outgoing DMs)', () => {
    expect(extractStoryReplyEvents(storyPayload({ is_echo: true }))).toHaveLength(0);
  });

  it('ignores comment-style payloads entirely', () => {
    const payload = {
      object: 'instagram',
      entry: [{ id: 'a', time: 1, changes: [{ field: 'comments', value: { id: 'c1' } }] }],
    };
    expect(extractStoryReplyEvents(payload)).toHaveLength(0);
  });
});

describe('findStoryReplyEvent', () => {
  it('finds by message id and returns null when absent', () => {
    const payload = storyPayload();
    expect(findStoryReplyEvent(payload, 'mid.abc')?.storyId).toBe('story-1');
    expect(findStoryReplyEvent(payload, 'mid.nope')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/unit/event-parser.test.ts`
Expected: FAIL（`extractStoryReplyEvents` 未匯出）

- [ ] **Step 3: 實作**（附加到 `src/webhook/event-parser.ts` 末尾）

```ts
// 從 Instagram messaging webhook 抽出「限時動態回應」事件。
// 結構：{ object, entry: [{ id:<account>, time, messaging: [{ sender:{id}, recipient:{id},
//   timestamp, message: { mid, text, is_echo?, reply_to?: { story: { id, url } } } }] }] }
// 只接受帶 reply_to.story 的訊息；一般 DM 與 echo（自己發出的訊息）一律忽略。
export interface StoryReplyEvent {
  instagramAccountId: string;
  storyId: string;
  messageId: string;
  senderId: string;
  text: string;
  eventType: string;
  eventTimestamp: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractStoryReplyEvents(payload: any): StoryReplyEvent[] {
  const out: StoryReplyEvent[] = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const accountId = entry?.id != null ? String(entry.id) : '';
    const time = entry?.time != null ? String(entry.time) : '';
    const messagings = Array.isArray(entry?.messaging) ? entry.messaging : [];
    for (const m of messagings) {
      const msg = m?.message;
      const storyId = msg?.reply_to?.story?.id;
      if (!storyId) continue;
      if (msg?.is_echo) continue;
      out.push({
        instagramAccountId: accountId,
        storyId: String(storyId),
        messageId: msg?.mid != null ? String(msg.mid) : '',
        senderId: m?.sender?.id != null ? String(m.sender.id) : '',
        text: typeof msg?.text === 'string' ? msg.text : '',
        eventType: 'story_reply',
        eventTimestamp: m?.timestamp != null ? String(m.timestamp) : time,
      });
    }
  }
  return out;
}

// 從 payload 中找出特定 mid 的限動回應（Consumer 用）。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function findStoryReplyEvent(payload: any, messageId: string): StoryReplyEvent | null {
  return extractStoryReplyEvents(payload).find((e) => e.messageId === messageId) ?? null;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/unit/event-parser.test.ts`
Expected: PASS（全部）

- [ ] **Step 5: Commit**

```bash
git add src/webhook/event-parser.ts tests/unit/event-parser.test.ts
git commit -m "feat: 解析限時動態回應 webhook 事件（reply_to.story）"
```

---

### Task 2: Webhook 接收限動回應並入列

**Files:**
- Modify: `src/queue/producer.ts`
- Modify: `src/webhook/receive-webhook.ts`
- Test: `tests/integration/webhook-receive.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `extractStoryReplyEvents`。
- Produces: `CommentEventMessage` 增加選填 `eventType?: 'comments' | 'story_reply'`（Task 5 的 consumer 分流依據；舊訊息無此欄位＝留言）。story 事件存入 `webhook_events` 時 `event_type='story_reply'`、`instagram_media_id`←story id、`instagram_comment_id`←mid、event key＝mid。

- [ ] **Step 1: 寫失敗測試**（附加到 `tests/integration/webhook-receive.test.ts`，沿用檔內既有 `sign`／`post`／`env` helpers）

```ts
function storyReplyBody(mid: string, storyId = 'story-1') {
  return JSON.stringify({
    object: 'instagram',
    entry: [
      {
        id: 'acct-1',
        time: 1700000000,
        messaging: [
          {
            sender: { id: 'user-9' },
            recipient: { id: 'acct-1' },
            timestamp: 1700000001234,
            message: { mid, text: '關鍵字', reply_to: { story: { id: storyId } } },
          },
        ],
      },
    ],
  });
}

describe('POST /api/webhooks/meta/instagram — story replies', () => {
  it('stores a story_reply event keyed by mid and enqueues with eventType', async () => {
    const body = storyReplyBody('mid.abc');
    const res = await post(body, await sign(body));
    expect(res.status).toBe(200);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      instagramAccountId: 'acct-1',
      instagramMediaId: 'story-1',
      instagramCommentId: 'mid.abc',
      eventType: 'story_reply',
    });
    const rows = await drizzle(sqlite, { schema }).select().from(webhookEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('story_reply');
    expect(rows[0].eventKey).toBe('mid.abc');
  });

  it('is idempotent on story redelivery (duplicate_count++, no re-enqueue)', async () => {
    const body = storyReplyBody('mid.abc');
    await post(body, await sign(body));
    await post(body, await sign(body));
    expect(enqueued).toHaveLength(1);
    const rows = await drizzle(sqlite, { schema }).select().from(webhookEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0].duplicateCount).toBe(1);
  });

  it('ignores plain DMs (no reply_to.story): 200, nothing stored', async () => {
    const body = JSON.stringify({
      object: 'instagram',
      entry: [
        {
          id: 'acct-1',
          time: 1700000000,
          messaging: [
            { sender: { id: 'user-9' }, recipient: { id: 'acct-1' }, timestamp: 1, message: { mid: 'mid.x', text: '哈囉' } },
          ],
        },
      ],
    });
    const res = await post(body, await sign(body));
    expect(res.status).toBe(200);
    expect(enqueued).toHaveLength(0);
    expect(await drizzle(sqlite, { schema }).select().from(webhookEvents)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/integration/webhook-receive.test.ts`
Expected: 新增三例 FAIL（enqueued 為空／無 eventType）

- [ ] **Step 3: 實作 producer 型別**（`src/queue/producer.ts` 的 interface 改為）

```ts
export interface CommentEventMessage {
  webhookEventId: string;
  eventKey: string;
  instagramAccountId: string;
  instagramMediaId: string;
  instagramCommentId: string;
  // 'story_reply'＝限時動態回應（mid 存於 instagramCommentId、story id 存於 instagramMediaId）。
  // 省略或 'comments'＝留言事件（向後相容既有佇列中的訊息）。
  eventType?: 'comments' | 'story_reply';
}
```

- [ ] **Step 4: 實作 receive-webhook**：把 `handleWebhookReceive` 中 `const events = extractCommentEvents(payload);` 起到迴圈結束的段落改成統一事件清單（冪等寫入與入列邏輯不變，只是來源多了 story）：

```ts
  // 留言與限動回應統一成一份清單：eventKey 來源不同（留言＝欄位雜湊、限動＝mid 穩定 ID），
  // 其餘冪等寫入與入列流程完全共用。
  const commentEvents = extractCommentEvents(payload)
    // 缺 Comment ID／Media ID 的事件不處理（spec §8.3 排除條件之一）。
    .filter((ev) => ev.instagramCommentId && ev.instagramMediaId);
  const storyEvents = extractStoryReplyEvents(payload).filter((ev) => ev.messageId && ev.storyId);

  const unified: Array<{
    eventKey: string;
    eventType: 'comments' | 'story_reply';
    instagramAccountId: string;
    instagramMediaId: string;
    instagramCommentId: string;
  }> = [];
  for (const ev of commentEvents) {
    unified.push({
      eventKey: await deriveEventKey({
        instagramAccountId: ev.instagramAccountId,
        instagramMediaId: ev.instagramMediaId,
        instagramCommentId: ev.instagramCommentId,
        eventType: ev.eventType,
        eventTimestamp: ev.eventTimestamp,
      }),
      eventType: 'comments',
      instagramAccountId: ev.instagramAccountId,
      instagramMediaId: ev.instagramMediaId,
      instagramCommentId: ev.instagramCommentId,
    });
  }
  for (const ev of storyEvents) {
    unified.push({
      // mid 是 Meta 的穩定訊息 ID，直接當事件鍵。
      eventKey: await deriveEventKey({ stableEventId: ev.messageId }),
      eventType: 'story_reply',
      instagramAccountId: ev.instagramAccountId,
      instagramMediaId: ev.storyId,
      instagramCommentId: ev.messageId,
    });
  }

  const db = createDb(c.env.DB);
  for (const ev of unified) {
    const existing = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.eventKey, ev.eventKey))
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
      eventKey: ev.eventKey,
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
      eventKey: ev.eventKey,
      instagramAccountId: ev.instagramAccountId,
      instagramMediaId: ev.instagramMediaId,
      instagramCommentId: ev.instagramCommentId,
      eventType: ev.eventType,
    });
  }
```

檔頭 import 改為 `import { deriveEventKey, extractCommentEvents, extractStoryReplyEvents } from './event-parser';`，並把原本 `const db = createDb(c.env.DB);`（在舊迴圈前）移除以免重複宣告。

- [ ] **Step 5: 跑測試確認通過（含既有留言測試不回歸）**

Run: `npx vitest run tests/integration/webhook-receive.test.ts`
Expected: PASS（全部，含既有案例）

- [ ] **Step 6: Commit**

```bash
git add src/queue/producer.ts src/webhook/receive-webhook.ts tests/integration/webhook-receive.test.ts
git commit -m "feat: webhook 接收限動回應事件並以 mid 冪等入列"
```

---

### Task 3: 限動同步、過期標記與範圍排除

**Files:**
- Modify: `src/meta/media.ts`
- Modify: `src/automation/apply-scope.ts`
- Test: `tests/unit/story-sync.test.ts`（新檔）

**Interfaces:**
- Produces: `fetchActiveStories(client, instagramAccountId)`（回傳形狀同 `fetchRecentMedia`）、`syncStories(db, accountInternalId, items): Promise<{ inserted: number; updated: number; expired: number }>`；`SyncSummary` 增加 `expiredStories: number`。
- 硬規則：story 一律以 `mediaType: 'STORY'` 寫入（Meta `/stories` 回的 `media_type` 是 IMAGE/VIDEO，不能直接沿用）；`markDeletedMedia` 與 `bindNextPostAutomation` 都必須排除 STORY。

- [ ] **Step 1: 寫失敗測試**（新檔 `tests/unit/story-sync.test.ts`）

```ts
import { join } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';
import { syncStories } from '../../src/meta/media';
import { bindNextPostAutomation } from '../../src/automation/apply-scope';
import { applyMigrations } from '../helpers/d1-shim';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

beforeEach(async () => {
  const sqlite = new Database(':memory:');
  applyMigrations(sqlite, join(__dirname, '../../drizzle/migrations'));
  db = drizzle(sqlite, { schema });
  await db.insert(schema.instagramAccounts).values({ id: 'acct', instagramAccountId: 'ig-acct' });
});

describe('syncStories', () => {
  it('upserts stories with mediaType forced to STORY', async () => {
    const r = await syncStories(db, 'acct', [
      { id: 's1', media_type: 'IMAGE', media_url: 'https://cdn/s1.jpg', timestamp: '2026-08-18T01:00:00+0000' },
    ]);
    expect(r).toMatchObject({ inserted: 1, updated: 0, expired: 0 });
    const rows = await db.select().from(schema.instagramMedia);
    expect(rows).toHaveLength(1);
    expect(rows[0].mediaType).toBe('STORY');
    expect(rows[0].thumbnailUrl).toBe('https://cdn/s1.jpg');
  });

  it('marks stories missing from the active list as expired and pauses their automations', async () => {
    await syncStories(db, 'acct', [{ id: 's1', media_url: 'https://cdn/s1.jpg' }]);
    const media = (await db.select().from(schema.instagramMedia))[0];
    await db.insert(schema.automations).values({
      id: 'auto-s1',
      instagramMediaId: media.id,
      name: '限動',
      status: 'active',
    });

    const r = await syncStories(db, 'acct', []);
    expect(r.expired).toBe(1);
    const after = (await db.select().from(schema.instagramMedia))[0];
    expect(after.deletedAt).not.toBeNull();
    const auto = (await db.select().from(schema.automations))[0];
    expect(auto.status).toBe('paused');
  });

  it('does not touch non-STORY media when expiring', async () => {
    await db.insert(schema.instagramMedia).values({
      id: 'post-1',
      instagramAccountId: 'acct',
      instagramMediaId: 'ig-post-1',
      mediaType: 'IMAGE',
    });
    const r = await syncStories(db, 'acct', []);
    expect(r.expired).toBe(0);
    expect((await db.select().from(schema.instagramMedia))[0].deletedAt).toBeNull();
  });
});

describe('bindNextPostAutomation — STORY 排除', () => {
  it('never binds a next_post automation to a story', async () => {
    await db.insert(schema.automations).values({
      id: 'pending',
      applyScope: 'next_post',
      name: '待命',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await db.insert(schema.instagramMedia).values({
      id: 'story-row',
      instagramAccountId: 'acct',
      instagramMediaId: 's1',
      mediaType: 'STORY',
      publishedAt: '2026-08-18T01:00:00.000Z',
    });
    const media = (await db.select().from(schema.instagramMedia))[0];
    const bound = await bindNextPostAutomation(db, media);
    expect(bound).toBeNull();
    const auto = (await db.select().from(schema.automations))[0];
    expect(auto.instagramMediaId).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/unit/story-sync.test.ts`
Expected: FAIL（`syncStories` 未匯出；STORY 綁定案例失敗）

- [ ] **Step 3: 實作 `src/meta/media.ts`**

3a. 新增（放在 `fetchRecentMedia` 之後）：

```ts
export interface RawStoryItem {
  id: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  timestamp?: string;
}

// 進行中的限時動態清單（GET /{ig-account-id}/stories）。此端點只回 24 小時內的限動，
// 是「是否仍存活」的權威來源（不像貼文清單只涵蓋近期第一頁）。
export async function fetchActiveStories(
  client: MetaClientType,
  instagramAccountId: string,
): Promise<{ ok: boolean; items: RawStoryItem[]; status: number; reason?: string; detail?: string }> {
  const fields = 'id,media_type,media_url,thumbnail_url,timestamp';
  const res = await client.get<{ data?: RawStoryItem[] }>(`${instagramAccountId}/stories`, { fields });
  if (!res.ok) {
    return {
      ok: false,
      items: [],
      status: res.status,
      reason: res.failure?.nonRetryableReason ?? (res.failure?.networkError ? 'network_error' : 'http_error'),
      detail: res.failure?.metaErrorMessage
        ? `(code ${res.failure?.metaErrorCode ?? '?'}) ${res.failure.metaErrorMessage}`
        : undefined,
    };
  }
  return { ok: true, items: res.data?.data ?? [], status: res.status };
}

// 限動 upsert＋過期標記。media_type 一律強制寫 'STORY'（Meta 回的是 IMAGE/VIDEO，
// 若照抄會與貼文混在一起）。不在 active 清單＝已過期 → 標 deleted_at 並暫停其自動化。
export async function syncStories(
  db: SchemaDb,
  accountInternalId: string,
  items: RawStoryItem[],
): Promise<{ inserted: number; updated: number; expired: number }> {
  let inserted = 0;
  let updated = 0;
  const now = new Date().toISOString();

  for (const item of items) {
    if (!item.id) continue;
    const existing = await db
      .select()
      .from(instagramMedia)
      .where(eq(instagramMedia.instagramMediaId, item.id))
      .limit(1);
    if (existing.length > 0) {
      await db
        .update(instagramMedia)
        .set({
          thumbnailUrl: item.thumbnail_url ?? item.media_url ?? existing[0].thumbnailUrl,
          lastSyncedAt: now,
          updatedAt: now,
          deletedAt: null,
        })
        .where(eq(instagramMedia.id, existing[0].id));
      updated += 1;
    } else {
      await db.insert(instagramMedia).values({
        id: crypto.randomUUID(),
        instagramAccountId: accountInternalId,
        instagramMediaId: item.id,
        mediaType: 'STORY',
        thumbnailUrl: item.thumbnail_url ?? item.media_url ?? null,
        publishedAt: item.timestamp ?? null,
        lastSyncedAt: now,
      });
      inserted += 1;
    }
  }

  const activeIds = new Set(items.map((i) => i.id).filter(Boolean));
  const candidates = await db
    .select()
    .from(instagramMedia)
    .where(
      and(
        eq(instagramMedia.instagramAccountId, accountInternalId),
        eq(instagramMedia.mediaType, 'STORY'),
        isNull(instagramMedia.deletedAt),
      ),
    );
  let expired = 0;
  for (const story of candidates) {
    if (activeIds.has(story.instagramMediaId)) continue;
    await db
      .update(instagramMedia)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(instagramMedia.id, story.id));
    await db
      .update(automations)
      .set({ status: 'paused', updatedAt: now })
      .where(and(eq(automations.instagramMediaId, story.id), eq(automations.status, 'active')));
    expired += 1;
  }
  return { inserted, updated, expired };
}
```

3b. `markDeletedMedia` 的 candidates 查詢加 STORY 排除（限動的存活由 `syncStories` 判斷，逐篇查證只適用貼文）。import 加 `ne`：

```ts
import { and, eq, isNull, ne } from 'drizzle-orm';
```

```ts
    .where(
      and(
        eq(instagramMedia.instagramAccountId, accountInternalId),
        isNull(instagramMedia.deletedAt),
        ne(instagramMedia.mediaType, 'STORY'),
      ),
    );
```

3c. `SyncSummary` 加 `expiredStories: number`；`runScheduledSync` 中 summary 初始值加 `expiredStories: 0`，且每帳號貼文同步後加：

```ts
    // 限時動態：抓進行中清單 → upsert ＋ 過期標記。抓取失敗不中斷貼文同步，但要讓使用者看到。
    const storiesRes = await fetchActiveStories(client, account.instagramAccountId);
    if (!storiesRes.ok) {
      summary.errors.push(
        `account ${account.instagramAccountId}: 抓取限時動態失敗 (HTTP ${storiesRes.status}, ${storiesRes.reason})${storiesRes.detail ? `｜Meta：${storiesRes.detail}` : ''}`,
      );
    } else {
      const s = await syncStories(db, account.id, storiesRes.items);
      summary.inserted += s.inserted;
      summary.updated += s.updated;
      summary.expiredStories += s.expired;
    }
```

（`ensureAccountRegistered` 失敗的早退回傳值也要補 `expiredStories: 0`。）

- [ ] **Step 4: 實作 `src/automation/apply-scope.ts`**：`bindNextPostAutomation` 開頭加 guard：

```ts
  // 限時動態不參與 next_post 綁定——待命自動化的語意是「下一篇新貼文」。
  if (media.mediaType === 'STORY') return null;
```

- [ ] **Step 5: 跑測試確認通過（含既有 media-sync 測試不回歸）**

Run: `npx vitest run tests/unit/story-sync.test.ts tests/unit/media-sync.test.ts`
Expected: PASS（全部）

- [ ] **Step 6: Commit**

```bash
git add src/meta/media.ts src/automation/apply-scope.ts tests/unit/story-sync.test.ts
git commit -m "feat: 限動同步與過期標記，排除待命綁定與貼文刪除偵測"
```

---

### Task 4: Private Reply 支援 recipient IGSID

**Files:**
- Modify: `src/meta/private-replies.ts`
- Test: `tests/unit/private-replies.test.ts`（新檔）

**Interfaces:**
- Produces: `PrivateReplyInput` 改為 `{ instagramAccountId: string; commentId?: string; recipientId?: string; text: string; buttonText?; buttonUrl? }`——`recipientId`（回應者 IGSID）優先於 `commentId`。既有留言呼叫端不需改（仍傳 `commentId`）。

- [ ] **Step 1: 寫失敗測試**（新檔 `tests/unit/private-replies.test.ts`）

```ts
import { describe, expect, it, vi } from 'vitest';
import { MetaClient } from '../../src/meta/client';
import { sendPrivateReply } from '../../src/meta/private-replies';

function captureClient() {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message_id: 'm' }), { status: 200 }));
  const client = new MetaClient({
    accessToken: 't',
    graphApiVersion: 'v21.0',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { client, fetchImpl };
}

async function sentRecipient(fetchImpl: ReturnType<typeof vi.fn>): Promise<unknown> {
  const [, init] = fetchImpl.mock.calls[0] as [unknown, RequestInit];
  const params = new URLSearchParams(String(init.body));
  return JSON.parse(params.get('recipient')!);
}

describe('sendPrivateReply — recipient 形式', () => {
  it('uses comment_id for comment private replies', async () => {
    const { client, fetchImpl } = captureClient();
    await sendPrivateReply(client, { instagramAccountId: 'a', commentId: 'c1', text: 'hi' });
    expect(await sentRecipient(fetchImpl)).toEqual({ comment_id: 'c1' });
  });

  it('uses user id for story replies (recipientId wins)', async () => {
    const { client, fetchImpl } = captureClient();
    await sendPrivateReply(client, { instagramAccountId: 'a', recipientId: 'user-9', text: 'hi' });
    expect(await sentRecipient(fetchImpl)).toEqual({ id: 'user-9' });
  });
});
```

註：若 `MetaClient` 送 JSON body 而非 form encoding，`sentRecipient` 改成解析 `JSON.parse(String(init.body)).recipient`——先看 `src/meta/client.ts` 的 `post` 實作再定，斷言目標不變（recipient 物件形狀）。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/unit/private-replies.test.ts`
Expected: recipientId 案例 FAIL（型別／行為未支援）

- [ ] **Step 3: 實作**（`src/meta/private-replies.ts` 改 interface 與 recipient 組裝；檔頭註解補充限動情境）

```ts
// Private Reply DM（spec.md 第 10 節）。
// Graph API：POST /{ig-account-id}/messages。
// - 留言：recipient.comment_id 指定要私訊的留言。
// - 限動回應：回應已開啟 24 小時訊息窗，recipient.id 直接指定回應者 IGSID。
export interface PrivateReplyInput {
  instagramAccountId: string;
  commentId?: string;
  recipientId?: string;
  text: string;
  buttonText?: string | null;
  buttonUrl?: string | null;
}
```

```ts
  const recipient = JSON.stringify(
    input.recipientId ? { id: input.recipientId } : { comment_id: input.commentId },
  );
```

- [ ] **Step 4: 跑測試確認通過（含引擎既有測試不回歸）**

Run: `npx vitest run tests/unit/private-replies.test.ts tests/integration/engine.test.ts`
Expected: PASS（全部）

- [ ] **Step 5: Commit**

```bash
git add src/meta/private-replies.ts tests/unit/private-replies.test.ts
git commit -m "feat: private reply 支援以 IGSID 為收件者（限動回應用）"
```

---

### Task 5: 引擎限動路徑 ＋ Consumer 分流

**Files:**
- Modify: `src/automation/engine.ts`
- Modify: `src/queue/consumer.ts`
- Test: `tests/integration/engine-story.test.ts`（新檔）

**Interfaces:**
- Consumes: Task 1 `findStoryReplyEvent`、Task 2 `CommentEventMessage.eventType`、Task 4 `sendPrivateReply({ recipientId })`。
- Produces: `processStoryReplyEvent(deps: EngineDeps, message: CommentEventMessage): Promise<EngineOutcome>`（輸出型別與 `processCommentEvent` 相同）。

- [ ] **Step 1: 寫失敗測試**（新檔 `tests/integration/engine-story.test.ts`）

```ts
import { join } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../src/database/schema';
import { processStoryReplyEvent } from '../../src/automation/engine';
import { MetaClient } from '../../src/meta/client';
import { applyMigrations } from '../helpers/d1-shim';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

function storyPayload(mid: string, text: string, opts: { senderId?: string } = {}) {
  return {
    object: 'instagram',
    entry: [
      {
        id: 'ig-acct',
        time: 1700000000,
        messaging: [
          {
            sender: { id: opts.senderId ?? 'user-9' },
            recipient: { id: 'ig-acct' },
            timestamp: 1700000001234,
            message: { mid, text, reply_to: { story: { id: 'ig-story' } } },
          },
        ],
      },
    ],
  };
}

async function seedStoryEvent(mid: string, text: string, opts: { senderId?: string } = {}) {
  const id = 'evt-' + mid;
  await db.insert(schema.webhookEvents).values({
    id,
    eventKey: mid,
    eventType: 'story_reply',
    instagramAccountId: 'ig-acct',
    instagramMediaId: 'ig-story',
    instagramCommentId: mid,
    rawPayload: JSON.stringify(storyPayload(mid, text, opts)),
    signatureValid: 1,
  });
  return id;
}

async function seedStoryAutomation(overrides: Partial<typeof schema.automations.$inferInsert> = {}) {
  await db.insert(schema.instagramAccounts).values({ id: 'acct', instagramAccountId: 'ig-acct' });
  await db.insert(schema.instagramMedia).values({
    id: 'story',
    instagramAccountId: 'acct',
    instagramMediaId: 'ig-story',
    mediaType: 'STORY',
  });
  await db.insert(schema.automations).values({
    id: 'auto',
    instagramMediaId: 'story',
    name: '限動回覆',
    status: 'active',
    matchType: 'contains_any',
    publicReplyEnabled: 0,
    privateReplyEnabled: 1,
    openingDm: '這是你要的連結',
    ...overrides,
  });
  await db.insert(schema.automationKeywords).values({
    id: 'kw1',
    automationId: 'auto',
    keyword: '連結',
    normalizedKeyword: '連結',
  });
}

function okClient() {
  const fetchImpl = vi.fn(async () =>
    new Response(JSON.stringify({ recipient_id: 'user-9', message_id: 'm' }), { status: 200 }),
  ) as unknown as typeof fetch;
  return { client: new MetaClient({ accessToken: 't', graphApiVersion: 'v21.0', fetchImpl }), fetchImpl };
}

const msg = (mid: string, webhookEventId: string) => ({
  webhookEventId,
  eventKey: mid,
  instagramAccountId: 'ig-acct',
  instagramMediaId: 'ig-story',
  instagramCommentId: mid,
  eventType: 'story_reply' as const,
});

beforeEach(() => {
  const sqlite = new Database(':memory:');
  applyMigrations(sqlite, join(__dirname, '../../drizzle/migrations'));
  db = drizzle(sqlite, { schema });
});

describe('processStoryReplyEvent', () => {
  it('matches a keyword and sends exactly one DM, no public reply', async () => {
    await seedStoryAutomation();
    const evt = await seedStoryEvent('mid.1', '請給我連結');
    const { client, fetchImpl } = okClient();

    const outcome = await processStoryReplyEvent({ db, metaClient: client }, msg('mid.1', evt));
    expect(outcome.kind).toBe('completed');
    if (outcome.kind === 'completed') {
      expect(outcome.publicReplyStatus).toBe('skipped');
      expect(outcome.privateReplyStatus).toBe('success');
    }
    // 只有一次 Meta 呼叫（DM），沒有公開回覆。
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);

    const runs = await db.select().from(schema.automationRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0].instagramCommentId).toBe('mid.1');
  });

  it('is idempotent: reprocessing the same mid sends nothing more', async () => {
    await seedStoryAutomation();
    const evt = await seedStoryEvent('mid.1', '請給我連結');
    const { client, fetchImpl } = okClient();
    await processStoryReplyEvent({ db, metaClient: client }, msg('mid.1', evt));
    await processStoryReplyEvent({ db, metaClient: client }, msg('mid.1', evt));
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
    expect(await db.select().from(schema.automationRuns)).toHaveLength(1);
  });

  it('returns no_match when the reply does not contain a keyword', async () => {
    await seedStoryAutomation();
    const evt = await seedStoryEvent('mid.1', '早安');
    const { client } = okClient();
    const outcome = await processStoryReplyEvent({ db, metaClient: client }, msg('mid.1', evt));
    expect(outcome.kind).toBe('no_match');
    expect(await db.select().from(schema.automationRuns)).toHaveLength(0);
  });

  it('skips expired stories', async () => {
    await seedStoryAutomation();
    await db
      .update(schema.instagramMedia)
      .set({ deletedAt: '2026-08-18T00:00:00.000Z' })
      .where();
    const evt = await seedStoryEvent('mid.1', '請給我連結');
    const { client } = okClient();
    const outcome = await processStoryReplyEvent({ db, metaClient: client }, msg('mid.1', evt));
    expect(outcome).toEqual({ kind: 'skipped', reason: 'story_expired' });
  });

  it('does not fall back to account_default automations', async () => {
    await db.insert(schema.instagramAccounts).values({ id: 'acct', instagramAccountId: 'ig-acct' });
    await db.insert(schema.instagramMedia).values({
      id: 'story',
      instagramAccountId: 'acct',
      instagramMediaId: 'ig-story',
      mediaType: 'STORY',
    });
    await db.insert(schema.automations).values({
      id: 'default-auto',
      applyScope: 'account_default',
      name: '全帳號',
      status: 'active',
      matchType: 'all_comments',
      privateReplyEnabled: 1,
      openingDm: 'hi',
    });
    const evt = await seedStoryEvent('mid.1', '任何字');
    const { client } = okClient();
    const outcome = await processStoryReplyEvent({ db, metaClient: client }, msg('mid.1', evt));
    expect(outcome).toEqual({ kind: 'skipped', reason: 'no_active_automation' });
  });

  it('skips when emergency stop is on', async () => {
    await seedStoryAutomation();
    await db.insert(schema.systemSettings).values({ id: 's', emergencyStop: 1 });
    const evt = await seedStoryEvent('mid.1', '請給我連結');
    const { client } = okClient();
    const outcome = await processStoryReplyEvent({ db, metaClient: client }, msg('mid.1', evt));
    expect(outcome).toEqual({ kind: 'skipped', reason: 'emergency_stop' });
  });
});
```

（`skips expired stories` 案例中 `.where()` 不合法——改為 `.where(eq(schema.instagramMedia.id, 'story'))` 並在檔頭 `import { eq } from 'drizzle-orm';`。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/integration/engine-story.test.ts`
Expected: FAIL（`processStoryReplyEvent` 未匯出）

- [ ] **Step 3: 實作 `src/automation/engine.ts`**——檔頭 import 加 `findStoryReplyEvent`、`and`（drizzle-orm），並在檔尾新增：

```ts
// 限時動態回應處理鏈：與留言路徑共用冪等 run／send-gate／attempt 紀錄，差異在：
// - 只套用綁定該限動的專屬自動化（不走 next_post / account_default——那是留言語意）。
// - 沒有公開回覆（限動無留言串），public_reply_status 一律 skipped。
// - DM 的 recipient 用回應者 IGSID（回應已開啟 24 小時訊息窗）。
export async function processStoryReplyEvent(
  deps: EngineDeps,
  message: CommentEventMessage,
): Promise<EngineOutcome> {
  const { db, metaClient } = deps;

  // 1. Webhook event + 回應內容
  const eventRows = await db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.id, message.webhookEventId))
    .limit(1);
  if (eventRows.length === 0) return { kind: 'skipped', reason: 'webhook_event_not_found' };
  let payload: unknown;
  try {
    payload = JSON.parse(eventRows[0].rawPayload);
  } catch {
    return { kind: 'skipped', reason: 'payload_parse_error' };
  }
  const reply = findStoryReplyEvent(payload, message.instagramCommentId);
  if (!reply || !reply.messageId || !reply.storyId) {
    return { kind: 'skipped', reason: 'story_reply_not_in_payload' };
  }

  // 2. 緊急停止
  const settings = await db.select().from(systemSettings).limit(1);
  if (settings.length > 0 && settings[0].emergencyStop === 1) {
    return { kind: 'skipped', reason: 'emergency_stop' };
  }

  // 3. Story media——本地沒有時向 Meta 補抓（回應可能早於同步）。已過期不處理。
  let mediaRows = await db
    .select()
    .from(instagramMedia)
    .where(eq(instagramMedia.instagramMediaId, reply.storyId))
    .limit(1);
  if (mediaRows.length === 0) {
    const discovered = await discoverStory(db, metaClient, reply.storyId);
    if (!discovered) return { kind: 'skipped', reason: 'story_not_found' };
    mediaRows = [discovered];
  }
  const media = mediaRows[0];
  if (media.deletedAt) return { kind: 'skipped', reason: 'story_expired' };

  // 4. 帳號（停用 / 熔斷）
  const accountRows = await db
    .select()
    .from(instagramAccounts)
    .where(eq(instagramAccounts.id, media.instagramAccountId))
    .limit(1);
  if (accountRows.length === 0) return { kind: 'skipped', reason: 'account_not_found' };
  const account = accountRows[0];
  if (account.automationEnabled === 0) return { kind: 'skipped', reason: 'account_disabled' };
  if (account.circuitBreakerStatus !== 'closed') return { kind: 'skipped', reason: 'circuit_open' };

  // 5. 專屬 active 自動化（限動不 fallback）
  const autoRows = await db
    .select()
    .from(schema.automations)
    .where(
      and(eq(schema.automations.instagramMediaId, media.id), eq(schema.automations.status, 'active')),
    )
    .limit(1);
  const automation = autoRows[0];
  if (!automation) return { kind: 'skipped', reason: 'no_active_automation' };

  // 6. 排除：自己（帳號本人）發出的回應
  if (reply.senderId && reply.senderId === account.instagramAccountId) {
    return { kind: 'skipped', reason: 'own_message' };
  }

  // 7. 正規化 + 比對
  const normalized = normalizeCommentText(reply.text);
  const kwRows = await db
    .select()
    .from(automationKeywords)
    .where(eq(automationKeywords.automationId, automation.id));
  const match = matchKeywords(
    normalized,
    kwRows.map((k) => k.normalizedKeyword),
    automation.matchType as MatchType,
  );
  if (!match.matched) return { kind: 'no_match' };

  // 8. 冪等 run（mid 存在 instagram_comment_id 欄，unique (automation, mid) 保證各發一次）
  const { run } = await ensureAutomationRun(db, {
    automationId: automation.id,
    webhookEventId: message.webhookEventId,
    instagramCommentId: reply.messageId,
    instagramMediaId: media.instagramMediaId,
    commenterId: reply.senderId || null,
    commenterUsername: null,
    originalCommentText: reply.text,
    normalizedCommentText: normalized,
    matchedKeyword: match.matchedKeyword,
    status: 'matched',
  });

  let privateStatus = run.privateReplyStatus ?? 'pending';
  let retryable = false;
  const attemptNumber = run.retryCount + 1;

  // 9. DM（限動唯一的動作）
  if (privateStatus === 'pending') {
    if (automation.privateReplyEnabled === 0 || !automation.openingDm || !reply.senderId) {
      privateStatus = 'skipped';
    } else if (
      !(
        await acquireSendPermission(db, {
          actionType: 'private_reply',
          automationId: automation.id,
          automationDailyLimit: automation.dailyLimit,
        })
      ).allowed
    ) {
      privateStatus = 'skipped';
    } else {
      const res = await sendPrivateReply(metaClient, {
        instagramAccountId: reply.instagramAccountId,
        recipientId: reply.senderId,
        text: automation.openingDm,
        buttonText: automation.buttonText,
        buttonUrl: automation.buttonUrl,
      });
      await recordAttempt(db, run.id, account.id, 'private_reply', attemptNumber, res);
      if (res.ok) {
        privateStatus = 'success';
      } else if (res.failure && isRetryable(res.failure)) {
        retryable = true;
      } else if (
        res.failure &&
        res.failure.httpStatus === 400 &&
        !PERMANENT_REASONS.has(res.failure.nonRetryableReason ?? '')
      ) {
        // 與留言 DM 相同：非永久性的 400 走重試路徑（Meta 對極新事件偶發暫時性 400）。
        retryable = true;
      } else {
        privateStatus = 'failed';
      }
    }
  }

  // 10. 收尾
  if (retryable && privateStatus === 'pending') {
    const delay = nextRetryDelaySeconds(run.retryCount);
    await db
      .update(schema.automationRuns)
      .set({
        retryCount: run.retryCount + 1,
        publicReplyStatus: 'skipped',
        privateReplyStatus: privateStatus,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.automationRuns.id, run.id));
    return { kind: 'retry', delaySeconds: delay, runId: run.id, reason: 'retryable_meta_error' };
  }

  const finalPrivate = privateStatus === 'pending' ? 'failed' : privateStatus;
  const overall = finalPrivate === 'failed' ? 'completed_with_errors' : 'completed';
  await db
    .update(schema.automationRuns)
    .set({
      status: overall,
      publicReplyStatus: 'skipped',
      privateReplyStatus: finalPrivate,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.automationRuns.id, run.id));

  return { kind: 'completed', runId: run.id, publicReplyStatus: 'skipped', privateReplyStatus: finalPrivate };
}
```

並在 `discoverMedia` 之後加：

```ts
// 向 Meta 補抓單則限動並寫入 instagram_media（media_type 強制 STORY，理由見 meta/media.ts）。
async function discoverStory(
  db: SchemaDb,
  metaClient: MetaClient,
  storyId: string,
): Promise<typeof instagramMedia.$inferSelect | null> {
  const account = (await db.select().from(instagramAccounts).limit(1))[0];
  if (!account) return null;
  const res = await metaClient.get<{
    id?: string;
    media_url?: string;
    thumbnail_url?: string;
    timestamp?: string;
  }>(storyId, { fields: 'id,media_type,media_url,thumbnail_url,timestamp' });
  if (!res.ok || !res.data?.id) return null;
  await db
    .insert(instagramMedia)
    .values({
      id: crypto.randomUUID(),
      instagramAccountId: account.id,
      instagramMediaId: res.data.id,
      mediaType: 'STORY',
      thumbnailUrl: res.data.thumbnail_url ?? res.data.media_url ?? null,
      publishedAt: res.data.timestamp ?? null,
      lastSyncedAt: new Date().toISOString(),
    })
    .onConflictDoNothing();
  const rows = await db
    .select()
    .from(instagramMedia)
    .where(eq(instagramMedia.instagramMediaId, res.data.id))
    .limit(1);
  return rows[0] ?? null;
}
```

檔頭 drizzle import 改為 `import { and, desc, eq } from 'drizzle-orm';`。

- [ ] **Step 4: 實作 `src/queue/consumer.ts` 分流**（迴圈內改為）

```ts
  for (const msg of batch.messages) {
    try {
      const outcome =
        msg.body.eventType === 'story_reply'
          ? await processStoryReplyEvent(deps, msg.body)
          : await processCommentEvent(deps, msg.body);
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
```

import 改為 `import { processCommentEvent, processStoryReplyEvent, type EngineDeps } from '../automation/engine';`。

- [ ] **Step 5: 跑測試確認通過（含既有引擎測試不回歸）**

Run: `npx vitest run tests/integration/engine-story.test.ts tests/integration/engine.test.ts`
Expected: PASS（全部）

- [ ] **Step 6: Commit**

```bash
git add src/automation/engine.ts src/queue/consumer.ts tests/integration/engine-story.test.ts
git commit -m "feat: 引擎限動回應路徑——關鍵字比對後以 IGSID 私訊，跳過公開回覆"
```

---

### Task 6: 啟用檢核（STORY）與 Admin API 擴充

**Files:**
- Modify: `src/shared/validation.ts`
- Modify: `src/admin/automations.ts`
- Test: `tests/unit/validation.test.ts`、`tests/integration/automations.test.ts`

**Interfaces:**
- Produces: `ActivationCheckInput` 增加 `isStory?: boolean`；新錯誤碼 `private_reply_required_for_story`（前端 Task 9 要對映文案）。`GET /api/admin/automations/:id` 回傳增加 `media: { id, mediaType, caption, thumbnailUrl } | null`（Task 9 編輯器判斷限動模式用）。

- [ ] **Step 1: 寫失敗測試**（附加到 `tests/unit/validation.test.ts`；沿用該檔既有的 `validateActivation` 呼叫慣例——先開檔確認 helper 寫法，斷言如下）

```ts
describe('validateActivation — story automations', () => {
  const base = {
    automationExists: true,
    matchType: 'contains_any',
    keywordCount: 1,
    publicReplyEnabled: false,
    privateReplyEnabled: true,
    openingDm: '連結在這',
    buttonUrl: null,
    tokenHealthy: true,
    emergencyStop: false,
  };

  it('accepts a story automation with only private reply', () => {
    expect(validateActivation({ ...base, isStory: true })).toEqual([]);
  });

  it('requires private reply for story automations', () => {
    expect(
      validateActivation({ ...base, isStory: true, privateReplyEnabled: false }),
    ).toContain('private_reply_required_for_story');
  });

  it('still requires at least one reply for non-story automations', () => {
    expect(
      validateActivation({ ...base, privateReplyEnabled: false }),
    ).toContain('at_least_one_reply_required');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/unit/validation.test.ts`
Expected: story 案例 FAIL

- [ ] **Step 3: 實作 `src/shared/validation.ts`**——`ActivationCheckInput` 加 `isStory?: boolean;`，並把 `at_least_one_reply_required` 區塊改為：

```ts
  if (input.isStory) {
    // 限動自動化沒有公開回覆，私訊是唯一動作，必須啟用。
    if (!input.privateReplyEnabled) errors.push('private_reply_required_for_story');
  } else if (!input.publicReplyEnabled && !input.privateReplyEnabled) {
    errors.push('at_least_one_reply_required');
  }
```

- [ ] **Step 4: 實作 `src/admin/automations.ts`**

4a. `POST /:id/activate`：token 健康度區塊已查 media；重構為先取 media row 一次、同時供 isStory 與 token 檢查（把區塊改成）：

```ts
    let tokenHealthy = true;
    let boundMedia: typeof instagramMedia.$inferSelect | null = null;
    if (automation) {
      if (automation.instagramMediaId) {
        const media = await db
          .select()
          .from(instagramMedia)
          .where(eq(instagramMedia.id, automation.instagramMediaId))
          .limit(1);
        boundMedia = media[0] ?? null;
      }
      const acct = boundMedia
        ? await db
            .select()
            .from(instagramAccounts)
            .where(eq(instagramAccounts.id, boundMedia.instagramAccountId))
            .limit(1)
        : await db.select().from(instagramAccounts).limit(1);
      if (acct[0]) tokenHealthy = acct[0].circuitBreakerStatus === 'closed';
    }
```

`validateActivation` 呼叫加 `isStory: boundMedia?.mediaType === 'STORY',`。

4b. `GET /:id` 回傳加 media（在 variants 查詢後）：

```ts
    const mediaRow = rows[0].instagramMediaId
      ? (
          await db
            .select()
            .from(instagramMedia)
            .where(eq(instagramMedia.id, rows[0].instagramMediaId))
            .limit(1)
        )[0] ?? null
      : null;
    return c.json({
      automation: rows[0],
      media: mediaRow
        ? {
            id: mediaRow.id,
            mediaType: mediaRow.mediaType,
            caption: mediaRow.caption,
            thumbnailUrl: mediaRow.thumbnailUrl,
          }
        : null,
      keywords: keywords.map((k: { keyword: string }) => k.keyword),
      publicReplyVariants: variants.map((v: { message: string }) => v.message),
    });
```

- [ ] **Step 5: 補一條 activate 整合測試**：開 `tests/integration/automations.test.ts`，沿用該檔既有的 app／session／seed helpers，加一例——seed 一筆 `mediaType: 'STORY'` 的 media＋綁定的自動化（`publicReplyEnabled: 0, privateReplyEnabled: 1, openingDm: 'x'`，一個關鍵字），呼叫 `POST /api/admin/automations/:id/activate`，斷言 200／`ok: true` 且自動化 status 變 `active`。再加一例 `privateReplyEnabled: 0` 時回 422 且 `reasons` 含 `private_reply_required_for_story`。

- [ ] **Step 6: 跑測試確認通過**

Run: `npx vitest run tests/unit/validation.test.ts tests/integration/automations.test.ts`
Expected: PASS（全部）

- [ ] **Step 7: Commit**

```bash
git add src/shared/validation.ts src/admin/automations.ts tests/unit/validation.test.ts tests/integration/automations.test.ts
git commit -m "feat: 限動自動化啟用檢核與編輯器 media 資訊 API"
```

---

### Task 7: 系統狀態 API 回傳帳號資訊

**Files:**
- Modify: `src/admin/system.ts`
- Test: `tests/integration/system.test.ts`

**Interfaces:**
- Produces: `GET /api/admin/system/status` 回傳增加 `account: { username: string | null; profilePictureUrl: string | null } | null`（Task 8 頁首用）。

- [ ] **Step 1: 寫失敗測試**：開 `tests/integration/system.test.ts`，沿用該檔既有 app／登入 helpers，在 status 測試（或新增一例）中 seed `instagramAccounts`（`username: 'octave'`, `profilePictureUrl: 'https://cdn/p.jpg'`）後斷言：

```ts
    expect(body.account).toEqual({ username: 'octave', profilePictureUrl: 'https://cdn/p.jpg' });
```

無帳號時斷言 `body.account` 為 `null`。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/integration/system.test.ts`
Expected: 新斷言 FAIL

- [ ] **Step 3: 實作**：`app.get('/status', ...)` 的 `return c.json({...})` 加：

```ts
      account: accounts[0]
        ? { username: accounts[0].username, profilePictureUrl: accounts[0].profilePictureUrl }
        : null,
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/integration/system.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/admin/system.ts tests/integration/system.test.ts
git commit -m "feat: 系統狀態 API 回傳帳號名稱與頭像"
```

---

### Task 8: 前端——合併為 IG 風格首頁

**Files:**
- Create: `admin/src/pages/HomePage.tsx`
- Delete: `admin/src/pages/DashboardPage.tsx`、`admin/src/pages/MediaPage.tsx`
- Modify: `admin/src/main.tsx`、`admin/src/components/AppHeader.tsx`、`admin/src/styles/app.css`

**Interfaces:**
- Consumes: Task 7 `status.account`；既有 `/api/admin/media?limit=100`（含 STORY 列）、`/api/admin/automations/overview`（stats）。
- Produces: 路由 `/` ＝ HomePage；`/media` 轉址 `/`；進編輯器的連結——貼文 `/media/:id/automation?automationId=…`、限動同路由再加 `&story=1`。

前端無自動化測試（現況），驗證方式為 typecheck ＋ build ＋ `npm run dev` 手動確認。

- [ ] **Step 1: 建 `admin/src/pages/HomePage.tsx`**（完整內容）

```tsx
// 首頁：IG 個人頁式版面——頁首（帳號＋今日統計＋系統控制）、限動圓圈列、貼文九宮格。
// 取代原本的儀表板與貼文兩頁。
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { AppHeader } from '../components/AppHeader';
import { apiGet, apiPost, type ApiError } from '../api/client';

interface Status {
  emergencyStop: boolean;
  circuitBreakerStatus: string;
  account: { username: string | null; profilePictureUrl: string | null } | null;
  today: { matched: number; publicReplySuccess: number; dmSuccess: number; failures: number };
}
interface Media {
  id: string;
  mediaType: string;
  caption: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  automationStatus: string;
  automationId: string | null;
}
interface AutoStats {
  triggered: number;
  publicReplySuccess: number;
  dmSuccess: number;
  failures: number;
}
interface OverviewAutomation {
  automationId: string;
  name: string;
  status: string;
  applyScope: string;
  media: { id: string } | null;
  stats: AutoStats;
}

function typeLabel(t: string): string {
  if (t === 'VIDEO') return '影片';
  if (t === 'REELS') return 'Reels';
  if (t === 'CAROUSEL_ALBUM') return '多圖';
  if (t === 'STORY') return '限動';
  return '圖片';
}

// 影片/Reels 用播放三角，多圖用堆疊方塊，圖片不標。
function TypeIcon({ type }: { type: string }) {
  if (type === 'VIDEO' || type === 'REELS') {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M8 5v14l11-7z" />
      </svg>
    );
  }
  if (type === 'CAROUSEL_ALBUM') {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M4 16V6a2 2 0 0 1 2-2h10" />
      </svg>
    );
  }
  return null;
}

function StatusTag({ status }: { status: string }) {
  if (status === 'paused') return <span className="badge badge-warning">已暫停</span>;
  if (status === 'draft') return <span className="badge badge-neutral">草稿</span>;
  return null;
}

function Thumb({ url, type }: { url: string | null; type: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="media-thumb">
      {url && !failed ? (
        <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <div className="media-thumb-fallback">{typeLabel(type)}</div>
      )}
      {(type === 'VIDEO' || type === 'REELS' || type === 'CAROUSEL_ALBUM') && (
        <span className="media-type-tag">
          <TypeIcon type={type} />
          {typeLabel(type)}
        </span>
      )}
    </div>
  );
}

function StoryCircle({ story, active, onClick }: { story: Media; active: boolean; onClick: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      className={`story-circle${active ? ' is-active' : ''}`}
      onClick={onClick}
      title={active ? '自動化啟用中——點擊編輯' : '點擊設定自動化'}
    >
      <span className="story-ring">
        {story.thumbnailUrl && !failed ? (
          <img src={story.thumbnailUrl} alt="" onError={() => setFailed(true)} />
        ) : (
          <span className="story-fallback">限動</span>
        )}
      </span>
      <span className="story-label">{active ? '⚡ 啟用中' : '設定'}</span>
    </button>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status | null>(null);
  const [media, setMedia] = useState<Media[]>([]);
  const [overview, setOverview] = useState<OverviewAutomation[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [syncErrors, setSyncErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const [s, m, o] = await Promise.all([
        apiGet<Status>('/api/admin/system/status'),
        apiGet<{ media: Media[] }>('/api/admin/media?limit=100'),
        apiGet<{ automations: OverviewAutomation[] }>('/api/admin/automations/overview'),
      ]);
      setStatus(s);
      setMedia(m.media);
      setOverview(o.automations);
    } catch (e) {
      if ((e as ApiError).status === 401) navigate('/login');
      else setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function sync() {
    setSyncing(true);
    setError(null);
    setSyncNotice(null);
    setSyncErrors([]);
    try {
      const summary = await apiPost<{
        accounts: number;
        inserted: number;
        updated: number;
        deleted: number;
        expiredStories: number;
        errors: string[];
      }>('/api/admin/media/sync', {});
      setSyncNotice(
        `同步完成：新增 ${summary.inserted}｜更新 ${summary.updated}｜已刪除貼文 ${summary.deleted ?? 0}｜過期限動 ${summary.expiredStories ?? 0}`,
      );
      // 同步的部分失敗（例如 token 無效）不會中斷整體流程，但必須讓使用者看到。
      setSyncErrors(summary.errors ?? []);
      await load();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSyncing(false);
    }
  }

  async function toggleEmergency() {
    if (!status) return;
    await apiPost(status.emergencyStop ? '/api/admin/system/resume' : '/api/admin/system/emergency-stop', {});
    void load();
  }

  async function resetCircuitBreaker() {
    await apiPost('/api/admin/system/circuit-breaker/reset', {});
    void load();
  }

  // 限動與貼文分流；成效數據以 media id 對 overview join。
  const stories = media.filter((m) => m.mediaType === 'STORY');
  const posts = media.filter((m) => m.mediaType !== 'STORY');
  const statsByMediaId = new Map(
    overview.filter((a) => a.media).map((a) => [a.media!.id, a.stats]),
  );
  const pendingAutomations = overview.filter((a) => a.applyScope !== 'media');

  function openEditor(m: Media) {
    const params = new URLSearchParams();
    if (m.automationId) params.set('automationId', m.automationId);
    if (m.mediaType === 'STORY') params.set('story', '1');
    const q = params.toString();
    navigate(`/media/${m.id}/automation${q ? `?${q}` : ''}`);
  }

  return (
    <>
      <AppHeader />
      <div className="container">
        {error ? <div className="alert alert-danger" style={{ marginBottom: 'var(--space-4)' }}>{error}</div> : null}
        {syncNotice ? (
          <div className="alert alert-success" style={{ marginBottom: 'var(--space-2)' }}>{syncNotice}</div>
        ) : null}
        {syncErrors.map((e, i) => (
          <div key={i} className="alert alert-danger" style={{ marginBottom: 'var(--space-2)' }}>
            {e}
          </div>
        ))}

        {/* IG 個人頁式頁首 */}
        {status ? (
          <div className="profile-header">
            <div className="profile-avatar">
              {status.account?.profilePictureUrl ? (
                <img src={status.account.profilePictureUrl} alt="" />
              ) : (
                <span className="profile-avatar-fallback">IG</span>
              )}
            </div>
            <div className="profile-main">
              <div className="profile-name-row">
                <span className="profile-username">
                  {status.account?.username ? `@${status.account.username}` : '（尚未同步帳號）'}
                </span>
                <span className={`badge ${status.emergencyStop ? 'badge-danger' : 'badge-success'}`}>
                  {status.emergencyStop ? '緊急停止中' : '運作中'}
                </span>
              </div>
              <div className="profile-stats">
                <span>今日符合 <strong>{status.today.matched}</strong></span>
                <span>公開回覆 <strong>{status.today.publicReplySuccess}</strong></span>
                <span>DM <strong>{status.today.dmSuccess}</strong></span>
                <span className={status.today.failures > 0 ? 'is-danger' : ''}>
                  失敗 <strong>{status.today.failures}</strong>
                </span>
              </div>
            </div>
            <div className="profile-actions">
              <button className="btn btn-ghost btn-sm" onClick={sync} disabled={syncing}>
                {syncing ? '同步中…' : '↻ 同步'}
              </button>
              <button
                className={`btn btn-sm ${status.emergencyStop ? 'btn-primary' : 'btn-danger'}`}
                onClick={toggleEmergency}
              >
                {status.emergencyStop ? '恢復系統' : '緊急停止'}
              </button>
            </div>
          </div>
        ) : null}

        {status && status.circuitBreakerStatus !== 'closed' ? (
          <div className="alert alert-danger" style={{ marginBottom: 'var(--space-4)' }}>
            熔斷器已開啟——已暫停所有發送。
            <button className="btn btn-sm btn-primary" style={{ marginLeft: 'var(--space-3)' }} onClick={resetCircuitBreaker}>
              熔斷復歸
            </button>
          </div>
        ) : null}

        {/* 待命／全帳號預設 */}
        <div className="pending-row">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/automations/new?scope=next_post')}>
            ＋ 待命自動化
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/automations/new?scope=account_default')}>
            ＋ 全帳號預設
          </button>
          {pendingAutomations.map((a) => (
            <button
              key={a.automationId}
              type="button"
              className="chip chip-clickable"
              onClick={() => navigate(`/automations/new?scope=${a.applyScope}&automationId=${a.automationId}`)}
            >
              {a.applyScope === 'next_post' ? '待綁定' : '全帳號'}｜{a.name}
              {a.status === 'active' ? ' ⚡' : a.status === 'paused' ? '（暫停）' : '（草稿）'}
            </button>
          ))}
        </div>

        {/* 限動圓圈列 */}
        <div className="story-row">
          {stories.length === 0 ? (
            <span className="state-note">目前沒有進行中的限時動態（按「↻ 同步」抓取）。</span>
          ) : (
            stories.map((s) => (
              <StoryCircle
                key={s.id}
                story={s}
                active={s.automationStatus === 'active'}
                onClick={() => openEditor(s)}
              />
            ))
          )}
        </div>

        {/* 貼文九宮格 */}
        {loading ? (
          <div className="state-note">載入中…</div>
        ) : posts.length === 0 ? (
          <div className="card">
            <div className="state-note">尚無貼文。按上方「↻ 同步」從 Instagram 抓取。</div>
          </div>
        ) : (
          <div className="media-grid" style={{ marginTop: 'var(--space-4)' }}>
            {posts.map((m) => {
              const stats = statsByMediaId.get(m.id);
              return (
                <div className="media-card" key={m.id}>
                  <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => openEditor(m)}>
                    <Thumb url={m.thumbnailUrl} type={m.mediaType} />
                    {m.automationStatus === 'active' ? (
                      <span className="media-flash" title="自動化啟用中">⚡</span>
                    ) : m.automationStatus !== 'none' ? (
                      <span className="media-status-tag">
                        <StatusTag status={m.automationStatus} />
                      </span>
                    ) : null}
                  </div>
                  <div className="media-card-body">
                    <div className={`media-caption${m.caption ? '' : ' is-empty'}`}>
                      {m.caption ?? '（無說明文字）'}
                    </div>
                    {stats ? (
                      <div className="media-stats-line">
                        觸發 {stats.triggered} · DM {stats.dmSuccess}
                        {stats.failures > 0 ? <span className="is-danger"> · 失敗 {stats.failures}</span> : null}
                      </div>
                    ) : null}
                    <div className="media-card-footer">
                      {m.permalink ? (
                        <a className="media-permalink" href={m.permalink} target="_blank" rel="noreferrer">
                          在 IG 開啟 ↗
                        </a>
                      ) : (
                        <span />
                      )}
                      <button
                        className={`btn btn-sm ${m.automationId ? 'btn-ghost' : 'btn-primary'}`}
                        onClick={() => openEditor(m)}
                      >
                        {m.automationId ? '編輯自動化' : '設定自動化'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 2: 更新 `admin/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { AutomationEditorPage } from './pages/AutomationEditorPage';
import { AccountPage } from './pages/AccountPage';
import './styles/tokens.css';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/admin">
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<HomePage />} />
        {/* 舊書籤相容：貼文頁已併入首頁 */}
        <Route path="/media" element={<Navigate to="/" replace />} />
        <Route path="/media/:mediaId/automation" element={<AutomationEditorPage />} />
        <Route path="/automations/new" element={<AutomationEditorPage />} />
        <Route path="/account" element={<AccountPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
```

並刪除 `admin/src/pages/DashboardPage.tsx` 與 `admin/src/pages/MediaPage.tsx`。

- [ ] **Step 3: 更新 `admin/src/components/AppHeader.tsx` 導覽**——`<nav className="app-nav">` 內只留：

```tsx
          <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}>
            首頁
          </NavLink>
```

（檔頭註解同步改為「品牌＋首頁導覽＋目前登入者＋登出」。）

- [ ] **Step 4: `admin/src/styles/app.css` 追加樣式**（附加到檔尾）

```css
/* ── IG 個人頁式頁首 ── */
.profile-header {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  padding: var(--space-5) var(--space-6);
  margin-bottom: var(--space-4);
}
.profile-avatar {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-full);
  overflow: hidden;
  flex-shrink: 0;
  background: var(--slate-100);
  display: flex;
  align-items: center;
  justify-content: center;
}
.profile-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.profile-avatar-fallback {
  color: var(--color-text-subtle);
  font-weight: var(--weight-semibold);
}
.profile-main {
  flex: 1;
  min-width: 0;
}
.profile-name-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}
.profile-username {
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
}
.profile-stats {
  display: flex;
  gap: var(--space-5);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  flex-wrap: wrap;
}
.profile-stats strong {
  color: var(--color-text);
  font-weight: var(--weight-semibold);
}
.profile-stats .is-danger,
.profile-stats .is-danger strong,
.media-stats-line .is-danger {
  color: var(--danger-fg);
}
.profile-actions {
  display: flex;
  gap: var(--space-2);
  flex-shrink: 0;
}

/* ── 待命／全帳號預設列 ── */
.pending-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}
.chip-clickable {
  cursor: pointer;
  border: none;
  font: inherit;
}
.chip-clickable:hover {
  background: var(--primary-100);
}

/* ── 限動圓圈列 ── */
.story-row {
  display: flex;
  gap: var(--space-4);
  align-items: center;
  overflow-x: auto;
  padding: var(--space-2) 0 var(--space-3);
  border-bottom: 1px solid var(--color-border);
}
.story-circle {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  background: none;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
}
.story-ring {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-full);
  padding: 3px;
  background: var(--slate-200);
  display: block;
}
/* IG 式漸層外框＝自動化啟用中 */
.story-circle.is-active .story-ring {
  background: linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888);
}
.story-ring img,
.story-fallback {
  width: 100%;
  height: 100%;
  border-radius: var(--radius-full);
  object-fit: cover;
  border: 2px solid var(--color-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--slate-100);
  color: var(--color-text-subtle);
  font-size: var(--text-xs);
}
.story-label {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

/* ── 九宮格：啟用標記與成效數據 ── */
.media-flash {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  width: 24px;
  height: 24px;
  border-radius: var(--radius-full);
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
}
.media-stats-line {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  margin-top: var(--space-1);
}
```

- [ ] **Step 5: 驗證**

Run: `npm run typecheck && npm run build`
Expected: 通過、無錯誤。再 `npm run dev` 開 `/admin` 手動確認：頁首顯示帳號與今日統計、限動列（可為空）、九宮格 ⚡ 與數據、`/media` 轉址回首頁。

- [ ] **Step 6: Commit**

```bash
git add admin/src/pages/HomePage.tsx admin/src/main.tsx admin/src/components/AppHeader.tsx admin/src/styles/app.css
git rm admin/src/pages/DashboardPage.tsx admin/src/pages/MediaPage.tsx
git commit -m "feat: 合併儀表板與貼文頁為 IG 個人頁式首頁（含限動列）"
```

---

### Task 9: 前端——編輯器（預設範本、按鈕、限動模式）

**Files:**
- Modify: `admin/src/pages/AutomationEditorPage.tsx`、`admin/src/styles/app.css`

**Interfaces:**
- Consumes: Task 6 `GET /:id` 的 `media.mediaType`、錯誤碼 `private_reply_required_for_story`；Task 8 的 `?story=1` query。

- [ ] **Step 1: 修改 `AutomationEditorPage.tsx`**

1a. 預設公開回覆範本＋限動模式旗標（state 區塊改為）：

```tsx
const DEFAULT_PUBLIC_REPLIES = [
  '已經私訊你囉，記得去小盒子看看 📩',
  '連結傳到你的 DM 了，去收信吧！',
  '私訊已發送給你 🙌 沒收到的話檢查一下訊息邀請',
];
```

```tsx
  // 限動模式：新建時由首頁帶 ?story=1，編輯既有時由 API 的 media.mediaType 判斷。
  const [storyMode, setStoryMode] = useState(searchParams.get('story') === '1');
```

```tsx
  const [publicReplyEnabled, setPublicReplyEnabled] = useState(searchParams.get('story') !== '1');
  // 新建（非限動）預填三則繁中範本；編輯既有以伺服器資料為準。
  const [variants, setVariants] = useState<string[]>(
    automationId || searchParams.get('story') === '1' ? [''] : [...DEFAULT_PUBLIC_REPLIES],
  );
```

1b. `AutomationDetail` interface 加 `media: { id: string; mediaType: string } | null;`，`load()` 內加：

```tsx
      if (d.media?.mediaType === 'STORY') {
        setStoryMode(true);
        setPublicReplyEnabled(false);
      }
```

1c. `payload()` 限動時強制關閉公開回覆：

```tsx
      publicReplyEnabled: storyMode ? false : publicReplyEnabled,
      publicReplyVariants: storyMode ? [] : variants.map((v) => v.trim()).filter(Boolean),
```

1d. `ACTIVATION_REASON_TEXT` 加：

```tsx
  private_reply_required_for_story: '限動自動化必須啟用 Private Reply（私訊是唯一動作）',
```

1e. 標題與說明（`status-line` 的 h1 三元運算最前面加 storyMode 分支；`page-subtitle` 同）：

```tsx
            {storyMode
              ? savedId
                ? '編輯限動自動化'
                : '設定限動自動化'
              : applyScope === 'next_post'
                ? '待命自動化：下一篇新貼文'
                : applyScope === 'account_default'
                  ? '全帳號預設自動化'
                  : savedId
                    ? '編輯自動化'
                    : '設定自動化'}
```

```tsx
        {storyMode ? (
          <p className="page-subtitle">
            有人回應這則限時動態、且訊息含關鍵字時，自動私訊指定內容。限動 24 小時後過期，自動化會自動暫停。
          </p>
        ) : null}
```

1f. 「公開回覆」整個 `form-section` 用 `{storyMode ? null : ( … )}` 包起來。

1g. 關鍵字說明文案（storyMode 時）：

```tsx
                <p className="field-help">
                  {storyMode
                    ? '限動回應（正規化後）符合任一關鍵字即觸發私訊。大小寫、全形半形會自動處理。'
                    : '留言（正規化後）符合任一關鍵字即觸發。大小寫、全形半形會自動處理。'}
                </p>
```

1h. 按鈕列（靠右、啟用改主色、儲存改外框）：

```tsx
          <div className="btn-row">
            {!savedId ? <span className="field-help" style={{ margin: 0 }}>先儲存才能啟用</span> : null}
            <button className="btn btn-outline" onClick={handleSave} disabled={busy}>
              {busy ? '處理中…' : '儲存'}
            </button>
            {status !== 'active' ? (
              <button className="btn btn-primary" onClick={handleActivate} disabled={busy || !savedId}>
                啟用
              </button>
            ) : (
              <button className="btn btn-danger" onClick={handlePause} disabled={busy}>
                暫停
              </button>
            )}
          </div>
```

1i. 返回連結改 `<Link to="/" className="back-link">← 返回首頁</Link>`。

- [ ] **Step 2: `app.css` 加 `.btn-outline` 並讓 `.btn-row` 靠右**（附加到檔尾；先 `grep -n "btn-row" admin/src` 確認只有編輯器使用）

```css
/* ── 編輯器動作列：靠右，主要動作（啟用）在最右 ── */
.btn-row {
  justify-content: flex-end;
}
.btn-outline {
  background: var(--color-surface);
  color: var(--color-primary);
  border: 1px solid var(--color-primary);
}
.btn-outline:hover:not(:disabled) {
  background: var(--color-primary-soft);
}
```

（若 `.btn-row` 原定義含 `justify-content`，直接改原定義而不是覆寫。）

- [ ] **Step 3: 驗證**

Run: `npm run typecheck && npm run build`
Expected: 通過。`npm run dev` 手動確認：新建自動化預填三則範本；按鈕靠右、「啟用」為藍紫填色；由限動圓圈進入時看不到公開回覆區塊。

- [ ] **Step 4: Commit**

```bash
git add admin/src/pages/AutomationEditorPage.tsx admin/src/styles/app.css
git commit -m "feat: 編輯器——預設公開回覆範本、按鈕靠右改色、限動模式"
```

---

### Task 10: 文件更新與整體驗證

**Files:**
- Modify: `spec.md`、`README.md`

- [ ] **Step 1: `spec.md` 增補限動章節**——在適當章節（webhook／自動化附近）加一節「限時動態自動化」，內容涵蓋：資料模型（`instagram_media.media_type='STORY'`、過期＝不在 `GET /{id}/stories` 清單→`deleted_at`＋暫停自動化）、webhook（`messages` 欄位、只收 `reply_to.story`、event key＝mid、`event_type='story_reply'`）、引擎（僅專屬自動化、無公開回覆、DM recipient＝IGSID）、啟用檢核（`private_reply_required_for_story`）。同時把第 16.3 節 status API 的回傳補上 `account` 欄位、16.7 同步補 stories 與 `expiredStories`。

- [ ] **Step 2: `README.md` 部署注意**——在 Meta App 設定段落加：

```markdown
### 限時動態自動化的額外設定

- Meta App 的 Webhooks 訂閱需勾選 `messages` 欄位（原本只需 `comments`）。
- Access token 需具備 `instagram_business_manage_messages` 權限。
- 設定完成後務必實測：對限動回覆關鍵字，確認收到自動私訊
 （Workers 正式 runtime 的限制在 `wrangler dev` 測不出來，見 CLAUDE.md）。
```

- [ ] **Step 3: 全套驗證**

Run: `npm run test && npm run typecheck && npm run lint && npm run build`
Expected: 全部通過（工作區既有 deleted_at 變更的測試也應通過——若它們原本就紅，記錄原因回報，不要順手修不相關的東西）。

- [ ] **Step 4: Commit**

```bash
git add spec.md README.md
git commit -m "docs: 限時動態自動化規格與部署注意事項"
```

---

## Self-Review 紀錄

- Spec 覆蓋：版面合併（Task 8）、預設範本（Task 9）、按鈕（Task 9）、限動（Task 1–7）、文件（Task 10）——全數對應。
- 型別一致性：`CommentEventMessage.eventType`（Task 2 定義、Task 5 使用）、`StoryReplyEvent`（Task 1 定義、Task 5 使用）、`recipientId`（Task 4 定義、Task 5 使用）、`account`（Task 7 定義、Task 8 使用）、`media.mediaType`／`private_reply_required_for_story`（Task 6 定義、Task 9 使用）——已核對。
- 已知留白（刻意）：Task 6 Step 5 與 Task 7 Step 1 的整合測試要沿用既有測試檔的 app／session helpers（該兩檔在工作區有未提交變更，實作時以現檔為準），斷言內容已完整給出。
