'use client';

import { Alert, Button, Checkbox, Field, Input, Select, Spinner } from '@cardiy/ui';
import { X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import type { Category } from '@/lib/inventory';
import { moneyInput, parseMoney, type ItemKind } from '@/lib/orders';

export interface ProductFormValue {
  code: string;
  name: string;
  kind: ItemKind;
  categoryId: string;
  brand: string;
  unit: string;
  salePrice: string;
  costPrice: string;
  vehicleMakes: string[];
  minStock: string;
  note: string;
  active: boolean;
}

export const emptyProduct = (categoryId = ''): ProductFormValue => ({ code: '', name: '', kind: 'PHU_TUNG', categoryId, brand: '', unit: '', salePrice: '', costPrice: '', vehicleMakes: [], minStock: '', note: '', active: true });

/** Chọn hãng xe dùng được: bấm chip hãng hay gặp, hoặc gõ thêm. Không chọn = dùng cho mọi xe. */
function MakesField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [makes, setMakes] = useState<string[]>([]);
  const [extra, setExtra] = useState('');
  useEffect(() => {
    api<string[]>('/products/vehicle-makes').then(setMakes, () => setMakes([]));
  }, []);
  const has = (m: string) => value.some((v) => v.toLowerCase() === m.toLowerCase());
  const toggle = (m: string) => onChange(has(m) ? value.filter((v) => v.toLowerCase() !== m.toLowerCase()) : [...value, m]);
  const shown = [...new Set([...value, ...makes.slice(0, 20)])];
  return (
    <div className="space-y-2" data-testid="makes-field">
      <div className="flex flex-wrap gap-1.5">
        {shown.map((m) => (
          <button key={m} type="button" onClick={() => toggle(m)} aria-pressed={has(m)} className={`rounded-full border px-2.5 py-1 text-xs ${has(m) ? 'border-brand-500 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-brand-300'}`}>
            {m}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          aria-label="Thêm hãng xe khác"
          placeholder="Hãng khác…"
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && extra.trim()) {
              e.preventDefault();
              if (!has(extra.trim())) onChange([...value, extra.trim()]);
              setExtra('');
            }
          }}
          className="h-9 max-w-[200px]"
        />
        {value.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-rose-600">
            <X className="h-3 w-3" /> Bỏ chọn hết (dùng cho mọi xe)
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">{value.length ? `Chỉ gợi ý khi đơn có xe ${value.join(', ')}.` : 'Chưa chọn hãng: sản phẩm dùng cho mọi xe.'}</p>
    </div>
  );
}

export function productPayload(v: ProductFormValue) {
  return {
    code: v.code.trim() || null,
    name: v.name.trim(),
    kind: v.kind,
    categoryId: v.categoryId || null,
    brand: v.brand.trim() || null,
    unit: v.unit.trim() || null,
    salePrice: parseMoney(v.salePrice),
    costPrice: parseMoney(v.costPrice),
    vehicleMakes: v.kind === 'DICH_VU' && !v.vehicleMakes.length ? [] : v.vehicleMakes,
    minStock: v.kind === 'PHU_TUNG' && v.minStock.trim() ? Number(v.minStock.replace(',', '.')) : null,
    note: v.note.trim() || null,
    active: v.active,
  };
}

export function ProductForm({ initial, categories, submitLabel, showCost, onSubmit, onCancel }: { initial: ProductFormValue; categories: Category[]; submitLabel: string; showCost: boolean; onSubmit: (v: ProductFormValue) => Promise<void>; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ProductFormValue>(k: K, val: ProductFormValue[K]) => setV((x) => ({ ...x, [k]: val }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(v);
    } catch (err) {
      setError(err instanceof ApiError ? (err.errors?.[0]?.message ?? err.message) : 'Không lưu được');
      setBusy(false);
    }
  };

  return (
    <form id="product-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      {error && <Alert className="sm:col-span-2">{error}</Alert>}
      <Field label="Tên sản phẩm / dịch vụ" className="sm:col-span-2">
        {(id) => <Input id={id} required value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="VD: Lốp Michelin Primacy 4 215/55R17" autoFocus />}
      </Field>
      <Field label="Loại">
        {(id) => (
          <Select id={id} value={v.kind} onChange={(e) => set('kind', e.target.value as ItemKind)}>
            <option value="PHU_TUNG">Hàng hoá (có tồn kho)</option>
            <option value="DICH_VU">Dịch vụ (không tồn kho)</option>
          </Select>
        )}
      </Field>
      <Field label="Mã hàng" hint="Để trống: tự sinh SP… / DV…">
        {(id) => <Input id={id} value={v.code} onChange={(e) => set('code', e.target.value)} placeholder="VD: mã cũ, mã vạch" />}
      </Field>
      <Field label="Nhóm">
        {(id) => (
          <Select id={id} value={v.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">— Chưa xếp nhóm —</option>
            {categories.map((c) => (
              <optgroup key={c.id} label={c.name}>
                <option value={c.id}>{c.name} (chung)</option>
                {c.children.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Thương hiệu">{(id) => <Input id={id} value={v.brand} onChange={(e) => set('brand', e.target.value)} placeholder="VD: Michelin, GS, Castrol" />}</Field>
      <Field label="Đơn vị tính">{(id) => <Input id={id} value={v.unit} onChange={(e) => set('unit', e.target.value)} placeholder={v.kind === 'DICH_VU' ? 'lần' : 'cái, bộ, lít…'} />}</Field>
      <Field label="Giá bán">{(id) => <Input id={id} inputMode="numeric" value={v.salePrice} onChange={(e) => set('salePrice', moneyInput(parseMoney(e.target.value)))} />}</Field>
      {showCost && <Field label="Giá vốn" hint="Tự cập nhật theo lần nhập hàng gần nhất">{(id) => <Input id={id} inputMode="numeric" value={v.costPrice} onChange={(e) => set('costPrice', moneyInput(parseMoney(e.target.value)))} />}</Field>}
      {v.kind === 'PHU_TUNG' && (
        <Field label="Tồn tối thiểu" hint="Cảnh báo khi tồn ở chi nhánh xuống tới mức này">
          {(id) => <Input id={id} inputMode="decimal" value={v.minStock} onChange={(e) => set('minStock', e.target.value)} />}
        </Field>
      )}
      <div className="sm:col-span-2">
        <div className="mb-1.5 text-sm font-medium text-slate-700">Hãng xe dùng được</div>
        <MakesField value={v.vehicleMakes} onChange={(m) => set('vehicleMakes', m)} />
      </div>
      <Field label="Ghi chú" className="sm:col-span-2">{(id) => <Input id={id} value={v.note} onChange={(e) => set('note', e.target.value)} placeholder="VD: đời xe, thông số, vị trí kệ" />}</Field>
      <Checkbox className="sm:col-span-2" checked={v.active} onChange={(e) => set('active', e.target.checked)} label="Đang bán (bỏ chọn để ẩn khỏi gợi ý khi tạo đơn)" />
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Huỷ
        </Button>
        <Button type="submit" disabled={busy} data-testid="save-product">
          {busy && <Spinner />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
