# TASK-020 — Meta Graph API client（comments + private replies）

- Epic：留言比對與自動回覆引擎 ／ US：公開回覆執行
- 分軌：後端｜風險：中｜狀態：完成｜dependsOn：TASK-013

## 目標
`MetaClient`（集中 HTTP + 錯誤分類）、`replyToComment`（POST /{comment}/replies）、`sendPrivateReply`（POST /{account}/messages，button template）。Meta 錯誤碼映射到可/不可重試（190→token、10/200/803→權限、100→參數、368→政策）。

## 驗收 / 驗證
- 單元測試 `tests/unit/meta-client.test.ts`（6 項）：200 成功、token/權限不可重試、500/網路可重試、button 與純文字 payload。fetch mock。
- 全專案 99 測試通過。

## 完成證據
- 檔案：`src/meta/client.ts`、`src/meta/comments.ts`、`src/meta/private-replies.ts`。
- 已知限制：錯誤碼表涵蓋常見碼，其餘依 HTTP 狀態；實際端點/版本需以憑證上線驗證。
