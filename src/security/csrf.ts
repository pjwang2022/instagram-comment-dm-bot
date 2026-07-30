// CSRF 防護：非安全方法（POST/PUT/PATCH/DELETE）驗證 Origin／Referer。
//
// 比對基準取自「請求本身的網址」（c.req.url）而非設定值：Cloudflare 依 hostname
// 路由請求，能到達本 Worker 的請求其網址必為本 Worker 的合法網域，因此
// workers.dev 與自訂網域都自動支援，無需 APP_BASE_URL 之類的設定。
//
// 安全性要點（依安全性審查）：
// - 精確比對 origin（用 URL().origin，非 startsWith），避免 evil.com 子網域繞過。
// - Origin 為字面字串 "null" 視為不可信。
// - Origin 與 Referer 皆缺失時一律拒絕（fail-closed）。
import { createMiddleware } from 'hono/factory';
import type { AppBindings } from '../app';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// 把 Origin 標頭或 Referer URL 正規化成 origin 字串；不可信時回傳 null。
export function toTrustedOrigin(value: string | undefined | null): string | null {
  if (!value || value === 'null') return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isSameOriginRequest(
  method: string,
  originHeader: string | undefined | null,
  refererHeader: string | undefined | null,
  requestUrl: string,
): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;

  const expected = toTrustedOrigin(requestUrl);
  if (!expected) return false; // 請求網址異常時 fail-closed

  const candidate = toTrustedOrigin(originHeader) ?? toTrustedOrigin(refererHeader);
  if (!candidate) return false; // 兩者皆缺失／不可信時 fail-closed

  return candidate === expected;
}

export function csrfMiddleware() {
  return createMiddleware<{ Bindings: AppBindings }>(async (c, next) => {
    const ok = isSameOriginRequest(
      c.req.method,
      c.req.header('Origin'),
      c.req.header('Referer'),
      c.req.url,
    );
    if (!ok) {
      return c.json({ error: 'CSRF 檢查失敗' }, 403);
    }
    return next();
  });
}
