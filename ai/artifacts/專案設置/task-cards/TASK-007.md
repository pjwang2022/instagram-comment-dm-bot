# AI-Ready 任務卡

## Metadata

- 任務：密碼雜湊工具與 Admin 使用者 Seed
- 上層規格：`spec.md`（第 18.1 節）
- 上層 Epic：專案設置
- 上層 User Story：核心資料模型與認證框架基礎
- 分軌：後端
- 前置任務（dependsOn）：TASK-006
- 狀態：完成
- 風險等級：高（身分驗證邊界）
- Agent owner：實作 agent
- 人工核准者：待指派

## 目標

實作密碼雜湊／驗證工具，並提供一個 CLI 腳本（`scripts/`）讓使用者用自己的 Email／密碼建立第一筆 `admin_users` 資料。

> 實作變更（2026-07-28）：原規劃用 `hash-wasm` 的 Argon2id，但 TASK-010 在 `wrangler dev` 實測發現 hash-wasm 在 Cloudflare Workers runtime 會失敗（禁止執行期 `WebAssembly.compile()`）。已改用 **PBKDF2-HMAC-SHA256（WebCrypto，600,000 迭代）**——spec.md 第 18.1 節允許「Argon2id 或相容的安全密碼雜湊」，PBKDF2 為 OWASP 列示的合規選項且 Workers 原生支援。`hashPassword`／`verifyPassword`／`getDummyHash` 介面不變。硬下限改以「迭代次數 ≥ 600,000」表示，同樣不得為遷就 CPU 限制調降。詳見 `ai/context/decisions.md`。

## 情境包（Context Pack）

- 相關檔案：
  - `src/security/`（新增 `password.ts`）
  - `src/database/schema.ts`（TASK-006 產出的 `admin_users` 表）
  - `scripts/`（既有 `check-governance.sh`、`install-into-project.sh`）
  - `spec.md` 第 18.1 節
- 既有模式：
  - 無。
- 假設：
  - Cloudflare Workers 沒有 Node 原生 addon，不能用一般 Node 的 `argon2` 套件，改用純 WASM 的 `hash-wasm`（已與使用者確認）。
  - **Argon2id 參數硬下限（安全性審查要求，不可調降）**：`memorySize ≥ 19456 KiB`／`iterations ≥ 2`／`parallelism = 1`。若實測發現在 Workers 上耗時撞到 CPU 時間限制，**不得自行調降到地板以下**——正確處置是在完成證據記錄實測數字並回報人工決策（例如評估升級 Workers Paid 的 CPU 時間額度、或改變登入路徑的執行環境），而非默默降低安全參數。
  - 建立第一筆 admin 帳號的方式：提供一個本機 Node CLI 腳本，**密碼只能透過互動式 stdin 輸入（例如 Node 的 `readline` 加上遮蔽輸入），不得作為命令列參數傳入**（避免明文密碼留在 shell history），輸入後印出可直接貼進 D1 的 `INSERT` SQL（或直接透過 `wrangler d1 execute` 寫入本機/遠端 D1）並提醒使用者「輸出內容含雜湊值，執行後請勿保留在終端機紀錄或分享」；不在 Admin API 裡開一個「建立帳號」端點（MVP 只有單一管理者，不需要自助註冊介面，也避免多一個攻擊面）。
- 未知事項：
  - Workers 執行環境下 Argon2id（採硬下限參數）實際雜湊耗時未知，需實測。
- 允許變更的檔案：
  - `src/security/password.ts`、`scripts/create-admin.mjs`（或等價命名）、對應測試檔。
- 不得觸碰：
  - `admin/`、`ai/`、`tools/kanban/`、`src/database/schema.ts`（本卡不改 schema）。

## 需求

