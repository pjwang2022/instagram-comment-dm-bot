# Instagram 留言關鍵字自動私訊系統

## MVP 系統技術規格書

**文件版本：** 1.0
**專案代號：** IG Comment DM Bot
**系統性質：** 單一管理者、自用工具
**部署平台：** Cloudflare
**整合平台：** Meta Instagram 官方 API
**文件日期：** 2026 年 7 月 28 日

---

# 1. 專案目標

建立一套自行部署的 Instagram 留言自動化工具。

管理者可以針對多篇 Instagram 貼文或 Reels 設定：

* 留言觸發關鍵字。
* 公開留言回覆內容。
* Opening DM 內容。
* 外部連結按鈕。
* 自動化啟用或停用。
* 每次執行成功與失敗紀錄。

系統只處理使用者主動在指定貼文下留下的留言，不主動向未互動使用者發送訊息。

核心流程：

```text
使用者留言
    ↓
Instagram Webhook
    ↓
比對貼文與關鍵字
    ↓
公開回覆原留言
    ↓
透過 Private Reply 傳送一則 DM
```

---

# 2. MVP 範圍

## 2.1 包含功能

MVP 必須包含：

1. 單一 Instagram Professional Account。
2. Instagram 貼文與 Reels 同步。
3. 多篇貼文管理。
4. 每篇貼文設定一組自動化。
5. 每組自動化設定多個關鍵字。
6. 留言關鍵字比對。
7. 公開回覆原留言。
8. 傳送一則 Private Reply DM。
9. DM 內提供一個外部連結按鈕。
10. Webhook 原始事件保存。
11. 執行成功及失敗紀錄。
12. 防止重複發送。
13. 暫時性錯誤重試。
14. Token、權限及政策錯誤自動停用。
15. 全系統緊急停止功能。
16. 管理者登入。
17. 限時動態自動化：限動回應含關鍵字即自動私訊（逐則限動設定，見第 30 節）。

## 2.2 不包含功能

MVP 不包含：

* 多個 Instagram 帳號。
* 多租戶。
* SaaS 計費。
* 主動群發 DM。
* Broadcast。
* 未互動使用者行銷。
* 多步驟 Flow Builder。
* AI 客服。
* CRM。
* 聯絡人標籤。
* Facebook Messenger。
* WhatsApp。
* Instagram 密碼登入。
* Selenium。
* Playwright。
* 瀏覽器模擬操作。
* Instagram 私有 API。
* 任何規避 Meta Rate Limit 的機制。

---

# 3. 系統架構

## 3.1 Cloudflare 架構

本系統採用以下 Cloudflare 服務：

```text
Cloudflare Workers
Cloudflare D1
Cloudflare Queues
Cloudflare Static Assets
Cloudflare Secrets
Cloudflare Workers Logs
Cloudflare Cron Triggers
```

Cloudflare D1 是可直接與 Workers 綁定的 Serverless SQL 資料庫；免費方案單一資料庫上限目前為 500 MB、帳號總儲存空間為 5 GB，足以支援本 MVP。

## 3.2 架構圖

```text
Instagram 使用者
        │
        │ 留言
        ▼
Instagram / Meta
        │
        │ Webhook
        ▼
Cloudflare Worker
Webhook Endpoint
        │
        ├── 驗證 Meta Signature
        ├── 儲存 Webhook Event
        ├── 發送 Queue Message
        └── 立即回傳 200 OK
                    │
                    ▼
           Cloudflare Queues
                    │
                    ▼
            Queue Consumer
                    │
                    ├── 查詢自動化規則
                    ├── 比對留言關鍵字
                    ├── 冪等性檢查
                    ├── 公開回覆留言
                    ├── 傳送 Private Reply
                    └── 保存執行結果
                            │
                            ▼
                      Cloudflare D1
                            │
                            ▼
                   React 管理後台
```

## 3.3 架構原則

系統必須遵守：

* Serverless First。
* Event Driven。
* 單一 Worker 優先。
* 不使用長駐伺服器。
* 不使用 Docker。
* 不使用 VPS。
* 不使用 Redis。
* 不使用 PostgreSQL。
* 不使用 Kubernetes。
* 不拆分微服務。
* 不進行過早最佳化。
* 優先保持程式碼簡單、可追蹤及可維護。

---

# 4. 技術選型

## 4.1 程式語言

全專案統一使用：

```text
TypeScript
```

不得混用 Python 後端。

## 4.2 Web Framework

使用：

```text
Hono
```

負責：

* Webhook API。
* Admin API。
* Authentication Middleware。
* Queue Consumer。
* Meta API Client。

## 4.3 管理後台

使用：

