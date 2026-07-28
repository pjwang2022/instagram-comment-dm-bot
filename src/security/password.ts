// 密碼雜湊：PBKDF2-HMAC-SHA256（WebCrypto，Cloudflare Workers 原生支援）。
//
// 為什麼不是 Argon2id：spec.md 第 18.1 節允許「Argon2id 或相容的安全密碼雜湊」。
// 原先規劃的 hash-wasm（Argon2id）在 Workers runtime 會失敗——它用
// WebAssembly.compile() 在執行期動態編譯 WASM，而 Workers 禁止執行期 WASM 產生
// （"Wasm code generation disallowed by embedder"，於 wrangler dev 實測確認）。
// PBKDF2 是 OWASP 列示的合規密碼雜湊，且透過 crypto.subtle 原生可用、無 WASM。
//
// 硬下限（依安全性審查精神，改以 PBKDF2 的對應強度槓桿表示，不可調降）：
// PBKDF2-HMAC-SHA256 迭代次數 ≥ 600,000（OWASP 建議下限）。若在 Workers 上撞到
// CPU 時間限制，正確處置是回報人工決策（例如升級 Workers Paid 提高 CPU 額度），
// 不得為了通過而調降迭代次數。
export const PBKDF2_HASH = 'SHA-256';
export const PBKDF2_ITERATIONS = 600_000;
export const PBKDF2_ITERATIONS_FLOOR = 600_000;

const SALT_BYTES = 16;
const DERIVED_BYTES = 32;
const encoder = new TextEncoder();

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64Decode(input: string): Uint8Array {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveBits(plain: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(plain), 'PBKDF2', false, [
    'deriveBits',
  ]);
  // 複製成 ArrayBuffer-backed 的 Uint8Array，避免 workers-types 把來源判成
  // ArrayBufferLike（可能是 SharedArrayBuffer）而與 BufferSource 型別不相容。
  const saltCopy = new Uint8Array(salt);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltCopy, iterations, hash: PBKDF2_HASH },
    keyMaterial,
    DERIVED_BYTES * 8,
  );
  return new Uint8Array(bits);
}

// 等長輸入的 constant-time 比較（推導出的 key 長度固定，防時序側 channel）。
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

// 自描述編碼：pbkdf2$sha256$<iterations>$<saltB64>$<hashB64>
export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await deriveBits(plain, salt, PBKDF2_ITERATIONS);
  const algo = PBKDF2_HASH.toLowerCase().replace('-', '');
  return `pbkdf2$${algo}$${PBKDF2_ITERATIONS}$${base64Encode(salt)}$${base64Encode(derived)}`;
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  const parts = hash.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number.parseInt(parts[2], 10);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = base64Decode(parts[3]);
    expected = base64Decode(parts[4]);
  } catch {
    return false;
  }
  const derived = await deriveBits(plain, salt, iterations);
  return timingSafeEqual(derived, expected);
}

let dummyHashPromise: Promise<string> | null = null;

// 供登入 API 做 timing equalization：Email 不存在時，仍對這個固定 hash 跑一次
// verifyPassword，讓耗時與「密碼錯誤」情境同一量級，避免時序側 channel 洩漏帳號是否存在。
export function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword('timing-equalization-dummy-password');
  }
  return dummyHashPromise;
}
