# TASK-030 — 自動化編輯器後端補強

- Epic：自動化規則管理 ／ US：建立/編輯自動化｜後端｜狀態：完成

## 交付
GET /api/admin/automations/:id（automation+keywords+variants 供編輯器預填）、PATCH 整批替換 keywords/variants、POST /api/admin/media/sync（手動同步）。

## 驗證
端到端 curl（建立→GET→啟用→列表 active）；手動同步實測抓 25 篇真實貼文；全專案 129 測試綠。
