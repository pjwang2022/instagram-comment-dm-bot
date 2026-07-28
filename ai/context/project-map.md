# 專案地圖

狀態：已依 `spec.md`（IG Comment DM Bot MVP 技術規格書 v1.0）填寫。

## 產品

- 名稱：Instagram 留言關鍵字自動私訊系統（IG Comment DM Bot）
- 使用者：單一管理者、自用工具（不做多租戶、不做 SaaS）
- 核心工作流程：使用者留言 → Instagram Webhook → 比對貼文與關鍵字 → 公開回覆原留言 → 透過 Private Reply 傳送一則 DM

## 技術棧

- 前端：React + Vite + React Router + TypeScript（純 SPA，靜態檔由 Workers Static Assets 提供，無 SSR/SEO 需求）
- 後端：TypeScript + Hono（單一 Cloudflare Worker，負責 Webhook、Admin API、Auth middleware、Queue Consumer、Meta API Client）
- 資料庫：Cloudflare D1 + Drizzle ORM
- 身分驗證：Email + Password（Argon2id）、HttpOnly + Secure + SameSite=Strict Session Cookie，CSRF 採 Origin 驗證或 CSRF Token
- 非同步處理：Cloudflare Queues（Webhook 收到事件後不得同步等待 Meta API）
- 排程：Cloudflare Cron Triggers（貼文同步 04:00、Token 檢查 08:00、資料清理 03:00，皆 Asia/Taipei，需自行換算 UTC）
- Secret 管理：Cloudflare Secrets（META_APP_SECRET / META_VERIFY_TOKEN / INSTAGRAM_ACCESS_TOKEN / ADMIN_SESSION_SECRET / TOKEN_ENCRYPTION_KEY）
- 測試：單元測試（比對邏輯、正規化）＋整合測試（Webhook／Queue／D1／重試）＋實際 IG 帳號測試
- 部署：Cloudflare Workers（單一 Worker，不拆微服務），GitHub + Cloudflare Workers Builds CI/CD

## 硬性限制（來自 spec.md）

- 不使用 Docker／VPS／Redis／PostgreSQL／Kubernetes／Selenium／Playwright／Instagram 私有 API。
- 不做多帳號、多租戶、SaaS 計費、主動群發 DM、Broadcast、AI 客服、CRM。
- 單一 Worker、不拆微服務、不過早最佳化。
- 詳細規格見 repo 根目錄 `spec.md`。

## 重要目錄

| 路徑 | 用途 | 備註 |
|---|---|---|
| `spec.md` | MVP 技術規格書（單一事實來源） | 拆解 Epic/Task 前必讀 |
| `src/` | Worker 端原始碼（webhook/queue/automation/meta/admin/database/security/monitoring/shared） | 見 spec.md 第 23 節目錄結構 |
| `admin/` | React 管理後台原始碼 | 建置為靜態檔，由 `ASSETS` binding 提供 |
| `drizzle/migrations/` | D1 migration 檔 | 對應 spec.md 第 14 節資料表設計 |
| `tools/kanban/` | 治理看板（Epic/Task 追蹤） | 見 `tools/kanban/README.md` |

## 常用指令

| 指令 | 用途 | 備註 |
|---|---|---|
| `npm run lint` | Lint | 部署前必過 |
| `npm run typecheck` | 型別檢查 | 部署前必過 |
| `npm run test` | 單元＋整合測試 | 部署前必過 |
| `npm run build` | 建置 Worker＋Admin 靜態檔 | 部署前必過 |
| `node tools/kanban/server.mjs` | 啟動治理看板 | 瀏覽器開 127.0.0.1:4420 |
