# AI-Ready 任務卡

## Metadata

- 任務：留言文字正規化
- 上層規格：`spec.md`（第 8.2 節）
- 上層 Epic：留言比對與自動回覆引擎（Queue Consumer）
- 上層 User Story：留言文字正規化
- 分軌：後端
- 前置任務（dependsOn）：TASK-001
- 狀態：完成
- 風險等級：低
- Agent owner：實作 agent
- 人工核准者：待指派

## 目標

實作 `normalizeCommentText(input)`：比對前正規化留言文字（trim、小寫、全形英數/空白轉半形、連續空白合併），保留中文與 Emoji，不修改原始留言。

## 需求 / 驗收標準

- 對照 spec.md 第 8.2 節範例：`  我想要 ＡＤＨＤ 連結  ` → `我想要 adhd 連結`。
- 涵蓋：大小寫、全形轉半形（含 U+3000 全形空白）、連續空白合併、前後空白、保留中文、保留 Emoji。

## 驗證契約

- 單元測試：`tests/unit/normalizer.test.ts`（8 項）。
- Lint / 型別 / Build：`npm run lint && npm run typecheck && npm run build`。

## 完成證據

- 變更檔案：`src/automation/normalizer.ts`、`tests/unit/normalizer.test.ts`。
- 測試輸出：8 項全過；全專案 68 測試通過，lint/typecheck/build 全綠。
- 已知限制：只轉換 U+FF01–U+FF5E 全形 ASCII 與 U+3000 全形空白；其他 Unicode 空白（如 NBSP）交由 `\s+` 合併處理。
