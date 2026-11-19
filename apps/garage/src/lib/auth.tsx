'use client';

import type { PermissionCode } from '@cardiy/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, onSessionExpired, refreshSession, setAccessToken, type TokenResponse } from './api';

export interface Me {
  user: { id: string; phone: string; fullName: string; email: string | null; totpEnabled: boolean; mustChangePassword: boolean; avatarUrl: string | null };
  workspace: { membershipId: string; tenantId: string; tenantName: string; tenantType: 'PLATFORM' | 'GARAGE' };
  roles: { id: string; code: string; name: string; branchId: string | null }[];
  permissions: PermissionCode[];
  branches: { id: string; code: string; name: string }[];
  limited: boolean;
  memberships: { membershipId: string; tenantId: string; tenantName: string; tenantType: 'PLATFORM' | 'GARAGE' }[];
}

type Status = 'loading' | 'authed' | 'anon';
export type LoginOutcome = { kind: 'ok' } | { kind: '2fa'; challengeToken: string };

interface AuthState {
  status: Status;
  me: Me | null;
  mustChangePassword: boolean;
  mustSetup2fa: boolean;
  can: (...codes: PermissionCode[]) => boolean;
  login: (phone: string, password: string) => Promise<LoginOutcome>;
  verify2fa: (challengeToken: string, code: string) => Promise<void>;
  /** Nhận token mới (sau đổi mật khẩu / bật 2FA) và tải lại thông tin. */
  applyTokens: (t: TokenResponse) => Promise<void>;
  reload: () => Promise<void>;
  logout: () => Promise<void>;
  switchWorkspace: (membershipId: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [flags, setFlags] = useState({ mustChangePassword: false, mustSetup2fa: false });

  const loadMe = useCallback(async () => {
    const m = await api<Me>('/me');
    setMe(m);
    setStatus('authed');
  }, []);

  const applyTokens = useCallback(
    async (t: TokenResponse) => {
      setAccessToken(t.accessToken);
      setFlags({ mustChangePassword: t.mustChangePassword, mustSetup2fa: t.mustSetup2fa });
      await loadMe();
    },
    [loadMe],
  );

  const clear = useCallback(() => {
    setAccessToken(null);
    setMe(null);
    setFlags({ mustChangePassword: false, mustSetup2fa: false });
    setStatus('anon');
  }, []);

  useEffect(() => {
    onSessionExpired(clear);
    void (async () => {
      const t = await refreshSession();
      if (!t) return clear();
      try {
        await applyTokens(t);
      } catch {
        clear();
      }
    })();
  }, [applyTokens, clear]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      me,
      ...flags,
      can: (...codes) => !!me && codes.every((c) => me.permissions.includes(c)),
      login: async (phone, password) => {
        const res = await api<TokenResponse | { status: '2fa_required'; challengeToken: string }>('/auth/login', { body: { phone, password } });
        if (res.status === '2fa_required') return { kind: '2fa', challengeToken: res.challengeToken };
        await applyTokens(res);
        return { kind: 'ok' };
      },
      verify2fa: async (challengeToken, code) => {
        await applyTokens(await api<TokenResponse>('/auth/2fa/verify', { body: { challengeToken, code } }));
      },
      applyTokens,
      reload: loadMe,
      logout: async () => {
        try {
          await api('/auth/logout', { method: 'POST' });
        } finally {
          clear();
        }
      },
      switchWorkspace: async (membershipId) => {
        await applyTokens(await api<TokenResponse>('/auth/switch', { body: { membershipId } }));
      },
    }),
    [status, me, flags, applyTokens, loadMe, clear],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth phải nằm trong <AuthProvider>');
  return ctx;
}
