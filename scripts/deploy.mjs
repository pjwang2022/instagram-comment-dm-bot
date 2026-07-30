#!/usr/bin/env node
// 一鍵部署（npm run deploy）——使用者不需要手動建立或命名任何 Cloudflare 資源：
// 1. Queue 不存在就自動建立（wrangler 的自動開通目前不涵蓋 Queues，故在此補上）。
// 2. 建置管理後台（ASSETS binding 需要 admin/dist）。
// 3. wrangler deploy——設定檔的 D1 缺 database_id 時，wrangler（≥4.45）會自動建立
//    資料庫並把 ID 寫回 wrangler.jsonc，之後的部署保持連結。
// 4. 套用 D1 migrations（放在 deploy 之後，確保資料庫已存在；首次部署會有數秒
//    「已上線但尚無資料表」的空窗，屬可接受範圍）。
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

// 支援部署到指定環境：npm run deploy -- --env staging
// （staging 使用獨立的 Worker/D1/Queue/secrets，與正式環境零共用。）
const envIdx = process.argv.indexOf('--env');
const targetEnv = envIdx !== -1 ? process.argv[envIdx + 1] : null;
const envFlag = targetEnv ? ` --env ${targetEnv}` : '';
const QUEUE_NAME = targetEnv ? `ig-comment-events-${targetEnv}` : 'ig-comment-events';

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

// wrangler 的自動開通只會把 database_id 寫回「頂層」設定，env 區塊不會（實測）。
// 部署後若設定檔仍缺 id，從 `wrangler d1 list` 反查並寫回，migrations 才能解析 binding。
const DB_NAME = targetEnv ? `ig-comment-dm-db-${targetEnv}` : 'ig-comment-dm-db';
function ensureDatabaseId(dbName) {
  const cfg = readFileSync('wrangler.jsonc', 'utf8');
  const nameIdx = cfg.indexOf(`"database_name": "${dbName}"`);
  if (nameIdx === -1) return;
  if (cfg.slice(nameIdx, nameIdx + 200).includes('"database_id"')) return; // 已有 id
  const listJson = execSync('npx wrangler d1 list --json', { stdio: 'pipe' }).toString();
  const found = JSON.parse(listJson).find((d) => d.name === dbName);
  if (!found) return;
  const lineStart = cfg.lastIndexOf('\n', nameIdx) + 1;
  const indent = cfg.slice(lineStart, nameIdx);
  const insertAt = cfg.indexOf('\n', nameIdx);
  const updated =
    cfg.slice(0, insertAt) + `\n${indent}"database_id": "${found.uuid}",` + cfg.slice(insertAt);
  writeFileSync('wrangler.jsonc', updated);
  console.log(`已把 ${dbName} 的 database_id 寫回 wrangler.jsonc`);
}

run('npm ci --prefix admin'); // 確保 admin 依賴存在（Workers Builds 等環境只裝根目錄依賴）
run('npm run build --prefix admin');
run(`npx wrangler deploy${envFlag}`);
ensureDatabaseId(DB_NAME);
run(`npx wrangler d1 migrations apply DB --remote${envFlag}`);

console.log('\n部署完成。首次部署請立刻打開 https://<你的 Worker 網址>/admin 建立管理者帳號。');