```text
React
Vite
React Router
TypeScript
```

管理後台不需要：

* SSR。
* SEO。
* Next.js Server Components。

管理後台應建置成靜態檔案，由 Cloudflare Workers Static Assets 提供。Cloudflare 官方目前對靜態資產請求不另外計費，只有實際進入 Worker 程式的請求才依 Workers 使用量計算。

## 4.4 資料庫

使用：

```text
Cloudflare D1
```

ORM 使用：

```text
Drizzle ORM
```

## 4.5 非同步處理

使用：

```text
Cloudflare Queues
```

Webhook 收到事件後，不得直接等待 Meta API 呼叫完成。

## 4.6 Secret 管理

使用：

```text
Cloudflare Secrets
```

保存：

* Meta App Secret。
* Meta Verify Token。
* Instagram Access Token。
* 管理者 Session Secret。

不得將 Secret：

* 寫入程式碼。
* 提交至 Git。
* 傳送至前端。
* 寫入一般 Log。

---

# 5. Cloudflare Resources

系統需要建立以下資源。

## 5.1 Worker

名稱建議：

```text
ig-comment-dm-bot
```

同一個 Worker 負責：

* Webhook 驗證。
* Webhook 接收。
* Admin API。
* Static Assets。
* Queue Producer。
* Queue Consumer。
* Cron Trigger。

MVP 不拆成多個 Worker。

## 5.2 D1 Database

名稱建議：

```text
ig-comment-dm-db
```

Binding：

```text
DB
```

## 5.3 Queue

名稱建議：

```text
ig-comment-events
```

Producer Binding：

```text
COMMENT_QUEUE
```

Consumer 使用同一個 Worker。

## 5.4 自訂網域

建議：

```text
igbot.example.com
```

Webhook URL：

```text
https://igbot.example.com/api/webhooks/meta/instagram
```

管理後台：

```text
https://igbot.example.com/admin
```

---

# 6. 使用者角色

MVP 只有一個角色：

```text
Administrator
```

管理者可以：

* 登入後台。
* 查看 Instagram 帳號狀態。
* 同步貼文。
* 建立自動化。
* 修改自動化。
* 啟用或停用自動化。
* 查看 Webhook。
* 查看執行紀錄。
* 查看 API 錯誤。
* 緊急停止所有自動化。

不建立：

* Organization。
* Team。
* Role。
* Permission。
* Subscription。

---

# 7. 核心使用流程

## 7.1 建立自動化

1. 管理者登入。
2. 進入貼文管理頁面。
3. 點擊同步 Instagram 貼文。
4. 系統取得近期貼文與 Reels。
5. 管理者選擇一篇貼文。
6. 輸入自動化名稱。
7. 選擇關鍵字比對模式。
8. 輸入一個或多個關鍵字。
9. 輸入公開回覆版本。
10. 輸入 Opening DM。
11. 輸入按鈕文字及網址。
12. 儲存並啟用自動化。

## 7.2 留言事件

1. 使用者在貼文或 Reel 留言。
2. Meta 將留言事件傳到 Webhook。
3. Worker 驗證請求簽章。
4. Worker 建立事件唯一鍵。
5. Worker 將原始 Payload 寫入 D1。
6. Worker 將事件送到 Cloudflare Queue。
7. Worker 立即回傳 `200 OK`。
8. Queue Consumer 讀取事件。
9. Consumer 依 Media ID 查詢自動化。
10. Consumer 標準化留言文字。
11. Consumer 比對關鍵字。
12. 符合時建立 `automation_run`。
13. 呼叫 Meta API 公開回覆留言。
14. 呼叫 Meta API 傳送 Private Reply。
15. 將結果及錯誤寫入 D1。

---

# 8. 關鍵字比對

## 8.1 支援模式

### `contains_any`

包含任一關鍵字即觸發。

例如設定：

```text
adhd
github
想要
```

以下留言會觸發：

```text
我想要 ADHD 的 GitHub
```

### `exact_any`

留言正規化後完全等於任一關鍵字。

例如：

```text
adhd
```

以下會觸發：

```text
ADHD
```

以下不觸發：

```text
我想要 ADHD
```

### `all_comments`

所有留言皆觸發。

此模式必須由管理者明確選擇。

## 8.2 文字正規化

比對前必須：

* 移除前後空白。
* 英文字母轉小寫。
* 全形英數轉半形。
* 連續空白合併為一個空白。
* 保留中文。
* 保留 Emoji。
* 不修改原始留言。

範例：

```text
原始：  我想要 ＡＤＨＤ 連結  
結果：我想要 adhd 連結
```

## 8.3 排除條件

以下事件不得觸發：

