'use client';

import { Alert, Button, Card, Input, Spinner } from '@cardiy/ui';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { ownerApi, useOwner } from '@/lib/owner';

interface Preview {
  garage: string;
  customerName: string;
  phone: string;
  hasAccount: boolean;
}

/** Khách mở link / quét QR garage gửi: đặt mật khẩu (hoặc nhập mật khẩu sẵn có) để vào app */
export default function ActivatePage() {
  const { token } = useParams<{ token: string }>();
  const { signIn } = useOwner();
  const router = useRouter();
  const [p, setP] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ownerApi<Preview>(`/auth/invite/${encodeURIComponent(token)}`).then(setP, (e) => setErr(e instanceof ApiError ? e.message : 'Không mở được link'));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!p) return;
    if (!p.hasAccount && pw !== pw2) return setErr('Hai lần nhập mật khẩu chưa khớp');
    setBusy(true);
    setErr(null);
    try {
      const r = await ownerApi<{ accessToken: string }>('/auth/activate', { body: { token, password: pw } });
      await signIn(r.accessToken);
      router.replace('/app');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Không kích hoạt được, thử lại sau');
    } finally {
      setBusy(false);
    }
  }

  if (!p && !err) return <Spinner className="h-6 w-6 text-brand-600" />;
  return (
    <div className="space-y-4 pt-6">
      <div className="text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-600 text-white">
          <ShieldCheck className="h-7 w-7" />
        </div>
        <h1 className="mt-3 text-xl font-semibold">Kích hoạt app chủ xe</h1>
        {p && <p className="mt-1 text-sm text-slate-500">Theo dõi xe và lịch sử sửa chữa tại {p.garage}</p>}
      </div>
      {!p ? (
        <Card className="space-y-3 p-5 text-center">
          <Alert>{err}</Alert>
          <Link href="/app/dang-nhap" className="text-sm font-medium text-brand-700">
            Đăng nhập bằng số điện thoại
          </Link>
        </Card>
      ) : (
        <Card className="p-5">
          <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-slate-500">Khách hàng</dt>
            <dd className="font-medium" data-testid="invite-name">
              {p.customerName}
            </dd>
            <dt className="text-slate-500">Số điện thoại</dt>
            <dd className="font-medium">{p.phone}</dd>
          </dl>
          <form onSubmit={submit} className="space-y-3">
            {p.hasAccount ? (
              <p className="rounded-xl bg-sky-100 px-3 py-2 text-sm text-sky-700">Số điện thoại này đã có tài khoản. Nhập mật khẩu bạn đang dùng để liên kết xe.</p>
            ) : (
              <p className="text-sm text-slate-600">Đặt mật khẩu để lần sau đăng nhập bằng số điện thoại (ít nhất 8 ký tự, có cả chữ và số).</p>
            )}
            <label className="block text-sm">
              Mật khẩu
              <Input type="password" autoComplete={p.hasAccount ? 'current-password' : 'new-password'} value={pw} onChange={(e) => setPw(e.target.value)} className="mt-1" required />
            </label>
            {!p.hasAccount && (
              <label className="block text-sm">
                Nhập lại mật khẩu
                <Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} className="mt-1" required />
              </label>
            )}
            {err && <Alert>{err}</Alert>}
            <Button type="submit" disabled={busy} className="w-full justify-center" data-testid="activate">
              {busy ? 'Đang kích hoạt…' : 'Kích hoạt & vào app'}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
