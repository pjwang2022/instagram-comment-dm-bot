# AI-Ready 任務卡

## Metadata

- 任務：Cloudflare Secrets／Variables 設定與本機開發規範
- 上層規格：`spec.md`（第 4.6、22 節）
- 上層 Epic：專案設置
- 上層 User Story：環境變數與金鑰設定
- 分軌：不適用
- 前置任務（dependsOn）：無
- 狀態：完成
- 風險等級：低
- Agent owner：實作 agent
- 人工核准者：待指派

## 目標

落實 spec.md 第 22 節的 Secrets／Variables 清單：在 `wrangler.jsonc` 宣告一般 Variables（非機密）的預設值，並建立本機開發用的 `.dev.vars.example`（僅放置說明與空白／placeholder，不含真實機密），確保正式環境 Secret 一律透過 `wrangler secret put` 設定、不寫入任何被 git 追蹤的檔案。

## 情境包（Context Pack）

- 相關檔案：
  - `wrangler.jsonc`（TASK-001 已建立，目前只有 bindings，無 `vars`）
  - `.gitignore`（已有 `.env`／`.env.*`，需確認是否涵蓋 wrangler 慣用的 `.dev.vars`）
  - `spec.md` 第 4.6、22 節
- 既有模式：
  - 無。
- 假設：
  - Secrets（`META_APP_SECRET`／`META_VERIFY_TOKEN`／`INSTAGRAM_ACCESS_TOKEN`／`ADMIN_SESSION_SECRET`／`TOKEN_ENCRYPTION_KEY`）一律用 `wrangler secret put <NAME>`（正式環境）或本機不進 git 的 `.dev.vars`（本機開發）提供，不寫進 `wrangler.jsonc` 的 `vars`。
  - `META_GRAPH_API_VERSION` 目前先用一個明確標註「需在實際串接 Meta API 前，由使用者對照 Meta 官方文件確認當下最新版本」的 placeholder 值，不自行假造一個未經查證的版本號當作事實。
- 未知事項：
  - 真實的 `INSTAGRAM_ACCOUNT_ID`、`ADMIN_EMAIL`、`APP_BASE_URL`（正式網域）需使用者填入，本卡只建立 placeholder 與填寫說明。
- 允許變更的檔案：
  - `wrangler.jsonc`、`.gitignore`、新增 `.dev.vars.example`。
- 不得觸碰：
  - `src/`（除非是純粹讀取型別調整）、`admin/`、`ai/`、`tools/kanban/`。

## 需求

- `wrangler.jsonc` 新增 `vars` 區塊，包含 `META_GRAPH_API_VERSION`／`INSTAGRAM_ACCOUNT_ID`／`APP_ENV`／`APP_BASE_URL`／`ADMIN_EMAIL`／`LOG_LEVEL`，值為明確標註待填的 placeholder（例如 `"<TODO:...>"`），並在鄰近註解說明每個變數的用途與正式環境要怎麼覆寫。
- 新增 `.dev.vars.example`：列出 5 個 Secret 名稱＋一行說明用途，值留空或寫 `# 本機開發用，不得填入真實機密並提交` 提示。
- `.gitignore` 確認／新增 `.dev.vars` 規則，避免真的建立 `.dev.vars` 時被誤 commit。
- 不在任何程式碼、測試、log 裡寫入真實 Secret 值。

## 驗收標準

- `wrangler.jsonc` 通過既有的 `wrangler deploy --dry-run` 驗證（新增 `vars` 不破壞既有 config）。
- `.dev.vars.example` 存在且不含任何真實機密。
- `git status` 確認 `.dev.vars`（若日後建立）會被 `.gitignore` 排除。
- `grep` 全 repo 確認新增檔案不含真實 Token／Secret 字串。

## 實作備註

- 本卡不實際申請或填入任何 Meta App Secret／Access Token——那是使用者在 Meta for Developers 後台操作的步驟，不在程式碼範圍內。

## 驗證契約

- 單元測試：不適用。
- 整合測試：不適用。
- E2E 測試：不適用。
- 型別檢查：`npm run typecheck`（確認 `wrangler.jsonc` 型別不受影響）。
- Lint：`npm run lint`。
- Build：`npm run build`（`wrangler deploy --dry-run` 需通過）。
- 螢幕截圖：不適用。
- 安全性檢查：`grep -r` 確認新增檔案無真實機密字串；確認 `.dev.vars` 被 `.gitignore` 排除。

## 完成證據

- 變更的檔案：
  - 新增：`.dev.vars.example`
  - 修改：`wrangler.jsonc`（新增 `vars` 區塊）、`.gitignore`（新增 `.dev.vars`）
- 執行過的指令：
  - `npm run typecheck && npm run lint && npm run build`
  - `git check-ignore -v .dev.vars.example .dev.vars`
  - `grep -n 'META_APP_SECRET\|META_VERIFY_TOKEN\|INSTAGRAM_ACCESS_TOKEN\|ADMIN_SESSION_SECRET\|TOKEN_ENCRYPTION_KEY' wrangler.jsonc .dev.vars.example`
- 測試輸出：
  - `wrangler deploy --dry-run` 列出 6 個 Environment Variable，皆為 `<TODO:...>` placeholder 或明確預設值，無真實機密
  - `.dev.vars.example` 的 5 個 Secret 名稱皆為空值，無真實機密
  - `git check-ignore` 確認 `.dev.vars` 會被排除、`.dev.vars.example` 不會
  - lint/typecheck/build 全數通過
- 螢幕截圖：不適用。
- 已知限制：`META_GRAPH_API_VERSION`／`INSTAGRAM_ACCOUNT_ID`／`APP_BASE_URL`／`ADMIN_EMAIL` 仍是 `<TODO:...>` placeholder，需使用者在實際串接 Meta API／申請正式網域前填入真實值；本卡刻意不假設或查證當下的 Meta Graph API 版本號。
- 後續任務：JSON Structured Logging 基礎模組（TASK-005）、核心資料模型與認證框架基礎。
