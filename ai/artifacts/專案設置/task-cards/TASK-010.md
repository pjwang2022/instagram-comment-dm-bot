# AI-Ready 任務卡

## Metadata

- 任務：登入頁前端（功能性、無視覺樣式）
- 上層規格：`spec.md`（第 17.1 節）
- 上層 Epic：專案設置
- 上層 User Story：核心資料模型與認證框架基礎
- 分軌：前端
- 前置任務（dependsOn）：TASK-009
- 狀態：完成
- 風險等級：中
- Agent owner：實作 agent
- 人工核准者：待指派

## 目標

把 `admin/src/pages/LoginPage.tsx` 從純文字 placeholder 改成真正呼叫 `POST /api/admin/auth/login` 的功能性表單，涵蓋 spec.md 第 17.1 節的功能（Email／Password／登入錯誤顯示／登入頻率限制的錯誤提示），但**不套用任何視覺樣式**——UI 設計系統 User Story 定案後會有後續任務卡回頭套用 design token 與元件。

## 情境包（Context Pack）

- 相關檔案：
  - `admin/src/pages/LoginPage.tsx`
  - `admin/src/api/`（新增一個簡單的 fetch 封裝）
  - TASK-009 的 `POST /api/admin/auth/login`
- 既有模式：
  - 無（TASK-002 的登入頁目前只是文字 placeholder）。
- 假設：
  - 使用瀏覽器原生表單元素（`<form>`/`<input>`/`<button>`），不引入任何 UI 元件庫或自訂樣式；這是與使用者已確認的時序決策——先驗證 auth 流程端到端可行，視覺留給 UI 設計系統 Story 之後的任務卡。
  - Cookie 由瀏覽器自動處理（`fetch` 帶 `credentials: 'include'`），前端不需要自己讀寫 Session Cookie 內容。
- 未知事項：
  - 無。
- 允許變更的檔案：
  - `admin/src/pages/LoginPage.tsx`、`admin/src/api/**`、對應測試檔。
- 不得觸碰：
  - `src/`（後端）、`ai/`、`tools/kanban/`。

## 需求

- 表單欄位：Email、Password。
- 送出後呼叫 `POST /api/admin/auth/login`（`credentials: 'include'`）。
- 成功：導向 `/admin`（Dashboard 佔位頁）。
- 失敗：顯示後端回傳的錯誤訊息（不特別區分帳號不存在 vs 密碼錯誤，維持後端已統一的訊息）。
- 429（超過登入頻率限制）：顯示明確的「請稍後再試」提示。

## 驗收標準

- 正確帳密送出後導向 `/admin`。
- 錯誤帳密送出後顯示錯誤訊息，不導頁。
- 未使用任何色彩/字體/間距的自訂樣式決策（避免之後套用 design system 時要打掉重做)。

## 實作備註

- 這是刻意的過渡態：功能正確但「醜」，之後 UI 設計系統 User Story 定案後會有專門任務卡回頭套用視覺樣式，不在本卡處理。

## 驗證契約

- 單元測試：不適用（表單邏輯簡單，用整合測試涵蓋）。
- 整合測試：`admin` 側或 `tests/integration/` 涵蓋登入成功／失敗的前端行為（依實作時判斷用什麼工具跑，若需要新增測試相依套件，列出選項讓使用者選）。
- E2E 測試：手動以瀏覽器對本地 `wrangler dev` + `admin dev server` 走一次登入流程。
- 型別檢查：`npm run typecheck`。
- Lint：`npm run lint`。
- Build：`npm run build`。
- 螢幕截圖：不需要（本卡明確不做視覺設計，螢幕截圖留到套用視覺樣式的後續任務卡）。
- 安全性檢查：確認前端不會把密碼印在 console/log。

## 完成證據

- 變更的檔案：
  - 實作：`admin/src/pages/LoginPage.tsx`（功能性登入表單）
  - 新增：`admin/src/api/client.ts`（fetch 封裝，credentials: include）
- 執行過的指令：`cd admin && npx tsc --noEmit && npm run build`、`npx wrangler dev` + curl E2E、`npm run lint && npm run typecheck && npm run test && npm run build`
- 測試輸出：
  - 端到端於真實 wrangler dev 驗證：正確帳密 → 200+cookie；錯誤帳密／不存在帳號 → 同一 401；跨源／無 Origin → 403；同 IP 第 11 次登入 → 429；logout 清 cookie
  - admin build 成功（25 modules），全專案 41 測試通過，lint/typecheck/build 全綠
- 螢幕截圖：不需要（本卡明確不做視覺設計，截圖留給套用 design system 的後續卡）。
- 已知限制：前端未加獨立 React 測試框架（避免多一組 jsdom/testing-library 依賴），auth 流程伺服器端行為由 TASK-009 整合測試＋本卡 wrangler dev 手動 E2E 覆蓋（架構審查建議作法）；頁面為刻意無樣式過渡態。
- 後續任務：UI 設計系統 User Story 定案後，回頭套用視覺樣式的任務卡。
