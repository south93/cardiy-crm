'use client';

import { Badge, Button, Card, Dialog, Input, Select, Spinner } from '@cardiy/ui';
import { FileUp, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { CustomerForm, customerPayload, emptyCustomer, vehiclePayload } from '@/components/crm-forms';
import { ExportButton } from '@/components/export-button';
import { Pager } from '@/components/pager';
import { RequirePermission } from '@/components/require-permission';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { SOURCES, TIERS, fmtDate, initials, sourceLabel, tierOf, type Paged, type Source, type Tier } from '@/lib/crm';
import { fetchAllPages } from '@/lib/export';

interface Row {
  id: string;
  code: string;
  type: 'PERSON' | 'COMPANY';
  name: string;
  phone: string | null;
  tier: Tier;
  source: Source;
  branchName: string | null;
  createdAt: string;
  vehicles: { id: string; plate: string; make: string | null; model: string | null }[];
}

function CustomersList() {
  const { can } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [tier, setTier] = useState('');
  const [source, setSource] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<Row> | null>(null);
  const [open, setOpen] = useState(false);

  const buildQuery = useCallback(
    (p: number, ps: number) => {
      const qs = new URLSearchParams({ page: String(p), pageSize: String(ps) });
      if (q.trim()) qs.set('q', q.trim());
      if (tier) qs.set('tier', tier);
      if (source) qs.set('source', source);
      return `/customers?${qs}`;
    },
    [q, tier, source],
  );

  const load = useCallback(async () => {
    setData(await api<Paged<Row>>(buildQuery(page, 20)));
  }, [buildQuery, page]);

  // Gõ tìm: chờ 300ms rồi mới gọi API
  useEffect(() => {
    const t = setTimeout(() => void load(), 300);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Tên (không cần dấu), SĐT, biển số, mã KH…"
            className="rounded-full bg-white/80 pl-10"
            aria-label="Tìm khách hàng"
          />
        </div>
        <Select value={tier} onChange={(e) => { setTier(e.target.value); setPage(1); }} className="w-auto rounded-full bg-white/80" aria-label="Lọc hạng">
          <option value="">Mọi hạng</option>
          {TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        <Select value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }} className="w-auto rounded-full bg-white/80" aria-label="Lọc nguồn">
          <option value="">Mọi nguồn</option>
          {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
        <div className="flex-1" />
        <ExportButton<Row>
          filename="danh-sach-khach-hang"
          sheetName="Khách hàng"
          testId="export-customers"
          disabled={!data || data.total === 0}
          fetchRows={() => fetchAllPages<Row>(buildQuery)}
          columns={[
            { header: 'Mã KH', value: (r) => r.code },
            { header: 'Tên khách hàng', value: (r) => r.name },
            { header: 'Loại', value: (r) => (r.type === 'COMPANY' ? 'Doanh nghiệp' : 'Cá nhân') },
            { header: 'Số điện thoại', value: (r) => r.phone ?? '' },
            { header: 'Biển số xe', value: (r) => r.vehicles.map((v) => v.plate).join(', ') },
            { header: 'Hạng', value: (r) => tierOf(r.tier).label },
            { header: 'Nguồn', value: (r) => sourceLabel(r.source) },
            { header: 'Chi nhánh', value: (r) => r.branchName ?? '' },
            { header: 'Ngày tạo', value: (r) => fmtDate(r.createdAt) },
          ]}
        />
        {can('data.import') && (
          <Link href="/khach-hang/nhap">
            <Button variant="outline">
              <FileUp className="h-4 w-4" />
              Nhập từ AppSheet
            </Button>
          </Link>
        )}
        {can('customer.manage') && (
          <Button onClick={() => setOpen(true)} data-testid="add-customer">
            <Plus className="h-4 w-4" />
            Thêm khách hàng
          </Button>
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
              <table className="w-full text-sm" data-testid="customer-table">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3 font-semibold">Khách hàng</th>
                    <th className="px-3 py-3 font-semibold">Xe</th>
                    <th className="px-3 py-3 font-semibold">Hạng</th>
                    <th className="px-3 py-3 font-semibold">Nguồn</th>
                    <th className="px-3 py-3 font-semibold">Chi nhánh</th>
                    <th className="px-5 py-3 font-semibold">Ngày tạo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id} onClick={() => router.push(`/khach-hang/${r.id}`)} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-white/70" data-testid="customer-row">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sky-100 text-xs font-semibold text-sky-700">{initials(r.name) || '?'}</span>
                          <div className="min-w-0">
                            <Link href={`/khach-hang/${r.id}`} className="font-medium hover:text-brand-600" onClick={(e) => e.stopPropagation()}>
                              {r.name}
                            </Link>
                            <div className="text-xs text-slate-500">
                              {r.phone ?? <span className="text-peach-700">Chưa có SĐT</span>} · {r.code}
                              {r.type === 'COMPANY' && ' · Doanh nghiệp'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {r.vehicles.slice(0, 3).map((v) => (
                            <span key={v.id} className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-xs">
                              {v.plate}
                            </span>
                          ))}
                          {r.vehicles.length > 3 && <span className="text-xs text-slate-500">+{r.vehicles.length - 3}</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={tierOf(r.tier).tone}>{tierOf(r.tier).label}</Badge>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{sourceLabel(r.source)}</td>
                      <td className="px-3 py-3 text-slate-600">{r.branchName ?? '—'}</td>
                      <td className="px-5 py-3 text-slate-500">{fmtDate(r.createdAt)}</td>
                    </tr>
                  ))}
                  {!data.items.length && (
                    <tr>
                      <td colSpan={6} className="px-5 py-12 text-center text-slate-500">
                        {q ? `Không tìm thấy khách hàng khớp "${q}"` : 'Chưa có khách hàng. Thêm mới hoặc nhập từ AppSheet.'}
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

      <Dialog open={open} onClose={() => setOpen(false)} title="Thêm khách hàng" wide>
        {open && (
          <CustomerForm
            initial={emptyCustomer()}
            withVehicle
            submitLabel="Thêm khách hàng"
            onCancel={() => setOpen(false)}
            onSubmit={async (c, v) => {
              const r = await api<{ id: string }>('/customers', { body: { ...customerPayload(c), vehicle: v ? vehiclePayload(v) : null } });
              setOpen(false);
              router.push(`/khach-hang/${r.id}`);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

export default function CustomersPage() {
  return (
    <RequirePermission permission="customer.view">
      <Suspense>
        <CustomersList />
      </Suspense>
    </RequirePermission>
  );
}
