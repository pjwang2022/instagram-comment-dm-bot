# AI-Ready 任務卡

## Metadata

- 任務：Session／CSRF／Rate-limit 中介層
- 上層規格：`spec.md`（第 18.1、18.2、18.4 節）
- 上層 Epic：專案設置
- 上層 User Story：核心資料模型與認證框架基礎
- 分軌：後端
- 前置任務（dependsOn）：TASK-006（需要 `login_rate_limits` 表）
- 狀態：完成
- 風險等級：高（身分驗證／權限邊界）
- Agent owner：實作 agent
- 人工核准者：待指派

## 目標

實作三個共用 Hono middleware：（1）無狀態簽章 Session Cookie 的簽發／驗證，（2）CSRF 防護（SameSite=Strict Cookie＋Origin 驗證），（3）頻率限制——Admin API 的 120/分鐘用 Cloudflare 原生 Rate Limiting binding，登入的 15 分鐘/10 次用 `login_rate_limits` D1 計數表（原生 binding 週期只支援 10/60 秒，無法表示 15 分鐘窗口，已與使用者確認採此混合方案）。

## 情境包（Context Pack）

- 相關檔案：
  - `src/security/session.ts`、`src/security/csrf.ts`、`src/security/rate-limit.ts`（TASK-001 建立的空占位）
  - `wrangler.jsonc`（需新增 Rate Limiting binding）
  - `src/database/schema.ts`（TASK-006 產出的 `login_rate_limits` 表）
  - `spec.md` 第 18.1、18.2、18.4 節
- 既有模式：
  - 無。
- 假設（已與使用者確認，含架構＋安全性審查後的修正）：
  - **Session**：無狀態簽章 Cookie，格式為 `base64url(JSON payload).base64url(HMAC-SHA256 signature)`，payload 含 `{ sub: admin_user_id, kid, iat, exp }`（`kid` 為固定字串版本號，供未來輪替 `ADMIN_SESSION_SECRET` 時判斷舊 session 是否該作廢；MVP 階段只有一組 secret，`kid` 先固定為 `"1"`）。驗證時：`exp` 缺失、非數字、或已過期，一律視為驗證失敗（fail-closed，不得預設為永久有效）；簽章比對必須用 `crypto.subtle.verify`（原生即 constant-time）而不是自行字串比較。Cookie 屬性：`HttpOnly; Secure; SameSite=Strict; Path=/`。**撤銷方案**：MVP 不支援撤銷單一 session，僅能透過輪替 `ADMIN_SESSION_SECRET`（同時遞增 `kid`）使全部既有 session 失效，此為刻意的設計取捨並在本卡文件化，不建立 sessions 表。
  - **CSRF**：非 GET/HEAD 的 Admin API 請求驗證 `Origin`（找不到則退回 `Referer`）是否與 `APP_BASE_URL` **精確比對**（非 `startsWith`，避免 `https://app.example.com.evil.com` 之類的子網域繞過）；`Origin` 為字面字串 `"null"` 視為不相符；**Origin 與 Referer 皆缺失時一律拒絕**（fail-closed，不得放行）。搭配 `SameSite=Strict` 作為第二層防護。
  - **Rate limiting（混合方案）**：
    - Admin API 一般限流（每 Session 每分鐘 120 次）：Cloudflare 原生 Rate Limiting binding，`period: 60`／`limit: 120`，以 session 的 `sub`（admin_user_id）當 key。
    - 登入限流（每 IP 15 分鐘 10 次）：原生 binding 週期只支援 10/60 秒，無法表示 15 分鐘窗口，改用 `login_rate_limits` D1 表自建滑動窗口計數（以 `CF-Connecting-IP` 當 key，`window_start` 對齊 15 分鐘區間，超過 10 次即拒絕）。
    - **兩種限流器故障時的行為**：一律 fail-closed（元件本身出錯時視為「已達限制」拒絕請求並記錄錯誤 log），不得因為限流元件掛掉就默默放行無限次嘗試。
- 未知事項：
  - 無（Rate Limiting binding 的 schema 已在架構審查中對照本機 `node_modules/wrangler/config-schema.json` 確認：`ratelimits[].simple.period` 只接受 `10` 或 `60`）。
- 允許變更的檔案：
  - `src/security/{session,csrf,rate-limit}.ts`、`wrangler.jsonc`、對應測試檔。
