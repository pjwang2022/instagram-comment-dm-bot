# TASK-029 — UI 設計系統（清爽專業風）+ 登入/儀表板套用

- Epic：專案設置 ／ US：UI 設計系統與風格指引｜前端｜風險：低｜狀態：完成

## 背景
管理者反映無樣式頁面「太誇張」。載入 pro-ui-ux skill，提供 3 個視覺方向讓使用者選（清爽專業/現代深色/IG 暖調），選定「清爽專業風」。

## 目標
建立 design token 系統與自建元件樣式，套用到登入頁與儀表板；定案寫入 design-system.md。

## 交付
- `admin/src/styles/tokens.css`：CSS variables（slate 灰階、indigo 主色、語意色、字級 scale、4 倍數間距、圓角、陰影）
- `admin/src/styles/app.css`：Button/Input/Card/Stat/Table/Badge/Alert/Header/空狀態，深度只用陰影
- 重寫 `LoginPage.tsx`、`DashboardPage.tsx` 套用 token/元件
- `ai/context/design-system.md`：S1-S5 定案（單一事實來源）

## 驗證
Chrome headless 截圖確認 production 級視覺；全專案 129 測試通過，lint/typecheck/build 全綠。

## 已知限制
實作先行、事後補登 design-system.md（經使用者選定方向核准），未跑完整五關卡；暗色模式未做；其他後台頁面 UI 未實作。
