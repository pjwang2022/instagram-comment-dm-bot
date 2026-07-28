# TASK-018 — Webhook POST 接收流程（簽章→儲存→入列）

- Epic：Webhook 接收與事件儲存 ／ US：事件接收、簽章驗證與冪等儲存（POST）
- 分軌：後端｜風險：中｜狀態：完成｜dependsOn：TASK-006/014/016

## 目標
`POST /api/webhooks/meta/instagram`：讀 raw body → 驗簽（TASK-014）→ 解析 comment events → 事件唯一鍵（TASK-016）→ 冪等寫 `webhook_events`（重送 duplicate_count++、不重複入列）→ 送 Queue → 立即回 200。禁止等待任何 Meta API（spec §11.2）。

## 驗收 / 驗證
- 整合測試 `tests/integration/webhook-receive.test.ts`（4 項）：無效簽章 401 且不入列、有效簽章寫入並入列、重送 duplicate_count++ 不重複入列、空事件回 200。
- 全專案 99 測試通過，lint/typecheck/build 全綠。

## 完成證據
- 檔案：`src/webhook/receive-webhook.ts`、`src/queue/producer.ts`、`src/webhook/routes.ts`、`src/webhook/event-parser.ts`（新增 extractCommentEvents/findCommentEvent）、`tests/helpers/d1-shim.ts`（抽共用）。
- 已知限制：多筆 comment change 各寫一列（共用 rawPayload），MVP 可接受。
