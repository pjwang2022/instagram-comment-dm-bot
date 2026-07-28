// Admin API 的極簡 fetch 封裝。credentials: 'include' 讓瀏覽器自動帶上 Session Cookie。
export interface ApiError {
  status: number;
  message: string;
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) {
    const err: ApiError = { status: res.status, message: `HTTP ${res.status}` };
    throw err;
  }
  return (await res.json()) as T;
}

export async function apiPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let message = '發生錯誤，請稍後再試。';
    if (res.status === 429) {
      message = '登入嘗試次數過多，請稍後再試。';
    } else {
      try {
        const data = (await res.json()) as { error?: string };
        if (data.error) message = data.error;
      } catch {
        // 忽略非 JSON 回應，沿用預設訊息。
      }
    }
    const err: ApiError = { status: res.status, message };
    throw err;
  }

  return (await res.json()) as T;
}
