# AI-Ready 任務卡

## Metadata

- 任務：公開回覆版本隨機選擇
- 上層規格：`spec.md`（第 9 節、第 26 節）
- 上層 Epic：留言比對與自動回覆引擎（Queue Consumer）
- 上層 User Story：公開回覆執行
- 分軌：後端
- 前置任務（dependsOn）：TASK-001
- 狀態：完成
- 風險等級：低
- Agent owner：實作 agent
- 人工核准者：待指派

## 目標

實作 `selectPublicReply(variants, randomFn?)`：從 `enabled` 的公開回覆版本中均勻隨機選一則；可注入亂數源方便測試。

## 需求 / 驗收標準

- 只選 `enabled` 的版本；全部停用回 null。
- 注入亂數源時結果可決定（測試用）；`randomFn` 回傳 1 時不越界。

## 驗證契約

- 單元測試：`tests/unit/public-reply.test.ts`（4 項）。
- Lint / 型別 / Build。

## 完成證據

- 變更檔案：`src/automation/public-reply.ts`、`tests/unit/public-reply.test.ts`。
- 測試輸出：4 項全過；全專案 78 測試通過。
- 已知限制：本卡只做選擇邏輯；實際呼叫 Meta 公開回覆 API、每 Comment ID 只回一次的冪等控制屬 Consumer 引擎後續卡（需 Meta 憑證與 D1）。