* 留言者是自己的 IG 帳號。
* 沒有 Comment ID。
* 沒有 Media ID。
* 自動化已停用。
* Instagram 帳號已停用。
* 系統處於緊急停止狀態。
* Comment ID 已處理。
* 留言來自未設定自動化的貼文。

---

# 9. 公開留言回覆

每組自動化可以設定：

* 是否啟用公開回覆。
* 1 至 5 個公開回覆版本。

例如：

```text
已經私訊給你囉，請查看訊息 📩
```

```text
連結已送到你的 DM 囉！
```

```text
收到，請打開私訊查看 🙌
```

系統從已啟用版本中隨機選擇一則。

限制：

* 每個 Comment ID 最多公開回覆一次。
* 公開回覆失敗不得造成同一留言重複回覆。
* 不得在留言中加入與觸發內容無關的廣告。
* 不得提及無關帳號。
* 多版本文字僅改善留言區觀感，不得宣稱可規避 Meta 風控。

---

# 10. Private Reply DM

符合條件後，系統使用該留言的 Comment ID 發送一則 Private Reply。

Opening DM 支援：

* 一段文字。
* 一個外部網址按鈕。
* 一個按鈕標題。

範例：

```text
這是影片中介紹的 i-have-adhd GitHub 專案。

點擊下方按鈕即可查看 👇
```

按鈕：

```text
開啟 GitHub
```

網址：

```text
https://github.com/ayghri/i-have-adhd
```

限制：

* 每個 Comment ID 最多傳送一次。
* 不傳送第二則自動追蹤訊息。
* 不將留言者加入永久推播名單。
* 不將一次留言視為永久行銷同意。
* 不使用留言者 ID 主動建立其他行銷對話。
* 不使用 Private Reply 以外的方式主動私訊陌生使用者。

---

# 11. Webhook API

## 11.1 Webhook 驗證

```http
GET /api/webhooks/meta/instagram
```

Query Parameters：

```text
hub.mode
hub.verify_token
hub.challenge
```

當 Verify Token 正確時回傳：

```text
hub.challenge
```

Verify Token 錯誤時回傳：

```http
403 Forbidden
```

## 11.2 Webhook 接收

```http
POST /api/webhooks/meta/instagram
```

處理順序：

1. 讀取原始 Request Body。
2. 驗證 Meta Signature。
3. 解析 JSON。
4. 驗證必要欄位。
5. 建立事件唯一鍵。
6. 寫入 `webhook_events`。
7. 發送 Queue Message。
8. 回傳 `200 OK`。

禁止在 Webhook Request 中等待：

* Meta 公開留言 API。
* Meta Private Reply API。
* 完整規則處理。

---

# 12. Queue 設計

## 12.1 Queue Message

```json
{
  "webhookEventId": "uuid",
  "eventKey": "string",
  "instagramAccountId": "string",
  "instagramMediaId": "string",
  "instagramCommentId": "string"
}
```

Queue Message 不應包含：

* Access Token。
* App Secret。
* 完整敏感設定。

## 12.2 Consumer 流程

```text
取得 Queue Message
    ↓
查詢 Webhook Event
    ↓
查詢 Instagram Account
    ↓
查詢 Media
    ↓
查詢 Active Automation
    ↓
執行冪等檢查
    ↓
比對關鍵字
    ↓
建立 Automation Run
    ↓
公開回覆
    ↓
Private Reply
    ↓
更新結果
```

## 12.3 Queue Retry

可重試錯誤：

* HTTP 429。
* HTTP 500。
* HTTP 502。
* HTTP 503。
* HTTP 504。
* 網路錯誤。
* Timeout。

不可重試：

* Token 無效。
* 權限不足。
* Comment ID 不存在。
* Request 格式錯誤。
* 自動化停用。
* Meta 政策限制。
* 使用者不允許接收訊息。

應用程式層重試策略：

```text
第一次：30 秒後
第二次：2 分鐘後
第三次：10 分鐘後
```

最多三次。

---

# 13. 冪等性

Meta 可能重送 Webhook，因此系統必須避免重複處理。

## 13.1 Webhook Event Key

若 Meta Payload 有穩定事件 ID，直接使用該 ID。

否則使用以下欄位產生 SHA-256：

```text
instagram_account_id
instagram_media_id
instagram_comment_id
event_type
event_timestamp
```

## 13.2 Automation Run 唯一限制

```sql
UNIQUE (
  automation_id,
  instagram_comment_id
)
```

同一事件再次抵達時：

* Webhook 回傳成功。
* `duplicate_count` 加一。
* 不再次公開回覆。
* 不再次發送 DM。

---

# 14. 資料庫設計

