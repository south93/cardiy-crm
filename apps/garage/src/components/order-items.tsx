'use client';

import { Button } from '@cardiy/ui';
import { Package, Trash2, Wrench } from 'lucide-react';
import { fmtMoney } from '@/lib/crm';
import { draftAmount, KINDS, moneyInput, newItem, parseMoney, parseQty, type ItemDraft } from '@/lib/orders';

const cell = 'h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100';

/** Bảng hạng mục có thể sửa: dịch vụ (công) và phụ tùng. Tổng tiền tính ngay khi gõ. */
export function OrderItemsEditor({
  rows,
  onChange,
  orderDiscount,
  onDiscountChange,
}: {
  rows: ItemDraft[];
  onChange: (rows: ItemDraft[]) => void;
  orderDiscount: string;
  onDiscountChange: (v: string) => void;
}) {
  const set = (key: string, patch: Partial<ItemDraft>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const subtotal = rows.reduce((s, r) => s + draftAmount(r), 0);
  const discount = parseMoney(orderDiscount);

  return (
    <div className="space-y-3" data-testid="items-editor">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="w-28 pb-2 font-medium">Loại</th>
              <th className="pb-2 font-medium">Hạng mục</th>
              <th className="w-20 pb-2 font-medium">ĐVT</th>
              <th className="w-20 pb-2 font-medium">SL</th>
              <th className="w-32 pb-2 font-medium">Đơn giá</th>
              <th className="w-28 pb-2 font-medium">Giảm</th>
              <th className="w-32 pb-2 text-right font-medium">Thành tiền</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const badQty = r.quantity !== '' && parseQty(r.quantity) === null;
              return (
                <tr key={r.key} className="align-top" data-testid="item-row">
                  <td className="py-1 pr-2">
                    <select aria-label={`Loại dòng ${i + 1}`} className={cell} value={r.kind} onChange={(e) => set(r.key, { kind: e.target.value as ItemDraft['kind'] })}>
                      {KINDS.map((k) => (
                        <option key={k.value} value={k.value}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <input aria-label={`Tên hạng mục dòng ${i + 1}`} className={cell} value={r.name} placeholder={r.kind === 'DICH_VU' ? 'VD: Thay dầu máy' : 'VD: Lốp Michelin 215/55R17'} onChange={(e) => set(r.key, { name: e.target.value })} />
                  </td>
                  <td className="py-1 pr-2">
                    <input aria-label={`ĐVT dòng ${i + 1}`} className={cell} value={r.unit} placeholder={r.kind === 'DICH_VU' ? 'lần' : 'cái'} onChange={(e) => set(r.key, { unit: e.target.value })} />
                  </td>
                  <td className="py-1 pr-2">
                    <input aria-label={`Số lượng dòng ${i + 1}`} inputMode="decimal" className={`${cell} ${badQty ? 'border-rose-400' : ''}`} value={r.quantity} onChange={(e) => set(r.key, { quantity: e.target.value })} />
                  </td>
                  <td className="py-1 pr-2">
                    <input aria-label={`Đơn giá dòng ${i + 1}`} inputMode="numeric" className={`${cell} text-right`} value={r.unitPrice} onChange={(e) => set(r.key, { unitPrice: moneyInput(parseMoney(e.target.value)) })} />
                  </td>
                  <td className="py-1 pr-2">
                    <input aria-label={`Giảm giá dòng ${i + 1}`} inputMode="numeric" className={`${cell} text-right`} value={r.discount} onChange={(e) => set(r.key, { discount: moneyInput(parseMoney(e.target.value)) })} />
                  </td>
                  <td className="py-1 pr-2 pt-3 text-right font-medium tabular-nums">{fmtMoney(draftAmount(r))}</td>
                  <td className="py-1">
                    <button type="button" aria-label={`Xoá dòng ${i + 1}`} onClick={() => onChange(rows.filter((x) => x.key !== r.key))} className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="rounded-xl bg-slate-50 p-4 text-center text-slate-500">
                  Chưa có hạng mục. Thêm dịch vụ hoặc phụ tùng.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => onChange([...rows, newItem('DICH_VU')])}>
            <Wrench className="h-4 w-4" />
            Thêm dịch vụ
          </Button>
          <Button type="button" variant="outline" onClick={() => onChange([...rows, newItem('PHU_TUNG')])}>
            <Package className="h-4 w-4" />
            Thêm phụ tùng
          </Button>
        </div>
        <dl className="w-full max-w-xs space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Tổng tiền</dt>
            <dd className="tabular-nums">{fmtMoney(subtotal)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-slate-500">Chiết khấu</dt>
            <dd>
              <input aria-label="Chiết khấu" inputMode="numeric" className={`${cell} w-32 text-right ${discount > subtotal ? 'border-rose-400' : ''}`} value={orderDiscount} onChange={(e) => onDiscountChange(moneyInput(parseMoney(e.target.value)))} />
            </dd>
          </div>
          <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-semibold">
            <dt>Tổng sau CK</dt>
            <dd className="tabular-nums" data-testid="draft-total">
              {fmtMoney(Math.max(0, subtotal - discount))}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
