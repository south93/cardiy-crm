'use client';

import { Alert, Badge, Button, Card, Checkbox, Dialog, Field, Input, Select, Spinner } from '@cardiy/ui';
import { Pencil, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { moneyInput, parseMoney } from '@/lib/orders';

interface Voucher {
  id: string;
  code: string;
  title: string;
  kind: 'PERCENT' | 'AMOUNT';
  value: number;
  minOrder: number;
  maxDiscount: number | null;
  appliesTo: string;
  startsAt: string;
  endsAt: string;
  usageLimit: number | null;
  active: boolean;
  used: number;
  summary: string;
}
const ymd = (d: Date) => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
const empty = () => ({
  id: null as string | null,
  code: '',
  title: '',
  kind: 'PERCENT' as 'PERCENT' | 'AMOUNT',
  value: '',
  minOrder: '',
  maxDiscount: '',
  appliesTo: 'ALL',
  startsAt: ymd(new Date()),
  endsAt: ymd(new Date(Date.now() + 30 * 86_400_000)),
  usageLimit: '',
  active: true,
});

/** Voucher của garage hiện trên sàn; khách nhập mã khi gửi yêu cầu. Garage tự chịu phần giảm */
export function VoucherManager() {
  const [rows, setRows] = useState<Voucher[] | null>(null);
  const [f, setF] = useState<ReturnType<typeof empty> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<Voucher[]>('/seller/vouchers').then(setRows), []);
  useEffect(() => void load(), [load]);
  const save = async () => {
    if (!f) return;
    setError(null);
    try {
      await api(f.id ? `/seller/vouchers/${f.id}` : '/seller/vouchers', {
        method: f.id ? 'PUT' : 'POST',
        body: {
          code: f.code,
          title: f.title,
          kind: f.kind,
          value: f.kind === 'AMOUNT' ? parseMoney(f.value) : Number(f.value),
          minOrder: parseMoney(f.minOrder),
          maxDiscount: f.kind === 'PERCENT' && f.maxDiscount ? parseMoney(f.maxDiscount) : null,
          appliesTo: f.appliesTo,
          startsAt: `${f.startsAt}T00:00:00+07:00`,
          endsAt: `${f.endsAt}T23:59:59+07:00`,
          usageLimit: f.usageLimit ? Number(f.usageLimit) : null,
          active: f.active,
        },
      });
      setF(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : 'Không lưu được');
    }
  };
  const now = Date.now();
  return (
    <div className="space-y-4">
      <div className="flex items-center">
        <p className="flex-1 text-sm text-slate-500">Voucher hiện trên gian hàng và trang so giá. Khách nhập mã khi gửi yêu cầu; bạn tự chịu phần giảm và có thể chốt lại giá khi xác nhận.</p>
        <Button onClick={() => (setF(empty()), setError(null))} data-testid="add-voucher">
          <Plus className="h-4 w-4" /> Tạo voucher
        </Button>
      </div>
      {!rows ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="voucher-list">
          {rows.map((v) => {
            const live = v.active && new Date(v.startsAt).getTime() <= now && new Date(v.endsAt).getTime() >= now && (v.usageLimit === null || v.used < v.usageLimit);
            return (
              <Card key={v.id} className={`p-4 text-sm ${live ? '' : 'opacity-60'}`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <div className="font-mono text-base font-bold text-peach-700">{v.code}</div>
                    <div className="font-medium">{v.title}</div>
                  </div>
                  <Badge tone={live ? 'mint' : 'slate'}>{live ? 'Đang chạy' : v.active ? 'Hết hạn / hết lượt' : 'Tắt'}</Badge>
                  <button
                    type="button"
                    aria-label={`Sửa ${v.code}`}
                    onClick={() =>
                      setF({
                        id: v.id,
                        code: v.code,
                        title: v.title,
                        kind: v.kind,
                        value: v.kind === 'AMOUNT' ? moneyInput(v.value) : String(v.value),
                        minOrder: v.minOrder ? moneyInput(v.minOrder) : '',
                        maxDiscount: v.maxDiscount ? moneyInput(v.maxDiscount) : '',
                        appliesTo: v.appliesTo,
                        startsAt: ymd(new Date(v.startsAt)),
                        endsAt: ymd(new Date(v.endsAt)),
                        usageLimit: v.usageLimit ? String(v.usageLimit) : '',
                        active: v.active,
                      })
                    }
                    className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-1 text-slate-600">{v.summary}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {new Date(v.startsAt).toLocaleDateString('vi-VN')} – {new Date(v.endsAt).toLocaleDateString('vi-VN')} · đã dùng {v.used}
                  {v.usageLimit ? `/${v.usageLimit}` : ''}
                </p>
              </Card>
            );
          })}
          {!rows.length && <Card className="p-8 text-center text-sm text-slate-500 md:col-span-2">Chưa có voucher.</Card>}
        </div>
      )}
      <Dialog
        open={f !== null}
        onClose={() => setF(null)}
        title={f?.id ? 'Sửa voucher' : 'Tạo voucher'}
        footer={
          <>
            <Button variant="outline" onClick={() => setF(null)}>
              Huỷ
            </Button>
            <Button onClick={() => void save()} data-testid="save-voucher">
              Lưu
            </Button>
          </>
        }
      >
        {f && (
          <div className="grid gap-4 sm:grid-cols-2">
            {error && <Alert className="sm:col-span-2">{error}</Alert>}
            <Field label="Mã voucher" hint="Khách nhập mã này">
              {(id) => <Input id={id} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="GIAM10" />}
            </Field>
            <Field label="Tên chương trình">{(id) => <Input id={id} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Giảm 10% thay lốp" />}</Field>
            <Field label="Kiểu giảm">
              {(id) => (
                <Select id={id} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'PERCENT' | 'AMOUNT', value: '' })}>
                  <option value="PERCENT">Theo %</option>
                  <option value="AMOUNT">Số tiền</option>
                </Select>
              )}
            </Field>
            <Field label={f.kind === 'PERCENT' ? 'Giảm (%)' : 'Giảm (đồng)'}>
              {(id) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  value={f.value}
                  onChange={(e) => setF({ ...f, value: f.kind === 'AMOUNT' ? moneyInput(parseMoney(e.target.value)) : e.target.value.replace(/\D/g, '').slice(0, 3) })}
                />
              )}
            </Field>
            {f.kind === 'PERCENT' && (
              <Field label="Giảm tối đa (đồng)">
                {(id) => <Input id={id} inputMode="numeric" value={f.maxDiscount} onChange={(e) => setF({ ...f, maxDiscount: e.target.value ? moneyInput(parseMoney(e.target.value)) : '' })} />}
              </Field>
            )}
            <Field label="Đơn tối thiểu (đồng)">
              {(id) => <Input id={id} inputMode="numeric" value={f.minOrder} onChange={(e) => setF({ ...f, minOrder: e.target.value ? moneyInput(parseMoney(e.target.value)) : '' })} />}
            </Field>
            <Field label="Áp dụng cho">
              {(id) => (
                <Select id={id} value={f.appliesTo} onChange={(e) => setF({ ...f, appliesTo: e.target.value })}>
                  <option value="ALL">Mọi sản phẩm & dịch vụ</option>
                  <option value="PRODUCT">Chỉ sản phẩm</option>
                  <option value="SERVICE">Chỉ dịch vụ</option>
                </Select>
              )}
            </Field>
            <Field label="Số lượt dùng tối đa" hint="Để trống = không giới hạn">
              {(id) => <Input id={id} inputMode="numeric" value={f.usageLimit} onChange={(e) => setF({ ...f, usageLimit: e.target.value.replace(/\D/g, '') })} />}
            </Field>
            <Field label="Từ ngày">{(id) => <Input id={id} type="date" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} />}</Field>
            <Field label="Đến ngày">{(id) => <Input id={id} type="date" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />}</Field>
            <div className="sm:col-span-2">
              <Checkbox label="Đang bật" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