## 14.1 `admin_users`

```sql
CREATE TABLE admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

## 14.2 `system_settings`

```sql
CREATE TABLE system_settings (
  id TEXT PRIMARY KEY,
  emergency_stop INTEGER NOT NULL DEFAULT 0,
  max_public_replies_per_minute INTEGER,
  max_private_replies_per_minute INTEGER,
  max_public_replies_per_day INTEGER,
  max_private_replies_per_day INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

## 14.3 `instagram_accounts`

```sql
CREATE TABLE instagram_accounts (
  id TEXT PRIMARY KEY,
  instagram_account_id TEXT NOT NULL UNIQUE,
  username TEXT,
  profile_picture_url TEXT,
  account_type TEXT,
  token_expires_at TEXT,
  webhook_subscribed INTEGER NOT NULL DEFAULT 0,
  automation_enabled INTEGER NOT NULL DEFAULT 1,
  circuit_breaker_status TEXT NOT NULL DEFAULT 'closed',
  last_webhook_received_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Access Token 原則上保存在 Cloudflare Secret。

由於 MVP 只有一個 Instagram 帳號，不需要將 Token 寫入 D1。

## 14.4 `instagram_media`

```sql
CREATE TABLE instagram_media (
  id TEXT PRIMARY KEY,
  instagram_account_id TEXT NOT NULL,
  instagram_media_id TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL,
  caption TEXT,
  thumbnail_url TEXT,
  permalink TEXT,
  published_at TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (instagram_account_id)
    REFERENCES instagram_accounts(id)
);
```

## 14.5 `automations`

```sql
CREATE TABLE automations (
  id TEXT PRIMARY KEY,
  instagram_media_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  match_type TEXT NOT NULL DEFAULT 'contains_any',
  public_reply_enabled INTEGER NOT NULL DEFAULT 1,
  private_reply_enabled INTEGER NOT NULL DEFAULT 1,
  opening_dm TEXT,
  button_text TEXT,
  button_url TEXT,
  daily_limit INTEGER,
  exclude_own_comments INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (instagram_media_id)
    REFERENCES instagram_media(id)
);
```

`status` 可使用：

```text
draft
active
paused
disabled
```

## 14.6 `automation_keywords`

```sql
CREATE TABLE automation_keywords (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  normalized_keyword TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (automation_id)
    REFERENCES automations(id),
  UNIQUE (automation_id, normalized_keyword)
);
```

## 14.7 `public_reply_variants`

```sql
CREATE TABLE public_reply_variants (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL,
  message TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (automation_id)
    REFERENCES automations(id)
);
```

## 14.8 `webhook_events`

```sql
CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  instagram_account_id TEXT,
  instagram_media_id TEXT,
  instagram_comment_id TEXT,
  raw_payload TEXT NOT NULL,
  signature_valid INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL,
  last_received_at TEXT NOT NULL,
  processed_at TEXT
);
```

## 14.9 `automation_runs`

```sql
CREATE TABLE automation_runs (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL,
  webhook_event_id TEXT,
  instagram_comment_id TEXT NOT NULL,
  instagram_media_id TEXT NOT NULL,
  commenter_id TEXT,
  commenter_username TEXT,
  original_comment_text TEXT,
  normalized_comment_text TEXT,
  matched_keyword TEXT,
  status TEXT NOT NULL,
  public_reply_message TEXT,
  public_reply_status TEXT,
  private_reply_status TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (automation_id)
    REFERENCES automations(id),
  FOREIGN KEY (webhook_event_id)
    REFERENCES webhook_events(id),
  UNIQUE (automation_id, instagram_comment_id)
);
```

## 14.10 `api_attempts`

```sql
CREATE TABLE api_attempts (
  id TEXT PRIMARY KEY,
  automation_run_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  http_status INTEGER,
  meta_error_code TEXT,
  meta_error_subcode TEXT,
  meta_error_message TEXT,
  meta_trace_id TEXT,
  request_payload_redacted TEXT,
  response_payload_redacted TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (automation_run_id)
    REFERENCES automation_runs(id)
);
```

## 14.11 `audit_logs`

```sql
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL
);
```

---

# 15. 資料庫索引

至少建立：

```sql
CREATE INDEX idx_media_account
ON instagram_media(instagram_account_id);

CREATE INDEX idx_automations_status
ON automations(status);

CREATE INDEX idx_keywords_automation
ON automation_keywords(automation_id);

CREATE INDEX idx_webhook_comment
ON webhook_events(instagram_comment_id);

CREATE INDEX idx_webhook_received
ON webhook_events(received_at);

CREATE INDEX idx_runs_status
ON automation_runs(status);

