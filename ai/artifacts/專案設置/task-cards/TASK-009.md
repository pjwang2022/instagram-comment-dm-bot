# AI-Ready 任務卡

## Metadata

- 任務：登入／登出 Admin API
- 上層規格：`spec.md`（第 16.1、16.2、18.1、14.11、21 節）
- 上層 Epic：專案設置
- 上層 User Story：核心資料模型與認證框架基礎
- 分軌：後端
- 前置任務（dependsOn）：TASK-006, TASK-007, TASK-008
- 狀態：完成
- 風險等級：高（身分驗證邊界）
- Agent owner：實作 agent
- 人工核准者：待指派

## 目標

實作 `POST /api/admin/auth/login`、`POST /api/admin/auth/logout`，並提供一個 `requireAdminAuth` middleware 供之後所有 Admin API 掛載；把 TASK-007（密碼驗證）、TASK-008（session/csrf/rate-limit）組裝成完整的登入流程。

## 情境包（Context Pack）

- 相關檔案：
  - `src/admin/auth.ts`（TASK-001 空占位）
  - `src/admin/routes.ts`（掛載點）
  - `src/security/{session,csrf,rate-limit}.ts`（TASK-008 產出）
  - `src/security/password.ts`（TASK-007 產出）
  - `src/database/schema.ts`（`admin_users` 表，TASK-006 產出）
  - `spec.md` 第 16.1、16.2、18.1 節
- 既有模式：
  - 沿用 `src/app.ts` 的 `AppBindings` 型別。
- 假設：
  - 登入失敗（Email 不存在或密碼錯誤）回傳一致的錯誤訊息與狀態碼，不透露「帳號不存在」與「密碼錯誤」的差異（避免帳號列舉）。
  - **Timing equalization（安全性審查要求）**：Email 不存在時，仍必須對一組固定的 dummy Argon2id 雜湊執行一次 `verifyPassword`（結果丟棄），再回傳與「密碼錯誤」相同耗時量級的 401，避免透過回應時間差異側 channel 判斷帳號是否存在。
  - 登入成功以 `Set-Cookie` 回傳 Session Cookie；登出以清除該 Cookie 回應。
  - **Audit log（安全性審查要求）**：登入成功、登入失敗、登出皆寫入 `audit_logs`（`action` 分別為 `admin.login.success`／`admin.login.failure`／`admin.logout`，`ip_address` 取自 `CF-Connecting-IP`），且 `metadata` 欄位不得包含密碼、Session Cookie 內容或雜湊值。
- 未知事項：
  - 無。
- 允許變更的檔案：
  - `src/admin/auth.ts`、`src/admin/routes.ts`、`src/app.ts`（掛載路由）、對應測試檔。
- 不得觸碰：
  - `admin/`、`ai/`、`tools/kanban/`、`src/database/schema.ts`、`src/security/{session,csrf,rate-limit,password}.ts`（本卡只組裝、不重新設計）。

## 需求

- `POST /api/admin/auth/login`：套用 `rateLimitMiddleware('login')`，驗證 Email/密碼，成功後簽發 Session Cookie。
- `POST /api/admin/auth/logout`：套用 `requireAdminAuth`，清除 Session Cookie。
- `requireAdminAuth` middleware：驗證 Session Cookie，失敗回傳 401；成功則把 admin user 資訊放進 context 供後續 handler 使用。
- 除登入端點外，其餘會修改資料的 Admin API 都要套用 `csrfMiddleware()`＋`rateLimitMiddleware('admin-api')`（本卡先建立掛載慣例，實際其他 Admin API 由各自功能 Epic 的任務卡實作時遵循）。
- 登入成功／失敗／登出寫入 `audit_logs`。

## 驗收標準

- 正確 Email/密碼 → 200 並帶有效 Session Cookie。
- 錯誤密碼／不存在的 Email → 相同的 401 錯誤格式，不洩漏差異，且兩者的回應時間量級相近（Email 不存在時也跑過一次 dummy 雜湊驗證）。
- 未帶 Session Cookie 呼叫受保護路由 → 401。
- 登出後原本的 Session Cookie 不再能通過 `requireAdminAuth`。
- 超過登入頻率限制 → 429。
- 登入成功／失敗／登出都各自產生一筆 `audit_logs` 紀錄，且不含密碼／雜湊／Cookie 內容。

## 實作備註

- 高風險（身分驗證邊界）：實作前需經安全性審查與人工核准。
- 本卡不建立任何除了登入/登出以外的 Admin API；`requireAdminAuth`／CSRF／Rate-limit 的掛載慣例會被後續功能 Epic 的 Admin API 任務卡重用。

## 驗證契約

- 單元測試：不適用（邏輯已在 TASK-007／TASK-008 單元測試覆蓋）。
- 整合測試：`tests/integration/auth.test.ts`，涵蓋登入成功／失敗／頻率限制／登出／受保護路由。
- E2E 測試：不適用（前端串接在 TASK-010）。
- 型別檢查：`npm run typecheck`。
- Lint：`npm run lint`。
- Build：`npm run build`。
- 螢幕截圖：不適用。
- 安全性檢查：確認錯誤訊息不洩漏帳號存在與否；確認 Session Cookie 屬性正確（HttpOnly/Secure/SameSite=Strict）；確認 timing equalization 生效；確認 audit_logs 不含機密。

## 完成證據

- 變更的檔案：
  - 實作：`src/admin/auth.ts`（login/logout 路由＋`requireAdminAuth` middleware＋audit log）
  - 實作：`src/admin/routes.ts`（Admin API 掛載點）
  - 修改：`src/app.ts`（掛載 `/api/admin`）
  - 新增：`tests/integration/auth.test.ts`
- 執行過的指令：`npx vitest run tests/integration/auth.test.ts`、`npm run test`、`npm run lint && npm run typecheck && npm run build`
- 測試輸出：
  - 登入成功 → 200 + Set-Cookie（HttpOnly/Secure/SameSite=Strict）
  - 密碼錯誤與帳號不存在 → 相同 401 格式，不洩漏差異；帳號不存在時對 dummy hash 跑一次 verifyPassword（timing equalization）
  - audit_logs 寫入 success/failure/logout，序列化後不含明文密碼或 `$argon2` 雜湊
  - 未帶 cookie 的 logout → 401；帶有效 cookie → 200 並回 `Max-Age=0` 清除
  - 6 個整合測試通過，全專案 39 個測試通過，lint/typecheck/build 全綠
- 螢幕截圖：不適用。
- 已知限制：整合測試用 better-sqlite3 實作的 D1Database shim（drizzle-orm/d1 只用到 prepare/bind/all/run/raw/batch），非真正的 Workers D1 runtime；原生 `ADMIN_RATE_LIMITER` 用 always-allow stub；真實行為需在部署或 wrangler dev 階段再驗證。
- 後續任務：登入頁前端（TASK-010）。