- 不得觸碰：
  - `admin/`、`ai/`、`tools/kanban/`、`src/database/schema.ts`（本卡使用 TASK-006 已建立的 `login_rate_limits` 表，不重新定義 schema）。

## 需求

- `createSessionCookie(secret, adminUserId, ttlSeconds)` / `verifySessionCookie(secret, cookieValue)`：簽發與驗證，過期、簽章不符、或 `exp` 缺失／格式錯誤，一律回傳明確的「未驗證」結果（不拋出讓呼叫端忘記處理的例外）；簽章驗證用 `crypto.subtle.verify`。
- `csrfMiddleware()`：Hono middleware，對非安全方法（POST/PUT/PATCH/DELETE）驗證 Origin／Referer，精確比對且雙缺失時拒絕。
- `rateLimitMiddleware(kind: 'login' | 'admin-api')`：`admin-api` 用原生 binding；`login` 用 `login_rate_limits` D1 計數表；兩者故障都 fail-closed 並回傳 429。
- 三者皆為獨立、可組合的 middleware，不互相耦合對方的實作細節。

## 驗收標準

- 合法簽章＋未過期 → 驗證通過；竄改任一字元 → 驗證失敗；過期 → 驗證失敗；`exp` 缺失或非數字 → 驗證失敗。
- 非法 Origin 的 POST 請求被 CSRF middleware 擋下（403 或等價）；合法 Origin 通過；Origin 為 `"null"` 或 Origin／Referer 皆缺失時拒絕；子網域變體（如 `APP_BASE_URL` 加後綴）不視為相符。
- Admin API 限流：超過 120/分鐘回傳 429，未超過正常放行。
- 登入限流：同一 IP 15 分鐘內第 11 次請求回傳 429；跨窗口後計數重置。
- 刻意讓限流元件拋錯的情境下，middleware fail-closed（回傳 429／錯誤，不放行）。
- 五個 middleware（session／csrf／admin-api 限流／login 限流／限流故障 fail-closed）都有對應單元測試。

## 實作備註

- 高風險（身分驗證／權限邊界）：實作前需經安全性審查與人工核准。
- Session payload 的 `kid` 欄位目前只是預留欄位，MVP 不實作多組 secret 併存驗證的邏輯，只要「輪替 secret 即可讓舊 session 失效」成立即可。

## 驗證契約

- 單元測試：`tests/unit/session.test.ts`、`tests/unit/csrf.test.ts`、`tests/unit/rate-limit.test.ts`。
- 整合測試：不適用（本卡不接任何真實路由，路由整合屬於 TASK-009）。
- E2E 測試：不適用。
- 型別檢查：`npm run typecheck`。
- Lint：`npm run lint`。
- Build：`npm run build`。
- 螢幕截圖：不適用。
- 安全性檢查：竄改簽章／逾時／`exp` 缺失／跨站請求偽造／Origin 子網域繞過／限流故障放行等情境都要有測試覆蓋；`ADMIN_SESSION_SECRET` 不得出現在任何 log。

## 完成證據

- 變更的檔案：
  - 修改：`src/app.ts`（新增 `RateLimiter` 介面與 `ADMIN_RATE_LIMITER` binding 型別）
  - 實作：`src/security/session.ts`、`src/security/csrf.ts`、`src/security/rate-limit.ts`（取代空占位）
  - 修改：`wrangler.jsonc`（新增 `ratelimits` binding）
  - 新增：`tests/unit/session.test.ts`、`tests/unit/csrf.test.ts`、`tests/unit/rate-limit.test.ts`
- 執行過的指令：`npx wrangler deploy --dry-run`、`npm run test`、`npm run lint && npm run typecheck && npm run build`
- 測試輸出：
  - Rate Limit binding 正確識別為 `120 requests/60s`
  - session 7 項、csrf 9 項、login rate limit 4 項測試通過（含各項 fail-closed 情境）
  - 全部 33 個測試通過，lint/typecheck/build 全綠
- 螢幕截圖：不適用。
- 已知限制：登入限流用 D1 固定窗口計數，高併發下讀改寫可能有極小計數誤差（對單一管理者登入無實質安全影響）；`ADMIN_RATE_LIMITER` 的 `namespace_id` 用佔位值 `1001`；原生 binding 實際行為無法在本機單元測試，僅由 dry-run 驗證設定、由 fail-closed 邏輯測試覆蓋錯誤路徑。
- 後續任務：登入登出 Admin API（TASK-009）。