CREATE INDEX idx_runs_created
ON automation_runs(created_at);

CREATE INDEX idx_runs_media
ON automation_runs(instagram_media_id);

CREATE INDEX idx_attempts_run
ON api_attempts(automation_run_id);
```

---

# 16. Admin API

## 16.1 登入

```http
POST /api/admin/auth/login
```

Request：

```json
{
  "email": "admin@example.com",
  "password": "password"
}
```

## 16.2 登出

```http
POST /api/admin/auth/logout
```

## 16.3 取得系統狀態

```http
GET /api/admin/system/status
```

回傳含 `account`（`{ username, profilePictureUrl }`，無帳號時為 `null`），供首頁 IG 個人頁式頁首顯示；
統計含 `total`（累計）與 `today`（以台北時區 UTC+8 為日界）兩組 `{ matched, publicReplySuccess, dmSuccess, failures }`。

## 16.4 緊急停止

```http
POST /api/admin/system/emergency-stop
```

## 16.5 恢復系統

```http
POST /api/admin/system/resume
```

## 16.6 取得貼文

```http
GET /api/admin/media
```

Query：

```text
page
limit
mediaType
automationStatus
search
```

## 16.7 同步貼文

```http
POST /api/admin/media/sync
```

同步涵蓋貼文/Reels 與進行中的限時動態（見第 30 節）；回傳摘要含 `expiredStories`（本次標記為過期的限動數）。

## 16.8 建立自動化

```http
POST /api/admin/automations
```

Request：

```json
{
  "instagramMediaId": "uuid",
  "name": "i-have-adhd GitHub",
  "matchType": "contains_any",
  "keywords": [
    "adhd",
    "github",
    "想要"
  ],
  "publicReplyEnabled": true,
  "publicReplyVariants": [
    "已經私訊給你囉，請查看訊息 📩",
    "連結已送到你的 DM 囉！",
    "收到，請打開私訊查看 🙌"
  ],
  "privateReplyEnabled": true,
  "openingDm": "這是影片中介紹的 i-have-adhd GitHub 專案，點擊下方按鈕即可查看。",
  "buttonText": "開啟 GitHub",
  "buttonUrl": "https://github.com/ayghri/i-have-adhd",
  "dailyLimit": 2000
}
```

## 16.9 修改自動化

```http
PATCH /api/admin/automations/:automationId
```

## 16.10 啟用自動化

```http
POST /api/admin/automations/:automationId/activate
```

啟用前驗證：

* 貼文存在。
* 自動化設定完整。
* 關鍵字至少一個，除非為 `all_comments`。
* 至少啟用公開回覆或 Private Reply。
* Private Reply 啟用時 Opening DM 不得為空。
* Button URL 必須為有效 HTTPS URL。
* Token 狀態正常。
* 緊急停止未啟用。

## 16.11 暫停自動化

```http
POST /api/admin/automations/:automationId/pause
```

## 16.12 取得執行紀錄

```http
GET /api/admin/automation-runs
```

可篩選：

```text
dateFrom
dateTo
mediaId
automationId
status
publicReplyStatus
privateReplyStatus
keyword
```

## 16.13 查看單筆紀錄

```http
GET /api/admin/automation-runs/:runId
```

---

# 17. 管理後台頁面

## 17.1 登入頁

功能：

* Email。
* Password。
* 登入錯誤顯示。
* 登入頻率限制。

## 17.2 儀表板

顯示：

* 今日收到留言數。
* 今日匹配關鍵字數。
* 今日公開回覆成功數。
* 今日 DM 成功數。
* 今日失敗數。
* 最近一次 Webhook 時間。
* Token 狀態。
* Queue 狀態。
* 緊急停止狀態。
* 熔斷器狀態。

## 17.3 貼文列表

每篇顯示：

* 縮圖。
* Caption 摘要。
* 貼文類型。
* 發布日期。
* Instagram 連結。
* 自動化狀態。
* 本月觸發次數。
* 本月成功率。

## 17.4 自動化編輯

欄位：

* 自動化名稱。
* 比對模式。
* 關鍵字。
* 公開回覆啟用開關。
* 公開回覆版本。
* Private Reply 啟用開關。
* Opening DM。
* Button Text。
* Button URL。
* 每日觸發上限。
* 儲存。
* 啟用。
* 暫停。

## 17.5 執行紀錄

列表顯示：

* 日期。
* 貼文。
* 留言內容。
* 符合關鍵字。
* 公開回覆狀態。
* DM 狀態。
* 重試次數。
* 錯誤摘要。

單筆詳情顯示：

* Webhook Payload。
* 規則匹配結果。
* Meta API Request 摘要。
* Meta API Response。
* Meta error code。
* Meta trace ID。
* 重試歷程。

Token 等敏感資訊必須遮蔽。

---

# 18. 驗證與安全

## 18.1 管理者登入

使用：

* Email＋Password。
* Argon2id 或相容的安全密碼雜湊。
* HttpOnly Cookie Session。

Cookie 必須設定：

```text
HttpOnly
Secure
SameSite=Strict
```

## 18.2 CSRF

所有會修改資料的 Admin API 必須：

* 驗證 Origin。
* 使用 CSRF Token，或
* 採嚴格 SameSite Cookie 搭配 Origin 驗證。

## 18.3 Webhook Signature

Webhook 必須驗證 Meta 提供的簽章。

實作要求：

* 使用原始 Request Body。
* 使用 Meta App Secret。
* Constant-time comparison。
* 驗證失敗不得進入 Queue。
* 驗證失敗寫入安全 Log。

## 18.4 Rate Limiting

Admin Login：

```text
每個 IP 每 15 分鐘最多 10 次
```

Admin API：

```text
每個 Session 每分鐘最多 120 次
```

Webhook 不使用一般 IP Rate Limit，以免誤擋 Meta，但必須驗證 Signature。

---

# 19. 熔斷機制

以下任一條件成立時，暫停自動發送：

* 連續 5 次 Token 無效。
* 連續 5 次權限錯誤。
* 收到明確政策限制錯誤。
* 5 分鐘內至少 10 次 API 呼叫，且錯誤率超過 20%。
* 管理者啟用緊急停止。
* 每日發送量超過設定上限。

暫停後：

* 繼續接收 Webhook。
* 繼續保存事件。
* 不公開回覆。
* 不發送 DM。
* Queue Job 標記為 blocked。
* 儀表板顯示警告。

---

# 20. Cron Jobs

使用 Cloudflare Cron Triggers。

## 每日貼文同步

```text
每天 04:00 Asia/Taipei
```

功能：

* 同步近期 Instagram 貼文及 Reels。
* 更新 Caption、Thumbnail、Permalink。
* IG 上已刪除的貼文：逐篇向 Meta 查證（GET /{media-id}），確認不存在才標記
  `deleted_at`（軟刪除）並暫停綁定該貼文的 active 自動化；網路錯誤、限流、
  token 失效不視為刪除證據。後台列表預設隱藏已刪除貼文（`?includeDeleted=1`
  可查回），發送紀錄與歷史報表保留不動。貼文重新出現時自動解除標記。

## Token 檢查

```text
每天 08:00 Asia/Taipei
```

功能：

* 驗證 Token。
* 更新 Token 到期狀態。
* Token 即將到期時顯示警告。

## 資料清理

```text
每天 03:00 Asia/Taipei
```

清理：

* 超過 30 天的原始 Webhook Payload。
* 超過 180 天的詳細 API Attempt。
* 保留彙總統計資料。

D1 免費方案目前提供 7 天 Time Travel，付費 Workers 方案為 30 天；此功能可作為誤刪或錯誤寫入時的補充復原機制，但不能取代應用程式自己的資料備份與保留策略。

---

# 21. Logging

所有 Log 使用 JSON Structured Logging。

必要欄位：

```text
timestamp
level
requestId
webhookEventId
automationRunId
instagramMediaId
instagramCommentId
action
durationMs
httpStatus
metaErrorCode
metaTraceId
```

不得紀錄：

* Access Token。
* App Secret。
* Session Cookie。
* 完整密碼。
* 未遮蔽的敏感 Header。

---

# 22. 環境變數及 Bindings

## Secrets

```text
INSTAGRAM_APP_SECRET
WEBHOOK_VERIFY_TOKEN
INSTAGRAM_ACCOUNT_ACCESS_TOKEN
ADMIN_SESSION_SECRET
```

## 一般 Variables

```text
META_GRAPH_API_VERSION
APP_ENV
LOG_LEVEL
```

## Bindings

```text
DB
COMMENT_QUEUE
ASSETS
```

---

# 23. 專案目錄

```text
ig-comment-dm-bot/
├── src/
│   ├── index.ts
│   ├── app.ts
│   ├── webhook/
│   │   ├── routes.ts
│   │   ├── verify-webhook.ts
│   │   ├── receive-webhook.ts
│   │   ├── signature.ts
│   │   └── event-parser.ts
│   ├── queue/
│   │   ├── consumer.ts
│   │   ├── producer.ts
│   │   └── retry-policy.ts
│   ├── automation/
│   │   ├── engine.ts
│   │   ├── matcher.ts
│   │   ├── normalizer.ts
│   │   └── idempotency.ts
│   ├── meta/
│   │   ├── client.ts
│   │   ├── comments.ts
│   │   ├── private-replies.ts
│   │   ├── media.ts
│   │   └── errors.ts
│   ├── admin/
│   │   ├── routes.ts
│   │   ├── auth.ts
│   │   ├── media.ts
│   │   ├── automations.ts
│   │   └── runs.ts
│   ├── database/
│   │   ├── schema.ts
│   │   ├── client.ts
│   │   ├── repositories/
│   │   └── migrations/
│   ├── security/
│   │   ├── session.ts
│   │   ├── csrf.ts
│   │   └── rate-limit.ts
│   ├── monitoring/
│   │   ├── logger.ts
│   │   └── circuit-breaker.ts
│   └── shared/
│       ├── errors.ts
│       ├── types.ts
│       └── validation.ts
├── admin/
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── api/
│   │   └── main.tsx
│   └── vite.config.ts
├── drizzle/
│   └── migrations/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── wrangler.jsonc
├── drizzle.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

