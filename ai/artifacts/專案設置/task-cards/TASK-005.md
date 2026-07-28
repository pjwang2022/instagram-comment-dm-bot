# AI-Ready 任務卡

## Metadata

- 任務：JSON Structured Logging 基礎模組（含 Secret 遮蔽）
- 上層規格：`spec.md`（第 21 節）
- 上層 Epic：專案設置
- 上層 User Story：環境變數與金鑰設定
- 分軌：後端
- 前置任務（dependsOn）：無
- 狀態：完成
- 風險等級：低
- Agent owner：實作 agent
- 人工核准者：待指派

## 目標

實作 `src/monitoring/logger.ts`：提供全系統共用的 JSON structured logging 函式，輸出 spec.md 第 21 節列出的必要欄位，並依 `LOG_LEVEL` 控制輸出層級；同時確保呼叫端無法不小心把 Secret／Session Cookie／完整密碼寫進 log（例如提供白名單欄位介面，而非任意物件直接序列化）。

## 情境包（Context Pack）

- 相關檔案：
  - `src/monitoring/logger.ts`（TASK-001 建立的空佔位模組）
  - `src/app.ts` 的 `AppBindings`（`LOG_LEVEL` 型別已存在）
  - `spec.md` 第 21 節
- 既有模式：
  - 無既有 logging 實作。
- 假設：
  - 這裡只建立可重用的 logger 函式與型別，不在本卡強制所有既有路由都改用它（因為目前只有一個 health check 路由，尚無真正的業務欄位可帶入）；後續各功能 Epic 的任務卡在新增路由/處理邏輯時應改用這個 logger。
- 未知事項：
  - 無。
- 允許變更的檔案：
  - `src/monitoring/logger.ts`、`src/shared/types.ts`（如需共用型別）、對應測試檔。
- 不得觸碰：
  - `admin/`、`ai/`、`tools/kanban/`。

## 需求

- 定義一個 `LogFields` 型別，涵蓋 spec.md 第 21 節列出的必要欄位（`timestamp`／`level`／`requestId`／`webhookEventId`／`automationRunId`／`instagramMediaId`／`instagramCommentId`／`action`／`durationMs`／`httpStatus`／`metaErrorCode`／`metaTraceId`），除 `level`／`action`／`timestamp` 外皆為可選欄位。
- 提供 `log(level, fields)` 或等價函式，輸出單行 JSON 到 `console.log`／`console.error`（依 level），並依傳入的 `LOG_LEVEL`（`debug`/`info`/`warn`/`error`）決定是否輸出（低於設定層級的訊息不輸出）。
- 型別介面本身不包含 `accessToken`／`appSecret`／`sessionCookie`／`password` 等欄位，從介面設計上防止呼叫端直接把這些值放進 log。

## 驗收標準

- 呼叫 `log('info', { action: 'test', requestId: 'abc' })` 會輸出符合欄位結構的單行 JSON。
- 呼叫端無法透過型別系統把任意物件（例如整個 request headers 或 env）直接塞進 log fields。
- 設定 `LOG_LEVEL=error` 時，`log('info', ...)` 不輸出。
- 單元測試涵蓋：欄位輸出正確、層級過濾正確。

## 實作備註

- 不在本卡處理實際各路由的埋點（那是各功能 Epic 任務卡的責任），只交付共用工具本身。

## 驗證契約

- 單元測試：`tests/unit/logger.test.ts`，涵蓋欄位輸出與 LOG_LEVEL 過濾。
- 整合測試：不適用。
- E2E 測試：不適用。
- 型別檢查：`npm run typecheck`。
- Lint：`npm run lint`。
- Build：`npm run build`。
- 螢幕截圖：不適用。
- 安全性檢查：確認型別定義不包含機密欄位名稱。

## 完成證據

- 變更的檔案：
  - 修改：`src/monitoring/logger.ts`（取代 TASK-001 的佔位模組）
  - 新增：`tests/unit/logger.test.ts`
- 執行過的指令：
  - `npm run test`
  - `npm run lint && npm run typecheck && npm run build`
  - `grep -in 'accessToken|appSecret|sessionCookie|password' src/monitoring/logger.ts`
- 測試輸出：
  - `npm run test` → 4 個測試通過（health + 3 個 logger 測試）
  - lint/typecheck/build 全數通過
  - grep 確認 `LogFields` 型別未包含任何機密欄位名稱
- 螢幕截圖：不適用。
- 已知限制：目前沒有任何路由實際呼叫這個 logger（本卡只交付共用工具本身），各功能 Epic 新增路由/Consumer 時需自行改用它才會真正產生 log 輸出。
- 後續任務：各功能 Epic 實作路由/Consumer 時改用此 logger。
