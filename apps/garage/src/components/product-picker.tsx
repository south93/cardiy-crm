'use client';

import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/crm';
import { fmtQty, type ProductRow } from '@/lib/inventory';
import type { ItemKind } from '@/lib/orders';

/**
 * Tìm sản phẩm trong danh mục (mã, tên không dấu, thương hiệu). `make`: ưu tiên hàng dùng cho hãng xe này.
 * `branchId`: hiện tồn tại chi nhánh.
 */
export function ProductPicker({
  onPick,
  make,
  kind,
  branchId,
  placeholder = 'Tìm sản phẩm theo mã, tên…',
  autoFocus,
  label = 'Tìm sản phẩm',
}: {
  onPick: (p: ProductRow) => void;
  make?: string | null;
  kind?: ItemKind;
  branchId?: string;
  placeholder?: string;
  autoFocus?: boolean;
  label?: string;
}) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ProductRow[] | null>(null);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 1) return setRows(null);
    const p = new URLSearchParams({ q: q.trim(), pageSize: '12', active: 'true' });
    if (make) p.set('make', make);
    if (kind) p.set('kind', kind);
    if (branchId) p.set('branchId', branchId);
    const t = setTimeout(() => api<{ items: ProductRow[] }>(`/products?${p}`).then((r) => (setRows(r.items), setActive(0)), () => setRows([])), 200);
    return () => clearTimeout(t);
  }, [q, make, kind, branchId]);

  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setRows(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (p: ProductRow) => {
    onPick(p);
    setQ('');
    setRows(null);
  };

  return (
    <div className="relative" ref={box}>
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
      <input
        aria-label={label}
        autoFocus={autoFocus}
        value={q}
        placeholder={placeholder}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (!rows?.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, rows.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(rows[active]!);
          }
        }}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
      />
      {rows && (
        <div className="absolute z-30 mt-1 max-h-80 w-full min-w-[420px] overflow-y-auto rounded-xl border border-slate-100 bg-white p-1 shadow-card" data-testid="product-results">
          {rows.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(p)}
              className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm ${i === active ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
            >
              <span className="w-24 shrink-0 font-mono text-xs text-slate-500">{p.code}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.name}</span>
                <span className="block truncate text-xs text-slate-500">
                  {[p.brand, p.vehicleMakes.length ? p.vehicleMakes.join(', ') : null].filter(Boolean).join(' · ') || (p.kind === 'DICH_VU' ? 'Dịch vụ' : 'Dùng cho mọi xe')}
                </span>
              </span>
              <span className="text-right">
                <span className="block tabular-nums">{fmtMoney(p.salePrice)}</span>
                {p.stock !== null && <span className={`block text-xs ${p.stock <= 0 ? 'text-rose-600' : 'text-slate-500'}`}>Tồn {fmtQty(p.stock)}</span>}
              </span>
            </button>
          ))}
          {!rows.length && <div className="px-3 py-2 text-sm text-slate-500">Không có sản phẩm khớp. Gõ tên để nhập tay.</div>}
        </div>
      )}
    </div>
  );
}
