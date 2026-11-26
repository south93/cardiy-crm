'use client';

import { Alert, Button, Card, Input } from '@cardiy/ui';
import { CarFront } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { ownerApi, useOwner } from '@/lib/owner';

function LoginForm() {
  const { status, signIn } = useOwner();
  const router = useRouter();
  const next = useSearchParams().get('next');
  const target = next?.startsWith('/app') ? next : '/app';
  const [phone, setPhone] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (status === 'authed') router.replace(target);
  }, [status, target, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await ownerApi<{ accessToken: string }>('/auth/login', { body: { phone, password: pw } });
      await signIn(r.accessToken);
      router.replace(target);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Không đăng nhập được, thử lại sau');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 pt-10">
      <div className="text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-600 text-white">
          <CarFront className="h-7 w-7" />
        </div>
        <h1 className="mt-3 text-xl font-semibold">Xe của tôi</h1>
        <p className="mt-1 text-sm text-slate-500">Xem xe, lịch sử sửa chữa và đơn đang làm tại garage</p>
      </div>
      <Card className="p-5">
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm">
            Số điện thoại
            <Input inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" required />
          </label>
          <label className="block text-sm">
            Mật khẩu
            <Input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} className="mt-1" required />
          </label>
          {err && <Alert>{err}</Alert>}
          <Button type="submit" disabled={busy} className="w-full justify-center">
            {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </Button>
        </form>
      </Card>
      <div className="flex justify-between px-2 text-sm">
        <Link href="/app/otp?muc=dang-ky" className="font-medium text-brand-700" data-testid="go-register">
          Đăng ký bằng số điện thoại
        </Link>
        <Link href="/app/otp?muc=quen-mat-khau" className="text-slate-500">
          Quên mật khẩu?
        </Link>
      </div>
      <p className="px-2 text-center text-xs text-slate-500">Mã xác nhận gửi qua Zalo. Hoặc xin garage gửi link kích hoạt / quét mã QR tại quầy.</p>
    </div>
  );
}

export default function OwnerLoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
