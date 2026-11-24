'use client';

import { Button, Card, CardTitle, Spinner } from '@cardiy/ui';
import { LogOut, Store } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { fmtMoney } from '@/lib/crm';
import { fmtDateTime, methodLabel, type PaymentMethod } from '@/lib/orders';
import { ownerApi, useOwner } from '@/lib/owner';

interface Pay {
  id: string;
  amount: number;
  method: PaymentMethod;
  paidAt: string;
  order: { id: string; code: string; branch: string; plate: string | null };
}

/** Lịch sử thanh toán tại các garage */
function Payments() {
  const [rows, setRows] = useState<Pay[] | null>(null);
  useEffect(() => {
    ownerApi<Pay[]>('/payments').then(setRows);
  }, []);
  return (
    <Card className="p-4" data-testid="payment-history">
      <CardTitle className="mb-2 text-base">Lịch sử thanh toán</CardTitle>
      {!rows ? (
        <Spinner className="h-5 w-5 text-brand-600" />
      ) : !rows.length ? (
        <p className="text-sm text-slate-500">Chưa có khoản thanh toán nào.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.map((p) => (
            <li key={p.id}>
              <Link href={`/app/don/${p.order.id}`} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-medium">{p.order.code}</span>
                  {p.order.plate && <span className="font-mono text-xs text-slate-500"> · {p.order.plate}</span>}
                  <span className="block text-xs text-slate-500">
                    {fmtDateTime(p.paidAt)} · {methodLabel(p.method)} · {p.order.branch}
                  </span>
                </span>
                <span className="font-semibold tabular-nums">{fmtMoney(p.amount)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

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
      <Payments />
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