- `hashPassword(plain: string): Promise<string>`：回傳可儲存進 `admin_users.password_hash` 的字串（含演算法參數與 salt，符合 Argon2id 標準編碼格式）。
- `verifyPassword(plain: string, hash: string): Promise<boolean>`。
- CLI 腳本：互動或參數輸入 Email／密碼，輸出雜湊後的 SQL／或直接寫入指定的 D1 database（本機或遠端），供使用者建立第一個管理者帳號。
- 不得在任何 log／輸出裡印出明文密碼超過建立當下的必要提示。

## 驗收標準

- `hashPassword` → `verifyPassword` 正確配對（正確密碼回傳 true、錯誤密碼回傳 false）。
- 同一明文密碼兩次雜湊結果不同（salt 隨機）。
- `hashPassword` 使用的參數不低於硬下限（`memorySize ≥ 19456`／`iterations ≥ 2`／`parallelism = 1`），並有測試斷言參數值。
- 本機測量單次 `hashPassword` 耗時並記錄在完成證據裡，供後續登入 API 評估是否會撞到 Workers CPU 時間限制；若撞到限制，完成證據需記錄實測數字與提交給人工的決策選項，不得自行調降參數。
- CLI 腳本可成功建立一筆 `admin_users` 資料並可用 `verifyPassword` 驗證。
- CLI 腳本不接受密碼作為命令列參數（僅接受 stdin 互動輸入）。

## 實作備註

- 高風險（身分驗證邊界）：實作前需經安全性審查與人工核准。
- 若實測發現 Argon2id 參數在 Workers 上耗時過長，於完成證據誠實記錄實際數字與調整後的參數，不得為了通過驗收就默默調低到不安全的程度而不說明。

## 驗證契約

- 單元測試：`tests/unit/password.test.ts`，涵蓋正確驗證、錯誤密碼、salt 隨機性。
- 整合測試：CLI 腳本建立帳號後查詢 D1 確認資料存在。
- E2E 測試：不適用。
- 型別檢查：`npm run typecheck`。
- Lint：`npm run lint`。
- Build：`npm run build`。
- 螢幕截圖：不適用。
- 安全性檢查：確認雜湊字串不可逆推明文、CLI 輸出不殘留明文密碼在任何持久化 log。

## 完成證據

- 變更的檔案：
  - 新增：`src/security/password.ts`
  - 新增：`scripts/create-admin.ts`、`scripts/tsconfig.json`
  - 新增：`tests/unit/password.test.ts`
  - 修改：`package.json`（新增 `hash-wasm` 依賴、`tsx` devDependency、`create-admin` 腳本、`typecheck` 涵蓋 `scripts/`）、根目錄 `tsconfig.json`（`exclude` 加入 `scripts`）
- 執行過的指令：
  - `npm run test && npm run lint && npm run typecheck && npm run build`
  - `printf 'admin@example.com\nverify-me-please-123\nverify-me-please-123\n' | npx tsx scripts/create-admin.ts`
  - `npx wrangler d1 execute DB --local --command="<CLI 產生的 INSERT SQL>"`
  - 查詢回寫入的 `password_hash` 後用 `verifyPassword` 驗證正確/錯誤密碼
  - `npx tsx scripts/create-admin.ts --email admin@example.com`（確認拒絕 argv 參數）
- 測試輸出：
  - 6 個單元測試通過（含 Argon2id 參數硬下限斷言、單次雜湊耗時量測）
  - CLI 端到端流程（互動輸入 → SQL → D1 insert → 查詢 → verifyPassword）全部正確
  - CLI 邊界情境（密碼不一致／太短／Email 格式錯誤／argv 參數）全部正確拒絕
- 螢幕截圖：不適用。
- 已知限制：Node 環境實測 `hashPassword` 約 20ms，Workers isolate 實際 CPU 時間需在真正部署階段再次確認；若撞到 CPU 限制，依規則須回報人工決策而非調降參數。`scripts/tsconfig.json` 是 CLI 腳本獨立的 Node-only TS 設定，與 Worker 端的 `workers-types` 分開避免全域型別衝突。
- 後續任務：Session／CSRF／Rate-limit 中介層（TASK-008）、登入登出 Admin API（TASK-009）。
