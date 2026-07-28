// 應用層重試策略（spec.md 第 12.3 節）：可重試錯誤依序延遲重試，最多三次。
// 第一次 30 秒後、第二次 2 分鐘後、第三次 10 分鐘後。
export const RETRY_DELAYS_SECONDS = [30, 120, 600] as const;
export const MAX_RETRIES = RETRY_DELAYS_SECONDS.length;

// retryCount：已經重試過的次數（0 = 尚未重試）。
// 回傳下一次重試的延遲秒數；若已達上限則回傳 null（不再重試）。
export function nextRetryDelaySeconds(retryCount: number): number | null {
  if (retryCount < 0) return RETRY_DELAYS_SECONDS[0];
  if (retryCount >= MAX_RETRIES) return null;
  return RETRY_DELAYS_SECONDS[retryCount];
}

export function shouldRetry(retryCount: number): boolean {
  return retryCount < MAX_RETRIES;
}
