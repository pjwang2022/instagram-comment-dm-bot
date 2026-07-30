#!/usr/bin/env node
// 一鍵部署（npm run deploy）——使用者不需要手動建立或命名任何 Cloudflare 資源：
// 1. Queue 不存在就自動建立（wrangler 的自動開通目前不涵蓋 Queues，故在此補上）。
// 2. 建置管理後台（ASSETS binding 需要 admin/dist）。
// 3. wrangler deploy——設定檔的 D1 缺 database_id 時，wrangler（≥4.45）會自動建立
//    資料庫並把 ID 寫回 wrangler.jsonc，之後的部署保持連結。
// 4. 套用 D1 migrations（放在 deploy 之後，確保資料庫已存在；首次部署會有數秒
//    「已上線但尚無資料表」的空窗，屬可接受範圍）。
import { execSync } from 'node:child_process';

const QUEUE_NAME = 'ig-comment-events';

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

try {
  execSync(`npx wrangler queues create ${QUEUE_NAME}`, { stdio: 'pipe' });
  console.log(`已建立 Queue：${QUEUE_NAME}`);
} catch {
  // 幾乎都是「Queue 已存在」（正常情況）。若是未登入等其他問題，
  // 後面的 wrangler deploy 會失敗並顯示明確的錯誤訊息。
  console.log(`Queue ${QUEUE_NAME} 已存在，略過建立。`);
}

run('npm run build --prefix admin');
run('npx wrangler deploy');
run('npx wrangler d1 migrations apply DB --remote');

console.log('\n部署完成。首次部署請立刻打開 https://<你的 Worker 網址>/admin 建立管理者帳號。');
