# TASK-023 — 自動化啟用/暫停與啟用前驗證

- Epic：自動化規則管理 ／ US：自動化啟用/暫停｜後端｜風險：中｜狀態：完成｜dependsOn：TASK-022

## 目標
`POST /:id/activate`（spec §16.10 啟用前驗證：關鍵字、至少一回覆、Opening DM、HTTPS Button URL、Token、緊急停止）、`POST /:id/pause`。驗證邏輯抽到 `src/shared/validation.ts`（可單元測試）。

## 驗收 / 驗證
- 單元 `tests/unit/validation.test.ts` + 整合 `tests/integration/automations.test.ts`：有效啟用 200、缺關鍵字 422 附 reasons、pause 切狀態。全專案 110 測試全過。

## 完成證據
- 檔案：`src/admin/automations.ts`、`src/shared/validation.ts`。
- 已知限制：Token 健康度以 circuit_breaker_status 粗略判斷；完整 Token 檢查屬 Instagram 帳號 Epic cron。
