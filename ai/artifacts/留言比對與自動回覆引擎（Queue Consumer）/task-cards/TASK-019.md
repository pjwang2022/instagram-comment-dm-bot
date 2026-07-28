# TASK-019 — 冪等性檢查與 Automation Run 建立

- Epic：留言比對與自動回覆引擎 ／ US：冪等性檢查與 Automation Run 建立
- 分軌：後端｜風險：中｜狀態：完成｜dependsOn：TASK-006

## 目標
`ensureAutomationRun(db, input)`：靠 UNIQUE(automation_id, comment_id)，同一留言只建立一次 run；重複時回傳既有 run 且 created=false，供引擎判斷是否略過。

## 驗收 / 驗證
- 單元測試 `tests/unit/idempotency.test.ts`（3 項）：首次 created=true、重複 created=false 回既有 run、不同 automation 同 comment 各建一次。
- 全專案 99 測試通過。

## 完成證據
- 檔案：`src/automation/idempotency.ts`。
- 已知限制：select-then-insert 在高併發下有極小競態；Queue 同 message 序列處理下可忽略。
