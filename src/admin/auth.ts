// 登入／登出 Admin API 與 requireAdminAuth middleware。
// 組裝 password（TASK-007）、session/csrf/rate-limit（TASK-008）成完整登入流程。
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { AppBindings } from '../app';
import { createDb } from '../database/client';
import { adminUsers, auditLogs } from '../database/schema';
import { csrfMiddleware } from '../security/csrf';
import { getDummyHash, hashPassword, verifyPassword } from '../security/password';
import { adminApiRateLimitMiddleware, loginRateLimitMiddleware } from '../security/rate-limit';
import {
  SESSION_COOKIE_NAME,
  createSessionCookie,
  serializeClearedSessionCookie,
  serializeSessionCookie,
  verifySessionCookie,
} from '../security/session';

export const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 小時

type AuthEnv = {
  Bindings: AppBindings;
  Variables: { adminUserId: string };
};

async function writeAuditLog(
  env: AppBindings,
  entry: { adminUserId: string | null; action: string; ipAddress: string | null; metadata?: object },
): Promise<void> {
  try {
    const db = createDb(env.DB);
    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      adminUserId: entry.adminUserId,
      action: entry.action,
      entityType: 'admin_session',
      entityId: entry.adminUserId,
      // metadata 不得包含密碼/雜湊/cookie 內容（spec.md 第 21 節）。
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      ipAddress: entry.ipAddress,
    });
  } catch {
    // 稽核寫入失敗不應阻斷登入流程本身，但不吞掉錯誤語意——保留給 logger 之後接線。
  }
}

// 驗證 Session Cookie，成功把 adminUserId 放進 context，失敗回 401。
export function requireAdminAuth() {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const cookie = getCookie(c, SESSION_COOKIE_NAME);
    const result = await verifySessionCookie(c.env.ADMIN_SESSION_SECRET, cookie);
    if (!result.valid) {
      return c.json({ error: '未授權' }, 401);
    }
    c.set('adminUserId', result.payload.sub);
    return next();
  });
}

