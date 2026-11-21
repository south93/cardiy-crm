'use client';

import { Badge, Card, CardTitle, Spinner } from '@cardiy/ui';
import { Wrench } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/crm';
import { fmtDateTime, PAYMENT_STATE, STATUS, type OrderList } from '@/lib/orders';

/** Lịch sử đơn của một khách hoặc một xe (mới nhất trước) */
export function OrderHistory({ customerId, vehicleId, title = 'Lịch sử sửa chữa' }: { customerId?: string; vehicleId?: string; title?: string }) {
  const [data, setData] = useState<OrderList | null>(null);
  useEffect(() => {
    const p = new URLSearchParams({ view: 'all', pageSize: '50' });
    if (customerId) p.set('customerId', customerId);
    if (vehicleId) p.set('vehicleId', vehicleId);
    api<OrderList>(`/orders?${p}`).then(setData, () => setData({ total: 0, page: 1, pageSize: 50, counts: {}, items: [] }));
  }, [customerId, vehicleId]);

  return (
    <Card className="p-4 lg:p-5">
      <CardTitle className="mb-3">{title}</CardTitle>
      {!data ? (
        <Spinner className="text-brand-600" />
      ) : !data.items.length ? (
        <div className="py-6 text-center text-sm text-slate-500">
          <Wrench className="mx-auto mb-2 h-6 w-6 text-slate-300" />
          Chưa có đơn nào
        </div>
      ) : (
        <ul className="divide-y divide-slate-50" data-testid="order-history-list">
          {data.items.map((o) => (
            <li key={o.id}>
              <Link href={`/don-hang/${o.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm hover:text-brand-600">
                <span className="font-semibold">{o.code}</span>
                <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
                {!vehicleId && o.vehicle && <span className="font-mono text-xs">{o.vehicle.plate}</span>}
                <span className="min-w-0 flex-1 truncate text-slate-500">{o.request ?? `${o.itemCount} hạng mục`}</span>
                <span className="text-xs text-slate-500">{fmtDateTime(o.receivedAt)}</span>
                {o.total !== null && (
                  <span className="w-28 text-right tabular-nums">
                    {fmtMoney(o.total)}
                    {o.paymentState && o.paymentState !== 'DA_THU_DU' && o.status !== 'HUY' && <span className="block text-xs text-rose-600">{PAYMENT_STATE[o.paymentState].label}</span>}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
