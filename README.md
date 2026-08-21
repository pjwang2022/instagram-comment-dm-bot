# Instagram Comment DM Bot

**繁體中文** | [English](README.en.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**自架的 Instagram 自動化工具：有人在你的貼文留言命中關鍵字時，自動公開回覆並私訊對方——完整跑在 Cloudflare Workers 上。**

為「單一管理者管理自己的 Instagram 專業帳號」而設計。不依賴第三方 SaaS、沒有按訊息計費：你自己的 Meta App、你自己的 Cloudflare 帳號、你自己的資料。

## 一鍵部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/pjwang2022/instagram-comment-dm-bot)

點按鈕後會依序發生：

1. **複製本 repo** 到你自己的 GitHub（或 GitLab）帳號。
2. **自動開通資源**——在你的 Cloudflare 帳號建立 D1 資料庫與 Queue（免費方案即可；Queues 自 2026 年 2 月起開放免費方案）。
3. **提示你填入四個 secrets**（清單見 [`.dev.vars.example`](.dev.vars.example)：`INSTAGRAM_APP_SECRET`、`WEBHOOK_VERIFY_TOKEN`、`INSTAGRAM_ACCOUNT_ACCESS_TOKEN`、`ADMIN_SESSION_SECRET`）。
4. **建置並部署**，同時設好 push 即自動重新部署：之後改你那份 repo、push 就會自動上線。

首次部署完成後，到你自己的 repo 收尾：

- 完成 [Meta 端設定](#2-meta-端)（webhook 訂閱＋access token）。不需要改任何設定檔——系統會用 access token 自動識別並註冊你的 Instagram 帳號。
- 打開 `/admin`，在首次啟動設定頁[建立管理者帳號](#3-建立管理者帳號)——部署完請盡快做這步。

想全程手動操作？請看下方完整的 [Quick Start](#quick-start)。

## 功能

- **每篇貼文獨立的關鍵字自動化** —— 支援 `contains_any`／`exact_any`／`all_comments` 比對模式，含文字正規化與排除條件。
- **支援排程貼文** —— Instagram API 看不到未發布的貼文，因此可事先建立「待命自動化」（貼文一上線即自動綁定，連第一則留言都不漏），或設定套用到所有新貼文的全帳號預設。
- **每位留言者一次性公開回覆＋一則私訊**，公開回覆支援多變體輪替，私訊可選配可點擊的連結按鈕。
- **限時動態自動化** —— 有人回應限動且訊息含關鍵字時自動私訊（逐則限動設定；限動 24 小時過期後自動暫停）。
- **冪等設計** —— webhook 事件與自動化執行都有去重機制，Meta 重送 webhook 不會造成重複回覆。
- **自動重試與退避**（30 秒／2 分／10 分）處理 Meta API 暫時性失敗；永久性錯誤（token 失效、權限、政策）立即停止不重試。
- **熔斷與緊急停止** —— 連續失敗自動停用該自動化；管理後台有一鍵全面停止開關。
- **管理後台**（React SPA，路徑 `/admin`）—— 登入、貼文列表與同步、自動化編輯器、執行紀錄（含每次 Meta API 呼叫的錯誤細節）。
- **內建安全性** —— webhook HMAC 簽章驗證（constant-time）、PBKDF2 密碼雜湊、HttpOnly Session Cookie、CSRF 防護、rate limiting、含機密遮蔽的結構化 log。

## 架構

```text
Instagram 留言
      │  webhook（簽章驗證）
      ▼
Cloudflare Worker (Hono) ──▶ Cloudflare Queue ──▶ Consumer：關鍵字比對
      │                                             ├─ 公開回覆（Meta API）
      ▼                                             └─ 私訊 DM（Meta API）
Cloudflare D1 (SQLite)  ◀── 執行紀錄、API 呼叫紀錄、audit logs
      ▲
Cron：每日貼文同步 · Token 到期檢查
```

技術棧：Cloudflare Workers · Hono · D1（Drizzle ORM）· Queues · Cron Triggers · React + Vite 管理後台。

## 前置需求

- **Cloudflare 帳號**（免費方案即可——Queues 免費版每日 10,000 次佇列操作、訊息保留 24 小時，個人帳號用量綽綽有餘；重度用量再升級 Workers Paid），並已完成 `npx wrangler login`。
- **Meta 開發者 App**（已加入 Instagram 產品）與一個你管理的 **Instagram 專業帳號**。
- **Node.js 20+**。

## Quick Start

### 1. Cloudflare 端

```bash
git clone https://github.com/pjwang2022/instagram-comment-dm-bot.git
cd instagram-comment-dm-bot
npm ci && npm ci --prefix admin

# 正式環境機密。每個 secret 設定後約 30 秒才生效。
npx wrangler secret put INSTAGRAM_APP_SECRET
npx wrangler secret put WEBHOOK_VERIFY_TOKEN        # 自訂隨機字串；步驟 2 會再用到
npx wrangler secret put INSTAGRAM_ACCOUNT_ACCESS_TOKEN
npx wrangler secret put ADMIN_SESSION_SECRET     # 32 bytes 以上隨機值

# 部署——首次執行會自動建立 D1 資料庫與 Queue、建置管理後台、
# 部署 Worker 並套用 migrations。不需要命名任何資源、不需要改任何設定檔。
npm run deploy
```

### 2. Meta 端

1. 到 [Meta for Developers](https://developers.facebook.com/) 建立 App 並加入 **Instagram** 產品。
2. 為你的專業帳號取得 access token，權限需涵蓋讀取留言、回覆留言與發送訊息（例如 `instagram_business_basic`、`instagram_business_manage_comments`、`instagram_business_manage_messages`——實際名稱以 Meta 官方文件為準），存入 `INSTAGRAM_ACCOUNT_ACCESS_TOKEN` secret。請使用**長效（long-lived）token** 並留意到期日——每日 cron 會在到期前提醒。
3. 設定 webhook 訂閱：
   - Callback URL：`https://<你的網域>/api/webhooks/meta/instagram`
   - Verify token：與 `WEBHOOK_VERIFY_TOKEN` secret 相同的值
   - 訂閱 **`comments`** 欄位；若要使用限時動態自動化，一併訂閱 **`messages`** 欄位。
4. **把 App 切換為「發佈」（上線）狀態**——開發模式下，webhook 只會送 App 角色成員的事件，陌生人留言不會觸發。發佈需要公開的隱私政策網址，本專案內建於 `https://<你的網域>/privacy`（頁面顯示的聯絡信箱即你的管理者帳號 Email）。
5. 不需要走 App 審核（App Review）／進階存取——那是服務其他人帳號才需要的流程；自用工具操作自己授權的帳號，標準存取即可。

#### 限時動態自動化的額外設定

- Webhook 訂閱必須包含 **`messages`** 欄位（系統只處理帶 `reply_to.story` 的訊息，一般 DM 一律忽略）。
- Access token 需具備 `instagram_business_manage_messages` 權限。
- 設定完成後務必實測：對自己的限動回覆關鍵字，確認收到自動私訊
 （Workers 正式 runtime 的限制在 `wrangler dev` 測不出來，見 CLAUDE.md）。

### 3. 建立管理者帳號

**首次部署完成後立刻**打開 `https://<你的網域>/admin`。在還沒有任何管理者帳號時，登入頁會顯示一次性的**首次啟動設定表單**：輸入 Email 與密碼（至少 12 字元）即建立唯一的管理者帳號並自動登入。帳號建立後這個表單就永久消失——全程不需要 terminal。

> 請盡快完成這步：在帳號建立之前，任何發現你剛部署網址的人都有可能搶先註冊。

CLI 備援（例如不想用網頁表單時）：

```bash
# 互動式：輸入 Email 與密碼，產出 admin-insert.sql
#（密碼雜湊含 `$`，務必用 --file 套用，不要貼進 --command）
npm run create-admin
npx wrangler d1 execute DB --remote --file=admin-insert.sql && rm admin-insert.sql
```

**變更密碼**：點後台頁首的 Email → 帳號設定。本系統不提供忘記密碼重設——請妥善保管密碼（若遺失，需要重新部署、從頭設置）。

### 4. 驗證

```bash
npm run check-meta    # 唯讀健康檢查：token 有效性、帳號、貼文
```

接著開啟 `https://<你的網域>/admin` 登入，同步貼文、建立自動化，再用另一個帳號在貼文下留言關鍵字測試。

## 本機開發

```bash
cp .dev.vars.example .dev.vars    # 填入本機開發機密（已被 gitignore）
npx wrangler d1 migrations apply ig-comment-dm-db --local
npm run dev                        # wrangler dev
npm run test                       # vitest（單元＋整合測試）
npm run lint && npm run typecheck
```

注意：`wrangler dev` 不會強制所有正式 Workers 限制（例如 PBKDF2 單次 100k 迭代上限）。認證相關流程請務必在部署後的 Worker 上實測。

## 文件

- [`docs/faq.md`](docs/faq.md) —— 常見問答：費用、合規、功能邊界、疑難排解。
- [`spec.md`](spec.md) —— 完整技術規格：資料模型、API、比對規則、重試與熔斷語意。
- [`CLAUDE.md`](CLAUDE.md) —— 給 AI coding agent 的初始化步驟與專案規則（Claude Code 會自動讀取）。

## 安全性說明

所有機密只存在 Cloudflare Secrets（正式環境）或 `.dev.vars`（本機，已被 gitignore）——永不寫入被 git 追蹤的檔案。`wrangler.jsonc` 只以預設值提交進版控；首次部署時 wrangler 會把自動建立的 `database_id` 寫回檔內。若你會貢獻程式碼回來，請先執行 `git update-index --skip-worktree wrangler.jsonc`，確保寫回的個人資源 ID 永不進 commit。

## License

[MIT](LICENSE)
