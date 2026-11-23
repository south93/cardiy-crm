'use client';

import { Card, CardTitle, Spinner } from '@cardiy/ui';
import { ArrowLeft, Check, ClipboardCheck, MapPin, Phone } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { fmtMoney } from '@/lib/crm';
import { ownerApi } from '@/lib/owner';
import { fmtDateTime, methodLabel, type OrderStatus, type PaymentMethod } from '@/lib/orders';

interface Order {
  id: string;
  code: string;
  status: OrderStatus;
  statusLabel: string;
  branch: { name: string; address: string | null; phone: string | null };
  vehicle: { id: string; plate: string; make: string | null; model: string | null } | null;
  request: string | null;
  odometerKm: number | null;
  receivedAt: string;
  promisedAt: string | null;
  completedAt: string | null;
  deliveredAt: string | null;
  items: { kind: string; name: string; unit: string | null; quantity: number; unitPrice: number; discount: number; amount: number; vatRate: number }[];
  subtotal: number;
  orderDiscount: number;
  vatTotal: number;
  total: number;
  paid: number;
  due: number;
  payments: { amount: number; method: PaymentMethod; paidAt: string }[];
  history: { status: OrderStatus; label: string; at: string }[];
  inspection: { completedAt: string; checked: number; attention: number; replace: number; recommendation: string | null; suggestions: string | null } | null;
}

const STEPS: { status: OrderStatus; label: string }[] = [
  { status: 'TIEP_NHAN', label: 'Tiếp nhận' },
  { status: 'DANG_SUA', label: 'Đang sửa' },
  { status: 'HOAN_THANH', label: 'Sửa xong' },
  { status: 'DA_GIAO', label: 'Đã giao xe' },
];

export default function OwnerOrderPage() {
  const { id } = useParams<{ id: string }>();
  const [o, setO] = useState<Order | null>(null);
  useEffect(() => {
    ownerApi<Order>(`/orders/${id}`).then(setO);
  }, [id]);
  if (!o) return <Spinner className="h-6 w-6 text-brand-600" />;
  const at = (s: OrderStatus) => [...o.history].reverse().find((h) => h.status === s)?.at;
  const cur = STEPS.findIndex((s) => s.status === o.status);
  const qty = (q: number) => q.toLocaleString('vi-VN', { maximumFractionDigits: 2 });

  return (
    <div className="space-y-4">
      <Link href={o.vehicle ? `/app/xe/${o.vehicle.id}` : '/app'} className="flex items-center gap-1 text-sm text-slate-500">
        <ArrowLeft className="h-4 w-4" /> {o.vehicle?.plate ?? 'Xe của tôi'}
      </Link>
      <div>
        <div className="text-sm text-slate-500">Đơn {o.code}</div>
        <h1 className="text-xl font-semibold" data-testid="order-status">
          {o.statusLabel}
        </h1>
      </div>

      {o.status !== 'HUY' && (
        <Card className="p-4">
          <ol className="flex justify-between" data-testid="order-steps">
            {STEPS.map((s, i) => {
              const done = i <= cur;
              return (
                <li key={s.status} className="relative flex flex-1 flex-col items-center text-center">
                  {i > 0 && <span className={`absolute right-1/2 top-3.5 h-0.5 w-full ${i <= cur ? 'bg-brand-600' : 'bg-slate-200'}`} />}
                  <span className={`relative z-10 grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ${done ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                    {done ? <Check className="h-4 w-4" /> : i + 1}
                  </span>
                  <span className={`mt-1 text-[11px] ${i === cur ? 'font-semibold text-brand-700' : 'text-slate-500'}`}>{s.label}</span>
                  <span className="text-[10px] text-slate-400">{at(s.status) ? fmtDateTime(at(s.status)!).slice(0, 11) : ''}</span>
                </li>
              );
            })}
          </ol>
          {o.promisedAt && !['HOAN_THANH', 'DA_GIAO'].includes(o.status) && <p className="mt-3 text-center text-sm text-slate-600">Hẹn giao xe: {fmtDateTime(o.promisedAt)}</p>}
        </Card>
      )}

      <Card className="space-y-1.5 p-4 text-sm">
        <div className="font-semibold">{o.branch.name}</div>
        {o.branch.address && (
          <div className="flex items-start gap-1.5 text-slate-600">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {o.branch.address}
          </div>
        )}
        {o.branch.phone && (
          <a href={`tel:${o.branch.phone}`} className="flex items-center gap-1.5 font-medium text-brand-700">
            <Phone className="h-4 w-4" /> Gọi garage {o.branch.phone}
          </a>
        )}
        {o.request && <p className="rounded-xl bg-slate-50 px-3 py-2">Yêu cầu: {o.request}</p>}
      </Card>

      {o.inspection && (
        <Card className="p-4" data-testid="order-inspection">
          <CardTitle className="mb-2 flex items-center gap-1.5 text-base">
            <ClipboardCheck className="h-4 w-4" /> Kết quả kiểm tra xe
          </CardTitle>
          <p className="text-sm">
            {o.inspection.checked} hạng mục đã kiểm tra
            {o.inspection.attention > 0 && <span className="font-semibold text-amber-600"> · {o.inspection.attention} cần chú ý</span>}
            {o.inspection.replace > 0 && <span className="font-semibold text-rose-600"> · {o.inspection.replace} nên thay</span>}
          </p>
          {o.inspection.recommendation && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm">Kỹ thuật viên khuyên: {o.inspection.recommendation}</p>}
          {o.inspection.suggestions && <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{o.inspection.suggestions}</p>}
        </Card>
      )}

      <Card className="p-4">
        <CardTitle className="mb-2 text-base">Hạng mục</CardTitle>
        <ul className="divide-y divide-slate-100 text-sm" data-testid="order-items">
          {o.items.map((i, k) => (
            <li key={k} className="flex justify-between gap-3 py-2">
              <div className="min-w-0">
                <div>{i.name}</div>
                <div className="text-xs text-slate-500">
                  {qty(i.quantity)} {i.unit ?? ''} × {fmtMoney(i.unitPrice)}
                  {i.discount > 0 && ` · giảm ${fmtMoney(i.discount)}`}
                </div>
              </div>
              <div className="shrink-0 font-medium tabular-nums">{fmtMoney(i.amount)}</div>
            </li>
          ))}
        </ul>
        <dl className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-sm">
          {o.orderDiscount > 0 && (
            <div className="flex justify-between text-slate-600">
              <dt>Giảm giá đơn</dt>
              <dd>−{fmtMoney(o.orderDiscount)}</dd>
            </div>
          )}
          {o.vatTotal > 0 && (
            <div className="flex justify-between text-slate-600">
              <dt>Thuế VAT</dt>
              <dd>{fmtMoney(o.vatTotal)}</dd>
            </div>
          )}
          <div className="flex justify-between text-base font-semibold">
            <dt>Tổng cộng</dt>
            <dd data-testid="order-total">{fmtMoney(o.total)}</dd>
          </div>
          {o.payments.map((p, k) => (
            <div key={k} className="flex justify-between text-slate-600">
              <dt>
                Đã trả ({methodLabel(p.method)}, {fmtDateTime(p.paidAt)})
              </dt>
              <dd>{fmtMoney(p.amount)}</dd>
            </div>
          ))}
          {o.due > 0 && (
            <div className="flex justify-between font-semibold text-rose-600">
              <dt>Còn phải trả</dt>
              <dd>{fmtMoney(o.due)}</dd>
            </div>
          )}
        </dl>
      </Card>
    </div>
  );
}
