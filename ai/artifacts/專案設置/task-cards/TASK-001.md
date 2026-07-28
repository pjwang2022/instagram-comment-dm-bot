# AI-Ready 任務卡

## Metadata

- 任務：Worker 專案骨架與 Cloudflare 設定
- 上層規格：`spec.md`（第 3、4.1-4.2、4.4-4.6、5、23、24 節）
- 上層 Epic：專案設置
- 上層 User Story：技術骨架初始化
- 分軌：後端
- 前置任務（dependsOn）：無
- 狀態：完成
- 風險等級：低
- Agent owner：實作 agent
- 人工核准者：待指派

## 目標

建立可透過 `wrangler dev` 啟動的最小 Hono Worker 骨架，具備 `src/index.ts`／`src/app.ts` 入口、`wrangler.jsonc` 的 D1／Queue／Cron/Assets bindings 宣告、`drizzle.config.ts`（指向尚未建立內容的 `src/database/schema.ts` 路徑即可，schema 實際內容屬於「核心資料模型與認證框架基礎」任務），以及 spec.md 第 23 節列出的 `src/` 子目錄骨架（webhook/queue/automation/meta/admin/database/security/monitoring/shared，各放一個空的 index 或 `.gitkeep`，不寫商業邏輯）。

## 情境包（Context Pack）

- 相關檔案：
  - 專案根目錄（目前為空，僅有 `ai/`、`tools/`、`spec.md` 等治理檔案）
  - `spec.md` 第 3.1-3.3、4.1-4.2、4.4-4.6、5、23、24 節
- 既有模式：
  - 無既有程式碼，一切從 spec.md 的規格直接建立。
- 假設：
  - 使用 Node.js + npm（專案已有 `package.json`、`scripts/` 目錄雛形，需確認/補齊）。
  - Cloudflare 帳號、D1 database、Queue 等雲端資源尚未建立，`wrangler.jsonc` 內 `database_id` 先用 spec.md 範例的 `<D1_DATABASE_ID>` 佔位。
- 未知事項：
  - 實際 D1 database／Queue 需由使用者以 `wrangler d1 create` / `wrangler queues create` 建立並回填 id——這是需要 Cloudflare 帳號登入的操作步驟，不在本卡片範圍內，本卡片只需正確宣告 binding 結構。
- 允許變更的檔案：
  - 根目錄 `package.json`、`tsconfig.json`、`wrangler.jsonc`、`drizzle.config.ts`、`src/**`。
- 不得觸碰：
  - `admin/`（前端骨架屬於另一張任務卡）、`ai/`、`tools/kanban/`、`spec.md`。

## 需求

- `src/index.ts` 匯出符合 Cloudflare Workers `fetch` handler 簽名的入口，委派給 `src/app.ts` 的 Hono app。
- `src/app.ts` 建立 Hono app 並掛一個 `GET /api/health`（或等價健康檢查路由）回傳 200，用於驗證骨架可運作。
- `wrangler.jsonc` 依 spec.md 第 24 節範例，包含 `assets`（binding `ASSETS`，指向 `./admin/dist`）、`d1_databases`（binding `DB`）、`queues.producers`（binding `COMMENT_QUEUE`）、`queues.consumers`、`triggers.crons`（三個 cron 表達式，UTC 換算並註明對應台北時間用途）。
- `drizzle.config.ts` 指向 `src/database/schema.ts`（檔案可先為空/最小占位 export，內容留給下一張任務卡）與 D1 binding 設定。
- `src/` 下建立 spec.md 第 23 節列出的子目錄骨架（webhook/queue/automation/meta/admin/database/security/monitoring/shared），每個子目錄至少一個檔案（可為空模組或型別 re-export），確保目錄結構存在且可被匯入不報錯。
- `package.json` 具備 `dev`／`build` 基礎腳本（`lint`/`typecheck`/`test` 腳本由 TASK-003 補齊，這裡若順手建立空殼亦可但不強制）。

## 驗收標準

