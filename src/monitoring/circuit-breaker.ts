// 自動熔斷評估（spec.md 第 19 節）。純函式：吃「近期發送結果」與設定，回傳是否該開熔斷。
// 實際狀態寫入 instagram_accounts.circuit_breaker_status 由呼叫端負責。

export interface AttemptOutcome {
  // 這次呼叫的分類結果。
  ok: boolean;
  reason?: 'token_invalid' | 'permission_denied' | 'policy_restricted' | 'other';
  // Unix 毫秒。
  at: number;
}

export interface CircuitBreakerInput {
  // 最近的發送嘗試，時間新到舊或舊到新皆可（內部自行處理）。
  recentAttempts: AttemptOutcome[];
  now: number;
  dailySentCount: number;
  dailyLimit: number | null;
}

export interface CircuitBreakerDecision {
  open: boolean;
  reason: string | null;
}

const CONSECUTIVE_THRESHOLD = 5;
const ERROR_RATE_WINDOW_MS = 5 * 60 * 1000;
const ERROR_RATE_MIN_CALLS = 10;
const ERROR_RATE_THRESHOLD = 0.2;

export function evaluateCircuitBreaker(input: CircuitBreakerInput): CircuitBreakerDecision {
  const attempts = [...input.recentAttempts].sort((a, b) => a.at - b.at);

  // 每日發送量超過上限。
  if (input.dailyLimit != null && input.dailySentCount > input.dailyLimit) {
    return { open: true, reason: 'daily_limit_exceeded' };
  }

  // 收到明確政策限制錯誤。
  if (attempts.some((a) => a.reason === 'policy_restricted')) {
    return { open: true, reason: 'policy_restricted' };
  }

  // 連續 5 次 Token 無效 / 連續 5 次權限錯誤（看最尾端的連續段）。
  const tail = attempts.slice(-CONSECUTIVE_THRESHOLD);
  if (tail.length === CONSECUTIVE_THRESHOLD) {
    if (tail.every((a) => a.reason === 'token_invalid')) {
      return { open: true, reason: 'consecutive_token_invalid' };
    }
    if (tail.every((a) => a.reason === 'permission_denied')) {
      return { open: true, reason: 'consecutive_permission_denied' };
    }
  }

  // 5 分鐘內至少 10 次呼叫且錯誤率 > 20%。
  const windowStart = input.now - ERROR_RATE_WINDOW_MS;
  const inWindow = attempts.filter((a) => a.at >= windowStart);
  if (inWindow.length >= ERROR_RATE_MIN_CALLS) {
    const errors = inWindow.filter((a) => !a.ok).length;
    if (errors / inWindow.length > ERROR_RATE_THRESHOLD) {
      return { open: true, reason: 'error_rate_exceeded' };
    }
  }

  return { open: false, reason: null };
}
