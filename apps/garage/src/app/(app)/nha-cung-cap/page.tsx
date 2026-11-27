'use client';

import { Alert, Button, Card, Dialog, Field, Input, Spinner } from '@cardiy/ui';
import { Pencil, Plus, Search } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ExportButton } from '@/components/export-button';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { fmtMoney } from '@/lib/crm';
import { moneyInput, parseMoney } from '@/lib/orders';

interface Supplier {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  address: string | null;
  taxCode: string | null;
  note: string | null;
  purchased: number;
  receipts: number;
  openingPayable: number;
  paid: number;
  balance: number;
}
const empty = { name: '', phone: '', address: '', taxCode: '', note: '', openingPayable: '' };

function Suppliers() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Supplier[] | null>(null);
  const [edit, setEdit] = useState<{ id: string | null; v: typeof empty } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api<Supplier[]>(`/suppliers${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`).then(setRows), [q]);
  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    setError(null);
    try {
      await api(edit.id ? `/suppliers/${edit.id}` : '/suppliers', { method: edit.id ? 'PATCH' : 'POST', body: { ...edit.v, openingPayable: parseMoney(edit.v.openingPayable) } });
      setEdit(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.errors?.[0]?.message ?? err.message) : 'Không lưu được');
    }
  };
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => edit && setEdit({ ...edit, v: { ...edit.v, [k]: e.target.value } });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full md:w-72">
          <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tên, SĐT, mã số thuế…" className="rounded-full bg-white/80 pl-10" aria-label="Tìm nhà cung cấp" />
        </div>
        <div className="flex-1" />
        <ExportButton<Supplier>
          filename="nha-cung-cap"
          sheetName="Nhà cung cấp"
          testId="export-suppliers"
          rows={rows ?? []}
          columns={[
            { header: 'Mã NCC', value: (s) => s.code },
            { header: 'Tên nhà cung cấp', value: (s) => s.name },
            { header: 'Số điện thoại', value: (s) => s.phone ?? '' },
            { header: 'Mã số thuế', value: (s) => s.taxCode ?? '' },
            { header: 'Địa chỉ', value: (s) => s.address ?? '' },
            { header: 'Số phiếu nhập', value: (s) => s.receipts },
            { header: 'Đã nhập', value: (s) => s.purchased },
            { header: 'Nợ đầu kỳ', value: (s) => s.openingPayable },
            { header: 'Đã trả', value: (s) => s.paid },
            { header: 'Còn nợ', value: (s) => s.balance },
            { header: 'Ghi chú', value: (s) => s.note ?? '' },
          ]}
        />
        <Button onClick={() => (setEdit({ id: null, v: empty }), setError(null))} data-testid="add-supplier">
          <Plus className="h-4 w-4" />
          Thêm nhà cung cấp
        </Button>
      </div>
      <Card className="overflow-x-auto">
        {!rows ? (
          <div className="grid place-items-center p-10">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="supplier-table">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-semibold">Nhà cung cấp</th>
                <th className="px-3 py-3 font-semibold">Liên hệ</th>
                <th className="px-3 py-3 text-right font-semibold">Đã nhập</th>
                <th className="px-3 py-3 text-right font-semibold">Còn nợ</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b border-slate-50 last:border-0" data-testid="supplier-row">
                  <td className="px-5 py-3">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-slate-500">
                      {s.code}
                      {s.taxCode && ` · MST ${s.taxCode}`}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-600">
                    {s.phone ?? '—'}
                    {s.address && <div className="text-xs text-slate-500">{s.address}</div>}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="tabular-nums">{fmtMoney(s.purchased)}</div>
                    <div className="text-xs text-slate-500">{s.receipts} phiếu nhập</div>
                  </td>
                  <td className={`px-3 py-3 text-right font-semibold tabular-nums ${s.balance > 0 ? 'text-rose-600' : 'text-slate-400'}`} data-testid="supplier-balance">
                    {s.balance ? fmtMoney(s.balance) : '—'}
                  </td>
                  <td className="px-3 py-3">
                    <button type="button" aria-label={`Sửa ${s.name}`} onClick={() => (setEdit({ id: s.id, v: { name: s.name, phone: s.phone ?? '', address: s.address ?? '', taxCode: s.taxCode ?? '', note: s.note ?? '', openingPayable: moneyInput(s.openingPayable) } }), setError(null))} className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">
                      <Pencil className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-slate-500">
                    {q ? 'Không tìm thấy.' : 'Chưa có nhà cung cấp.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>
      <Dialog
        open={edit !== null}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'}
        footer={
          <>
            <Button variant="outline" onClick={() => setEdit(null)}>
              Huỷ
            </Button>
            <Button type="submit" form="supplier-form" data-testid="save-supplier">
              Lưu
            </Button>
          </>
        }
      >
        {edit && (
          <form id="supplier-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            {error && <Alert className="sm:col-span-2">{error}</Alert>}
            <Field label="Tên nhà cung cấp" className="sm:col-span-2">{(id) => <Input id={id} required value={edit.v.name} onChange={set('name')} autoFocus />}</Field>
            <Field label="Số điện thoại">{(id) => <Input id={id} value={edit.v.phone} onChange={set('phone')} />}</Field>
            <Field label="Mã số thuế">{(id) => <Input id={id} value={edit.v.taxCode} onChange={set('taxCode')} />}</Field>
            <Field label="Địa chỉ" className="sm:col-span-2">{(id) => <Input id={id} value={edit.v.address} onChange={set('address')} />}</Field>
            <Field label="Nợ đầu kỳ (còn nợ NCC lúc bắt đầu dùng hệ thống)" className="sm:col-span-2">
              {(id) => <Input id={id} inputMode="numeric" value={edit.v.openingPayable} onChange={(e) => setEdit({ ...edit, v: { ...edit.v, openingPayable: moneyInput(parseMoney(e.target.value)) } })} placeholder="0" />}
            </Field>
            <Field label="Ghi chú" className="sm:col-span-2">{(id) => <Input id={id} value={edit.v.note} onChange={set('note')} />}</Field>
          </form>
        )}
      </Dialog>
    </div>
  );
}

export default function SuppliersPage() {
  return (
    <RequirePermission permission="purchase.manage">
      <Suppliers />
    </RequirePermission>
  );
}
