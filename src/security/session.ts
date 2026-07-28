// 無狀態簽章 Session Cookie（HMAC-SHA256 over ADMIN_SESSION_SECRET）。
// 格式：base64url(JSON payload).base64url(HMAC signature)
//
// 安全性要點（依安全性審查）：
// - 簽章驗證用 crypto.subtle.verify（原生即 constant-time），不自行字串比較。
// - exp 缺失／非數字／已過期一律 fail-closed（不得預設永久有效）。
// - payload 帶 kid（secret 版本）：MVP 固定 "1"；未來輪替 ADMIN_SESSION_SECRET
//   即可讓全部既有 session 失效（無狀態設計下的撤銷方案，不建 sessions 表）。

export interface SessionPayload {
  sub: string; // admin_user_id
  kid: string; // secret 版本，MVP 固定 KID_CURRENT
  iat: number; // 簽發時間（Unix 秒）
  exp: number; // 過期時間（Unix 秒）
}

export const KID_CURRENT = '1';
export const SESSION_COOKIE_NAME = 'ig_admin_session';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function createSessionCookie(
  secret: string,
  adminUserId: string,
  ttlSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: adminUserId,
    kid: KID_CURRENT,
    iat: now,
    exp: now + ttlSeconds,
  };
  const payloadB64 = base64urlEncode(encoder.encode(JSON.stringify(payload)));
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64));
  const signatureB64 = base64urlEncode(new Uint8Array(signature));
  return `${payloadB64}.${signatureB64}`;
}

export type SessionVerifyResult =
  | { valid: true; payload: SessionPayload }
  | { valid: false };

export async function verifySessionCookie(
  secret: string,
  cookieValue: string | undefined | null,
): Promise<SessionVerifyResult> {
  if (!cookieValue || typeof cookieValue !== 'string') return { valid: false };

  const parts = cookieValue.split('.');
  if (parts.length !== 2) return { valid: false };
  const [payloadB64, signatureB64] = parts;
  if (!payloadB64 || !signatureB64) return { valid: false };

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64urlDecode(signatureB64);
  } catch {
    return { valid: false };
  }

  const key = await importKey(secret);
  let verified: boolean;
  try {
    verified = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(payloadB64));
  } catch {
    return { valid: false };
  }
  if (!verified) return { valid: false };

  let payload: SessionPayload;
  try {
    payload = JSON.parse(decoder.decode(base64urlDecode(payloadB64)));
  } catch {
    return { valid: false };
  }

  // fail-closed 檢查：sub 必須是非空字串，exp 必須是有限數字且尚未過期。
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return { valid: false };
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return { valid: false };
  const now = Math.floor(Date.now() / 1000);
  if (now >= payload.exp) return { valid: false };

  return { valid: true, payload };
}

// Set-Cookie 序列化（屬性依 spec.md 第 18.1 節）。
export function serializeSessionCookie(value: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function serializeClearedSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
