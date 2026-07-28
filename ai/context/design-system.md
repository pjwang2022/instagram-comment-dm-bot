# 設計系統（Design System）

由 Epic 0「專案設置」的「UI 設計系統」User Story 分五階段（框架 → 風格 → design token → 元件庫 → 版面）逐步填寫。**這份文件是後續所有功能 Epic 做 UI 時的單一事實來源**：任何前端任務開工前都要先讀它，能用既有 token／元件就必須用；缺的元件要照既有風格補做並登記回這裡（見 `ai/skills/project-kickoff.md` 步驟 6 與 `ai/skills/ui-mockup-gate.md`）。

狀態：首版已定案（登入頁 + 儀表板）。後續其他管理後台畫面沿用此系統。

> 說明：因管理者對「完全無樣式」的預覽提出意見，設計方向已由使用者在 3 個具體變體中選定「清爽專業風」，並直接落地為可跑的 token 檔與元件樣式，未逐關卡跑完整五階段的正式關卡（實作先行、事後補登本文件）。後續要新增畫面時沿用此系統即可。

## S1 底層框架

- UI 框架：React 19 + Vite（既有 admin 專案）
- 元件庫策略：**自建輕量元件（純 CSS class）**，不引入 shadcn/MUI/Ant Design（單一小型自用後台，避免額外依賴與 bundle）
- 樣式方案：**原生 CSS + CSS variables（design token）**，無 Tailwind／CSS-in-JS
- 選定理由：專案小、單一管理者；用 CSS variables 當 token 已足夠達成「design as a system」，且零額外依賴、與現有 Vite 建置無縫
- 人工核准：使用者（2026-07-28，選定視覺方向「清爽專業風」）

## S2 風格方向

- 選定的 style tile：**清爽專業風**（3 選 1，另有「現代深色風」「Instagram 暖調風」）
- 色彩情緒：中性、乾淨、專業（slate 灰階底 + indigo/violet 主色）
- 字體個性：system-ui 無襯線，含繁中 fallback（PingFang TC / 微軟正黑）
- 圓角／陰影傾向：中圓角（6–12px）、柔和陰影；**深度只用陰影，不疊邊框**
- 密度：舒適（間距起手 16–24px）
- 亮／暗模式：亮色（暗色未做）
- 參考產品：Linear、shadcn admin
- 人工核准：使用者（2026-07-28）

## S3 Design Token 清單

### 實際 token 檔位置

- **真實 token 檔：`admin/src/styles/tokens.css`（CSS variables，單一事實來源）**
- 元件樣式：`admin/src/styles/app.css`（只引用 tokens.css 的變數）
- 下表為摘要；完整值以 `tokens.css` 為準。

### Primitive Token（摘要）

| 類別 | Token | 值 | 備註 |
|---|---|---|---|
| 灰階 | `--slate-50…900` | #f8fafc … #0f172a | 9 階 slate |
| 主色 | `--primary-50/100/200/500/600/700` | #eef2ff … #4338ca | indigo/violet |
| 語意色 | `--success/danger/warning/neutral-fg/bg` | 綠/紅/琥珀/灰 各 fg+bg | status pill 用 |
| 字級 | `--text-xs…3xl` | 12/13/14/16/18/20/24/30 | type scale |
| 字重 | `--weight-normal…bold` | 400/500/600/700 | |
| 間距 | `--space-1…12` | 4/8/12/16/20/24/32/40/48 | 4 的倍數 |
| 圓角 | `--radius-sm/md/lg/full` | 6/8/12/999 | |
| 陰影 | `--shadow-sm/md/lg` | 柔和三階 | 深度唯一來源 |

### Semantic Token（摘要）

| Token | 對應 | 用途 |
|---|---|---|
| `--color-bg` | slate-100 | 頁面底色 |
| `--color-surface` | #fff | 卡片/表格/header 底 |
| `--color-border` | slate-200 | input／表格列分隔 |
| `--color-text` / `--color-text-muted` / `--color-text-subtle` | slate-900/500/400 | 三級文字層次 |
| `--color-primary` / `--color-primary-hover` | primary-600/700 | 主按鈕、focus ring、品牌點 |

