import { Hono } from 'hono';
import { createAdminRoutes } from './admin/routes';
import { createDb } from './database/client';
import { instagramAccounts } from './database/schema';
import type { CommentEventMessage } from './queue/producer';
import { createWebhookRoutes } from './webhook/routes';

// Cloudflare 原生 Rate Limiting binding 的最小介面（wrangler 4.86 的 ratelimits）。
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export type AppBindings = {
  DB: D1Database;
  COMMENT_QUEUE: Queue<CommentEventMessage>;
  ASSETS: Fetcher;
  ADMIN_RATE_LIMITER: RateLimiter;
  INSTAGRAM_APP_SECRET: string;
  WEBHOOK_VERIFY_TOKEN: string;
  INSTAGRAM_ACCOUNT_ACCESS_TOKEN: string;
  ADMIN_SESSION_SECRET: string;
  META_GRAPH_API_VERSION: string;
  META_BASE_URL?: string;
  APP_ENV: string;
  LOG_LEVEL: string;
};

export function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();

  // 根路徑導向後台登入頁。靜態資產的 index.html 在 / 會渲染空白（SPA base 是 /admin），
  // 因此 wrangler.jsonc 的 assets.run_worker_first 讓 / 先進 Worker、走這條 302。
  app.get('/', (c) => c.redirect('/admin', 302));

  app.get('/api/health', (c) => c.json({ status: 'ok' }));

  // 隱私政策頁（Meta App 上線審核要求提供公開網址）。
  // 聯絡方式用 Instagram 帳號私訊（自動取自已註冊的帳號），不顯示管理者 Email——
  // 那是登入憑證的一半，公開等於送攻擊者半組帳密、也成為釣魚目標。
  app.get('/privacy', async (c) => {
    let contactHtml = '請透過本服務綁定之 Instagram 帳號的私訊（DM）聯絡我們。';
    try {
      const accounts = await createDb(c.env.DB)
        .select({ username: instagramAccounts.username })
        .from(instagramAccounts)
        .limit(1);
      const username = accounts[0]?.username;
      if (username) {
        const safe = username.replace(/[^A-Za-z0-9._]/g, '');
        contactHtml = `Instagram 私訊：<a href="https://www.instagram.com/${safe}/" rel="noopener">@${safe}</a>`;
      }
    } catch {
      // 資料庫尚未就緒時仍應能顯示隱私政策頁。
    }
    return c.html(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隱私政策 — Instagram Comment DM Bot</title><style>body{font-family:system-ui,-apple-system,'PingFang TC','Microsoft JhengHei',sans-serif;max-width:680px;margin:40px auto;padding:0 20px;line-height:1.7;color:#0f172a}h1{font-size:24px}h2{font-size:17px;margin-top:28px}p,li{font-size:15px;color:#334155}</style></head><body>
<h1>隱私政策</h1>
<p>本服務（Instagram Comment DM Bot）為單一管理者自用的 Instagram 留言自動回覆工具。</p>
<h2>資料的蒐集與使用</h2>
<ul>
<li>本服務僅處理使用者主動在管理者指定貼文下發表的公開留言（留言文字、留言者公開名稱與 ID），用途僅限於依關鍵字規則進行一次性的公開回覆與一則私訊回覆。</li>
<li>本服務不會將留言者加入任何行銷名單、不會主動或定期發送行銷訊息、不會將資料提供給第三方。</li>
</ul>
<h2>資料的保存與刪除</h2>
<ul>
<li>留言事件與執行紀錄僅保存於管理者自行部署的資料庫，作為執行紀錄用途。</li>
<li>如希望刪除與您相關的紀錄，請透過下方聯絡方式提出，我們將於合理期間內刪除。</li>
</ul>
<h2>聯絡方式</h2>
<p>${contactHtml}</p>
<p>更新日期：2026-07-29</p>
</body></html>`);
  });

  app.route('/api/admin', createAdminRoutes());
  app.route('/api/webhooks', createWebhookRoutes());

  // 管理後台 SPA（React）由 ASSETS binding 提供。ASSETS 目錄對應網址根目錄，但前端
  // build base 是 /admin/，因此在此把 /admin 前綴映射到實際 asset 路徑：
  // - /admin/assets/xxx → 去掉 /admin 前綴取檔案
  // - /admin 或其他前端路由 → 回傳 index.html（SPA client-side routing）
  app.get('/admin', (c) =>
    c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url))),
  );
  app.get('/admin/*', (c) => {
    const url = new URL(c.req.url);
    const stripped = url.pathname.replace(/^\/admin/, '') || '/';
    const isFile = /\.[a-zA-Z0-9]+$/.test(stripped);
    const target = isFile ? stripped : '/index.html';
    return c.env.ASSETS.fetch(new Request(new URL(target, url.origin)));
  });

  return app;
}