# 24. Wrangler 設定範例

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "ig-comment-dm-bot",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-01",
  "observability": {
    "enabled": true
  },
  "assets": {
    "directory": "./admin/dist",
    "binding": "ASSETS"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "ig-comment-dm-db",
      "database_id": "<D1_DATABASE_ID>",
      "migrations_dir": "drizzle/migrations"
    }
  ],
  "queues": {
    "producers": [
      {
        "binding": "COMMENT_QUEUE",
        "queue": "ig-comment-events"
      }
    ],
    "consumers": [
      {
        "queue": "ig-comment-events",
        "max_batch_size": 10,
        "max_batch_timeout": 5,
        "max_retries": 3
      }
    ]
  },
  "triggers": {
    "crons": [
      "0 20 * * *",
      "0 0 * * *",
      "0 19 * * *"
    ]
  }
}
```

Cloudflare Cron 使用 UTC，因此實際排程需將台北時間轉換成 UTC，並另外處理日光節約時間不適用於台灣的情況。

---

# 25. CI/CD

使用：

```text
GitHub
Cloudflare Workers Builds
```

流程：

```text
Push 到 feature branch
    ↓
執行 Lint
    ↓
執行 Unit Tests
    ↓
執行 Type Check
    ↓
建立 Preview Deployment
    ↓
