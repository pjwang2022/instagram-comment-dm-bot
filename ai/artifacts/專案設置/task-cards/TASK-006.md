# AI-Ready 任務卡

## Metadata

- 任務：D1 Schema（全部 11 張資料表＋索引＋登入限流計數表）
- 上層規格：`spec.md`（第 14、15、18.4 節）
- 上層 Epic：專案設置
- 上層 User Story：核心資料模型與認證框架基礎
- 分軌：後端
- 前置任務（dependsOn）：無
- 狀態：完成
- 風險等級：高（資料庫遷移）
- Agent owner：實作 agent
- 人工核准者：待指派

## 目標

在 `src/database/schema.ts` 用 Drizzle ORM 定義 spec.md 第 14 節全部 11 張資料表與第 15 節列出的全部索引，並產生對應的 D1 migration 檔（`drizzle/migrations/`）。另外新增一張 spec.md 沒列出、但架構審查判定必要的 `login_rate_limits` 計數表，供 TASK-008 實作登入頻率限制（Cloudflare 原生 Rate Limiting binding 的週期只支援 10/60 秒，無法表示「每 IP 15 分鐘」的窗口，經與使用者確認採混合方案）。

## 情境包（Context Pack）

- 相關檔案：
  - `src/database/schema.ts`（TASK-001 建立的空占位）
  - `src/database/client.ts`（已存在，`createDb(d1)` 工廠函式）
  - `drizzle.config.ts`（已存在）
  - `spec.md` 第 14、15 節（逐表逐欄位、逐索引）
- 既有模式：
  - 無既有資料表。
- 假設：
  - 直接照 spec.md 第 14 節的欄位、型別、預設值、外鍵、UNIQUE 約束逐一轉成 Drizzle schema，不自行增減欄位（`login_rate_limits` 除外，見上）。
  - `admin_users` 的初始資料（seed）不在本卡範圍，屬於「密碼雜湊工具與 Admin 使用者 Seed」（TASK-007）。
  - **時間戳記策略（架構審查要求明訂）**：全部表的 `created_at`／`updated_at` 在 Drizzle schema 層級用 `.$defaultFn(() => new Date().toISOString())` 給預設值（`created_at` 建立時定值，`updated_at` 由應用層在每次更新時明確覆寫，不做資料庫層級的 auto-update trigger，避免隱藏行為），確保任何 insert 呼叫端不需要每次手動帶入時間戳記。
- 未知事項：
  - 無（spec.md 對每張表的定義已足夠明確）。
- 允許變更的檔案：
  - `src/database/schema.ts`、`drizzle/migrations/**`。
- 不得觸碰：
  - `admin/`、`ai/`、`tools/kanban/`。

## 需求

- 11 張表：`admin_users`／`system_settings`／`instagram_accounts`／`instagram_media`／`automations`／`automation_keywords`／`public_reply_variants`／`webhook_events`／`automation_runs`／`api_attempts`／`audit_logs`，欄位與型別完全對應 spec.md 第 14 節。
- 外鍵關係：`instagram_media.instagram_account_id → instagram_accounts.id`、`automations.instagram_media_id → instagram_media.id`（UNIQUE）、`automation_keywords.automation_id → automations.id`、`public_reply_variants.automation_id → automations.id`、`automation_runs.automation_id → automations.id`、`automation_runs.webhook_event_id → webhook_events.id`、`api_attempts.automation_run_id → automation_runs.id`。
- UNIQUE 約束：`admin_users.email`、`instagram_accounts.instagram_account_id`、`instagram_media.instagram_media_id`、`automation_keywords(automation_id, normalized_keyword)`、`webhook_events.event_key`、`automation_runs(automation_id, instagram_comment_id)`。
- 第 15 節全部 9 個索引。
- 新增 `login_rate_limits` 表（非 spec.md 原始 11 表之一，架構審查判定必要）：至少包含 `id`（PK）、`ip_address TEXT NOT NULL`、`window_start TEXT NOT NULL`、`attempt_count INTEGER NOT NULL DEFAULT 0`、`created_at`／`updated_at`，並在 `ip_address` 上建索引；具體欄位可依 TASK-008 實際計數演算法微調，但不得超出「登入頻率限制計數」這個單一用途。
- 全部表的 `created_at`／`updated_at` 依上述時間戳記策略給 Drizzle schema 層級預設值。
- 產生可套用的 D1 migration（`drizzle-kit generate`），並在本機以 `wrangler d1 execute --local` 驗證可套用不報錯。

## 驗收標準

- `npx drizzle-kit generate` 成功產出 migration SQL，內容涵蓋全部 11 張表＋`login_rate_limits`＋全部索引。
- 本機 D1（`--local`）套用 migration 無錯誤。
- `tsc --noEmit` 通過（schema 型別正確）。
- 逐表比對 spec.md 第 14 節，欄位數與型別一致（人工／agent 自查 checklist）。
- `created_at`／`updated_at` 皆有 schema 層級預設值，insert 時可省略這兩欄仍成功寫入。

## 實作備註

- 高風險（資料庫遷移）：實作前需經架構與安全性審查，並取得人工核准後才進入 implementing。
- 本卡不建立任何真實資料列（seed），純 schema／migration。

## 驗證契約

- 單元測試：不適用（schema 定義本身無邏輯）。
- 整合測試：本機 D1 套用 migration（`wrangler d1 execute --local --file`）。
- E2E 測試：不適用。
- 型別檢查：`npm run typecheck`。
- Lint：`npm run lint`。
- Build：`npm run build`。
- 螢幕截圖：不適用。
- 安全性檢查：確認 migration 檔不含任何真實資料／機密。

## 完成證據

- 變更的檔案：
  - 修改：`src/database/schema.ts`（取代空占位，12 張表：11 張 spec 表＋`login_rate_limits`）
  - 新增：`drizzle/migrations/0000_organic_monster_badoon.sql`
  - 新增：`tests/unit/schema.test.ts`
  - 修改：`package.json`（新增 `better-sqlite3`／`@types/better-sqlite3` devDependencies，僅供測試）
- 執行過的指令：
  - `npx drizzle-kit generate`
  - `npx wrangler d1 execute DB --local --file=drizzle/migrations/0000_organic_monster_badoon.sql`
  - `npx wrangler d1 execute DB --local --command="SELECT name FROM sqlite_master WHERE type='table' ..."`
  - `npm run test && npm run lint && npm run typecheck && npm run build`
  - `grep -n 'password|secret' drizzle/migrations/0000_organic_monster_badoon.sql`
- 測試輸出：
  - `drizzle-kit generate` → 12 張表、正確 FK/UNIQUE/索引
  - `wrangler d1 execute --local` → 套用成功，12 張表全數建立
  - `tests/unit/schema.test.ts` → 3 個測試通過（表存在、時間戳記可省略仍插入成功、UNIQUE 約束正確擋下重複）
  - lint/typecheck/build 全數通過
- 螢幕截圖：不適用。
- 已知限制：`better-sqlite3` 僅用於本機測試驗證 schema/migration（D1 與 SQLite 相容），Worker 執行期仍使用 `drizzle-orm/d1`，不影響 production 依賴；`login_rate_limits` 表目前只有 schema，實際讀寫邏輯留給 TASK-008。
- 後續任務：密碼雜湊工具與 Admin 使用者 Seed（TASK-007）。
