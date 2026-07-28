#!/usr/bin/env node
// 本機 CLI：建立第一筆 admin_users 資料的 INSERT SQL。
// 密碼只能透過 stdin 互動輸入（不接受命令列參數），避免明文密碼留在 shell history。
// 執行：npx tsx scripts/create-admin.ts
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../src/security/password';

const ENTER = '\r';
const NEWLINE = '\n';
const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const BACKSPACE = '\u007f';

if (process.argv.slice(2).length > 0) {
  console.error('此腳本不接受命令列參數（避免密碼留在 shell history）。請直接執行後依提示互動輸入。');
  process.exit(1);
}

// 統一用同一套逐字元讀取機制實作 question()/questionHidden()，避免混用
// readline.Interface 與手動 stdin 監聽（兩者對同一個 stream 的內部緩衝區
// 處理方式不同，混用在管線輸入情境下可能遺失資料）。
// 互動式 TTY 時每個 keypress 各自觸發一次 'data'；非 TTY（例如測試時用 pipe
// 灌入）時整段輸入（含多行）可能一次到齊，所以一律把收到的 chunk 拆成單一
// 字元逐一處理；遇到行結尾時，把同一個 chunk 裡尚未消費的剩餘內容 unshift
// 回 stream，讓下一次呼叫可以繼續讀到。
function readLine(query: string, options: { hidden: boolean }): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(query);
    const stdin = process.stdin;
    const isTty = Boolean(stdin.isTTY);
    stdin.resume();
    if (isTty) stdin.setRawMode?.(true);
    stdin.setEncoding('utf8');

    let input = '';
    const onData = (chunk: string) => {
      for (let i = 0; i < chunk.length; i += 1) {
        const char = chunk[i];
        if (char === NEWLINE || char === ENTER || char === CTRL_D) {
          let end = i + 1;
          if (char === ENTER && chunk[i + 1] === NEWLINE) end += 1; // 合併 \r\n
          if (isTty) stdin.setRawMode?.(false);
          stdin.removeListener('data', onData);
          stdin.pause();
          const remainder = chunk.slice(end);
          if (remainder) stdin.unshift(remainder);
          process.stdout.write('\n');
          resolve(input.trim());
          return;
        }
        if (char === CTRL_C) {
          process.stdout.write('\n');
          process.exit(1);
        }
        if (char === BACKSPACE) {
          input = input.slice(0, -1);
          continue;
        }
        input += char;
        if (!options.hidden) process.stdout.write(char);
      }
    };
    stdin.on('data', onData);
  });
}

function question(query: string): Promise<string> {
  return readLine(query, { hidden: false });
}

function questionHidden(query: string): Promise<string> {
  return readLine(query, { hidden: true });
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

async function main() {
  console.log('建立第一個 IG Comment DM Bot 管理者帳號。');
  console.log('（密碼輸入時不會顯示在畫面上；產生的 SQL 請勿貼到公開頻道或長期保留。）\n');

  const email = await question('Email: ');
  if (!email || !email.includes('@')) {
    console.error('Email 格式不正確。');
    process.exit(1);
  }

  const password = await questionHidden('Password: ');
  const passwordConfirm = await questionHidden('Confirm Password: ');
  if (password !== passwordConfirm) {
    console.error('兩次輸入的密碼不一致。');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('密碼長度至少需要 12 個字元。');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const id = randomUUID();
  const now = new Date().toISOString();

  const sql = `INSERT INTO admin_users (id, email, password_hash, created_at, updated_at) VALUES ('${id}', '${escapeSqlString(
    email,
  )}', '${escapeSqlString(passwordHash)}', '${now}', '${now}');`;

  console.log('\n產生的 SQL（請自行執行，本腳本不會直接連線到任何 D1 資料庫）：\n');
  console.log(sql);
  console.log('\n本機資料庫：npx wrangler d1 execute DB --local --command="<上面的 SQL>"');
  console.log('遠端正式環境：npx wrangler d1 execute DB --remote --command="<上面的 SQL>"');
  console.log('\n執行後請勿把上面這段 SQL（含密碼雜湊值）留在終端機紀錄或分享給他人。');

  process.exit(0);
}

main();