Merge 到 main
    ↓
執行 D1 Migration
    ↓
部署 Production Worker
    ↓
執行 Smoke Test
```

正式部署前必須通過：

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Cloudflare Workers Builds 免費方案目前提供每月 3,000 分鐘 Build 時數，對單一小型自用專案通常足夠。

---

# 26. 測試規格

## 單元測試

必須測試：

* 大小寫轉換。
* 全形轉半形。
* 中文關鍵字。
* Emoji。
* 前後空白。
* `contains_any`。
* `exact_any`。
* `all_comments`。
* 自己留言排除。
* 重複 Comment ID。
* 重試錯誤分類。
* 公開回覆隨機選擇。

## 整合測試

必須測試：

* Webhook Challenge。
* 有效 Signature。
* 無效 Signature。
* Webhook 重送。
* Queue Producer。
* Queue Consumer。
* D1 寫入。
* 自動化停用。
* 緊急停止。
* 公開回覆成功。
* Private Reply 成功。
* 公開回覆失敗但 DM 成功。
* 公開回覆成功但 DM 失敗。
* HTTP 429。
* HTTP 5xx。
* Token 無效。
* 權限錯誤。

## 實際 IG 測試

至少使用 5 個不同 Instagram 帳號完成：

* 符合關鍵字。
* 不符合關鍵字。
* 大小寫不同。
* 中文關鍵字。
* 同一帳號不同留言。
* 自己留言。
* 自動化停用。
* 快速連續留言。
* Webhook 重送模擬。

正式上線前至少完成：

```text
20 次有效觸發
0 次重複公開回覆
0 次重複 Private Reply
```

---

# 27. 驗收標準

MVP 必須符合：

1. 可以同步多篇 Instagram 貼文與 Reels。
2. 每篇貼文可以設定不同自動化。
3. 每組自動化可以設定多個關鍵字。
4. 符合關鍵字時可以公開回覆。
5. 符合關鍵字時可以傳送一次 Private Reply。
6. Private Reply 可以包含外部連結按鈕。
7. 同一 Comment ID 不會重複發送。
8. Webhook 可以快速回傳成功。
9. Meta API 暫時性錯誤可以重試。
10. Token 或權限錯誤不會無限重試。
11. 可以一鍵停止全部發送。
12. 可以查看每次執行紀錄。
13. 可以查看 Meta API 錯誤。
14. 不保存 Instagram 密碼。
15. 不使用非官方 Instagram API。
16. 不使用瀏覽器模擬操作。
17. Worker 重啟或重新部署不會遺失已進 Queue 的任務。
18. 所有 Secret 不會出現在前端及 Log。

---

# 28. 成本規格

初期使用：

```text
Cloudflare Workers Free
Cloudflare D1 Free
Cloudflare Queues Free
Workers Static Assets
```

預估雲端固定成本：

```text
US$0／月
```

實際費用仍取決於當時 Cloudflare 免費額度及使用量。

若出現以下情況，升級 Workers Paid：

* 單日留言量經常爆增。
* 免費 D1 每日讀寫限制不足。
* Queue 免費額度不足。
* 需要更長的 D1 Time Travel。
* 正式營運不希望超額後停止服務。

Cloudflare Workers Paid 目前以最低月費方案起算，實際價格及包含額度應以上線當時官方定價為準。Cloudflare 官方定價頁也說明，免費額度通常依每日 UTC 時間重置，付費方案的月額度則依訂閱週期重置。

---

# 29. 架構限制

開發過程不得在沒有明確需求時加入：

* Redis。
* PostgreSQL。
* Docker Compose。
* RabbitMQ。
* Kafka。
* Kubernetes。
* Event Bus。
* CQRS。
* 多租戶架構。
* Organization。
* Billing。
* Subscription。
* Repository Pattern 多層抽象。
* 多個獨立後端服務。
* AI 功能。

所有新增架構必須回答：

```text
目前的 MVP 是否真的需要？
Cloudflare 原生服務是否已經能解決？
不加入會造成什麼具體問題？
```

無法明確回答時，不得加入。

---

# 30. 最終產品定義

本系統是一套自用的 Instagram 留言關鍵字回覆工具。

它只解決：

```text
管理多篇 Instagram 貼文
        ↓
