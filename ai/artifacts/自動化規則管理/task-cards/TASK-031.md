# TASK-031 — 貼文管理頁 + 自動化編輯器（前端）

- Epic：自動化規則管理 ／ US：建立/編輯自動化｜前端｜狀態：完成

## 交付
- 共用 AppHeader（導覽：儀表板/貼文）
- MediaPage：貼文列表 + 每篇建立/編輯自動化 + 同步按鈕
- AutomationEditorPage：完整表單（名稱/比對模式/關鍵字 chip/公開回覆多版本/Private Reply/Opening DM/按鈕/每日上限/儲存/啟用/暫停）
- 新增元件（Nav/Select/Textarea/Toggle/Chips）登記回 design-system.md

## 驗證
Chrome headless 截圖確認 production 級視覺；全專案 129 測試綠、lint/typecheck/build 綠。

## 已知限制
admin email 寫死；分頁 UI 未做；執行紀錄詳情頁未做。
