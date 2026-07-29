@AGENTS.md

# Claude Code 指令

本檔案為 Claude Code 專屬的路由層，補充上方 `AGENTS.md` 所定義的共用作業規則與流程（該檔案也供 Codex 等其他 AI 工具讀取，為單一事實來源）。詳細規則位於 `ai/process/`。

- 保持 `CLAUDE.md` 簡短。可重複使用的工作流程放在 `.claude/skills/`。

## Clone 後初始化（新環境必做）

1. 安裝依賴：`npm ci` 與 `npm ci --prefix admin`。
2. `cp wrangler.jsonc.example wrangler.jsonc`（`wrangler.jsonc` 已被 `.gitignore` 排除，含部署專屬值，不進版控）。以 `wrangler d1 create ig-comment-dm-db`、`wrangler queues create ig-comment-events` 建立 Cloudflare 資源後，回填 `database_id` 與各 `<TODO:...>` 欄位（`INSTAGRAM_ACCOUNT_ID`／`APP_BASE_URL`／`ADMIN_EMAIL`）。
3. `cp .dev.vars.example .dev.vars`，填入本機開發用機密（同樣不進版控）。
4. 正式環境機密逐一 `wrangler secret put <NAME>`：`META_APP_SECRET`、`META_VERIFY_TOKEN`、`INSTAGRAM_ACCESS_TOKEN`、`ADMIN_SESSION_SECRET`、`TOKEN_ENCRYPTION_KEY`。設定後約 30 秒才生效，勿立即以舊回應誤判。
5. 套用資料庫 migrations：`wrangler d1 migrations apply ig-comment-dm-db --local`（本機）或 `--remote`（正式）。
6. 建立管理者帳號：`npm run create-admin`（互動式，產出 `admin-insert.sql`），再依畫面指示用 `npx wrangler d1 execute DB --local --file=admin-insert.sql`（正式改 `--remote`）套用，套用後刪除該檔。務必用 `--file`、不要貼進 `--command`（密碼雜湊含 `$`，會被 shell 展開打爛）。
7. 驗證環境：`npm run check-meta`（Meta token 健康檢查）→ `npm run test` → `npm run dev`。

規則：機密一律走 `.dev.vars`（本機）或 `wrangler secret put`（正式），永不寫入任何被 git 追蹤的檔案。若 `wrangler.jsonc` 的結構（bindings、queues、crons 等）有變更，必須同步更新 `wrangler.jsonc.example`——CI 的 build 步驟依賴該範本。

## Skill 路由

- 全新專案的 Epic/User Story/Task 拆解：`project-kickoff`
- 程式碼庫搜尋：`project-search`
- 需求釐清：`spec-interrogation`
- UI 替代方案與畫面狀態：`ui-mockup-gate`
- UI 視覺品質與設計工藝：`design-craft`
- 技術規劃與任務卡：`implementation-plan`
- 安全性與可維護性審查：`security-maintainability-review`
- 測試與驗證證據：`test-verification`

## 子代理路由

- 產品面模糊性：`product-planner`
- UI 與互動品質：`ux-reviewer`
- 架構或跨切面變更：`architect`
- 安全性敏感變更：`security-reviewer`
- 測試策略與回歸風險：`test-engineer`

不得將代理（agent）輸出視為核准。人工核准仍是
`ai/process/review-gates.md` 中所定義各關卡（gate）的必要條件。
