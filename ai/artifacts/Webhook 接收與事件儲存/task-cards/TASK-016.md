# AI-Ready 任務卡

## Metadata

- 任務：Webhook 事件唯一鍵產生
- 上層規格：`spec.md`（第 13.1 節）
- 上層 Epic：Webhook 接收與事件儲存
- 上層 User Story：事件接收、簽章驗證與冪等儲存（POST）
- 分軌：後端
- 前置任務（dependsOn）：TASK-001
- 狀態：完成
- 風險等級：低
- Agent owner：實作 agent
- 人工核准者：待指派

## 目標

實作 `deriveEventKey(input)`：有穩定事件 ID 時直接用；否則對 account/media/comment/type/timestamp 以固定順序串接後算 SHA-256 hex，作為 `webhook_events.event_key` 的冪等鍵。

## 需求 / 驗收標準

- 有 `stableEventId` → 原樣回傳。
- 無 → 同一組欄位恆得同一 64 字元 hex；不同 comment id 得不同鍵。

## 驗證契約

- 單元測試：`tests/unit/event-parser.test.ts`（3 項）。
- Lint / 型別 / Build。

## 完成證據

- 變更檔案：`src/webhook/event-parser.ts`、`tests/unit/event-parser.test.ts`。
- 測試輸出：3 項全過；全專案 78 測試通過。
- 已知限制：完整 POST 接收流程（把此鍵寫入 webhook_events 並做冪等 upsert、送 Queue）需 D1/Queue 接線，屬後續卡。
