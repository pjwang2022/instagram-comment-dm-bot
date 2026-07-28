// Meta Webhook 簽章驗證（spec.md 第 18.3 節）。
// - 用原始 Request Body（bytes），不重新序列化。
// - 用 Meta App Secret 算 HMAC-SHA256。
// - 與 X-Hub-Signature-256 標頭（格式 "sha256=<hex>"）做 constant-time 比對。
const encoder = new TextEncoder();

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    bytes[i] = byte;
  }
  return bytes;
}

// 等長輸入的 constant-time 比較。
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

// rawBody：原始 request body 的 bytes（用 ArrayBuffer 或 Uint8Array）。
// signatureHeader：X-Hub-Signature-256 標頭值，例如 "sha256=abcd...".
export async function verifyWebhookSignature(
  appSecret: string,
  rawBody: ArrayBuffer | Uint8Array,
  signatureHeader: string | undefined | null,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const prefix = 'sha256=';
  if (!signatureHeader.startsWith(prefix)) return false;
  const providedHex = signatureHeader.slice(prefix.length).trim().toLowerCase();
  const providedBytes = hexToBytes(providedHex);
  if (!providedBytes) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bodyBytes = rawBody instanceof Uint8Array ? new Uint8Array(rawBody) : new Uint8Array(rawBody);
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, bodyBytes));

  return timingSafeEqual(providedBytes, expected);
}
