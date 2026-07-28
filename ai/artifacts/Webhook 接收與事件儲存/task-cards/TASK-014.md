# AI-Ready 任務卡

## Metadata

- 任務：Webhook 簽章驗證（純邏輯）
- 上層規格：`spec.md`（第 18.3 節）
- 上層 Epic：Webhook 接收與事件儲存
- 上層 User Story：事件接收、簽章驗證與冪等儲存（POST）
- 分軌：後端
- 前置任務（dependsOn）：TASK-001
- 狀態：完成
- 風險等級：中（安全性相關）
- Agent owner：實作 agent
- 人工核准者：待指派

## 目標

實作 `verifyWebhookSignature(appSecret, rawBody, signatureHeader)`：以 Meta App Secret 對原始 request body 算 HMAC-SHA256，與 `X-Hub-Signature-256`（`sha256=<hex>`）做 constant-time 比對。

## 需求 / 驗收標準

- 用原始 body bytes（不重新序列化 JSON）。
- constant-time 比對（等長 XOR 累加），不用 `===` 字串比較。
- 缺標頭、格式錯誤、hex 非法、body 被竄改、secret 不符 → 一律回 false（fail-closed）。
- 接受 `ArrayBuffer` 或 `Uint8Array` 的 body。
- 本卡只做純簽章驗證；完整 POST 接收流程（寫 webhook_events、送 Queue、冪等）屬同 User Story 的後續（需 D1/Queue 接線）卡。

## 驗證契約

- 單元測試：`tests/unit/signature.test.ts`（5 項）。
- Lint / 型別 / Build。

## 完成證據

- 變更檔案：`src/webhook/signature.ts`、`tests/unit/signature.test.ts`。
- 測試輸出：5 項全過（正確簽章、錯 secret、body 竄改、標頭缺失/格式錯誤、ArrayBuffer body）；全專案 68 測試通過。
- 已知限制：完整 Webhook POST 端點（GET challenge 已在別的 User Story、POST 的儲存與入列）尚待後續卡實作，本卡只交付簽章驗證原語。
