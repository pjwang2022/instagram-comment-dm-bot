# AI-Ready 任務卡

## Metadata

- 任務：Webhook 驗證端點（GET challenge）
- 上層規格：`spec.md`（第 11.1 節）
- 上層 Epic：Webhook 接收與事件儲存
- 上層 User Story：Webhook 驗證端點（GET challenge）
- 分軌：後端
- 前置任務（dependsOn）：TASK-001
- 狀態：完成
- 風險等級：低
- Agent owner：實作 agent
- 人工核准者：待指派

## 目標

實作 `GET /api/webhooks/meta/instagram`：`hub.mode=subscribe` 且 `hub.verify_token` 等於 `META_VERIFY_TOKEN` 時回傳 `hub.challenge`（純文字 200），否則回 403。掛上 Webhook 路由。

## 需求 / 驗收標準

- verify_token 正確 → 200 並原樣回 challenge。
- verify_token 錯誤或 mode 非 subscribe → 403。
- 這是一個完整、零資料依賴的 User Story（不需 D1／Queue／Meta 憑證）。

## 驗證契約

- 整合測試：`tests/integration/webhook-verify.test.ts`（3 項，透過 `app.fetch`）。
- Lint / 型別 / Build。

## 完成證據

- 變更檔案：`src/webhook/verify-webhook.ts`、`src/webhook/routes.ts`、`src/app.ts`（掛載 `/api/webhooks`）、`tests/integration/webhook-verify.test.ts`。
- 測試輸出：3 項全過；全專案 78 測試通過，lint/typecheck/build 全綠。
- 已知限制：無（本 User Story 完成）。
