/** Gọi API: tự gắn access token, tự làm mới phiên khi token hết hạn (401) rồi thử lại một lần. */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly errors?: { field: string; message: string }[],
  ) {
    super(message);
  }
}

export interface TokenResponse {
  status: 'ok';
  accessToken: string;
  limited: boolean;
  mustChangePassword: boolean;
  mustSetup2fa: boolean;
}

let accessToken: string | null = null;
let refreshing: Promise<TokenResponse | null> | null = null;
let onSessionLost: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function onSessionExpired(cb: () => void) {
  onSessionLost = cb;
}

async function parse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toError(status: number, body: unknown): ApiError {
  const b = (body ?? {}) as { message?: string | string[]; code?: string; errors?: { field: string; message: string }[] };
  const msg = Array.isArray(b.message) ? b.message.join(', ') : b.message;
  return new ApiError(status, msg || `Lỗi ${status}`, b.code, b.errors);
}

/** Làm mới phiên bằng cookie refresh. Nhiều lời gọi cùng lúc dùng chung một yêu cầu. */
export function refreshSession(): Promise<TokenResponse | null> {
  refreshing ??= fetch(`${API_URL}/api/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (res) => {
      if (!res.ok) return null;
      const body = (await res.json()) as TokenResponse;
      accessToken = body.accessToken;
      return body;
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

type Options = { method?: string; body?: unknown; form?: FormData; retry?: boolean };

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_URL}/api${path}`, {
    method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
    headers,
    credentials: 'include',
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  if (res.status === 401 && opts.retry !== false && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) return api<T>(path, { ...opts, retry: false });
    onSessionLost?.();
  }
  const body = await parse(res);
  if (!res.ok) throw toError(res.status, body);
  return body as T;
}

/** Tải file (CSV…) qua API: có token, tự làm mới phiên khi hết hạn. */
export async function apiBlob(path: string, retry = true): Promise<Blob> {
  const res = await fetch(`${API_URL}/api${path}`, {
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (res.status === 401 && retry && (await refreshSession())) return apiBlob(path, false);
  if (!res.ok) throw toError(res.status, await parse(res));
  return res.blob();
}
