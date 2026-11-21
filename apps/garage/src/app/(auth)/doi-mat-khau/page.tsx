'use client';

import { Alert, Card, Spinner } from '@cardiy/ui';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ChangePasswordForm } from '@/components/change-password-form';
import { useAuth } from '@/lib/auth';
import { homeFor } from '@/lib/nav';

/** Bắt buộc đổi mật khẩu tạm ở lần đăng nhập đầu tiên. */
export default function ForceChangePasswordPage() {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === 'anon') router.replace('/dang-nhap');
    if (auth.status === 'authed' && !auth.mustChangePassword && auth.me) {
      router.replace(auth.mustSetup2fa ? '/bao-mat?batbuoc=1' : homeFor(auth.me.permissions, auth.me.workspace.tenantType));
    }
  }, [auth.status, auth.mustChangePassword, auth.mustSetup2fa, auth.me, router]);

  if (auth.status !== 'authed') {
    return (
      <div className="grid place-items-center py-10">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  }

  return (
    <Card className="space-y-4 p-6 sm:p-8">
      <div>
        <h1 className="text-xl font-semibold">Đặt mật khẩu mới</h1>
        <p className="mt-1 text-sm text-slate-500">Xin chào {auth.me?.user.fullName}.</p>
      </div>
      <Alert tone="peach">Bạn đang dùng mật khẩu tạm do quản lý cấp. Hãy đặt mật khẩu riêng trước khi tiếp tục.</Alert>
      <ChangePasswordForm />
    </Card>
  );
}
