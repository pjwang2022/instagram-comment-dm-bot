# AI-Ready 任務卡

## Metadata

- 任務：Lint／Typecheck／Test／Build 腳本與 CI Pipeline
- 上層規格：`spec.md`（第 25 節 CI/CD）
- 上層 Epic：專案設置
- 上層 User Story：技術骨架初始化
- 分軌：不適用
- 前置任務（dependsOn）：TASK-001, TASK-002
- 狀態：完成
- 風險等級：低
- Agent owner：實作 agent
- 人工核准者：待指派

## 目標

建立根目錄統一的 `npm run lint` / `npm run typecheck` / `npm run test` / `npm run build` 指令，並建立 GitHub Actions workflow 在 push／PR 時自動執行這四項檢查，落實 spec.md 第 25 節「正式部署前必須通過」的四道檢查。

## 情境包（Context Pack）

- 相關檔案：
  - 根目錄 `package.json`、`.github/`（目前為空目錄）
  - `spec.md` 第 25 節
- 既有模式：
  - 無既有 CI 設定。
- 假設：
  - Worker 端測試使用 Cloudflare 官方的 `@cloudflare/vitest-pool-workers`（或等價方案）以在 Workers runtime 情境下跑測試；若實作時發現更符合現況的方案，列出 2-3 個選項讓使用者選擇（依 `project-kickoff` 步驟 6 的「探索現成套件」規則）。
  - `npm run build` 需同時涵蓋 Worker（`wrangler deploy --dry-run` 或 `wrangler build`）與 Admin 前端（`admin/` 的 `vite build`）。
  - Cloudflare Workers Builds（雲端自動部署）需在 Cloudflare Dashboard 手動連接 GitHub repo，這是使用者的帳號操作步驟，不在本卡片程式碼範圍內；本卡片的 GitHub Actions 只負責 PR 前的 lint/test/typecheck/build 檢查，不負責實際部署。
- 未知事項：
  - 無。
- 允許變更的檔案：
  - 根目錄 `package.json`、ESLint／Prettier 設定檔、`vitest.config.ts`（或等價）、`.github/workflows/*.yml`。
- 不得觸碰：
  - `ai/`、`tools/kanban/`、`spec.md`。

## 需求

- 根目錄 `package.json` 的 `lint`／`typecheck`／`test`／`build` 腳本可一次涵蓋 `src/` 與 `admin/` 兩個子專案（可用 workspace 或簡單的腳本委派，依實作時判斷）。
- ESLint（+ Prettier 或等價格式化工具）設定，涵蓋 TypeScript + React 規則。
- 測試框架設定完成，至少能跑一個 smoke test（例如驗證 TASK-001 的 `/api/health`）。
- `.github/workflows/ci.yml`：在 push 到 feature branch 與建立 PR 時，依序執行 lint → test → typecheck → build，任一步驟失敗即整體失敗。

## 驗收標準

- 本地執行 `npm run lint`、`npm run typecheck`、`npm run test`、`npm run build` 均成功（在 TASK-001／TASK-002 骨架程式碼上）。
- GitHub Actions workflow 語法正確（可用 `act` 本地驗證或至少通過 YAML lint），四個步驟名稱與 spec.md 第 25 節流程對應。
- 未觸碰 `ai/`、`tools/kanban/`、`spec.md`。

## 實作備註

- 本卡片不含 Cloudflare Workers Builds 的 Dashboard 連接設定（需使用者手動操作），僅在卡片備註中提醒此步驟待辦。
- 若 lint/test 工具選型有多個合理選項，依規則列出並詢問使用者，不要自行悶頭選一個小眾工具。

## 驗證契約

- 單元測試：本卡片新增的 smoke test 需能跑通。
- 整合測試：不適用。
- E2E 測試：不適用。
- 型別檢查：`npm run typecheck` 本身即為驗證標的。
- Lint：`npm run lint` 本身即為驗證標的。
- Build：`npm run build` 本身即為驗證標的。
- 螢幕截圖：不適用。
- 安全性檢查：確認 CI workflow 不會把任何 Secret 印在 log 裡。

## 完成證據

- 變更的檔案：
  - 新增：`eslint.config.js`、`.prettierrc.json`、`vitest.config.ts`、`tests/unit/health.test.ts`
  - 新增：`tests/integration/.gitkeep`、`tests/fixtures/.gitkeep`
  - 新增：`.github/workflows/ci.yml`
  - 修改：根目錄 `package.json`（新增 `type: module`、`lint`/`typecheck`/`test` 腳本，`typescript` 改為 `5.9.3`）
  - 修改：`admin/package.json`（`typescript` 改為 `5.9.3`）、`.gitignore`（新增 `.wrangler/`、`*.tsbuildinfo`）
- 執行過的指令：
  - `npm install --save-dev eslint@9 @eslint/js@9 typescript-eslint eslint-plugin-react eslint-plugin-react-hooks prettier eslint-config-prettier vitest globals`
  - `npm install --save-dev typescript@5.9.3`（根目錄與 `admin/`）
  - `npm run lint` / `npm run test` / `npm run typecheck` / `npm run build`
  - `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
- 測試輸出：
  - `npm run lint` → 0 error
  - `npm run test` → 1 passed（`tests/unit/health.test.ts`）
  - `npm run typecheck` → 根目錄與 `admin/` 皆無錯誤
  - `npm run build` → `admin` `vite build` 成功 + `wrangler deploy --dry-run` 成功
- 螢幕截圖：不適用。
- 已知限制：
  1. `typescript@7.0.2` 與 `typescript-eslint@8` 不相容（peer 要求 `<6.1.0`），已將根目錄與 `admin/` 的 `typescript` 都改為 `5.9.3`（回溯影響 TASK-001／TASK-002，已在對應卡片加註留言）。
  2. 原本嘗試安裝的 `@cloudflare/vitest-pool-workers` 因間接依賴 Node ≥22 的 `miniflare` 而移除，改用純 `vitest` 直接呼叫 Hono app 的 `.request()` 做 smoke test，未透過真正的 Workers runtime/bindings；之後測試涉及 D1/Queue bindings 的邏輯時需重新評估。
  3. CI workflow Node 版本固定為 20，與本機 `wrangler@4.86.0` 保持一致；之後若升級本機 Node ≥22，可考慮同步升級 wrangler 版本並更新 CI。
  4. Cloudflare Workers Builds 尚未在 Dashboard 連接 GitHub repo（使用者帳號操作步驟），CI 目前只涵蓋 lint/test/typecheck/build 四項 PR 前檢查，不含實際部署。
  5. `npm audit` 顯示數個中高風險漏洞，多半來自 wrangler/miniflare 工具鏈的間接依賴（開發工具鏈而非執行期程式碼），暫不處理。
- 後續任務：後續所有功能 Epic 的任務卡都會依賴這裡建立的 lint/test/typecheck/build 腳本與 CI pipeline。
