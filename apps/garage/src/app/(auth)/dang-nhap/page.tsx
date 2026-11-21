'use client';

import { Alert, Button, Card, Field, Input, Spinner } from '@cardiy/ui';
import { Eye, EyeOff } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { homeFor } from '@/lib/nav';

function LoginForm() {
  const auth = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Đã đăng nhập: vào thẳng ứng dụng
  useEffect(() => {
    if (auth.status !== 'authed' || !auth.me) return;
    if (auth.mustChangePassword) return router.replace('/doi-mat-khau');
    const next = params.get('next');
    router.replace(next?.startsWith('/') && !next.startsWith('//') ? next : homeFor(auth.me.permissions, auth.me.workspace.tenantType));
  }, [auth.status, auth.me, auth.mustChangePassword, params, router]);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không kết nối được máy chủ. Thử lại sau.');
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await auth.login(phone, password);
      if (r.kind === '2fa') setChallenge(r.challengeToken);
    });
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    void run(() => auth.verify2fa(challenge!, code));
  };

  if (auth.status === 'loading') {
    return (
      <div className="grid place-items-center py-10">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  }

  return (
    <Card className="p-6 sm:p-8">
      {!challenge ? (
        <form onSubmit={submitPassword} className="space-y-4" data-testid="login-form">
          <div>
            <h1 className="text-xl font-semibold">Đăng nhập</h1>
            <p className="mt-1 text-sm text-slate-500">Dành cho nhân viên garage và quản trị sàn</p>
          </div>
          {error && <Alert>{error}</Alert>}
          <Field label="Số điện thoại">
            {(id) => <Input id={id} name="phone" inputMode="tel" autoComplete="username" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09xx xxx xxx" />}
          </Field>
          <Field label="Mật khẩu">
            {(id) => (
              <div className="relative">
                <Input id={id} name="password" type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="pr-11" />
                <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-slate-400 hover:bg-slate-100" aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            )}
          </Field>
          <Button type="submit" className="w-full py-2.5" disabled={busy}>
            {busy && <Spinner />}Đăng nhập
          </Button>
          <p className="text-center text-xs text-slate-500">Quên mật khẩu? Liên hệ Quản lý hoặc Chủ garage để được đặt lại.</p>
        </form>
      ) : (
        <form onSubmit={submitCode} className="space-y-4" data-testid="twofa-form">
          <div>
            <h1 className="text-xl font-semibold">Xác thực 2 lớp</h1>
            <p className="mt-1 text-sm text-slate-500">Nhập mã 6 số trong ứng dụng Authenticator trên điện thoại của bạn.</p>
          </div>
          {error && <Alert>{error}</Alert>}
          <Field label="Mã xác thực">
            {(id) => (
              <Input id={id} name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}" required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="text-center text-lg tracking-[0.4em]" />
            )}
          </Field>
          <Button type="submit" className="w-full py-2.5" disabled={busy || code.length !== 6}>
            {busy && <Spinner />}Xác nhận
          </Button>
          <button type="button" className="w-full text-center text-sm text-slate-500 hover:underline" onClick={() => { setChallenge(null); setCode(''); setError(null); }}>
            Quay lại
          </button>
        </form>
      )}
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
