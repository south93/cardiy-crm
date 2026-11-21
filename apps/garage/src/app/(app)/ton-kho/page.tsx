'use client';

import { Badge, Button, Card, Checkbox, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import { ArrowLeftRight, ClipboardCheck, PackagePlus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Pager } from '@/components/pager';
import { RequirePermission } from '@/components/require-permission';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCurrentBranch } from '@/lib/branch';
import { fmtMoney, type Paged } from '@/lib/crm';
import { DOC_TYPES, fmtMfg, fmtQty, type Category, type DocType, type ProductRow } from '@/lib/inventory';
import { fmtDateTime } from '@/lib/orders';

interface DocRow {
  id: string;
  code: string;
  type: DocType;
  branch: { code: string; name: string } | null;
  toBranch: { code: string; name: string } | null;
  supplier: string | null;
  refNo: string | null;
  note: string | null;
  lines: number;
  total: number | null;
  createdBy: string | null;
  createdAt: string;
}

function StockList({ branchId }: { branchId: string }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [cats, setCats] = useState<Category[]>([]);
  useEffect(() => {
    api<Category[]>('/product-categories').then(setCats, () => setCats([]));
  }, []);
  const [low, setLow] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<ProductRow> | null>(null);
  useEffect(() => {
    if (!branchId) return;
    const p = new URLSearchParams({ kind: 'PHU_TUNG', branchId, page: String(page), pageSize: '25' });
    if (q.trim()) p.set('q', q.trim());
    if (low) p.set('lowStock', 'true');
    if (cat) p.set('categoryId', cat);
    const t = setTimeout(() => api<Paged<ProductRow>>(`/products?${p}`).then(setData), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [branchId, q, low, cat, page]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full md:w-72">
          <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <Input value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="Mã, tên sản phẩm…" className="rounded-full bg-white/80 pl-10" aria-label="Tìm hàng trong kho" />
        </div>
        <Select value={cat} onChange={(e) => (setCat(e.target.value), setPage(1))} className="w-auto rounded-full bg-white/80" aria-label="Lọc nhóm hàng">
          <option value="">Mọi nhóm hàng</option>
          {cats.map((c) => (
            <optgroup key={c.id} label={c.name}>
              <option value={c.id}>{c.name} (tất cả)</option>
              {c.children.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.name}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <Checkbox checked={low} onChange={(e) => (setLow(e.target.checked), setPage(1))} label="Chỉ hàng sắp hết (≤ tồn tối thiểu)" />
      </div>
      <Card className="overflow-hidden">
        {!data ? (
          <div className="grid place-items-center p-10">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="stock-table">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3 font-semibold">Mã hàng</th>
                    <th className="px-3 py-3 font-semibold">Tên hàng</th>
                    <th className="px-3 py-3 font-semibold">Nhóm hàng</th>
                    <th className="px-3 py-3 text-right font-semibold">Tồn tối thiểu</th>
                    <th className="px-3 py-3 text-right font-semibold">Tồn</th>
                    <th className="px-5 py-3 text-right font-semibold">Giá trị (giá vốn)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((p) => {
                    const warn = (p.stock ?? 0) < 0 || (p.minStock !== null && (p.stock ?? 0) <= p.minStock);
                    return (
                      <tr key={p.id} onClick={() => router.push(`/danh-muc/${p.id}`)} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-white/70" data-testid="stock-row">
                        <td className="whitespace-nowrap px-5 py-3 font-mono text-xs">{p.code}</td>
                        <td className="px-3 py-3">
                          <div className="font-medium">{p.name}</div>
                          {fmtMfg(p.mfgMonth, p.mfgYear) && <div className="text-xs text-slate-500">SX {fmtMfg(p.mfgMonth, p.mfgYear)}</div>}
                        </td>
                        <td className="px-3 py-3 text-slate-600">{p.category?.name ?? '—'}</td>
                        <td className="px-3 py-3 text-right text-slate-500">{p.minStock === null ? '—' : fmtQty(p.minStock)}</td>
                        <td className={`px-3 py-3 text-right font-semibold tabular-nums ${warn ? 'text-rose-600' : ''}`}>
                          {fmtQty(p.stock)} {p.unit}
                          {warn && (
                            <div>
                              <Badge tone="rose">{(p.stock ?? 0) < 0 ? 'Âm kho' : 'Sắp hết'}</Badge>
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums text-slate-600">{p.costPrice === null ? '—' : fmtMoney(Math.round(Math.max(0, p.stock ?? 0) * p.costPrice))}</td>
                      </tr>
                    );
                  })}
                  {!data.items.length && (
                    <tr>
                      <td colSpan={6} className="px-5 py-12 text-center text-slate-500">
                        {low ? 'Không có hàng sắp hết.' : 'Chưa có hàng hoá. Thêm sản phẩm ở Danh mục rồi nhập hàng.'}
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

function DocList({ branchId }: { branchId: string }) {
  const router = useRouter();
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<DocRow> | null>(null);
  useEffect(() => {
    if (!branchId) return;
    const p = new URLSearchParams({ branchId, page: String(page), pageSize: '20' });
    if (type) p.set('type', type);
    api<Paged<DocRow>>(`/stock-documents?${p}`).then(setData);
  }, [branchId, type, page]);
  return (
    <div className="space-y-3">
      <Select value={type} onChange={(e) => (setType(e.target.value), setPage(1))} className="w-auto rounded-full bg-white/80" aria-label="Lọc loại phiếu">
        <option value="">Mọi loại phiếu</option>
        {(Object.keys(DOC_TYPES) as DocType[]).map((t) => (
          <option key={t} value={t}>
            {DOC_TYPES[t].label}
          </option>
        ))}
      </Select>
      <Card className="overflow-hidden">
        {!data ? (
          <div className="grid place-items-center p-10">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : (
          <>
            <table className="w-full text-sm" data-testid="doc-table">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-semibold">Phiếu</th>
                  <th className="px-3 py-3 font-semibold">Chi tiết</th>
                  <th className="px-3 py-3 text-right font-semibold">Số dòng</th>
                  <th className="px-3 py-3 text-right font-semibold">Giá trị</th>
                  <th className="px-5 py-3 font-semibold">Người lập</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((d) => (
                  <tr key={d.id} onClick={() => router.push(`/ton-kho/phieu/${d.id}`)} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-white/70" data-testid="doc-row">
                    <td className="px-5 py-3">
                      <div className="font-semibold">{d.code}</div>
                      <Badge tone={DOC_TYPES[d.type].tone}>{DOC_TYPES[d.type].label}</Badge>
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {d.type === 'CHUYEN' ? `${d.branch?.code} → ${d.toBranch?.code}` : d.branch?.code}
                      {d.supplier && ` · ${d.supplier}`}
                      {d.refNo && ` · HĐ ${d.refNo}`}
                      {d.note && <div className="text-xs text-slate-400">{d.note}</div>}
                    </td>
                    <td className="px-3 py-3 text-right">{d.lines}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{d.type === 'NHAP' && d.total !== null ? fmtMoney(d.total) : '—'}</td>
                    <td className="px-5 py-3 text-slate-500">
                      {d.createdBy}
                      <div className="text-xs">{fmtDateTime(d.createdAt)}</div>
                    </td>
                  </tr>
                ))}
                {!data.items.length && (
                  <tr>
                    <td colSpan={5} className="px-5 py-12 text-center text-slate-500">
                      Chưa có phiếu kho.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}

function Stock() {
  const { can, me } = useAuth();
  const params = useSearchParams();
  const current = useCurrentBranch();
  const [branchId, setBranchId] = useState('');
  const [tab, setTab] = useState<'ton' | 'phieu'>(params.get('tab') === 'phieu' ? 'phieu' : 'ton');
  useEffect(() => {
    if (current && !branchId) setBranchId(current);
  }, [current, branchId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          tabs={[
            { value: 'ton' as const, label: 'Tồn kho' },
            { value: 'phieu' as const, label: 'Phiếu kho' },
          ]}
          value={tab}
          onChange={setTab}
        />
        {(me?.branches.length ?? 0) > 1 && (
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="w-auto rounded-full bg-white/80" aria-label="Kho chi nhánh">
            {me!.branches.map((b) => (
              <option key={b.id} value={b.id}>
                Kho {b.name}
              </option>
            ))}
          </Select>
        )}
        <div className="flex-1" />
        {can('inventory.manage') && (
          <>
            <Link href={`/ton-kho/phieu/moi?loai=NHAP&cn=${branchId}`}>
              <Button data-testid="new-receipt">
                <PackagePlus className="h-4 w-4" />
                Nhập hàng
              </Button>
            </Link>
            {(me?.branches.length ?? 0) > 1 && (
              <Link href={`/ton-kho/phieu/moi?loai=CHUYEN&cn=${branchId}`}>
                <Button variant="outline">
                  <ArrowLeftRight className="h-4 w-4" />
                  Chuyển kho
                </Button>
              </Link>
            )}
          </>
        )}
        {can('inventory.adjust.approve') && (
          <Link href={`/ton-kho/phieu/moi?loai=DIEU_CHINH&cn=${branchId}`}>
            <Button variant="outline">
              <ClipboardCheck className="h-4 w-4" />
              Kiểm kê
            </Button>
          </Link>
        )}
      </div>
      {tab === 'ton' ? <StockList branchId={branchId} /> : <DocList branchId={branchId} />}
    </div>
  );
}

export default function StockPage() {
  return (
    <RequirePermission permission="inventory.view">
      <Suspense>
        <Stock />
      </Suspense>
    </RequirePermission>
  );
}
