'use client';

import { Alert, Button, Card, Input } from '@cardiy/ui';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ApiError } from '@/lib/api';
import { ownerApi, useOwner } from '@/lib/owner';

/** Đăng ký app / quên mật khẩu bằng mã OTP gửi qua Zalo */
function OtpFlow() {
  const purpose = useSearchParams().get('muc') === 'quen-mat-khau' ? 'RESET' : 'REGISTER';
  const { signIn } = useOwner();
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [sent, setSent] = useState<{ garage: string } | null>(null);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const title = purpose === 'REGISTER' ? 'Đăng ký app chủ xe' : 'Đặt lại mật khẩu';

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Có lỗi, thử lại sau');
    } finally {
      setBusy(false);
    }
  };
  const request = () => run(async () => setSent(await ownerApi<{ garage: string }>('/auth/otp/request', { body: { phone, purpose } })));
  const verify = () =>
    run(async () => {
      if (pw !== pw2) throw new ApiError(400, 'Hai lần nhập mật khẩu chưa khớp');
      const r = await ownerApi<{ accessToken: string }>('/auth/otp/verify', { body: { phone, purpose, code, password: pw } });
      await signIn(r.accessToken);
      router.replace('/app');
    });

  return (
    <div className="space-y-4 pt-6">
      <Link href="/app/dang-nhap" className="flex items-center gap-1 text-sm text-slate-500">
        <ArrowLeft className="h-4 w-4" /> Đăng nhập
      </Link>
      <div className="text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-sky-500 text-white">
          <MessageCircle className="h-7 w-7" />
        </div>
        <h1 className="mt-3 text-xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{purpose === 'REGISTER' ? 'Dùng số điện thoại bạn đã đăng ký khi sửa xe tại garage.' : 'Nhận mã xác nhận qua Zalo để đặt mật khẩu mới.'}</p>
      </div>
      <Card className="space-y-3 p-5">
        {!sent ? (
          <>
            <label className="block text-sm">
              Số điện thoại
              <Input inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" />
            </label>
            {err && <Alert>{err}</Alert>}
            <Button className="w-full justify-center" disabled={busy || phone.replace(/\D/g, '').length < 9} onClick={() => void request()} data-testid="otp-request">
              {busy ? 'Đang gửi…' : 'Gửi mã qua Zalo'}
            </Button>
          </>
        ) : (
          <>
            <p className="rounded-xl bg-sky-100 px-3 py-2 text-sm text-sky-800">
              Đã gửi mã 6 số tới Zalo của số {phone} (từ {sent.garage}). Mã có hiệu lực 5 phút.
            </p>
            <label className="block text-sm">
              Mã xác nhận
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="mt-1 text-center text-lg tracking-[0.5em]"
              />
            </label>
            <label className="block text-sm">
              {purpose === 'REGISTER' ? 'Đặt mật khẩu' : 'Mật khẩu mới'}
              <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className="mt-1" />
            </label>
            <label className="block text-sm">
              Nhập lại mật khẩu
              <Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} className="mt-1" />
            </label>
            <p className="text-xs text-slate-500">Ít nhất 8 ký tự, có cả chữ và số.</p>
            {err && <Alert>{err}</Alert>}
            <Button className="w-full justify-center" disabled={busy || code.length !== 6 || !pw} onClick={() => void verify()} data-testid="otp-verify">
              {busy ? 'Đang xác nhận…' : purpose === 'REGISTER' ? 'Đăng ký & vào app' : 'Đặt mật khẩu & vào app'}
            </Button>
            <button type="button" className="w-full text-center text-sm text-brand-700" disabled={busy} onClick={() => void request()}>
              Gửi lại mã
            </button>
          </>
        )}
      </Card>
    </div>
  );
}

export default function OtpPage() {
  return (
    <Suspense>
      <OtpFlow />
    </Suspense>
  );
}
