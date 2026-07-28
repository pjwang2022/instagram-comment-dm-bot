# TASK-027 — 貼文列表 API
- Epic：自動化規則管理 ／ US：貼文列表頁｜後端｜風險：低｜狀態：完成
## 目標
GET `/api/admin/media`（分頁 + mediaType/automationStatus 篩選），附自動化狀態。
## 驗證
整合測試：列表、automationStatus 篩選、需登入。全專案 129 測試全過。
## 已知限制
本月觸發次數/成功率統計未計算（需彙總 automation_runs）。
