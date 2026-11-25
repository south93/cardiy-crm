'use client';

import { Alert, Button, Field, Input, Spinner } from '@cardiy/ui';
import { Minus, Plus, TicketPercent } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { money } from '@/lib/market';
import { marketPost, nextDays, slotsFor, type Quote } from '@/lib/market-client';

const fieldErr = (e: unknown) => (e instanceof ApiError ? Object.fromEntries((e.errors ?? []).map((x) => [x.field, x.message])) : {});

function RequestForm() {
  const router = useRouter();
  const offerId = useSearchParams().get('tin') ?? '';
  const [qty, setQty] = useState(1);
  const [voucher, setVoucher] = useState('');
  const [applied, setApplied] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const days = useMemo(() => nextDays(14), []);
  const [day, setDay] = useState(1);
  const [time, setTime] = useState('');
  const [f, setF] = useState({ name: '', phone: '', plateNo: '', note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (q: number, code: string | null) => {
      try {
        setQuote(await marketPost<Quote>('/requests/quote', { items: [{ offerId, quantity: q }], voucherCode: code }));
        setLoadError(null);
      } catch (e) {
        setLoadError(e instanceof ApiError ? e.message : 'Không tải được');
      }
    },
    [offerId],
  );
  useEffect(() => void load(qty, applied), [load, qty, applied]);

  const d = days[day]!;
  const slots = quote ? slotsFor(d.ymd, d.dow, quote.openingHours) : [];
  useEffect(() => setTime((t) => (slots.includes(t) ? t : '')), [slots.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!offerId) return <Alert>Thiếu sản phẩm / dịch vụ cần đặt.</Alert>;
  if (!quote)
    return loadError ? (
      <Alert>{loadError}</Alert>
    ) : (
      <div className="grid place-items-center p-16">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  const line = quote.lines[0]!;
  const isProduct = line.kind === 'PRODUCT';

  const submit = async () => {
    setError(null);
    setErrors({});
    if (!time) return setError('Chọn giờ hẹn');
    setBusy(true);
    try {
      const r = await marketPost<{ id: string; token: string }>('/requests', {
        items: [{ offerId, quantity: qty }],
        voucherCode: applied,
        scheduledAt: new Date(`${d.ymd}T${time}:00+07:00`).toISOString(),
        ...f,
      });
      router.push(`/cho/yeu-cau/${r.id}?t=${encodeURIComponent(r.token)}&moi=1`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không gửi được, vui lòng thử lại');
      setErrors(fieldErr(e));
      setBusy(false);
    }
  };

  const chip = (on: boolean) => `rounded-full border px-3 py-1.5 text-sm ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-brand-200'}`;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">{isProduct ? 'Đặt hàng & hẹn lắp' : 'Đặt lịch dịch vụ'}</h1>
      <div className="rounded-2xl border border-slate-200/70 bg-white p-4">
        <div className="text-sm text-slate-500">
          tại{' '}
          <Link href={`/cho/garage/${quote.shop.slug}`} className="font-medium text-brand-700">
            {quote.shop.name}
          </Link>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <div className="w-full min-w-0 sm:w-auto sm:flex-1">
            <div className="font-semibold" data-testid="request-item">
              {line.name}
            </div>
            <div className="text-xs text-slate-500">{[line.installIncluded && 'gồm lắp đặt', line.mfgYear && `sản xuất ${line.mfgYear}`].filter(Boolean).join(' · ')}</div>
          </div>
          {isProduct && (
            <div className="flex items-center gap-1" aria-label="Số lượng">
              <button type="button" aria-label="Bớt" onClick={() => setQty((x) => Math.max(1, x - 1))} className="grid h-9 w-9 place-items-center rounded-full border border-slate-200">
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-8 text-center font-semibold" data-testid="qty">
                {qty}
              </span>
              <button type="button" aria-label="Thêm" onClick={() => setQty((x) => Math.min(20, x + 1))} className="grid h-9 w-9 place-items-center rounded-full border border-slate-200">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="ml-auto text-right font-bold text-brand-700">{money(line.amount)}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200/70 bg-white p-4">
        <div className="mb-2 font-semibold">Ngày giờ hẹn {isProduct ? 'lắp / nhận hàng' : ''}</div>
        <div className="flex gap-2 overflow-x-auto pb-1" data-testid="day-chips">
          {days.map((x, i) => (
            <button key={x.ymd} type="button" onClick={() => setDay(i)} className={`${chip(day === i)} shrink-0`}>
              {x.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2" data-testid="time-slots">
          {slots.map((t) => (
            <button key={t} type="button" onClick={() => setTime(t)} className={chip(time === t)}>
              {t}
            </button>
          ))}
          {!slots.length && <p className="text-sm text-slate-500">Garage không nhận hẹn ngày này, chọn ngày khác.</p>}
        </div>
      </div>

      <div className="grid gap-4 rounded-2xl border border-slate-200/70 bg-white p-4 sm:grid-cols-2">
        <Field label="Họ tên" error={errors.name}>
          {(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" />}
        </Field>
        <Field label="Số điện thoại" error={errors.phone} hint="Garage gọi số này để xác nhận">
          {(id) => <Input id={id} inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" />}
        </Field>
        <Field label="Biển số xe (không bắt buộc)">{(id) => <Input id={id} value={f.plateNo} onChange={(e) => setF({ ...f, plateNo: e.target.value })} placeholder="51K12345" />}</Field>
        <Field label="Ghi chú cho garage">{(id) => <Input id={id} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Dòng xe, yêu cầu thêm…" />}</Field>
      </div>

      <div className="rounded-2xl border border-slate-200/70 bg-white p-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <TicketPercent className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
            <Input value={voucher} onChange={(e) => setVoucher(e.target.value)} placeholder="Mã voucher của garage" aria-label="Mã voucher" className="pl-10" />
          </div>
          <Button variant="outline" onClick={() => setApplied(voucher.trim() || null)} data-testid="apply-voucher">
            Áp dụng
          </Button>
        </div>
        {quote.voucherError && <p className="mt-1 text-xs text-rose-600">{quote.voucherError}</p>}
        {quote.voucher && <p className="mt-1 text-xs text-emerald-700">Đã áp dụng {quote.voucher.title}</p>}
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Tạm tính</dt>
            <dd>{money(quote.subtotal)}</dd>
          </div>
          {quote.discount > 0 && (
            <div className="flex justify-between text-emerald-700">
              <dt>Voucher</dt>
              <dd>−{money(quote.discount)}</dd>
            </div>
          )}
          <div className="flex justify-between text-base font-bold">
            <dt>Tổng tạm tính</dt>
            <dd data-testid="request-total">{money(quote.total)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-slate-500">Giá cuối do garage chốt khi xác nhận. Bạn thanh toán trực tiếp cho garage khi đến lắp / nhận hàng; sàn không thu tiền.</p>
      </div>

      {error && <Alert>{error}</Alert>}
      <Button className="w-full justify-center py-3 text-base" disabled={busy} onClick={() => void submit()} data-testid="send-request">
        {busy && <Spinner />}
        Gửi yêu cầu tới garage
      </Button>
    </div>
  );
}

/** Khách gửi yêu cầu đặt hàng / đặt lịch tới garage (không cần tài khoản) */
export default function RequestPage() {
  return (
    <Suspense>
      <RequestForm />
    </Suspense>
  );
}
