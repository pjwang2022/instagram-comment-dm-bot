# TASK-021 — Queue Consumer 引擎（比對→回覆→結果）

- Epic：留言比對與自動回覆引擎 ／ US：公開回覆執行（引擎串接）
- 分軌：後端｜風險：高｜狀態：完成｜dependsOn：TASK-011/012/017/019/020

## 目標
`processCommentEvent`：查 webhook event→緊急停止→media→帳號(停用/熔斷)→active automation→排除(自己留言)→正規化→比對→冪等 run→公開回覆→Private Reply→寫 run 狀態與 api_attempts。掛上 queue handler（`consumer.ts`、`index.ts`）。**冪等**：queue 重試時只重試尚未成功的動作，確保每 Comment ID 各最多回一次。

## 驗收 / 驗證
- 整合測試 `tests/integration/engine.test.ts`（7 項）：完整比對→公開回覆+DM 各一次、重複處理不再送、不符/自己留言/緊急停止/無 active automation 略過、可重試 DM 失敗回 retry(30s) 且不重送公開回覆。
- 全專案 99 測試通過，lint/typecheck/build 全綠。

## 完成證據
- 檔案：`src/automation/engine.ts`、`src/queue/consumer.ts`、`src/index.ts`。
- 已知限制：只讀取熔斷狀態判斷（略過），觸發熔斷邏輯屬後續 Epic；真實 Meta 呼叫需憑證上線驗證。
