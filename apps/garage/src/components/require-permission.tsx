'use client';

import type { PermissionCode } from '@cardiy/shared';
import { Card, IconTile } from '@cardiy/ui';
import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth';

/** Hiện nội dung chỉ khi có đủ quyền; ngược lại báo không có quyền. API vẫn kiểm tra lại độc lập. */
export function RequirePermission({ permission, children }: { permission?: PermissionCode; children: ReactNode }) {
  const { can } = useAuth();
  if (!permission || can(permission)) return <>{children}</>;
  return (
    <Card className="p-12 text-center" data-testid="forbidden">
      <IconTile tone="rose" className="mx-auto h-14 w-14">
        <Lock className="h-6 w-6" />
      </IconTile>
      <h2 className="mt-4 text-lg font-semibold">Bạn không có quyền xem trang này</h2>
      <p className="mt-1 text-sm text-slate-500">Liên hệ Chủ garage hoặc Quản lý nếu bạn cần quyền này.</p>
    </Card>
  );
}
