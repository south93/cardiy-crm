'use client';

/** App chủ xe: phiên đăng nhập riêng (token "owner", cookie riêng), không dùng chung với phiên nhân viên CRM. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { API_URL, ApiError } from './api';

let token: string | null = null;
let refreshing: Promise<boolean> | null = null;

async function parse(res: Response) {
  const t = await res.text();
  try {
    return t ? JSON.parse(t) : null;
  } catch {
    return t;
  }
}
function toError(status: number, body: unknown) {
  const b = (body ?? {}) as { message?: string | string[] };
  return new ApiError(status, (Array.isArray(b.message) ? b.message.join(', ') : b.message) || `Lỗi ${status}`);
}

export function ownerRefresh(): Promise<boolean> {
  refreshing ??= fetch(`${API_URL}/api/owner/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (r) => {
      if (!r.ok) return false;
      token = ((await r.json()) as { accessToken: string }).accessToken;
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function ownerApi<T>(path: string, opts: { method?: string; body?: unknown; retry?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_URL}/api/owner${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    credentials: 'include',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && opts.retry !== false && !path.startsWith('/auth/') && (await ownerRefresh())) return ownerApi<T>(path, { ...opts, retry: false });
  const body = await parse(res);
  if (!res.ok) throw toError(res.status, body);
  return body as T;
}

export interface OwnerMe {
  name: string;
  phone: string;
  garages: { garage: string; customerName: string }[];
}
interface Ctx {
  status: 'loading' | 'anon' | 'authed';
  me: OwnerMe | null;
  signIn: (accessToken: string) => Promise<void>;
  signOut: () => Promise<void>;
}
const OwnerCtx = createContext<Ctx | null>(null);

export function OwnerProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Ctx['status']>('loading');
  const [me, setMe] = useState<OwnerMe | null>(null);
  const load = useCallback(async () => {
    try {
      setMe(await ownerApi<OwnerMe>('/me'));
      setStatus('authed');
    } catch {
      token = null;
      setMe(null);
      setStatus('anon');
    }
  }, []);
  useEffect(() => {
    ownerRefresh().then((ok) => (ok ? load() : setStatus('anon')));
  }, [load]);
  const value = useMemo<Ctx>(
    () => ({
      status,
      me,
      signIn: async (t) => {
        token = t;
        await load();
      },
      signOut: async () => {
        await fetch(`${API_URL}/api/owner/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => null);
        token = null;
        setMe(null);
        setStatus('anon');
      },
    }),
    [status, me, load],
  );
  return <OwnerCtx.Provider value={value}>{children}</OwnerCtx.Provider>;
}

export function useOwner() {
  const c = useContext(OwnerCtx);
  if (!c) throw new Error('useOwner ngoài OwnerProvider');
  return c;
}

/** Ngày còn lại tới hạn (âm = đã quá hạn) */
export function daysLeft(d: string | null | undefined) {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000);
}