// 與 scripts/create-admin.ts 相同的密碼下限。
const MIN_PASSWORD_LENGTH = 12;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createAuthRoutes() {
  const auth = new Hono<AuthEnv>();

  // GET /api/admin/auth/setup-status
  // 公開端點：登入頁以此決定顯示「登入」或「首次設定」表單。只回布林，不洩漏其他資訊。
  auth.get('/setup-status', async (c) => {
    const db = createDb(c.env.DB);
    const rows = await db.select({ id: adminUsers.id }).from(adminUsers).limit(1);
    return c.json({ needsSetup: rows.length === 0 });
  });

  // POST /api/admin/auth/setup
  // 首次啟動設定：僅在 admin_users 為空時允許建立第一個（唯一的）管理者帳號，之後永久 403。
  // 讓一鍵部署的使用者不需開 terminal 就能完成後台設定；CLI 備援見 scripts/create-admin.ts。
  // 掛載順序比照 login：CSRF（Origin 驗證）→ 登入頻率限制。
  auth.post('/setup', csrfMiddleware(), loginRateLimitMiddleware(), async (c) => {
    const ip = c.req.header('CF-Connecting-IP') ?? null;

    let body: { email?: unknown; password?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: '請求格式錯誤' }, 400);
    }
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!EMAIL_PATTERN.test(email)) {
      return c.json({ error: 'Email 格式不正確' }, 400);
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return c.json({ error: `密碼長度至少需要 ${MIN_PASSWORD_LENGTH} 個字元` }, 400);
    }

    const db = createDb(c.env.DB);
    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();

    // 原子性防搶註：單一 INSERT ... WHERE NOT EXISTS，併發請求只會有一個寫入成功。
    await db.run(sql`
      INSERT INTO admin_users (id, email, password_hash, created_at, updated_at)
      SELECT ${id}, ${email}, ${passwordHash}, ${now}, ${now}
      WHERE NOT EXISTS (SELECT 1 FROM admin_users)
    `);
    const inserted = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
    if (!inserted[0]) {
      await writeAuditLog(c.env, {
        adminUserId: null,
        action: 'admin.setup.rejected',
        ipAddress: ip,
      });
      return c.json({ error: '系統已完成初始設定' }, 403);
    }

    // 建立成功即發 Session（免再登入一次）。
    const cookie = await createSessionCookie(c.env.ADMIN_SESSION_SECRET, id, SESSION_TTL_SECONDS);
    c.header('Set-Cookie', serializeSessionCookie(cookie, SESSION_TTL_SECONDS));
    await writeAuditLog(c.env, {
      adminUserId: id,
      action: 'admin.setup.success',
      ipAddress: ip,
    });
    return c.json({ ok: true });
  });

  // GET /api/admin/auth/me——回傳目前登入者的 Email（頁首顯示用）。
  auth.get('/me', requireAdminAuth(), adminApiRateLimitMiddleware(), async (c) => {
    const db = createDb(c.env.DB);
    const rows = await db
      .select({ email: adminUsers.email })
      .from(adminUsers)
      .where(eq(adminUsers.id, c.get('adminUserId')))
      .limit(1);
    if (!rows[0]) return c.json({ error: '未授權' }, 401);
    return c.json({ email: rows[0].email });
  });

  // POST /api/admin/auth/login
  // CSRF（Origin 驗證）→ 登入頻率限制 → 帳密驗證。登入用專屬的 login 限流（每 IP 15 分鐘），
  // 不套一般 admin-api 限流。
  auth.post('/login', csrfMiddleware(), loginRateLimitMiddleware(), async (c) => {
    const ip = c.req.header('CF-Connecting-IP') ?? null;

    let body: { email?: unknown; password?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: '請求格式錯誤' }, 400);
    }
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) {
      return c.json({ error: '請輸入 Email 與密碼' }, 400);
    }

    const db = createDb(c.env.DB);
    const rows = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.email, email))
      .limit(1);
    const user = rows[0];

    // Timing equalization：帳號不存在時也對 dummy hash 跑一次驗算，
    // 讓「帳號不存在」與「密碼錯誤」耗時量級一致，防時序型帳號列舉。
    const hashToCheck = user ? user.passwordHash : await getDummyHash();
    const passwordOk = await verifyPassword(password, hashToCheck);

    if (!user || !passwordOk) {
      await writeAuditLog(c.env, {
        adminUserId: user ? user.id : null,
        action: 'admin.login.failure',
        ipAddress: ip,
      });
      // 一致的錯誤格式，不洩漏帳號存在與否。
      return c.json({ error: 'Email 或密碼錯誤' }, 401);
    }

    const cookie = await createSessionCookie(c.env.ADMIN_SESSION_SECRET, user.id, SESSION_TTL_SECONDS);
    c.header('Set-Cookie', serializeSessionCookie(cookie, SESSION_TTL_SECONDS));
    await writeAuditLog(c.env, {
      adminUserId: user.id,
      action: 'admin.login.success',
      ipAddress: ip,
    });
    return c.json({ ok: true });
  });

  // POST /api/admin/auth/logout
  // 這是「會修改資料的 Admin API」的掛載慣例範例：CSRF → 驗證登入 → 一般 admin-api 限流。
  // 後續功能 Epic 的修改型 Admin API 都比照這個順序掛載。
  auth.post(
    '/logout',
    csrfMiddleware(),
    requireAdminAuth(),
    adminApiRateLimitMiddleware(),
    async (c) => {
      const ip = c.req.header('CF-Connecting-IP') ?? null;
      c.header('Set-Cookie', serializeClearedSessionCookie());
      await writeAuditLog(c.env, {
        adminUserId: c.get('adminUserId'),
        action: 'admin.logout',
        ipAddress: ip,
      });
      return c.json({ ok: true });
    },
  );

  return auth;
}
