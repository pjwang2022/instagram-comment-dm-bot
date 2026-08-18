# 設計：IG 風格單頁後台 ＋ 限時動態自動化

日期：2026-08-18｜狀態：已與使用者確認

## 背景與目標

現行後台分「儀表板」與「貼文」兩頁，使用者認為過於複雜。目標：

1. 合併為單一 IG 個人頁式版面（頁首＋限動列＋貼文九宮格），啟用自動化的貼文有標記。
2. 新建自動化時，公開回覆預填三則繁中範本。
3. 編輯器「儲存／啟用」按鈕靠右、「啟用」改為填色主色按鈕。
4. 支援限時動態自動化：限動收到含關鍵字的回應即私訊指定內容（逐則限動設定）。

## 1. 單一 IG 版面

新首頁 `/`（取代 DashboardPage 與 MediaPage；`/media` 轉址到 `/`），由上到下：

### 1.1 IG 個人頁式頁首
- 左：帳號頭像＋`@username`（`instagram_accounts.username` / `profile_picture_url`；
  擴充 `GET /api/admin/system/status` 回傳 `account: { username, profilePictureUrl }`）。
- 中：今日統計列（符合／公開回覆／DM／失敗）。
- 右：「↻ 同步」與「緊急停止／恢復系統」小按鈕。
- 熔斷器非 `closed` 時才顯示紅色警示條＋「熔斷復歸」按鈕；平常不占空間。

### 1.2 限動圓圈列
- 顯示進行中的限時動態（`instagram_media.media_type = 'STORY'` 且未過期）。
- 圓形縮圖；已啟用自動化者加 IG 式漸層外框；點擊進編輯器（沿用
  `/media/:id/automation` 路由）。
- 無限動時顯示一行淡色提示（同步時會抓取進行中的限動）。

### 1.3 貼文九宮格
- 沿用現有 media grid（排除 STORY）。
- 已啟用自動化的貼文右上角顯示 ⚡ 標記（paused／draft 沿用現有 badge）。
- 格子下緣顯示該貼文成效數據：「觸發 X · DM Y」，失敗 > 0 時以紅字附「失敗 Z」。
  資料來源：`GET /api/admin/automations/overview` 的 stats，前端以 mediaId join。
- 點格子或按鈕進「設定自動化」。

### 1.4 待命／全帳號預設
- 縮成頁首下方一條精簡列：「＋ 待命自動化」「＋ 全帳號預設」兩顆小按鈕，
  既有項目以 chip 呈現（名稱＋狀態，點擊編輯）。

### 1.5 導覽
- AppHeader 導覽只留「首頁」與「帳號」。

## 2. 公開回覆預設範本

新建（無 `automationId`）時 `variants` 預填，可改可刪：

1. 已經私訊你囉，記得去小盒子看看 📩
2. 連結傳到你的 DM 了，去收信吧！
3. 私訊已發送給你 🙌 沒收到的話檢查一下訊息邀請

編輯既有自動化時不預填（以伺服器資料為準）。

## 3. 編輯器按鈕

- `btn-row` 靠右（`justify-content: flex-end`）。
- 「啟用」＝填色主色按鈕；「儲存」＝外框（outline）樣式；「暫停」維持紅色。

## 4. 限時動態自動化

### 4.1 資料模型（決議：重用 instagram_media，不新增資料表）
- 限動 upsert 進 `instagram_media`，`media_type = 'STORY'`；不需 migration。
- `automations` FK 綁定沿用；編輯器路由沿用。替代方案（story 專用表＋自動化型別）
  因需複製整套 CRUD 與 migration 而否決。

### 4.2 同步
- 手動同步與 cron 同一流程加抓 `GET /{ig-user-id}/stories`
  （fields：`id,media_type,media_url,thumbnail_url,timestamp`）。
- 不在 `/stories` 清單＝已過期（此端點對進行中限動是權威來源，不需逐篇查證）
  → 標 `deleted_at` 並暫停綁定的 active 自動化。
- 貼文的刪除偵測（逐篇查證）不套用於 STORY；STORY 亦不參與 next_post 綁定。

### 4.3 Webhook
- Meta App 需訂閱 `messages` 欄位；解析器只接受帶
  `entry[].messaging[].message.reply_to.story.id` 的事件，其他 DM（含 echo）一律忽略。
- 事件鍵：訊息 `mid`（穩定 ID）。`event_type = 'story_reply'`；
  `instagram_media_id` ← story id、`instagram_comment_id` ← mid（欄位重用）。
- 冪等、重送計數、Queue 流程全部沿用。

### 4.4 執行引擎
- 以 story 的 media 列找專屬自動化；限動不套用 `account_default`（留言語意）。
- 關鍵字比對回應文字（沿用 normalizer／matcher）。
- 跳過公開回覆（`public_reply_status = 'skipped'`）。
- 發 DM：recipient 改用 `{ id: <回應者 IGSID> }`（`sendPrivateReply` 加分支；
  現有留言路徑維持 `{ comment_id }`）。
- 限額 gate、每日上限、automation_runs、api_attempts 紀錄全部沿用
  （`instagram_comment_id` ← mid，unique 冪等成立）。

### 4.5 編輯器（STORY 情境）
- 偵測 media 為 STORY：隱藏「公開回覆」整個區塊，文案改為
  「回應限動的訊息含關鍵字 → 私訊」。
- 啟用檢核：STORY 自動化不要求公開回覆（`at_least_one_reply_required` 以
  private reply 滿足）。

### 4.6 部署與權限（手動步驟，寫入 README／spec）
- Meta App webhook 訂閱加 `messages` 欄位。
- Token 需 `instagram_business_manage_messages` 權限。
- 部署後需實測（Workers runtime 限制在 dev 測不出，見 CLAUDE.md）。

## 測試

- Unit：story webhook 解析（含忽略一般 DM／echo）、story 同步與過期標記、
  `sendPrivateReply` recipient 分支。
- Integration：story webhook → 冪等 → 引擎 → DM 成功／關鍵字不符／過期限動。
- 既有測試不得回歸（`npm run test`）。

## 相依現況

工作區有未提交的「貼文刪除偵測（deleted_at）」變更，本設計直接疊加其上。

## 明確不做

- 限動的全域預設自動化（使用者選逐則設定）。
- 一般 DM（非限動回應）的自動回覆。
- 貼文成效 hover 顯示（改為直接顯示在格子上）。