設定每篇貼文的留言關鍵字
        ↓
使用者留言符合條件
        ↓
公開回覆一次
        ↓
傳送一次 Private Reply DM
        ↓
保存成功或失敗紀錄
```

系統不得演變成：

```text
蒐集 Instagram 使用者
        ↓
建立大量聯絡人名單
        ↓
主動或定期發送行銷 DM
```

開發優先順序：

```text
遵守 Meta 規範
＞
避免重複發送
＞
系統安全
＞
可觀測性
＞
穩定性
＞
操作體驗
＞
進階功能
```


---

# 30. 限時動態自動化

限動回應含關鍵字即自動私訊指定內容。逐則限動設定；限動不套用待命（next_post）與全帳號預設（account_default）——那是留言的語意。

## 30.1 資料模型

* 限動重用 `instagram_media`，`media_type = 'STORY'`（同步時強制寫入；Meta `/stories` 回傳的 `media_type` 是 IMAGE/VIDEO，不可照抄）。
* 過期判斷：不在 `GET /{ig-account-id}/stories` 清單＝已過期（此端點只回 24 小時內的限動，是權威來源）→ 標 `deleted_at` 並暫停綁定的 active 自動化。貼文的逐篇刪除查證不適用於 STORY。

## 30.2 Webhook

* Meta App 需訂閱 `messages` 欄位；token 需 `instagram_business_manage_messages` 權限。
* 只接受帶 `entry[].messaging[].message.reply_to.story.id` 的事件；一般 DM 與 echo（`is_echo`）一律忽略。
* 事件鍵＝訊息 `mid`（穩定 ID）；`webhook_events.event_type = 'story_reply'`、`instagram_media_id` ← story id、`instagram_comment_id` ← mid（欄位重用）。
* 冪等、重送計數、Queue 流程與留言事件完全共用；Queue message 以 `eventType: 'story_reply'` 分流。

## 30.3 執行引擎

* 只套用綁定該限動的專屬 active 自動化（不 fallback）。
* 關鍵字比對沿用正規化與 matcher；已過期限動（`deleted_at` 非 NULL）直接略過。
* 沒有公開回覆（限動無留言串），`public_reply_status` 一律 `skipped`。
* DM 的 recipient 用 `{ id: <回應者 IGSID> }`（限動回應已開啟 24 小時訊息窗）；留言路徑維持 `{ comment_id }`。
* 限額 gate、每日上限、automation_runs／api_attempts、重試策略全部沿用（`instagram_comment_id` ← mid，unique 冪等成立）。

## 30.4 啟用檢核

* 限動自動化不要求公開回覆；`private_reply_enabled` 必須開啟，否則回 `private_reply_required_for_story`。
