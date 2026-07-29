// 密碼雜湊：迭代式 PBKDF2-HMAC-SHA256（WebCrypto，Cloudflare Workers 原生）。
//
// 為什麼是「迭代式」：Cloudflare Workers 正式 runtime 把單次 PBKDF2 迭代數硬上限
// 鎖在 100,000（超過會拋 NotSupportedError: iteration counts above 100000 are not
// supported）。而 OWASP 對 PBKDF2-HMAC-SHA256 的建議是 600,000。為同時滿足兩者，
// 我們每輪用 100,000（上限內），把前一輪的輸出當下一輪的輸入，串 6 輪 = 等效 600,000。
// 注意：本機 wrangler dev（miniflare）不強制這個上限，只有正式 workerd 會擋，務必實測。
//
// 為什麼不是 Argon2id：hash-wasm 在 Workers 禁執行期 WASM 編譯而失敗（見 decisions.md）。
export const PBKDF2_HASH = 'SHA-256';
export const PBKDF2_ITERATIONS_PER_ROUND = 100_000; // Workers 單次硬上限
export const PBKDF2_ROUNDS = 6;
export const PBKDF2_EFFECTIVE_ITERATIONS = PBKDF2_ITERATIONS_PER_ROUND * PBKDF2_ROUNDS; // 600,000
export const PBKDF2_EFFECTIVE_FLOOR = 600_000; // OWASP 建議下限，不可低於

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

async function deriveBitsOnce(
  keyBytes: Uint8Array,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  // 複製成 ArrayBuffer-backed，避免 workers-types 的 BufferSource 型別摩擦。
  const keyMaterial = await crypto.subtle.importKey('raw', new Uint8Array(keyBytes), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const saltCopy = new Uint8Array(salt);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltCopy, iterations, hash: PBKDF2_HASH },
    keyMaterial,
    DERIVED_BYTES * 8,
  );
  return new Uint8Array(bits);
}

// 串接多輪 PBKDF2：前一輪輸出當下一輪輸入，達成 rounds × perRound 的等效迭代。
async function deriveKey(
  passwordBytes: Uint8Array,
  salt: Uint8Array,
  perRound: number,
  rounds: number,
): Promise<Uint8Array> {
  let current = passwordBytes;
  for (let i = 0; i < rounds; i += 1) {
    current = await deriveBitsOnce(current, salt, perRound);
  }
  return current;
}

// 等長輸入的 constant-time 比較。
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

// 自描述編碼：pbkdf2$sha256$<perRound>x<rounds>$<saltB64>$<hashB64>
export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await deriveKey(encoder.encode(plain), salt, PBKDF2_ITERATIONS_PER_ROUND, PBKDF2_ROUNDS);
  const algo = PBKDF2_HASH.toLowerCase().replace('-', '');
  return `pbkdf2$${algo}$${PBKDF2_ITERATIONS_PER_ROUND}x${PBKDF2_ROUNDS}$${base64Encode(salt)}$${base64Encode(derived)}`;
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  const parts = hash.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false;
  const [perRoundStr, roundsStr] = parts[2].split('x');
  const perRound = Number.parseInt(perRoundStr, 10);
  const rounds = Number.parseInt(roundsStr ?? '1', 10);
  if (!Number.isInteger(perRound) || perRound <= 0 || !Number.isInteger(rounds) || rounds <= 0) {
    return false;
  }
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = base64Decode(parts[3]);
    expected = base64Decode(parts[4]);
  } catch {
    return false;
  }
  const derived = await deriveKey(encoder.encode(plain), salt, perRound, rounds);
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
