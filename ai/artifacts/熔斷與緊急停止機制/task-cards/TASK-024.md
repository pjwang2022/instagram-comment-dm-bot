# TASK-024 — 緊急停止/恢復與系統狀態 API

- Epic：熔斷與緊急停止機制 ／ US：管理者緊急停止與恢復｜後端｜風險：中｜狀態：完成

## 目標
`POST /system/emergency-stop`、`/resume`（切 system_settings.emergency_stop + audit log）、`GET /system/status`（緊急停止/熔斷狀態/今日統計）。引擎已在 emergency_stop 時略過發送。

## 驗收 / 驗證
- 整合 `tests/integration/system.test.ts`（4）：未登入 401、切換反映於 status、audit log、熔斷狀態回報。全專案 121 測試全過。

## 完成證據
- 檔案：`src/admin/system.ts`、`src/admin/routes.ts`。
- 已知限制：Queue 深度未納入 status（Cloudflare Queue 無同步查詢）。
