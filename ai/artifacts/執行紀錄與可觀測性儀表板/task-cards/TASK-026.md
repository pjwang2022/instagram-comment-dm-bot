# TASK-026 — 執行紀錄列表與詳情 API
- Epic：執行紀錄與可觀測性儀表板 ／ US：執行紀錄列表與篩選｜後端｜風險：低｜狀態：完成
## 目標
GET `/api/admin/automation-runs`（篩選 status/mediaId/automationId/date + 分頁）、`/:id`（含 api_attempts）。
## 驗證
整合 `tests/integration/admin-read.test.ts`：401、列表、篩選、詳情+attempts。全專案 129 測試全過。
## 已知限制
keyword 篩選未實作（需 join）；詳情安全（*_redacted 不含 Token）。
