'use client';

import { Alert, Button, Card, CardTitle, Field, Input, Select, Spinner } from '@cardiy/ui';
import { ChevronLeft, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { ProductPicker } from '@/components/product-picker';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtMoney } from '@/lib/crm';
import { DOC_TYPES, fmtMfg, fmtQty, type DocType, type ProductRow } from '@/lib/inventory';
import { moneyInput, parseMoney, parseQty } from '@/lib/orders';

interface Line {
  product: ProductRow;
  qty: string;
  cost: string;
}

const cell = 'h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-right outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100';

function NewDoc() {
  const params = useSearchParams();
  const router = useRouter();
  const { me, can } = useAuth();
  const type = (['NHAP', 'CHUYEN', 'DIEU_CHINH'].includes(params.get('loai') ?? '') ? params.get('loai') : 'NHAP') as DocType;
  const [branchId, setBranchId] = useState(params.get('cn') ?? '');
  const [toBranchId, setToBranchId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [suppliers, setSuppliers] = useState<{ id: string; code: string; name: string }[]>([]);
  const [refNo, setRefNo] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!branchId && me?.branches.length) setBranchId(me.branches[0]!.id);
  }, [me, branchId]);
  useEffect(() => {
    if (type === 'NHAP' && can('purchase.manage')) api<{ id: string; code: string; name: string }[]>('/suppliers').then(setSuppliers, () => setSuppliers([]));
  }, [type, can]);
  // Đổi chi nhánh: tồn hiện tại của các dòng (kiểm kê) phải tải lại theo kho mới
  useEffect(() => setLines([]), [branchId]);

  const add = (p: ProductRow) => {
    if (lines.some((l) => l.product.id === p.id)) return;
    setLines([...lines, { product: p, qty: type === 'DIEU_CHINH' ? String(p.stock ?? 0) : '1', cost: moneyInput(p.costPrice ?? 0) }]);
  };
  const set = (id: string, patch: Partial<Line>) => setLines(lines.map((l) => (l.product.id === id ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + Math.round((parseQty(l.qty) ?? 0) * parseMoney(l.cost)), 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>('/stock-documents', {
        body: {
          type,
          branchId,
          toBranchId: type === 'CHUYEN' ? toBranchId : null,
          supplierId: supplierId || null,
          refNo: refNo || null,
          note: note || null,
          lines: lines.map((l) =>
            type === 'DIEU_CHINH'
              ? { productId: l.product.id, countedQty: l.qty.replace(',', '.') }
              : { productId: l.product.id, quantity: l.qty.replace(',', '.'), ...(type === 'NHAP' ? { unitCost: parseMoney(l.cost) } : {}) },
          ),
        },
      });
      router.push(`/ton-kho/phieu/${r.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? (err.errors?.[0]?.message ?? err.message) : 'Không lưu được phiếu');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="new-doc">
      <Link href="/ton-kho?tab=phieu" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
        <ChevronLeft className="h-4 w-4" />
        Tồn kho
      </Link>
      <h2 className="text-xl font-semibold">{DOC_TYPES[type].title}</h2>
      {error && <Alert>{error}</Alert>}
      <Card className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4 lg:p-5">
        <Field label={type === 'CHUYEN' ? 'Chuyển từ kho' : 'Kho chi nhánh'}>
          {(id) => (
            <Select id={id} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {me?.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {type === 'CHUYEN' && (
          <Field label="Chuyển đến kho">
            {(id) => (
              <Select id={id} value={toBranchId} onChange={(e) => setToBranchId(e.target.value)} required>
                <option value="">— Chọn —</option>
                {me?.branches
                  .filter((b) => b.id !== branchId)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        )}
        {type === 'NHAP' && (
          <>
            <Field label="Nhà cung cấp">
              {(id) => (
                <Select id={id} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">— Không ghi —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Số hoá đơn NCC">{(id) => <Input id={id} value={refNo} onChange={(e) => setRefNo(e.target.value)} />}</Field>
          </>
        )}
        <Field label="Ghi chú" className={type === 'NHAP' ? '' : 'lg:col-span-2'}>
          {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </Card>

      <Card className="space-y-3 p-4 lg:p-5">
        <CardTitle>Hàng hoá</CardTitle>
        <div className="max-w-xl">
          <ProductPicker label="Thêm hàng vào phiếu" placeholder="Gõ mã hoặc tên hàng để thêm vào phiếu…" kind="PHU_TUNG" branchId={branchId} onPick={add} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm" data-testid="doc-lines">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="w-28 pb-2 font-medium">Mã hàng</th>
                <th className="pb-2 font-medium">Tên hàng</th>
                <th className="pb-2 font-medium">Nhóm hàng</th>
                <th className="w-28 pb-2 text-right font-medium">Tồn hiện tại</th>
                <th className="w-32 pb-2 text-right font-medium">{type === 'DIEU_CHINH' ? 'Số đếm thực tế' : 'Số lượng'}</th>
                {type === 'NHAP' && <th className="w-36 pb-2 text-right font-medium">Giá nhập</th>}
                {type === 'NHAP' && <th className="w-32 pb-2 text-right font-medium">Thành tiền</th>}
                {type === 'DIEU_CHINH' && <th className="w-28 pb-2 text-right font-medium">Chênh lệch</th>}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const q = parseQty(l.qty);
                const diff = type === 'DIEU_CHINH' ? Number(l.qty.replace(',', '.') || 0) - (l.product.stock ?? 0) : 0;
                return (
                  <tr key={l.product.id} className="border-t border-slate-50" data-testid="doc-line">
                    <td className="py-1.5 pr-2 font-mono text-xs">{l.product.code}</td>
                    <td className="py-1.5 pr-2">
                      <div className="font-medium">{l.product.name}</div>
                      {fmtMfg(l.product.mfgMonth, l.product.mfgYear) && <div className="text-xs text-slate-500">SX {fmtMfg(l.product.mfgMonth, l.product.mfgYear)}</div>}
                    </td>
                    <td className="py-1.5 pr-2 text-slate-600">{l.product.category?.name ?? '—'}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-500">
                      {fmtQty(l.product.stock)} {l.product.unit}
                    </td>
                    <td className="py-1.5 pl-2">
                      <input aria-label={`Số lượng ${l.product.name}`} inputMode="decimal" className={`${cell} ${q === null && !(type === 'DIEU_CHINH' && l.qty.trim() === '0') ? 'border-rose-400' : ''}`} value={l.qty} onChange={(e) => set(l.product.id, { qty: e.target.value })} />
                    </td>
                    {type === 'NHAP' && (
                      <td className="py-1.5 pl-2">
                        <input aria-label={`Giá nhập ${l.product.name}`} inputMode="numeric" className={cell} value={l.cost} onChange={(e) => set(l.product.id, { cost: moneyInput(parseMoney(e.target.value)) })} />
                      </td>
                    )}
                    {type === 'NHAP' && <td className="py-1.5 text-right tabular-nums">{fmtMoney(Math.round((q ?? 0) * parseMoney(l.cost)))}</td>}
                    {type === 'DIEU_CHINH' && <td className={`py-1.5 text-right font-medium tabular-nums ${diff < 0 ? 'text-rose-600' : diff > 0 ? 'text-mint-700' : 'text-slate-400'}`}>{diff > 0 ? '+' : ''}{fmtQty(diff)}</td>}
                    <td className="py-1.5 pl-1">
                      <button type="button" aria-label={`Bỏ ${l.product.name}`} onClick={() => setLines(lines.filter((x) => x.product.id !== l.product.id))} className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!lines.length && (
                <tr>
                  <td colSpan={8} className="rounded-xl bg-slate-50 p-4 text-center text-slate-500">
                    Chưa có hàng. Gõ mã hoặc tên ở ô trên để thêm.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {type === 'NHAP' && lines.length > 0 && (
          <div className="text-right text-base font-semibold">
            Tổng tiền nhập: <span data-testid="doc-total">{fmtMoney(total)}</span>
          </div>
        )}
        {type === 'DIEU_CHINH' && <p className="text-xs text-slate-500">Nhập số đếm thực tế; hệ thống ghi phần chênh lệch so với sổ. Dòng khớp sổ sẽ bỏ qua.</p>}
      </Card>
      <div className="flex justify-end">
        <Button type="submit" disabled={busy || !lines.length || (type === 'CHUYEN' && !toBranchId)} data-testid="save-doc">
          {busy && <Spinner />}
          Lưu {DOC_TYPES[type].title.toLowerCase()}
        </Button>
      </div>
    </form>
  );
}

export default function NewDocPage() {
  return (
    <RequirePermission permission="inventory.view">
      <Suspense>
        <NewDoc />
      </Suspense>
    </RequirePermission>
  );
}
