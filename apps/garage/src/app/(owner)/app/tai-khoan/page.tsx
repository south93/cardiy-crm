'use client';

import { Button, Card, CardTitle } from '@cardiy/ui';
import { LogOut, Store } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useOwner } from '@/lib/owner';

export default function OwnerAccountPage() {
  const { me, signOut } = useOwner();
  const router = useRouter();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Tài khoản</h1>
      <Card className="p-4">
        <div className="text-lg font-semibold">{me?.name}</div>
        <div className="text-sm text-slate-500">{me?.phone}</div>
      </Card>
      <Card className="p-4">
        <CardTitle className="mb-2 text-base">Garage của tôi</CardTitle>
        <ul className="space-y-2 text-sm">
          {me?.garages.map((g, i) => (
            <li key={i} className="flex items-center gap-2">
              <Store className="h-4 w-4 text-slate-400" /> {g.garage}
              <span className="text-slate-500">· hồ sơ {g.customerName}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Button
        variant="outline"
        className="w-full justify-center"
        onClick={async () => {
          await signOut();
          router.replace('/app/dang-nhap');
        }}
        data-testid="owner-logout"
      >
        <LogOut className="h-4 w-4" /> Đăng xuất
      </Button>
    </div>
  );
}
