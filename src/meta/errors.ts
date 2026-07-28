// Meta API 錯誤分類（spec.md 第 12.3 節）：決定一個失敗是否可重試。
export interface MetaApiFailure {
  httpStatus?: number;
  // 標記網路層錯誤（fetch reject／逾時），沒有 HTTP status。
  networkError?: boolean;
  timeout?: boolean;
  // Meta 明確回傳的政策/權限類錯誤（例如 token 失效、權限不足、政策限制）。
  nonRetryableReason?:
    | 'token_invalid'
    | 'permission_denied'
    | 'comment_not_found'
    | 'bad_request'
    | 'automation_disabled'
    | 'policy_restricted'
    | 'user_not_allowed';
}

const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

export function isRetryable(failure: MetaApiFailure): boolean {
  // 明確標記為不可重試的原因優先。
  if (failure.nonRetryableReason) return false;
  // 網路錯誤與逾時可重試。
  if (failure.networkError || failure.timeout) return true;
  // 特定 HTTP 狀態可重試。
  if (failure.httpStatus !== undefined && RETRYABLE_HTTP_STATUSES.has(failure.httpStatus)) {
    return true;
  }
  // 其餘（含 4xx 非 429）視為不可重試。
  return false;
}
