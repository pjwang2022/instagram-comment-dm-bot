# TASK-025 — 自動熔斷評估邏輯

- Epic：熔斷與緊急停止機制 ／ US：自動熔斷邏輯｜後端｜風險：中｜狀態：完成

## 目標
`evaluateCircuitBreaker(input)` 純函式（spec §19）：連續5次token/權限錯誤、政策限制、5分鐘內錯誤率>20%、每日上限 → 回 {open, reason}。

## 驗收 / 驗證
- 單元 `tests/unit/circuit-breaker.test.ts`（7）：健康不開、每日上限、政策、連續錯誤、錯誤率、窗口外忽略。全專案 121 測試全過。

## 完成證據
- 檔案：`src/monitoring/circuit-breaker.ts`。
- 已知限制：純評估邏輯；接進引擎每次發送後寫 circuit_breaker_status 屬後續接線（引擎已會讀該狀態並在 open 時略過）。
