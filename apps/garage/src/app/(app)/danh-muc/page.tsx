'use client';

import { Badge, Button, Card, Dialog, Input, Select, Spinner } from '@cardiy/ui';
import { FolderPlus, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Pager } from '@/components/pager';
import { ProductForm, emptyProduct, productPayload } from '@/components/product-form';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCurrentBranch } from '@/lib/branch';
import { fmtMoney } from '@/lib/crm';
import { fmtMfg, fmtQty, type Category, type ProductRow } from '@/lib/inventory';
import type { Paged } from '@/lib/crm';

function Catalog() {
  const router = useRouter();
  const { can } = useAuth();
  const branchId = useCurrentBranch();
  const [cats, setCats] = useState<Category[] | null>(null);
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [make, setMake] = useState('');
  const [makes, setMakes] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<ProductRow> | null>(null);
  const [open, setOpen] = useState(false);
  const [catDialog, setCatDialog] = useState<{ parentId: string | null } | null>(null);
  const [catName, setCatName] = useState('');
  const [catError, setCatError] = useState<string | null>(null);

  const loadCats = useCallback(() => api<Category[]>('/product-categories').then(setCats), []);
  useEffect(() => {
    void loadCats();
    api<string[]>('/products/vehicle-makes').then(setMakes, () => setMakes([]));
  }, [loadCats]);

  useEffect(() => {
    if (!branchId) return;
    const p = new URLSearchParams({ page: String(page), pageSize: '25', branchId });
    if (cat) p.set('categoryId', cat);
    if (q.trim()) p.set('q', q.trim());
    if (kind) p.set('kind', kind);
    if (make) p.set('make', make);
    const t = setTimeout(() => api<Paged<ProductRow>>(`/products?${p}`).then(setData), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [cat, q, kind, make, page, branchId]);

  const pickCat = (id: string) => (setCat(id), setPage(1));
  const total = cats?.reduce((s, c) => s + c.count, 0) ?? 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <Card className="h-fit p-3" data-testid="category-tree">
        <button type="button" onClick={() => pickCat('')} className={`flex w-full justify-between rounded-xl px-3 py-2 text-sm ${!cat ? 'bg-brand-600 text-white' : 'hover:bg-slate-50'}`}>
          <span>Tất cả</span>
          <span className="opacity-70">{total}</span>
        </button>
        {!cats ? (
          <Spinner className="m-3 text-brand-600" />
        ) : (
          cats.map((c) => (
            <div key={c.id} className="mt-1">
              <button type="button" onClick={() => pickCat(c.id)} className={`flex w-full justify-between rounded-xl px-3 py-2 text-left text-sm font-medium ${cat === c.id ? 'bg-brand-600 text-white' : 'hover:bg-slate-50'}`}>
                <span>{c.name}</span>
                <span className="opacity-70">{c.count}</span>
              </button>
              {(cat === c.id || c.children.some((ch) => ch.id === cat)) &&
                c.children.map((ch) => (
                  <button key={ch.id} type="button" onClick={() => pickCat(ch.id)} className={`ml-3 flex w-[calc(100%-0.75rem)] justify-between rounded-lg px-3 py-1.5 text-left text-sm ${cat === ch.id ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                    <span>{ch.name}</span>
                    <span className="opacity-70">{ch.count}</span>
                  </button>
                ))}
              {can('inventory.manage') && cat === c.id && (
                <button type="button" onClick={() => (setCatDialog({ parentId: c.id }), setCatName(''), setCatError(null))} className="ml-3 mt-0.5 flex items-center gap-1 px-3 py-1 text-xs text-brand-600 hover:underline">
                  <Plus className="h-3 w-3" /> Thêm nhóm con
                </button>
              )}
            </div>
          ))
        )}
        {can('inventory.manage') && (
          <button type="button" onClick={() => (setCatDialog({ parentId: null }), setCatName(''), setCatError(null))} className="mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-brand-600 hover:bg-brand-50">
            <FolderPlus className="h-4 w-4" /> Thêm nhóm
          </button>
        )}
      </Card>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full md:w-72">
            <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
            <Input value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="Mã, tên, thương hiệu…" className="rounded-full bg-white/80 pl-10" aria-label="Tìm sản phẩm" />
          </div>
          <Select value={kind} onChange={(e) => (setKind(e.target.value), setPage(1))} className="w-auto rounded-full bg-white/80" aria-label="Lọc loại">
            <option value="">Hàng hoá & dịch vụ</option>
            <option value="PHU_TUNG">Hàng hoá</option>
            <option value="DICH_VU">Dịch vụ</option>
          </Select>
          <Select value={make} onChange={(e) => (setMake(e.target.value), setPage(1))} className="w-auto rounded-full bg-white/80" aria-label="Lọc hãng xe">
            <option value="">Mọi hãng xe</option>
            {makes.map((m) => (
              <option key={m} value={m}>
                Hợp xe {m}
              </option>
            ))}
          </Select>
          <div className="flex-1" />
          {can('inventory.manage') && (
            <Button onClick={() => setOpen(true)} data-testid="add-product">
              <Plus className="h-4 w-4" />
              Thêm sản phẩm
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
                <table className="w-full text-sm" data-testid="product-table">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-5 py-3 font-semibold">Sản phẩm</th>
                      <th className="px-3 py-3 font-semibold">Nhóm</th>
                      <th className="px-3 py-3 font-semibold">Hãng xe</th>
                      <th className="px-3 py-3 text-right font-semibold">Giá bán</th>
                      {data.items[0]?.costPrice !== null && data.items.length > 0 && <th className="px-3 py-3 text-right font-semibold">Giá vốn</th>}
                      <th className="px-5 py-3 text-right font-semibold">Tồn CN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((p) => (
                      <tr key={p.id} onClick={() => router.push(`/danh-muc/${p.id}`)} className={`cursor-pointer border-b border-slate-50 last:border-0 hover:bg-white/70 ${p.active ? '' : 'opacity-50'}`} data-testid="product-row">
                        <td className="px-5 py-3">
                          <Link href={`/danh-muc/${p.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:text-brand-600">
                            {p.name}
                          </Link>
                          <div className="text-xs text-slate-500">
                            <span className="font-mono">{p.code}</span>
                            {p.brand && ` · ${p.brand}`}
                            {p.kind === 'DICH_VU' && ' · Dịch vụ'}
                            {fmtMfg(p.mfgMonth, p.mfgYear) && ` · SX ${fmtMfg(p.mfgMonth, p.mfgYear)}`}
                            {!p.active && ' · Ngừng bán'}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-slate-600">{p.category?.name ?? '—'}</td>
                        <td className="px-3 py-3">
                          {p.vehicleMakes.length ? (
                            <div className="flex flex-wrap gap-1">
                              {p.vehicleMakes.slice(0, 3).map((m) => (
                                <Badge key={m} tone="sky">
                                  {m}
                                </Badge>
                              ))}
                              {p.vehicleMakes.length > 3 && <span className="text-xs text-slate-500">+{p.vehicleMakes.length - 3}</span>}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">Mọi xe</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{fmtMoney(p.salePrice)}</td>
                        {p.costPrice !== null && <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-slate-500">{fmtMoney(p.costPrice)}</td>}
                        <td className={`px-5 py-3 text-right tabular-nums ${p.stock !== null && p.minStock !== null && p.stock <= p.minStock ? 'font-semibold text-rose-600' : ''}`}>
                          {p.kind === 'DICH_VU' ? '—' : fmtQty(p.stock)} {p.kind !== 'DICH_VU' && p.unit}
                        </td>
                      </tr>
                    ))}
                    {!data.items.length && (
                      <tr>
                        <td colSpan={6} className="px-5 py-12 text-center text-slate-500">
                          {q || cat || make || kind ? 'Không có sản phẩm khớp bộ lọc.' : 'Chưa có sản phẩm. Bấm "Thêm sản phẩm" để bắt đầu.'}
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

      <Dialog open={open} onClose={() => setOpen(false)} title="Thêm sản phẩm / dịch vụ" wide>
        {open && cats && (
          <ProductForm
            initial={emptyProduct(cat)}
            categories={cats}
            submitLabel="Thêm sản phẩm"
            showCost={can('inventory.manage')}
            onCancel={() => setOpen(false)}
            onSubmit={async (v) => {
              const r = await api<{ id: string }>('/products', { body: productPayload(v) });
              router.push(`/danh-muc/${r.id}`);
            }}
          />
        )}
      </Dialog>

      <Dialog
        open={catDialog !== null}
        onClose={() => setCatDialog(null)}
        title={catDialog?.parentId ? `Thêm nhóm con của "${cats?.find((c) => c.id === catDialog.parentId)?.name}"` : 'Thêm nhóm sản phẩm'}
        footer={
          <>
            <Button variant="outline" onClick={() => setCatDialog(null)}>
              Huỷ
            </Button>
            <Button
              disabled={!catName.trim()}
              onClick={async () => {
                try {
                  await api('/product-categories', { body: { name: catName, parentId: catDialog?.parentId } });
                  setCatDialog(null);
                  await loadCats();
                } catch (e) {
                  setCatError(e instanceof ApiError ? e.message : 'Không lưu được');
                }
              }}
            >
              Lưu
            </Button>
          </>
        }
      >
        {catError && <p className="mb-2 text-sm text-rose-600">{catError}</p>}
        <Input aria-label="Tên nhóm" value={catName} onChange={(e) => setCatName(e.target.value)} autoFocus />
      </Dialog>
    </div>
  );
}

export default function CatalogPage() {
  return (
    <RequirePermission permission="inventory.view">
      <Catalog />
    </RequirePermission>
  );
}
