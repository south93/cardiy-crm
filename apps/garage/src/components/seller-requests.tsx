'use client';

import { Alert, Badge, Button, Card, Dialog, Field, Input, Spinner, Tabs } from '@cardiy/ui';
import { Phone, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { fmtMoney } from '@/lib/crm';
import { REQ_STATUS } from '@/lib/market-client';
import { moneyInput, parseMoney } from '@/lib/orders';

interface Req {
  id: string;
  code: string;
  status: string;
  customerName: string;
  phone: string;
  plateNo: string | null;
  note: string | null;
  scheduledAt: string;
  voucherCode: string | null;
  subtotal: number;
  discount: number;
  estimatedTotal: number;
  finalTotal: number | null;
  sellerNote: string | null;
  expiresAt: string;
  createdAt: string;
  items: { name: string; quantity: number; amount: number; kind: string; installIncluded: boolean; mfgYear: number | null }[];
}
type Action = 'confirm' | 'reject' | 'complete' | 'no-show';
const ACT: Record<Action, string> = { confirm: 'Xác nhận yêu cầu', reject: 'Từ chối yêu cầu', complete: 'Hoàn tất (đã thu tiền)', 'no-show': 'Khách không đến' };
const when = (d: string) => new Date(d).toLocaleString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
const left = (d: string) => {
  const h = Math.max(0, Math.round((new Date(d).getTime() - Date.now()) / 3_600_000));
  return `còn ${h} giờ để xác nhận`;
};

/**
 * Yêu cầu đặt hàng / đặt lịch từ sàn (A7.20 cho đối tác, Kênh người bán cho PLG).
 * Tiền không qua sàn: garage gọi khách, xác nhận + chốt giá, khách đến thanh toán tại garage rồi bấm Hoàn tất.
 */
export function SellerRequests() {
  const [status, setStatus] = useState('DANG_XU_LY');
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ counts: Record<string, number>; items: Req[] } | null>(null);
  const [act, setAct] = useState<{ r: Req; a: Action } | null>(null);
  const [form, setForm] = useState({ finalTotal: '', note: '' });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () => api<NonNullable<typeof data>>(`/seller/requests?${new URLSearchParams({ ...(status ? { status } : {}), ...(q.trim() ? { q: q.trim() } : {}) })}`).then(setData),
    [status, q],
  );
  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const open = (r: Req, a: Action) => {
    setAct({ r, a });
    setForm({ finalTotal: moneyInput(r.finalTotal ?? r.estimatedTotal), note: '' });
    setError(null);
  };
  const submit = async () => {
    if (!act) return;
    try {
      await api(`/seller/requests/${act.r.id}/${act.a}`, { body: { finalTotal: act.a === 'confirm' || act.a === 'complete' ? parseMoney(form.finalTotal) : null, note: form.note || null } });
      setAct(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : 'Không thực hiện được');
    }
  };

  const c = data?.counts ?? {};
  const pending = (c.CHO_XAC_NHAN ?? 0) + (c.DA_XAC_NHAN ?? 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          tabs={[
            { value: 'DANG_XU_LY', label: `Đang xử lý${pending ? ` (${pending})` : ''}` },
            { value: 'HOAN_THANH', label: 'Hoàn tất' },
            { value: 'TU_CHOI', label: 'Từ chối' },
            { value: 'HET_HAN', label: 'Hết hạn' },
            { value: 'KHACH_HUY', label: 'Khách huỷ' },
            { value: '', label: 'Tất cả' },
          ]}
          value={status}
          onChange={setStatus}
        />
        <div className="relative w-full md:w-64">
          <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mã, tên, SĐT, biển số…" className="rounded-full bg-white/80 pl-10" aria-label="Tìm yêu cầu" />
        </div>
      </div>
      {!data ? (
        <div className="grid place-items-center p-10">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2" data-testid="request-list">
          {data.items.map((r) => {
            const st = REQ_STATUS[r.status] ?? { label: r.status, tone: 'slate' as const };
            return (
              <Card key={r.id} className="p-4 text-sm" data-testid="request-card">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.code}</span>
                  <Badge tone={st.tone}>{st.label}</Badge>
                  {r.status === 'CHO_XAC_NHAN' && <span className="text-xs text-rose-600">{left(r.expiresAt)}</span>}
                  <span className="ml-auto text-xs text-slate-400">gửi {when(r.createdAt)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{r.customerName}</span>
                  <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 text-brand-700">
                    <Phone className="h-3.5 w-3.5" />
                    {r.phone}
                  </a>
                  {r.plateNo && <span className="rounded bg-slate-100 px-1.5 font-mono text-xs">{r.plateNo}</span>}
                </div>
                <div className="mt-1 text-slate-600">
                  Hẹn: <span className="font-medium text-slate-900">{when(r.scheduledAt)}</span>
                </div>
                <ul className="mt-2 space-y-0.5">
                  {r.items.map((i, k) => (
                    <li key={k} className="flex justify-between gap-2">
                      <span>
                        {i.name}
                        {i.kind === 'PRODUCT' && ` × ${i.quantity}`}
                        {i.installIncluded && <span className="text-xs text-slate-500"> · gồm lắp</span>}
                      </span>
                      <span className="tabular-nums">{fmtMoney(i.amount)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-1 flex justify-between border-t border-slate-100 pt-1 font-semibold">
                  <span>
                    {r.finalTotal !== null ? 'Giá chốt' : 'Tạm tính'}
                    {r.voucherCode && (
                      <span className="ml-1 text-xs font-normal text-emerald-700">
                        voucher {r.voucherCode} −{fmtMoney(r.discount)}
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums">{fmtMoney(r.finalTotal ?? r.estimatedTotal)}</span>
                </div>
                {r.note && <p className="mt-1 text-xs text-slate-600">Khách ghi chú: {r.note}</p>}
                {r.sellerNote && <p className="mt-1 text-xs text-slate-500">Garage: {r.sellerNote}</p>}
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  {r.status === 'CHO_XAC_NHAN' && (
                    <>
                      <Button variant="outline" onClick={() => open(r, 'reject')}>
                        Từ chối
                      </Button>
                      <Button onClick={() => open(r, 'confirm')} data-testid="confirm-request">
                        Xác nhận
                      </Button>
                    </>
                  )}
                  {r.status === 'DA_XAC_NHAN' && (
                    <>
                      <Button variant="ghost" onClick={() => open(r, 'no-show')}>
                        Không đến
                      </Button>
                      <Button variant="outline" onClick={() => open(r, 'reject')}>
                        Huỷ
                      </Button>
                      <Button onClick={() => open(r, 'complete')} data-testid="complete-request">
                        Hoàn tất
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
          {!data.items.length && <Card className="p-10 text-center text-sm text-slate-500 lg:col-span-2">Không có yêu cầu nào.</Card>}
        </div>
      )}
      <Dialog
        open={act !== null}
        onClose={() => setAct(null)}
        title={act ? `${ACT[act.a]} ${act.r.code}` : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => setAct(null)}>
              Đóng
            </Button>
            <Button onClick={() => void submit()} data-testid="confirm-request-action">
              {act ? ACT[act.a] : ''}
            </Button>
          </>
        }
      >
        {act && (
          <div className="space-y-3 text-sm">
            {error && <Alert>{error}</Alert>}
            {act.a === 'confirm' && <p>Gọi khách {act.r.phone} để thống nhất giờ và giá trước khi xác nhận. Khách sẽ thấy giá chốt và ghi chú của bạn.</p>}
            {act.a === 'complete' && (
              <p>Khách đã đến lắp / nhận hàng và đã thanh toán tại garage.{act.r.items.some((i) => i.kind === 'PRODUCT') && ' Số lượng còn bán của tin (nếu nhập tay) sẽ tự trừ.'}</p>
            )}
            {(act.a === 'confirm' || act.a === 'complete') && (
              <Field label="Giá chốt">
                {(id) => <Input id={id} inputMode="numeric" value={form.finalTotal} onChange={(e) => setForm({ ...form, finalTotal: moneyInput(parseMoney(e.target.value)) })} />}
              </Field>
            )}
            <Field label={act.a === 'reject' ? 'Lý do (khách sẽ thấy)' : 'Ghi chú cho khách'}>
              {(id) => (
                <Input
                  id={id}
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder={act.a === 'confirm' ? 'VD: Mời anh qua lúc 9h, mang theo cà vẹt' : ''}
                  data-testid="request-note"
                />
              )}
            </Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}
