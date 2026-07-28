// Meta Graph API client。把 HTTP 呼叫與錯誤分類集中，讓 comments/private-replies 專注於 endpoint。
import { isRetryable, type MetaApiFailure } from './errors';

export interface MetaClientConfig {
  accessToken: string;
  graphApiVersion: string; // 例如 "v21.0"（正式值由使用者確認，見 env）
  // fetch 可注入，方便測試。
  fetchImpl?: typeof fetch;
  baseUrl?: string; // 預設 https://graph.instagram.com（可覆寫為 graph.facebook.com）
}

export interface MetaCallResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  failure?: MetaApiFailure;
}

// 把 Meta 錯誤回應映射到可/不可重試分類（spec §12.3）。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyMetaError(status: number, body: any): MetaApiFailure {
  const error = body?.error ?? {};
  const code = typeof error.code === 'number' ? error.code : undefined;

  // 常見不可重試：190 token 失效；10/200/803 權限；100 參數錯誤；368 政策限制。
  if (code === 190) return { httpStatus: status, nonRetryableReason: 'token_invalid' };
  if (code === 10 || code === 200 || code === 803) {
    return { httpStatus: status, nonRetryableReason: 'permission_denied' };
  }
  if (code === 100) return { httpStatus: status, nonRetryableReason: 'bad_request' };
  if (code === 368) return { httpStatus: status, nonRetryableReason: 'policy_restricted' };

  // 其餘依 HTTP 狀態分類（429/5xx 可重試，其他 4xx 不可）。
  return { httpStatus: status };
}

export class MetaClient {
  private readonly cfg: Required<Pick<MetaClientConfig, 'accessToken' | 'graphApiVersion'>> &
    MetaClientConfig;
  private readonly doFetch: typeof fetch;
  private readonly baseUrl: string;

  constructor(cfg: MetaClientConfig) {
    this.cfg = cfg as never;
    // 包一層 arrow function，避免把全域 fetch 存成 method 後 this 綁到 MetaClient
    // 實例 → Cloudflare Workers 會拋 "Illegal invocation"（Node 較寬鬆不會）。
    this.doFetch = cfg.fetchImpl ?? ((input, init) => fetch(input, init));
    this.baseUrl = cfg.baseUrl ?? 'https://graph.instagram.com';
  }

  async get<T = unknown>(path: string, params: Record<string, string> = {}): Promise<MetaCallResult<T>> {
    const query = new URLSearchParams({ ...params, access_token: this.cfg.accessToken });
    const url = `${this.baseUrl}/${this.cfg.graphApiVersion}/${path}?${query.toString()}`;
    let res: Response;
    try {
      res = await this.doFetch(url, { method: 'GET' });
    } catch {
      return { ok: false, status: 0, failure: { networkError: true } };
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (res.ok) return { ok: true, status: res.status, data: body as T };
    return { ok: false, status: res.status, failure: classifyMetaError(res.status, body) };
  }

  async post<T = unknown>(path: string, params: Record<string, string>): Promise<MetaCallResult<T>> {
    const url = `${this.baseUrl}/${this.cfg.graphApiVersion}/${path}`;
    const form = new URLSearchParams({ ...params, access_token: this.cfg.accessToken });

    let res: Response;
    try {
      res = await this.doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
    } catch {
      // 網路層錯誤 → 可重試。
      return { ok: false, status: 0, failure: { networkError: true } };
    }

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (res.ok) {
      return { ok: true, status: res.status, data: body as T };
    }

    const failure = classifyMetaError(res.status, body);
    return { ok: false, status: res.status, failure };
  }
}

export { isRetryable };
