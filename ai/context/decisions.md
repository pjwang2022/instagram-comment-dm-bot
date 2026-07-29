# 決策紀錄

記錄未來 agent 不該重新摸索一次的持久性決策。

## 範本

```text
日期：
決策：
情境：
考慮過的替代方案：
為何選這個：
影響：
```

## 紀錄

```text
日期：2026-07-28
決策：資料清理排程（每日清理過期 webhook_events payload／api_attempts 明細，spec.md 第 20 節）本階段（project-kickoff）不建立對應 Epic/User Story，暫不實作。
情境：project-kickoff 時原提議併入「執行紀錄與可觀測性儀表板」Epic，管理者最終決定先不做。
考慮過的替代方案：獨立成第 7 個 Epic；併入「執行紀錄與可觀測性儀表板」Epic 底下一個 User Story。
為何選這個：MVP 第一版先接受 webhook_events／api_attempts 資料無限累積的風險，之後有需要再補一張任務卡。
影響：D1 免費方案 500MB 上限可能隨時間被大量原始 payload 佔滿；未來若要補做，直接在「執行紀錄與可觀測性儀表板」Epic 底下新增「資料清理排程」User Story 即可，不必重新討論該不該做。
```

```text
日期：2026-07-28
決策：管理者密碼雜湊改用 PBKDF2-HMAC-SHA256（WebCrypto，600,000 迭代），不用原先規劃的 Argon2id（hash-wasm）。
情境：TASK-007 原採 hash-wasm 的 Argon2id。TASK-010 在 wrangler dev 實測時發現 hash-wasm 在 Cloudflare Workers runtime 會拋 "CompileError: WebAssembly.compile(): Wasm code generation disallowed by embedder"——Workers 禁止執行期動態編譯 WASM，而 hash-wasm 正是用 WebAssembly.compile() 從內嵌 bytes 產生模組。單元測試在 Node 環境不會抓到（Node 允許 WASM compile），只有真的用 wrangler dev 跑才會現形。
考慮過的替代方案：(1) 找支援「靜態 import .wasm 模組」的 Argon2 函式庫（Workers 允許靜態 WASM import，但需額外整合與驗證，複雜度高）；(2) 純 JS scrypt（CPU 重、易撞 Workers CPU 限制）；(3) PBKDF2 via WebCrypto crypto.subtle（Workers 原生、無 WASM、OWASP 列示合規密碼雜湊）。
為何選這個：spec.md 第 18.1 節明文允許「Argon2id 或相容的安全密碼雜湊」，PBKDF2 是 OWASP 列示的合規選項且 Workers 原生支援；hashPassword/verifyPassword/getDummyHash 介面不變，TASK-008/009 幾乎不受影響。迭代次數硬下限設 600,000（OWASP 建議），沿用安全性審查「不得為遷就 CPU 限制調降安全參數」的精神。
影響：密碼雜湊字串格式為 pbkdf2$sha256$<iterations>$<saltB64>$<hashB64>（自描述，日後可提高迭代數並用舊 hash 內記錄的迭代數驗證）。wrangler dev 本機 isolate 實測單次登入約 93ms wall（含 D1 查詢＋PBKDF2＋簽章）；正式環境 Workers CPU 限制下的表現需再確認，若撞限制應循「回報人工決策／升級 CPU 額度」而非調降迭代數。已在 TASK-007 卡片與 src/security/password.ts 檔頭記錄。teaching：Workers runtime 專屬限制（禁 WASM 執行期編譯、CPU 時間）務必在 wrangler dev 實測驗證，Node 單元測試綠燈不代表 Workers 能跑。
```

```text
日期：2026-07-28
決策：Private Reply 的連結按鈕（buttonText/buttonUrl）由 spec.md §10 的「必要」改為「選填」；私訊內容欄位名稱從「Opening DM」改為「私訊內容」。
情境：使用者看到編輯器後反映：只發一則訊息、不需要 ManyChat 式的「Opening + 按鈕」結構，連結直接貼在文字裡即可。
考慮過的替代方案：(A) 完全移除按鈕、只留純文字；(B) 純文字 + 選填按鈕（使用者選 B）。
為何選這個：後端 sendPrivateReply 本來就兩種都支援（按鈕文字/網址皆有才組 button template，否則發純文字 {text}），所以純介面調整；保留選填按鈕是因為 IG 私訊裡純文字連結不保證可點，需要時可加按鈕確保可點擊 CTA。
影響：編輯器預設只顯示「私訊內容」文字框；「加上可點擊的連結按鈕（選填）」預設不勾、勾了才出現按鈕文字/網址。未勾時前端送空字串 → 後端發純文字。啟用驗證的 button_url_invalid 只在有填 buttonUrl 時觸發，故純文字可正常啟用。**未來的 agent 不要把按鈕改回強制**，這是使用者明確要的產品簡化。「Opening DM」用語已廢棄（那是多步驟 flow 的用語，本系統只發一則）。
```

```text
日期：2026-07-29
決策：密碼雜湊改為「迭代式 PBKDF2」——每輪 100,000、串 6 輪 = 等效 600,000。
情境：部署到正式 Cloudflare Workers 後登入回 500，wrangler tail 抓到 NotSupportedError：Workers 正式 runtime 把 PBKDF2 單次迭代上限鎖在 100,000（本機 wrangler dev 不擋，只有正式環境爆）。
考慮過的替代方案：(A) 直接降到 100,000（低於 OWASP 600k 建議）；(B) 迭代式串接 6×100k=600k（選 B）。
為何選這個：守住安全性審查的「等效 ≥ 600,000」下限，同時符合 Workers 的 100k 單次上限。編碼 pbkdf2$sha256$100000x6$salt$hash 自描述、日後可調輪數。正式環境實測登入約 1.3–2.7s（可接受，登入不頻繁；timing equalization 仍成立）。
影響：既有 dev 環境用 600000 單次格式產生的 hash 無法被新版驗證（格式不同），但那只有本機測試帳號；正式環境的 admin 帳號用新格式重新建立即可。教訓見記憶 workers-pbkdf2-100k-cap。
```
