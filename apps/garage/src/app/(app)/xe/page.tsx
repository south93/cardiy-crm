'use client';

import { Badge, Card, Input, Select, Spinner } from '@cardiy/ui';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Pager } from '@/components/pager';
import { RequirePermission } from '@/components/require-permission';
import { api } from '@/lib/api';
import { daysUntil, expiryText, expiryTone, fmtKm, type Paged } from '@/lib/crm';

interface Row {
  id: string;
  plate: string;
  plateValid: boolean;
  make: string | null;
  model: string | null;
  year: number | null;
  odometerKm: number | null;
  registrationExpiry: string | null;
  insuranceExpiry: string | null;
  owner: { id: string; name: string; phone: string | null } | null;
}

function VehiclesList() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<Row> | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (q.trim()) qs.set('q', q.trim());
    if (filter === 'expiring') qs.set('expiringDays', '30');
    if (filter === 'review') qs.set('needsReview', 'true');
    setData(await api<Paged<Row>>(`/vehicles?${qs}`));
  }, [q, filter, page]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 300);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Biển số, hãng, dòng xe, SĐT chủ xe…" className="rounded-full bg-white/80 pl-10" aria-label="Tìm xe" />
        </div>
        <Select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }} className="w-auto rounded-full bg-white/80" aria-label="Lọc xe">
          <option value="">Tất cả xe</option>
          <option value="expiring">Sắp hết hạn đăng kiểm / bảo hiểm (30 ngày)</option>
          <option value="review">Biển số cần xem lại</option>
        </Select>
      </div>
      <Card className="overflow-hidden">
        {!data ? (
          <div className="grid place-items-center p-10"><Spinner className="h-6 w-6 text-brand-600" /></div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="vehicle-table">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3 font-semibold">Biển số</th>
                    <th className="px-3 py-3 font-semibold">Xe</th>
                    <th className="px-3 py-3 font-semibold">Chủ xe</th>
                    <th className="px-3 py-3 font-semibold">Số km</th>
                    <th className="px-5 py-3 font-semibold">Đăng kiểm</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((v) => (
                    <tr key={v.id} onClick={() => router.push(`/xe/${v.id}`)} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-white/70" data-testid="vehicle-row">
                      <td className="px-5 py-3">
                        <Link href={`/xe/${v.id}`} onClick={(e) => e.stopPropagation()} className="font-mono font-semibold hover:text-brand-600">{v.plate}</Link>
                        {!v.plateValid && <Badge tone="peach" className="ml-2">Cần xem lại</Badge>}
                      </td>
                      <td className="px-3 py-3 text-slate-600">{[v.make, v.model, v.year].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="px-3 py-3">
                        {v.owner ? (
                          <Link href={`/khach-hang/${v.owner.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-brand-600">
                            {v.owner.name} <span className="text-xs text-slate-500">{v.owner.phone ?? ''}</span>
                          </Link>
                        ) : (
                          <span className="text-slate-400">Chưa có chủ</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-slate-600">{fmtKm(v.odometerKm)}</td>
                      <td className="px-5 py-3"><Badge tone={expiryTone(daysUntil(v.registrationExpiry))}>{expiryText(daysUntil(v.registrationExpiry), v.registrationExpiry)}</Badge></td>
                    </tr>
                  ))}
                  {!data.items.length && (
                    <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-500">Không có xe phù hợp</td></tr>
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

export default function VehiclesPage() {
  return (
    <RequirePermission permission="vehicle.view">
      <VehiclesList />
    </RequirePermission>
  );
}
