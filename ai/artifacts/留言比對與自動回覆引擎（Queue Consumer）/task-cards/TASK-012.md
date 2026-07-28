# AI-Ready 任務卡

## Metadata

- 任務：關鍵字比對引擎
- 上層規格：`spec.md`（第 8.1 節）
- 上層 Epic：留言比對與自動回覆引擎（Queue Consumer）
- 上層 User Story：關鍵字比對引擎
- 分軌：後端
- 前置任務（dependsOn）：TASK-011
- 狀態：完成
- 風險等級：低
- Agent owner：實作 agent
- 人工核准者：待指派

## 目標

實作 `matchKeywords(normalizedComment, normalizedKeywords, matchType)`：支援 `contains_any` / `exact_any` / `all_comments` 三種模式，作用於已正規化的留言與關鍵字。附 `matchRawComment` 便利函式（內部先正規化）。

## 需求 / 驗收標準

- `contains_any`：留言包含任一關鍵字（子字串）即觸發，回傳第一個命中的關鍵字。
- `exact_any`：正規化後完全等於任一關鍵字才觸發。
- `all_comments`：一律觸發，`matchedKeyword` 為 null。
- 排除條件（自己留言、無 Comment/Media ID、停用、緊急停止等）屬 Consumer 引擎（後續卡），本卡只做純文字比對。

## 驗證契約

- 單元測試：`tests/unit/matcher.test.ts`（7 項）。
- Lint / 型別 / Build。

## 完成證據

- 變更檔案：`src/automation/matcher.ts`、`tests/unit/matcher.test.ts`。
- 測試輸出：7 項全過（含大小寫、全形對半形關鍵字命中）；全專案 68 測試通過。
- 已知限制：關鍵字順序決定 `contains_any`/`exact_any` 回傳哪個命中詞（依清單順序取第一個）。
