'use client';

import { Alert, Badge, Button, Card, CardTitle, Field, Input, Spinner } from '@cardiy/ui';
import { Camera, Monitor, ShieldCheck, Smartphone } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ChangePasswordForm } from '@/components/change-password-form';
import { api, ApiError, type TokenResponse } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { homeFor } from '@/lib/nav';

function TwoFactorCard() {
  const auth = useAuth();
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (auth.me?.user.totpEnabled) {
    return (
      <Card className="p-5 lg:p-6">
        <CardTitle className="mb-3">Xác thực 2 lớp</CardTitle>
        <div className="flex items-center gap-3 rounded-2xl bg-mint-100 p-4 text-mint-700">
          <ShieldCheck className="h-6 w-6" />
          <span className="text-sm font-medium">Đã bật. Mỗi lần đăng nhập cần thêm mã từ ứng dụng Authenticator.</span>
        </div>
      </Card>
    );
  }

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      setSetup(await api<{ secret: string; qrDataUrl: string }>('/auth/2fa/setup', { method: 'POST' }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không khởi tạo được');
    } finally {
      setBusy(false);
    }
  };

  const enable = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const wasForced = auth.mustSetup2fa;
      await auth.applyTokens(await api<TokenResponse>('/auth/2fa/enable', { body: { code } }));
      if (wasForced && auth.me) router.replace(homeFor(auth.me.permissions, auth.me.workspace.tenantType));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không bật được');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 lg:p-6" data-testid="twofa-card">
      <CardTitle className="mb-1">Xác thực 2 lớp</CardTitle>
      <p className="mb-4 text-sm text-slate-500">Bảo vệ tài khoản kể cả khi lộ mật khẩu. Dùng ứng dụng Google Authenticator hoặc Microsoft Authenticator (miễn phí).</p>
      {error && <Alert className="mb-3">{error}</Alert>}
      {!setup ? (
        <Button onClick={start} disabled={busy}>
          {busy && <Spinner />}Bật xác thực 2 lớp
        </Button>
      ) : (
        <form onSubmit={enable} className="grid gap-5 sm:grid-cols-[auto_1fr]">
          <div className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qrDataUrl} alt="Mã QR xác thực 2 lớp" className="mx-auto h-44 w-44 rounded-xl border border-slate-100" />
            <p className="mt-2 max-w-44 break-all font-mono text-[11px] text-slate-500" data-testid="totp-secret">
              {setup.secret}
            </p>
          </div>
          <div className="space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
              <li>Mở ứng dụng Authenticator, chọn thêm tài khoản.</li>
              <li>Quét mã QR (hoặc nhập mã chữ bên dưới QR).</li>
              <li>Nhập mã 6 số ứng dụng hiển thị.</li>
            </ol>
            <Field label="Mã 6 số">
              {(id) => <Input id={id} name="code" inputMode="numeric" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="max-w-40 text-center tracking-[0.3em]" />}
            </Field>
            <Button type="submit" disabled={busy || code.length !== 6}>
              {busy && <Spinner />}Xác nhận và bật
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function ProfileCard() {
  const auth = useAuth();
  const me = auth.me!;
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const f = await api<{ id: string }>('/files', { form });
      await api('/me/avatar', { method: 'PATCH', body: { fileId: f.id } });
      await auth.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được ảnh');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 lg:p-6">
      <CardTitle className="mb-4">Hồ sơ</CardTitle>
      {error && <Alert className="mb-3">{error}</Alert>}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy || !auth.can('file.upload')}
          className="group relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-lav-100 text-xl font-semibold text-lav-700"
          aria-label="Đổi ảnh đại diện"
        >
          {me.user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={me.user.avatarUrl} alt="" className="h-full w-full object-cover" data-testid="avatar-img" />
          ) : (
            me.user.fullName.split(/\s+/).slice(-1)[0]?.[0]
          )}
          <span className="absolute inset-0 grid place-items-center bg-slate-900/40 text-white opacity-0 transition group-hover:opacity-100">
            {busy ? <Spinner /> : <Camera className="h-5 w-5" />}
          </span>
        </button>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden data-testid="avatar-input" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        <div className="min-w-0 text-sm">
          <div className="text-base font-semibold">{me.user.fullName}</div>
          <div className="text-slate-500">{me.user.phone}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {[...new Set(me.roles.map((r) => r.name))].map((n) => (
              <Badge key={n} tone="brand">
                {n}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

interface SessionRow {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
}

function SessionsCard() {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const load = useCallback(async () => setRows(await api<SessionRow[]>('/me/sessions')), []);
  useEffect(() => void load(), [load]);
  const mobile = (ua: string | null) => !!ua && /Mobile|Android|iPhone/i.test(ua);
  return (
    <Card className="p-5 lg:p-6">
      <CardTitle className="mb-1">Thiết bị đang đăng nhập</CardTitle>
      <p className="mb-3 text-sm text-slate-500">Đăng xuất thiết bị lạ ngay khi phát hiện.</p>
      {!rows ? (
        <Spinner className="text-brand-600" />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3 text-sm">
              {mobile(r.userAgent) ? <Smartphone className="h-5 w-5 text-slate-400" /> : <Monitor className="h-5 w-5 text-slate-400" />}
              <div className="min-w-0 flex-1">
                <div className="truncate">{r.userAgent?.replace(/\s*\(.*?\)\s*/g, ' ').slice(0, 60) ?? 'Không rõ thiết bị'}</div>
                <div className="text-xs text-slate-500">
                  {r.ip ?? '—'} · từ {new Date(r.createdAt).toLocaleString('vi-VN')}
                </div>
              </div>
              <Button
                variant="outline"
                className="px-3 py-1.5 text-xs"
                onClick={async () => {
                  await api(`/me/sessions/${r.id}`, { method: 'DELETE' });
                  await load();
                }}
              >
                Đăng xuất
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SecurityContent() {
  const auth = useAuth();
  const params = useSearchParams();
  const forced = auth.mustSetup2fa || params.get('batbuoc') === '1';
  if (!auth.me) return null;
  return (
    <div className="space-y-4">
      {forced && !auth.me.user.totpEnabled && (
        <Alert tone="peach">Vai trò của bạn bắt buộc bật xác thực 2 lớp. Hoàn tất bước này để tiếp tục dùng hệ thống.</Alert>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          {!auth.mustSetup2fa && <ProfileCard />}
          <TwoFactorCard />
        </div>
        {!auth.mustSetup2fa && (
          <div className="space-y-4">
            <Card className="p-5 lg:p-6">
              <CardTitle className="mb-4">Đổi mật khẩu</CardTitle>
              <ChangePasswordForm />
            </Card>
            <SessionsCard />
          </div>
        )}
      </div>
    </div>
  );
}

export default function SecurityPage() {
  return (
    <Suspense>
      <SecurityContent />
    </Suspense>
  );
}
