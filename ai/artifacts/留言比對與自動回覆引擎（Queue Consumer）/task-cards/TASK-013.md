# AI-Ready 任務卡

## Metadata

- 任務：錯誤分類與重試策略
- 上層規格：`spec.md`（第 12.3 節）
- 上層 Epic：留言比對與自動回覆引擎（Queue Consumer）
- 上層 User Story：錯誤分類與重試策略
- 分軌：後端
- 前置任務（dependsOn）：TASK-001
- 狀態：完成
- 風險等級：低
- Agent owner：實作 agent
- 人工核准者：待指派

## 目標

實作 `isRetryable(failure)`（`src/meta/errors.ts`）與重試排程（`src/queue/retry-policy.ts`）：區分可重試／不可重試錯誤，並提供 30 秒／2 分鐘／10 分鐘、最多三次的重試延遲序列。

## 需求 / 驗收標準

- 可重試：HTTP 429／500／502／503／504、網路錯誤、Timeout。
- 不可重試：Token 無效、權限不足、Comment 不存在、格式錯誤、自動化停用、政策限制、使用者不允許接收；其他 4xx（非 429）亦不可重試。
- 明確的 `nonRetryableReason` 優先於可重試的 HTTP 狀態。
- `nextRetryDelaySeconds(retryCount)`：0→30、1→120、2→600、≥3→null；`MAX_RETRIES = 3`。

## 驗證契約

- 單元測試：`tests/unit/retry.test.ts`（7 項）。
- Lint / 型別 / Build。

## 完成證據

- 變更檔案：`src/meta/errors.ts`、`src/queue/retry-policy.ts`、`tests/unit/retry.test.ts`。
- 測試輸出：7 項全過；全專案 68 測試通過。
- 已知限制：本卡只做分類與延遲計算；實際把延遲餵回 Cloudflare Queue（`retry({ delaySeconds })`）屬 Consumer 引擎後續卡。
