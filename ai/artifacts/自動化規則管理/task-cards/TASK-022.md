# TASK-022 — 自動化 CRUD Admin API（建立/編輯）

- Epic：自動化規則管理 ／ US：建立/編輯自動化｜後端｜風險：中｜狀態：完成｜dependsOn：TASK-006/009/011

## 目標
`POST /api/admin/automations`（建立，含關鍵字正規化去重＋公開回覆版本≤5）、`PATCH /:id`（局部更新）。掛 requireAdminAuth+CSRF+限流。

## 驗收 / 驗證
- 整合測試（含未登入 401、建立後關鍵字/版本數正確）；單元＋整合共 110 測試全過。

## 完成證據
- 檔案：`src/admin/automations.ts`、`src/admin/routes.ts`。
- 已知限制：GET 清單/單筆屬儀表板/貼文列表 Epic；dailyLimit 僅存不在此強制。
