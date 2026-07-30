#!/usr/bin/env node
// 憑證健康檢查：驗證 Instagram/Meta access token 是否有效、能否抓到帳號與貼文。
// 讀取 .dev.vars（你自己填，不進版控）或環境變數。不修改任何資料，只做唯讀 GET。
//
// 執行：npm run check-meta
//
// 需要的值（填在 .dev.vars）：
//   INSTAGRAM_ACCOUNT_ACCESS_TOKEN=...   （必填）
//   INSTAGRAM_ACCOUNT_ID=...     （選填；沒填會嘗試用 /me 推斷）
//   META_GRAPH_API_VERSION=v21.0 （選填，預設 v21.0）
//   META_BASE_URL=...            （選填；Instagram Login 用 https://graph.instagram.com，
//                                  Facebook Login 用 https://graph.facebook.com，預設前者）
import { readFileSync } from 'node:fs';
import { MetaClient } from '../src/meta/client';

// 直接在此定義媒體回應型別，避免 import src/meta/media.ts（它會連帶拉進 D1 型別，
// 而本腳本跑在 Node、沒有 Workers 型別）。
interface RawMediaItem {
  id: string;
  media_type?: string;
  caption?: string;
}

function loadDevVars(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const text = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  } catch {
    // 沒有 .dev.vars 就只靠環境變數。
  }
  return out;
}

function get(vars: Record<string, string>, key: string): string {
  return process.env[key] ?? vars[key] ?? '';
}

const ok = (s: string) => `\x1b[32m✓\x1b[0m ${s}`;
const bad = (s: string) => `\x1b[31m✗\x1b[0m ${s}`;
const info = (s: string) => `\x1b[36mℹ\x1b[0m ${s}`;

async function main() {
  const vars = loadDevVars();
  const token = get(vars, 'INSTAGRAM_ACCOUNT_ACCESS_TOKEN');
  const accountId = get(vars, 'INSTAGRAM_ACCOUNT_ID');
  const version = get(vars, 'META_GRAPH_API_VERSION') || 'v21.0';
  const baseUrl = get(vars, 'META_BASE_URL') || 'https://graph.instagram.com';

  console.log('\n=== Meta / Instagram 憑證健康檢查 ===\n');
  console.log(info(`Graph API 版本：${version}`));
  console.log(info(`API Host：${baseUrl}`));
  console.log(info(`帳號 ID：${accountId || '(未提供，將試 /me)'}`));
  console.log('');

  if (!token || token.startsWith('<TODO') || token.startsWith('dev-')) {
    console.log(bad('INSTAGRAM_ACCOUNT_ACCESS_TOKEN 尚未填入真實值（請編輯 .dev.vars）。'));
    process.exit(1);
  }

  const client = new MetaClient({ accessToken: token, graphApiVersion: version, baseUrl });

  // 1) Token 有效性 + 帳號資訊
  const target = accountId || 'me';
  const acct = await client.get<{ id?: string; username?: string; account_type?: string; media_count?: number }>(
    target,
    { fields: 'id,username,account_type,media_count' },
  );

  if (!acct.ok) {
    console.log(bad(`取得帳號資訊失敗（HTTP ${acct.status}）。`));
    const reason = acct.failure?.nonRetryableReason;
    if (reason === 'token_invalid') {
      console.log('   → Token 無效或已過期（Meta error 190）。請重新產生 access token。');
    } else if (reason === 'permission_denied') {
      console.log('   → 權限不足。請確認 App 已取得 instagram_basic 等 scope 並通過 App Review。');
    } else {
      console.log('   → 也可能是 API Host 不對：Instagram Login 用 graph.instagram.com，');
      console.log('      Facebook Login 用 graph.facebook.com（在 .dev.vars 設 META_BASE_URL 再試）。');
    }
    process.exit(1);
  }

  console.log(ok('Token 有效，成功取得帳號：'));
  console.log(`   id=${acct.data?.id}  username=@${acct.data?.username ?? '?'}  type=${acct.data?.account_type ?? '?'}  media_count=${acct.data?.media_count ?? '?'}`);
  if (acct.data?.account_type && acct.data.account_type !== 'BUSINESS' && acct.data.account_type !== 'MEDIA_CREATOR' && acct.data.account_type !== 'CREATOR') {
    console.log('   ' + bad('注意：帳號類型看起來不是專業帳號（Business/Creator），自動化功能需要專業帳號。'));
  }

  // 2) 貼文列表（驗證 media 權限）
  const igId = accountId || acct.data?.id || '';
  const media = await client.get<{ data?: RawMediaItem[] }>(`${igId}/media`, {
    fields: 'id,media_type,caption,timestamp',
  });
  if (!media.ok) {
    console.log(bad('抓取貼文清單失敗 —— 可能缺少讀取媒體的權限。'));
  } else {
    const items = media.data?.data ?? [];
    console.log(ok(`成功抓到 ${items.length} 篇近期貼文/Reels：`));
    for (const m of items.slice(0, 5)) {
      const cap = (m.caption ?? '').slice(0, 30).replace(/\n/g, ' ');
      console.log(`   • [${m.media_type ?? '?'}] ${cap}${cap.length >= 30 ? '…' : ''}`);
    }
  }

  console.log('\n=== 檢查結束 ===');
  console.log('若上面帳號與貼文都 ✓，代表 token 與帳號串接沒問題，可以進入部署與 webhook 設定。');
  console.log('公開回覆 / Private Reply 的權限（instagram_manage_comments / instagram_manage_messages）');
  console.log('需要實際留言事件才驗證得到，且 messages 權限通常要通過 App Review。\n');
}

main().catch((e) => {
  console.error(bad('執行時發生非預期錯誤：'), e);
  process.exit(1);
});
