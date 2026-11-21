'use client';

import { Alert, Badge, Button, Card, CardTitle, Dialog, Spinner } from '@cardiy/ui';
import { ChevronLeft, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ProductForm, productPayload, type ProductFormValue } from '@/components/product-form';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtMoney } from '@/lib/crm';
import { fmtMfg, fmtQty, MOVE_KINDS, type Category } from '@/lib/inventory';
import { fmtDateTime, moneyInput, type ItemKind } from '@/lib/orders';

interface Product {
  id: string;
  code: string;
  name: string;
  kind: ItemKind;
  categoryId: string | null;
  category: string | null;
  brand: string | null;
  unit: string | null;
  salePrice: number;
  costPrice: number | null;
  vehicleMakes: string[];
  minStock: number | null;
  mfgMonth: number | null;
  mfgYear: number | null;
  note: string | null;
  active: boolean;
  stock: { branch: { id: string; code: string; name: string }; quantity: number }[];
  movements: { id: string; kind: string; branchId: string; quantity: number; balance: number; unitCost: number | null; document: { id: string; code: string } | null; order: { id: string; code: string } | null; note: string | null; at: string }[];
}

function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const [p, setP] = useState<Product | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [edit, setEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api<Product>(`/products/${id}`).then(setP), [id]);
  useEffect(() => {
    void load();
    api<Category[]>('/product-categories').then(setCats, () => setCats([]));
  }, [load]);

  if (!p) return <Spinner className="h-6 w-6 text-brand-600" />;
  const branchName = (bid: string) => p.stock.find((s) => s.branch.id === bid)?.branch.code ?? '';
  const form: ProductFormValue = {
    code: p.code,
    name: p.name,
    kind: p.kind,
    categoryId: p.categoryId ?? '',
    brand: p.brand ?? '',
    unit: p.unit ?? '',
    salePrice: moneyInput(p.salePrice),
    costPrice: moneyInput(p.costPrice ?? 0),
    vehicleMakes: p.vehicleMakes,
    minStock: p.minStock === null ? '' : String(p.minStock),
    mfgMonth: p.mfgMonth ? String(p.mfgMonth) : '',
    mfgYear: p.mfgYear ? String(p.mfgYear) : '',
    note: p.note ?? '',
    active: p.active,
  };

  return (
    <div className="space-y-4" data-testid="product-detail">
      <Link href="/danh-muc" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
        <ChevronLeft className="h-4 w-4" />
        Danh mục sản phẩm
      </Link>
      <Card className="flex flex-wrap items-start gap-4 p-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold" data-testid="product-name">
              {p.name}
            </h2>
            <Badge tone={p.kind === 'DICH_VU' ? 'lav' : 'sky'}>{p.kind === 'DICH_VU' ? 'Dịch vụ' : 'Hàng hoá'}</Badge>
            {!p.active && <Badge tone="slate">Ngừng bán</Badge>}
          </div>
          <div className="mt-1 text-sm text-slate-500">
            <span className="font-mono">{p.code}</span>
            {p.category && ` · ${p.category}`}
            {p.brand && ` · ${p.brand}`}
            {p.unit && ` · ĐVT: ${p.unit}`}
            {fmtMfg(p.mfgMonth, p.mfgYear) && <span data-testid="product-mfg"> · Sản xuất: {fmtMfg(p.mfgMonth, p.mfgYear)}</span>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {p.vehicleMakes.length ? p.vehicleMakes.map((m) => <Badge key={m} tone="sky">{m}</Badge>) : <span className="text-xs text-slate-500">Dùng cho mọi xe</span>}
          </div>
          {p.note && <p className="mt-2 text-sm text-slate-600">{p.note}</p>}
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">Giá bán</div>
          <div className="text-xl font-semibold tabular-nums" data-testid="product-price">
            {fmtMoney(p.salePrice)}
          </div>
          {p.costPrice !== null && <div className="text-xs text-slate-500">Giá vốn {fmtMoney(p.costPrice)}</div>}
        </div>
        {can('inventory.manage') && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEdit(true)} data-testid="edit-product">
              <Pencil className="h-4 w-4" />
              Sửa
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                if (!window.confirm(`Xoá "${p.name}"?`)) return;
                try {
                  await api(`/products/${p.id}`, { method: 'DELETE' });
                  router.push('/danh-muc');
                } catch (e) {
                  setError(e instanceof ApiError ? e.message : 'Không xoá được');
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </Card>
      {error && <Alert>{error}</Alert>}

      {p.kind === 'PHU_TUNG' && (
        <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
          <Card className="h-fit p-4 lg:p-5">
            <CardTitle className="mb-3">Tồn theo chi nhánh</CardTitle>
            <ul className="space-y-2 text-sm" data-testid="stock-by-branch">
              {p.stock.map((s) => (
                <li key={s.branch.id} className="flex justify-between rounded-xl bg-slate-50 px-3 py-2">
                  <span>{s.branch.name}</span>
                  <span className={`font-semibold tabular-nums ${s.quantity < 0 || (p.minStock !== null && s.quantity <= p.minStock) ? 'text-rose-600' : ''}`}>
                    {fmtQty(s.quantity)} {p.unit}
                  </span>
                </li>
              ))}
            </ul>
            {p.minStock !== null && <p className="mt-2 text-xs text-slate-500">Tồn tối thiểu: {fmtQty(p.minStock)}</p>}
          </Card>
          <Card className="p-4 lg:p-5">
            <CardTitle className="mb-3">Sổ kho (50 lần gần nhất)</CardTitle>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="movement-table">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                    <th className="py-2 font-medium">Thời gian</th>
                    <th className="py-2 font-medium">Loại</th>
                    <th className="py-2 font-medium">CN</th>
                    <th className="py-2 font-medium">Chứng từ</th>
                    <th className="py-2 text-right font-medium">SL</th>
                    <th className="py-2 text-right font-medium">Tồn sau</th>
                  </tr>
                </thead>
                <tbody>
                  {p.movements.map((m) => (
                    <tr key={m.id} className="border-b border-slate-50 last:border-0">
                      <td className="py-2 text-slate-500">{fmtDateTime(m.at)}</td>
                      <td className="py-2">{MOVE_KINDS[m.kind] ?? m.kind}</td>
                      <td className="py-2">{branchName(m.branchId)}</td>
                      <td className="py-2">
                        {m.document && (
                          <Link href={`/ton-kho/phieu/${m.document.id}`} className="text-brand-600 hover:underline">
                            {m.document.code}
                          </Link>
                        )}
                        {m.order && (
                          <Link href={`/don-hang/${m.order.id}`} className="text-brand-600 hover:underline">
                            {m.order.code}
                          </Link>
                        )}
                      </td>
                      <td className={`py-2 text-right tabular-nums ${m.quantity < 0 ? 'text-rose-600' : 'text-mint-700'}`}>
                        {m.quantity > 0 ? '+' : ''}
                        {fmtQty(m.quantity)}
                      </td>
                      <td className="py-2 text-right tabular-nums">{fmtQty(m.balance)}</td>
                    </tr>
                  ))}
                  {!p.movements.length && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-500">
                        Chưa có xuất nhập. Vào Tồn kho → Nhập hàng để nhập tồn đầu.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      <Dialog open={edit} onClose={() => setEdit(false)} title="Sửa sản phẩm" wide>
        {edit && (
          <ProductForm
            initial={form}
            categories={cats}
            submitLabel="Lưu"
            showCost={p.costPrice !== null}
            onCancel={() => setEdit(false)}
            onSubmit={async (v) => {
              await api(`/products/${p.id}`, { method: 'PATCH', body: productPayload(v) });
              setEdit(false);
              await load();
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

export default function ProductPage() {
  return (
    <RequirePermission permission="inventory.view">
      <ProductDetail />
    </RequirePermission>
  );
}
