'use client';

import { Alert, Badge, Card, CardTitle, Spinner } from '@cardiy/ui';
import { useEffect, useState } from 'react';
import { RequirePermission } from '@/components/require-permission';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/crm';
import { dmy, INVOICE_STATUS, PARTNER_STATUS, planPrice, type Invoice } from '@/lib/partners';

interface Billing {
  status: string;
  plan: { name: string; monthlyFee: number; billingMonths: number; startAt: string; paidThrough: string; features: string[]; ended: boolean } | null;
  dueTotal: number;
  invoices: Invoice[];
  payInfo: { amount: number; note: string; bank: { name: string; accountNo: string; accountName: string } | null; qr: string | null } | null;
}

function MyBilling() {
  const [b, setB] = useState<Billing | null>(null);
  useEffect(() => void api<Billing>('/partner/billing').then(setB), []);
  if (!b)
    return (
      <div className="grid place-items-center p-16">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  const st = PARTNER_STATUS[b.status];
  return (
    <div className="space-y-4">
      {b.status === 'DANG_THIET_LAP' && <Alert tone="sky">Gian hàng đang thiết lập. Sau khi sàn ghi nhận phí kỳ đầu, gian hàng chuyển sang Hoạt động.</Alert>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <CardTitle className="flex-1">Gói đang dùng</CardTitle>
            <span data-testid="partner-status">{st && <Badge tone={st.tone}>{st.label}</Badge>}</span>
          </div>
          {b.plan ? (
            <div className="mt-3 text-sm">
              <div className="text-lg font-semibold">{b.plan.name}</div>
              <div className="font-bold tabular-nums text-brand-700">{planPrice(b.plan.monthlyFee, b.plan.billingMonths)}</div>
              <div className="mt-1 text-slate-500">
                Bắt đầu {dmy(b.plan.startAt)} · đã lập hoá đơn tới {dmy(b.plan.paidThrough)}
              </div>
              {b.plan.features.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-slate-600">
                  {b.plan.features.map((f) => (
                    <li key={f}>• {f}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">Chưa có gói.</p>
          )}
        </Card>
        <Card className="p-5">
          <CardTitle>Cần thanh toán</CardTitle>
          <div className={`mt-2 text-2xl font-bold tabular-nums ${b.dueTotal ? 'text-rose-600' : 'text-mint-700'}`} data-testid="due-total">
            {b.dueTotal ? fmtMoney(b.dueTotal) : 'Đã thanh toán đủ'}
          </div>
          {b.payInfo?.bank && (
            <div className="mt-3 flex gap-4 text-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {b.payInfo.qr && <img src={b.payInfo.qr} alt="Mã QR chuyển khoản" className="h-36 w-36 rounded-xl border border-slate-100" />}
              <div className="space-y-0.5">
                <div className="font-medium">{b.payInfo.bank.name}</div>
                <div className="font-mono">{b.payInfo.bank.accountNo}</div>
                <div>{b.payInfo.bank.accountName}</div>
                <div className="pt-1 text-slate-500">
                  Nội dung: <span className="font-medium text-slate-700">{b.payInfo.note}</span>
                </div>
              </div>
            </div>
          )}
          {b.payInfo && !b.payInfo.bank && <p className="mt-2 text-sm text-slate-500">Liên hệ sàn để nhận thông tin chuyển khoản.</p>}
        </Card>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="my-invoices">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-semibold">Hoá đơn</th>
              <th className="px-3 py-3 font-semibold">Kỳ</th>
              <th className="px-3 py-3 text-right font-semibold">Số tiền</th>
              <th className="px-3 py-3 font-semibold">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {b.invoices.map((i) => (
              <tr key={i.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-3 font-medium">{i.code}</td>
                <td className="px-3 py-3 text-slate-600">
                  {dmy(i.periodFrom)} – {dmy(i.periodTo)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtMoney(i.amount)}</td>
                <td className="px-3 py-3">
                  <Badge tone={i.overdueDays ? 'rose' : INVOICE_STATUS[i.status]!.tone}>{i.overdueDays ? `Quá hạn ${i.overdueDays} ngày` : INVOICE_STATUS[i.status]!.label}</Badge>
                  {i.status === 'DA_PHAT_HANH' && !i.overdueDays && <span className="ml-2 text-xs text-slate-500">hạn {dmy(i.dueDate)}</span>}
                </td>
              </tr>
            ))}
            {!b.invoices.length && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-slate-500">
                  Chưa có hoá đơn.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/** A7.31 Phí & hoá đơn của đối tác */
export default function PartnerBillingPage() {
  return (
    <RequirePermission permission="partner.billing.view">
      <MyBilling />
    </RequirePermission>
  );
}