## S4 元件庫 Inventory

| 元件 | 狀態 | 涵蓋狀態 | 用到的 token | 檔案位置 | 截圖 | 來源階段 |
|---|---|---|---|---|---|---|
| Button（primary/ghost/danger/sm/block） | 已建 | 預設/hover/disabled | primary、slate、danger、radius-md、shadow-sm | `app.css .btn*` | 登入頁/儀表板 | S4 |
| Input | 已建 | 預設/focus（ring）| border、primary-500/100、radius-md | `app.css .input` | 登入頁 | S4 |
| Card / Stat card | 已建 | 預設 | surface、radius-lg、shadow-sm | `app.css .card/.stat-card` | 儀表板 | S4 |
| Table | 已建 | header/row/hover/empty | slate-50、border、text | `app.css .table*` | 儀表板 | S4 |
| Badge（success/danger/warning/neutral） | 已建 | 四色 status pill | 語意色 | `app.css .badge*` | 儀表板 | S4 |
| Alert（danger） | 已建 | 錯誤 | danger-fg/bg | `app.css .alert*` | 登入頁 | S4 |
| App header | 已建 | sticky | surface、shadow-sm | `app.css .app-header` | 儀表板 | S4 |
| Empty / Loading state | 已建 | 空/載入 | text-subtle | `app.css .state-note` | 儀表板 | S4 |
| Nav（header 導覽） | 已建 | 預設/hover/active | primary-soft、slate | `app.css .app-nav/.nav-link` | 貼文頁 | 貼文管理 Epic |
| Select | 已建 | 預設/focus | border、primary | `app.css .select` | 自動化編輯器 | 貼文管理 Epic |
| Textarea | 已建 | 預設/focus | border、primary | `app.css .textarea` | 自動化編輯器 | 貼文管理 Epic |
| Toggle（checkbox row） | 已建 | 勾選/取消 | primary（accent-color） | `app.css .toggle-row` | 自動化編輯器 | 貼文管理 Epic |
| Chips（關鍵字標籤） | 已建 | 預設/移除 hover | primary-soft/700 | `app.css .chips/.chip` | 自動化編輯器 | 貼文管理 Epic |
| Media card（IG 風縮圖卡） | 已建 | 預設/hover/縮圖失敗 fallback | surface、shadow、slate | `app.css .media-grid/.media-card/.media-thumb` | 貼文頁 | 貼文管理 Epic |
| Automation stat card（自動化成效卡） | 已建 | 預設/hover | surface、shadow、danger | `app.css .auto-list/.auto-card/.auto-stats` | 儀表板 | 儀表板 Epic |

（尚未做：Modal/Dialog、Toast、分頁元件——後續畫面需要時照既有 token 補做並回登此表。）

## S5 各介面版面

| 介面／使用者端 | 選定版型 | Mockup 決策紀錄 | 人工核准 |
|---|---|---|---|
| 管理員後台 — 登入頁 | 置中卡片 + 微漸層背景 | 本文件（實作先行） | 使用者 2026-07-28 |
| 管理員後台 — 儀表板 | 系統控制列 + **已設定自動化的貼文卡（每篇縮圖＋觸發/公開回覆/DM/失敗數據）** | 本文件（實作先行） | 使用者 2026-07-28（要求只顯示有自動化的貼文＋每篇數據） |
| 管理員後台 — 貼文管理 | header 導覽 + **IG 風縮圖網格**（方形縮圖、媒體類型角標、狀態徽章、caption、操作按鈕） | 本文件（實作先行） | 使用者 2026-07-28（要求做成像 IG） |
| 管理員後台 — 自動化編輯器 | 返回連結 + 狀態標籤 + 分區表單卡（基本/公開回覆/Private Reply/進階） | 本文件（實作先行） | 使用者 2026-07-28 |
| 管理員後台 — 執行紀錄詳情 | 沿用上述元件與版型，尚未實作 | 待補 | 待補 |
