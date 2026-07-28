# TASK-028 — 貼文同步邏輯（Meta media + scheduled）
- Epic：Instagram 帳號連接與貼文同步 ／ US：貼文與 Reels 同步｜後端｜風險：中｜狀態：完成
## 目標
`syncMediaItems`（upsert 不刪歷史）、`fetchRecentMedia`（GET /media）、`runScheduledSync`（掛 scheduled handler）。
## 驗證
單元 `tests/unit/media-sync.test.ts`（3）：新增、更新去重、跳過無 id。全專案 129 測試全過。
## 已知限制
Token 檢查 cron 專屬邏輯與手動同步 API 端點屬後續卡；真實抓取需 Meta 憑證上線驗證。
