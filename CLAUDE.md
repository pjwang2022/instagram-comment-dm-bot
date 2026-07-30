# Claude Code 指令

本專案為 Instagram Comment DM Bot：留言命中關鍵字即自動公開回覆並發送私訊，
跑在 Cloudflare Workers（Hono + D1/Drizzle + Queues + Cron），管理後台為 React SPA
（`admin/`，由 ASSETS binding 供應）。完整技術規格見 `spec.md`，安裝與部署見 `README.md`。

## Clone 後初始化（新環境必做）

1. 安裝依賴：`npm ci` 與 `npm ci --prefix admin`。
2. 直接編輯 `wrangler.jsonc`（版控中的內容是 placeholder；「Deploy to Cloudflare」按鈕依賴此檔存在）。以 `wrangler d1 create ig-comment-dm-db`、`wrangler queues create ig-comment-events` 建立 Cloudflare 資源後，回填 `database_id` 與各 `<TODO:...>` 欄位（`INSTAGRAM_ACCOUNT_ID`／`ADMIN_EMAIL`），並立即執行 `git update-index --skip-worktree wrangler.jsonc`，避免個人部署值被提交。
3. `cp .dev.vars.example .dev.vars`，填入本機開發用機密（同樣不進版控）。
4. 正式環境機密逐一 `wrangler secret put <NAME>`：`META_APP_SECRET`、`META_VERIFY_TOKEN`、`INSTAGRAM_ACCESS_TOKEN`、`ADMIN_SESSION_SECRET`。設定後約 30 秒才生效，勿立即以舊回應誤判。
5. 套用資料庫 migrations：`wrangler d1 migrations apply ig-comment-dm-db --local`（本機）；正式環境改用 `npm run deploy`（一次完成 admin 建置、`--remote` migrations 與部署）。
6. 建立管理者帳號：部署後開 `/admin`——資料庫沒有任何管理者時，登入頁顯示一次性的首次啟動設定表單（`POST /api/admin/auth/setup`，僅在 `admin_users` 為空時允許）。CLI 備援：`npm run create-admin`（產出 `admin-insert.sql`）→ `npx wrangler d1 execute DB --local --file=admin-insert.sql`（正式改 `--remote`）→ 套用後刪檔。務必用 `--file`、不要貼進 `--command`（密碼雜湊含 `$`，會被 shell 展開打爛）。
7. 驗證環境：`npm run check-meta`（Meta token 健康檢查）→ `npm run test` → `npm run dev`。

## 機密與設定規則

- 機密一律走 `.dev.vars`（本機）或 `wrangler secret put`（正式），永不寫入任何被 git 追蹤的檔案、不傳到前端、不寫進 log。
- `wrangler.jsonc` 在版控中只允許 placeholder 值——本機真實部署值以 `git update-index --skip-worktree wrangler.jsonc` 保護（意味著 git 不會回報此檔的變更；要提交結構性修改前，先 `git update-index --no-skip-worktree wrangler.jsonc`，確認 diff 只含 placeholder 後再提交，完成後重新設回 skip-worktree）。

## 開發注意事項

- Workers 正式 runtime 的限制在 `wrangler dev` 測不出來（例：PBKDF2 單次迭代上限 100,000、禁止執行期 WASM 編譯、全域 fetch 需綁定 this）。認證與加密相關變更務必部署後實測。
- 提供驗證證據：指令、輸出結果、UI 螢幕截圖，以及已知殘留風險。
- 審查重點：功能性錯誤、安全與隱私風險、auth／權限／密鑰／網路邊界、資料驗證與錯誤處理、缺失的測試。
