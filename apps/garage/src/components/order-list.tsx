'use client';

import { Badge, Button, Card, Input, Select, Spinner } from '@cardiy/ui';
import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { QUOTE_STATUS } from '@/components/order-quote-card';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Pager } from '@/components/pager';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCurrentBranch } from '@/lib/branch';
import { fmtMoney } from '@/lib/crm';
import { fmtDateTime, PAYMENT_STATE, STATUS, type OrderList, type OrderStatus } from '@/lib/orders';

const VIEWS = {
  open: { statuses: ['TIEP_NHAN', 'DANG_SUA', 'HOAN_THANH'] as OrderStatus[], empty: 'Không có đơn đang xử lý.' },
  done: { statuses: ['DA_GIAO', 'HUY'] as OrderStatus[], empty: 'Chưa có đơn đã giao.' },
};

/** Danh sách đơn có lọc theo trạng thái (đếm số đơn từng trạng thái) và tìm theo biển số / SĐT / tên / mã đơn. */
export function OrderListView({ view }: { view: 'open' | 'done' }) {
  const router = useRouter();
  const { can, me } = useAuth();
  const current = useCurrentBranch();
  /** '' = tất cả chi nhánh được phép; mặc định theo chi nhánh đang làm việc ở thanh trên cùng */
  const [branch, setBranch] = useState<string | null>(null);
  useEffect(() => {
    if (current) setBranch(current);
    else if (me && !me.branches.length) setBranch('');
  }, [current, me]);
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<OrderList | null>(null);

  useEffect(() => {
    if (branch === null) return;
    const p = new URLSearchParams({ view, page: String(page), pageSize: '20' });
    if (branch) p.set('branchId', branch);
    if (status) p.set('status', status);
    if (q.trim()) p.set('q', q.trim());
    const t = setTimeout(() => api<OrderList>(`/orders?${p}`).then(setData), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [view, branch, status, q, page]);

  const all = VIEWS[view].statuses.reduce((s, st) => s + (data?.counts[st] ?? 0), 0);
  const chip = (value: OrderStatus | '', label: string, n: number) => (
    <button
      key={value || 'all'}
      type="button"
      onClick={() => (setStatus(value), setPage(1))}
      className={`rounded-full px-3 py-1.5 text-sm ${status === value ? 'bg-brand-600 text-white' : 'bg-white/80 text-slate-600 hover:bg-white'}`}
      data-testid={`status-${value || 'all'}`}
    >
      {label} <span className="opacity-70">{n}</span>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {chip('', 'Tất cả', all)}
        {VIEWS[view].statuses.map((s) => chip(s, STATUS[s].label, data?.counts[s] ?? 0))}
        {(me?.branches.length ?? 0) > 1 && (
          <Select value={branch ?? ''} onChange={(e) => (setBranch(e.target.value), setPage(1))} className="w-auto rounded-full bg-white/80 md:ml-2" aria-label="Lọc chi nhánh">
            <option value="">Tất cả chi nhánh</option>
            {me!.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
        <div className="relative w-full md:ml-2 md:w-72">
          <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <Input value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="Biển số, SĐT, tên, mã đơn…" className="rounded-full bg-white/80 pl-10" aria-label="Tìm đơn" />
        </div>
        <div className="flex-1" />
        {can('ro.manage') && (
          <Link href="/ban-hang">
            <Button>
              <Plus className="h-4 w-4" />
              Tạo đơn
            </Button>
          </Link>
        )}
      </div>

      <Card className="overflow-hidden">
        {!data ? (
          <div className="grid place-items-center p-10">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="order-table">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3 font-semibold">Đơn</th>
                    <th className="px-3 py-3 font-semibold">Xe · Khách</th>
                    <th className="px-3 py-3 font-semibold">Yêu cầu</th>
                    <th className="px-3 py-3 font-semibold">KTV</th>
                    <th className="px-3 py-3 text-right font-semibold">Tổng tiền</th>
                    <th className="px-5 py-3 font-semibold">{view === 'done' ? 'Giao xe' : 'Nhận xe'}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((o) => (
                    <tr key={o.id} onClick={() => router.push(`/don-hang/${o.id}`)} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-white/70" data-testid="order-row">
                      <td className="px-5 py-3">
                        <Link href={`/don-hang/${o.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold hover:text-brand-600">
                          {o.code}
                        </Link>
                        <div className="mt-1">
                          <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
                        </div>
                        {o.quote && o.quote.status !== 'HET_HIEU_LUC' && (
                          <div className="mt-1" data-testid="row-quote">
                            <Badge tone={QUOTE_STATUS[o.quote.status].tone} className="text-[10px]">
                              {QUOTE_STATUS[o.quote.status].label}
                            </Badge>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {o.vehicle ? <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-xs">{o.vehicle.plate}</span> : <span className="text-xs text-slate-500">Bán lẻ</span>}
                        <div className="mt-1 text-slate-700">{o.customer.name}</div>
                        <div className="text-xs text-slate-500">{o.customer.phone ?? ''}</div>
                      </td>
                      <td className="max-w-xs px-3 py-3 text-slate-600">
                        <div className="line-clamp-2">{o.request ?? '—'}</div>
                        <div className="text-xs text-slate-400">{o.itemCount} hạng mục · {o.branch.code}</div>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{o.technician?.name ?? '—'}</td>
                      <td className="px-3 py-3 text-right">
                        {o.total === null ? (
                          '—'
                        ) : (
                          <>
                            <div className="font-medium tabular-nums">{fmtMoney(o.total)}</div>
                            {o.paymentState && o.status !== 'HUY' && <Badge tone={PAYMENT_STATE[o.paymentState].tone}>{PAYMENT_STATE[o.paymentState].label}</Badge>}
                          </>
                        )}
                      </td>
                      <td className="px-5 py-3 text-slate-500">
                        {fmtDateTime(view === 'done' ? (o.deliveredAt ?? o.receivedAt) : o.receivedAt)}
                        {view === 'open' && o.promisedAt && <div className={`text-xs ${new Date(o.promisedAt) < new Date() ? 'text-rose-600' : 'text-slate-400'}`}>Hẹn: {fmtDateTime(o.promisedAt)}</div>}
                      </td>
                    </tr>
                  ))}
                  {!data.items.length && (
                    <tr>
                      <td colSpan={6} className="px-5 py-12 text-center text-slate-500">
                        {q ? `Không có đơn khớp "${q}"` : VIEWS[view].empty}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
