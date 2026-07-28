# AI-Ready 任務卡

## Metadata

- 任務：Admin 前端骨架（Vite + React + React Router）
- 上層規格：`spec.md`（第 4.3、17、23 節）
- 上層 Epic：專案設置
- 上層 User Story：技術骨架初始化
- 分軌：前端
- 前置任務（dependsOn）：無
- 狀態：完成
- 風險等級：低
- Agent owner：實作 agent
- 人工核准者：待指派

## 目標

在 `admin/` 建立可建置為靜態檔的 React + Vite + React Router + TypeScript 專案骨架，輸出到 `admin/dist`（與 `wrangler.jsonc` 的 `assets.directory` 對應），具備最小可運作的路由骨架（首頁／登入頁佔位，尚無真實登入邏輯與其他功能頁面）。

## 情境包（Context Pack）

- 相關檔案：
  - `admin/`（目前不存在，全新建立）
  - `spec.md` 第 4.3 節（技術選型）、第 17 節（管理後台頁面清單，僅作為未來路由命名參考，不在本卡實作內容）
- 既有模式：
  - 無既有前端程式碼。
- 假設：
  - 不需要 SSR／SEO／Next.js Server Components（spec.md 4.3 明確排除）。
  - 實際頁面（登入、儀表板、貼文列表等）內容與樣式由各自功能 Epic 的任務卡實作；本卡只建立路由骨架與空頁面 placeholder。
  - 尚未有 `ai/context/design-system.md` 的定案內容（UI 設計系統是另一個 User Story），因此本卡不套用任何視覺樣式決策，只保證專案可建置、可路由跳轉。
- 未知事項：
  - 無。
- 允許變更的檔案：
  - `admin/**`。
- 不得觸碰：
  - `src/`（Worker 骨架屬於另一張任務卡）、`ai/`、`tools/kanban/`、`spec.md`。

## 需求

- `admin/vite.config.ts`：Vite + React plugin，build output 設為 `dist`（相對於 `admin/`），確保根目錄 `wrangler.jsonc` 的 `assets.directory: "./admin/dist"` 生效。
- `admin/src/main.tsx`：React Router 初始化，至少兩條路由：`/admin/login`（佔位頁）、`/admin`（佔位首頁，之後會被儀表板頁取代）。
- `admin/tsconfig.json`：獨立於根目錄 `tsconfig.json`，適配 Vite + React 專案。
- `admin/package.json`（或整合進根目錄 workspace，依實作時判斷何者更符合專案慣例並簡述理由）：具備 `dev`／`build` 腳本。

## 驗收標準

- `npm run build`（於 `admin/` 或根目錄委派）成功產出 `admin/dist/index.html` 與相關 assets。
- 本地 `npm run dev` 可開啟頁面，瀏覽器切換 `/admin/login` 與 `/admin` 兩條路由皆可正常渲染不報錯。
- 不含任何尚未定案的視覺設計（配色、字體、元件樣式），避免與後續「UI 設計系統」User Story 的產出衝突。
- 未觸碰 `src/`、`ai/`、`tools/kanban/`。

## 實作備註

- 這是純骨架卡，畫面內容用最簡單的文字 placeholder 即可（例如「登入頁（待實作）」），不需要視覺打磨——視覺工藝規則（`ai/skills/design-craft.md`）從 UI 設計系統 User Story 定案後才開始套用於真正的功能頁面。

## 驗證契約

- 單元測試：不適用（無商業邏輯）。
- 整合測試：不適用。
- E2E 測試：不適用。
- 型別檢查：`tsc --noEmit`（admin 專案）。
- Lint：不適用（正式 lint 設定由 TASK-003 提供）。
- Build：`npm run build` 產出 `admin/dist`。
- 螢幕截圖：本地啟動後兩條路由的畫面截圖，證明骨架可運作。
- 安全性檢查：不適用（無資料、無 API 呼叫）。

## 完成證據

- 變更的檔案：
  - 新增：`admin/package.json`、`admin/vite.config.ts`、`admin/tsconfig.json`、`admin/index.html`
  - 新增：`admin/src/main.tsx`、`admin/src/pages/{LoginPage,DashboardPage}.tsx`
  - 新增：`admin/src/components/.gitkeep`、`admin/src/api/.gitkeep`
- 執行過的指令：
  - `npm install`（於 `admin/`）
  - `npx tsc --noEmit`（於 `admin/`）
  - `npm run build`（於 `admin/`）
  - `npx vite --port 5173`（本地 dev server）+ `curl http://localhost:5176/admin/login`、`/admin/`
  - `npx wrangler deploy --dry-run`（根目錄，確認讀到真實 build 產物）
- 測試輸出：
  - `vite build` → 24 modules transformed，產出 `admin/dist/index.html` + `assets/*.js`，無錯誤
  - `tsc --noEmit` → 無輸出
  - dev server 對 `/admin/login`、`/admin/` 皆回傳 200（SPA shell）
  - `wrangler deploy --dry-run` → 讀到 3 個檔案（真實 build 產物）
- 螢幕截圖：未附——兩條路由目前只是純文字 placeholder，尚未套用任何視覺樣式；真正的視覺驗證留到對應功能頁面實作、且 UI 設計系統 User Story 定案後再進行。
- 已知限制：
  1. 本機沙盒環境對 dev server 的 IPv4 loopback（127.0.0.1）連線會被拒絕，需改用 `localhost`／`::1`，屬本機環境限制，不影響實際部署行為。
  2. `admin/` 為獨立 `package.json`（非 npm workspace），root 的 lint/typecheck/build 需分別委派到 `admin/`，由 TASK-003 統一處理。
- 後續任務：Lint/Typecheck/Test/Build 與 CI（TASK-003）、UI 設計系統與風格指引（S1-S5）、各功能 Epic 的實際頁面實作。
