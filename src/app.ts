import { Hono } from 'hono';
import { createAdminRoutes } from './admin/routes';
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
  META_APP_SECRET: string;
  META_VERIFY_TOKEN: string;
  INSTAGRAM_ACCESS_TOKEN: string;
  ADMIN_SESSION_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
  META_GRAPH_API_VERSION: string;
  META_BASE_URL?: string;
  INSTAGRAM_ACCOUNT_ID: string;
  APP_ENV: string;
  APP_BASE_URL: string;
  ADMIN_EMAIL: string;
  LOG_LEVEL: string;
};

export function createApp() {
  const app = new Hono<{ Bindings: AppBindings }>();

  app.get('/api/health', (c) => c.json({ status: 'ok' }));

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