- `npx wrangler dev` 可成功啟動（或至少 `npx wrangler deploy --dry-run` 通過），無 binding 設定錯誤。
- `GET /api/health` 本地測試回傳 200。
- `wrangler.jsonc` 通過 `wrangler.jsonc` schema 檢查（`$schema` 指向 `node_modules/wrangler/config-schema.json`）。
- `src/` 目錄結構與 spec.md 第 23 節一致，無多餘或缺漏的頂層子目錄。
- 未觸碰 `admin/`、`ai/`、`tools/kanban/`。

## 實作備註

- 這是純骨架卡，不實作任何 webhook 簽章驗證、Meta API 呼叫、資料表 schema 等商業邏輯——那些屬於各自功能 Epic 的任務卡。
- Cron 表達式需將 spec.md 第 20 節的台北時間（04:00／08:00／03:00 Asia/Taipei）換算成 UTC 寫入 `triggers.crons`，並在註解或本卡片備註對照原始台北時間，避免之後誤改。

## 驗證契約

- 單元測試：無（骨架卡，暫無商業邏輯可測；健康檢查路由可用一個最小 smoke test 涵蓋）。
- 整合測試：`wrangler dev` 本地啟動 + `curl /api/health` 手動或腳本驗證。
- E2E 測試：不適用。
- 型別檢查：`tsc --noEmit`（若 TASK-003 尚未提供正式腳本，先手動執行確認無誤）。
- Lint：不適用（正式 lint 設定由 TASK-003 提供）。
- Build：`npx wrangler deploy --dry-run` 或等價的本地建置驗證。
- 螢幕截圖：不適用。
- 安全性檢查：確認 `wrangler.jsonc` 中不含任何真實 Secret 值。

## 完成證據

- 變更的檔案：
  - 新增：`package.json`（更新名稱與 dev/build 腳本）、`tsconfig.json`、`wrangler.jsonc`、`drizzle.config.ts`
  - 新增：`src/index.ts`、`src/app.ts`、`src/database/{schema,client}.ts`
  - 新增：`src/{webhook,queue,automation,meta,admin,security,monitoring,shared}/*` 骨架檔（各為 `export {};` 佔位模組）
  - 新增：`src/database/repositories/.gitkeep`、`admin/dist/index.html`（佔位，待 TASK-002 覆蓋）
- 執行過的指令：
  - `npm install --save hono drizzle-orm`
  - `npm install --save-dev wrangler@4.86.0 @cloudflare/workers-types@4.20260702.1 typescript drizzle-kit`
  - `npx wrangler deploy --dry-run`
  - `npx wrangler dev --port 8788` + `curl http://127.0.0.1:8788/api/health`
  - `npx tsc --noEmit`
- 測試輸出：
  - `curl /api/health` → `200 {"status":"ok"}`
  - `wrangler deploy --dry-run` → 成功讀取 `admin/dist`，列出 `DB`／`COMMENT_QUEUE`／`ASSETS` 三個 binding，無錯誤
  - `tsc --noEmit` → 無輸出（無型別錯誤）
- 螢幕截圖：不適用。
- 已知限制：
  1. `wrangler`／`@cloudflare/workers-types` 鎖定在 4.86.0／4.x：最新 wrangler 4.114.0 需要 Node ≥22，本機為 Node 20.19.0。之後升級本機 Node 版本後可再評估升級。
  2. `compatibility_date` 暫定為 `2026-05-03`（4.86.0 支援的最新日期），未採用 spec.md 範例中的 `2026-07-01`。
  3. `admin/dist` 目前只是本卡為了讓 `wrangler` 通過 assets 目錄檢查而建立的最小佔位檔，會被 TASK-002 的 `npm run build` 覆蓋。
  4. spec.md 第 23 節 `src/database/` 底下列的 `migrations/` 子目錄未建立：`drizzle.config.ts` 與 `wrangler.jsonc` 的 `migrations_dir` 都指向根目錄 `drizzle/migrations/`，避免兩處遷移目錄造成混淆。
  5. 資料清理排程 cron（spec.md 第 20 節第三個 cron）依 `ai/context/decisions.md` 的決策未列入 `wrangler.jsonc` 的 `triggers.crons`。
- 後續任務：Admin 前端骨架（TASK-002）、Lint/Typecheck/Test/Build 與 CI（TASK-003）、核心資料模型與認證框架基礎（D1 schema）、環境變數與金鑰設定。
