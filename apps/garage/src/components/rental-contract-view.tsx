'use client';

import { Alert, Badge, Button, Card, Field, Input } from '@cardiy/ui';
import { CarFront, CheckCircle2, Fuel, Gauge, KeyRound, MapPin, Phone, ReceiptText } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/orders';
import { fmtVnd, FUEL_LABEL, RENTAL_CONTRACT_UI, TRANSMISSION_LABEL, type RentalContractDetail, type RentalContractStatus } from '@/lib/rentals';

const CONTRACT_STEPS: { keys: RentalContractStatus[]; label: string }[] = [
  { keys: ['DAT_TRUOC'], label: 'Đặt trước' },
  { keys: ['DA_XAC_MINH'], label: 'Xác minh GPLX' },
  { keys: ['DA_KY_COC'], label: 'Ký HĐ & đặt cọc' },
  { keys: ['DANG_THUE', 'QUA_HAN'], label: 'Đang thuê xe' },
  { keys: ['DA_TRA_XE'], label: 'Đã trả xe' },
  { keys: ['DA_QUYET_TOAN'], label: 'Đã quyết toán' },
];

export function RentalContractView({
  data,
  onCancel,
}: {
  data: RentalContractDetail;
  onCancel: (reason: string) => Promise<void>;
}) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const st = RENTAL_CONTRACT_UI[data.status];
  const stepIdx = CONTRACT_STEPS.findIndex((s) => s.keys.includes(data.status));

  async function doCancel() {
    setBusy(true);
    setErr(null);
    try {
      await onCancel(reason);
      setCancelOpen(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Không huỷ được đơn thuê');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="rental-contract-view">
      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-brand-700">
              <KeyRound className="h-4 w-4" /> Hợp đồng đặt thuê xe
            </div>
            <h1 className="mt-1 font-mono text-2xl font-bold" data-testid="rental-contract-code">
              {data.code}
            </h1>
            <p className="text-sm text-slate-500">
              Nhận xe: <b>{fmtDateTime(data.startAt)}</b> → Trả xe: <b>{fmtDateTime(data.endAt)}</b> ({data.rentalDays} ngày)
            </p>
          </div>
          <div data-testid="rental-contract-status">
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>
        </div>

        {stepIdx >= 0 && (
          <ol className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-6">
            {CONTRACT_STEPS.map((s, idx) => {
              const done = idx <= stepIdx;
              return (
                <li
                  key={s.label}
                  className={`flex items-center gap-1.5 rounded-xl px-2.5 py-2 font-medium ${done ? 'bg-brand-50 text-brand-700' : 'bg-slate-50 text-slate-400'}`}
                >
                  <CheckCircle2 className={`h-4 w-4 shrink-0 ${done ? 'text-brand-600' : 'text-slate-300'}`} />
                  <span className="truncate">{s.label}</span>
                </li>
              );
            })}
          </ol>
        )}

        <div className="grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs text-slate-500">Xe thuê</div>
            <div className="font-semibold text-slate-900">
              <CarFront className="mr-1 inline h-4 w-4 text-brand-600" />
              {data.vehicle.title}
            </div>
            <div className="text-xs text-slate-600">
              Biển số: <b className="font-mono">{data.vehicle.plateNo}</b> · {data.vehicle.seats} chỗ · {TRANSMISSION_LABEL[data.vehicle.transmission] ?? data.vehicle.transmission} ·{' '}
              {FUEL_LABEL[data.vehicle.fuel] ?? data.vehicle.fuel}
            </div>
            <div className="text-xs text-slate-500">
              Giới hạn: {data.vehicle.kmLimitPerDay > 0 ? `${data.vehicle.kmLimitPerDay} km/ngày (vượt thu ${fmtVnd(data.vehicle.overKmFee)}/km)` : 'Không giới hạn km'}
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-500">Garage cho thuê</div>
            <div className="font-semibold text-slate-900">
              {data.garage.slug ? (
                <Link href={`/cho/garage/${data.garage.slug}`} className="hover:text-brand-700 hover:underline">
                  {data.garage.name}
                </Link>
              ) : (
                data.garage.name
              )}
            </div>
            {data.vehicle.pickupAddress && (
              <div className="flex items-start gap-1 text-xs text-slate-600">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {data.vehicle.pickupAddress}
              </div>
            )}
            {data.garage.phone && (
              <a href={`tel:${data.garage.phone}`} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">
                <Phone className="h-3.5 w-3.5" /> Gọi garage {data.garage.phone}
              </a>
            )}
          </div>
        </div>
      </Card>

      {err && <Alert>{err}</Alert>}

      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2 font-semibold text-slate-800">
          <ReceiptText className="h-4 w-4 text-brand-600" /> Chi phí thuê & đặt cọc (thanh toán trực tiếp với garage)
        </div>
        <div className="grid gap-3 sm:grid-cols-4 text-sm">
          <div className="rounded-2xl bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Tiền thuê ({data.rentalDays} ngày)</div>
            <div className="mt-0.5 font-semibold tabular-nums">{fmtVnd(data.baseTotal)}</div>
          </div>
          <div className="rounded-2xl bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Tiền cọc yêu cầu / đã đặt</div>
            <div className="mt-0.5 font-semibold tabular-nums">
              {fmtVnd(data.depositPaid)} / {fmtVnd(data.depositRequired)}
            </div>
          </div>
          <div className="rounded-2xl bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Phụ phí phát sinh</div>
            <div className="mt-0.5 font-semibold tabular-nums">{fmtVnd(data.extraFee)}</div>
          </div>
          <div className="rounded-2xl bg-emerald-50/80 p-3">
            <div className="text-xs text-emerald-700">Quyết toán cuối</div>
            <div className="mt-0.5 font-bold tabular-nums text-emerald-800" data-testid="rental-final-total">
              {data.finalTotal !== null ? fmtVnd(data.finalTotal) : `Tạm tính ${fmtVnd(data.previewSettlement.finalTotal)}`}
            </div>
            {data.depositRefund !== null && data.depositRefund > 0 && (
              <div className="text-xs text-emerald-700" data-testid="rental-deposit-refund">
                Hoàn cọc: {fmtVnd(data.depositRefund)}
              </div>
            )}
          </div>
        </div>
        {data.sellerNote && <p className="rounded-xl bg-sky-50 px-3.5 py-2 text-sm text-sky-900"><b>Ghi chú từ garage:</b> {data.sellerNote}</p>}
      </Card>

      {(data.handover.at || data.returned.at) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.handover.at && (
            <Card className="p-4 space-y-2" data-testid="rental-handover-card">
              <div className="font-semibold text-slate-800">Biên bản bàn giao xe</div>
              <div className="flex flex-wrap gap-3 text-sm text-slate-700">
                <span className="inline-flex items-center gap-1">
                  <Gauge className="h-4 w-4 text-slate-400" /> {data.handover.km?.toLocaleString('vi-VN')} km
                </span>
                <span className="inline-flex items-center gap-1">
                  <Fuel className="h-4 w-4 text-slate-400" /> Nhiên liệu {data.handover.fuel}%
                </span>
              </div>
              {data.handover.note && <p className="text-xs text-slate-600">{data.handover.note}</p>}
              {data.handover.images.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {data.handover.images.map(
                    (img) =>
                      img.url && (
                        <a key={img.id} href={img.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-slate-200">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.url} alt="Ảnh giao xe" className="h-16 w-24 object-cover" />
                        </a>
                      ),
                  )}
                </div>
              )}
            </Card>
          )}

          {data.returned.at && (
            <Card className="p-4 space-y-2" data-testid="rental-return-card">
              <div className="font-semibold text-slate-800">Biên bản trả xe</div>
              <div className="flex flex-wrap gap-3 text-sm text-slate-700">
                <span className="inline-flex items-center gap-1">
                  <Gauge className="h-4 w-4 text-slate-400" /> {data.returned.km?.toLocaleString('vi-VN')} km
                </span>
                <span className="inline-flex items-center gap-1">
                  <Fuel className="h-4 w-4 text-slate-400" /> Nhiên liệu {data.returned.fuel}%
                </span>
              </div>
              {data.overKmSummary && (
                <div className="text-xs text-slate-600">
                  Đã đi {data.overKmSummary.drivenKm} km
                  {data.overKmSummary.overKm > 0 ? ` · vượt ${data.overKmSummary.overKm} km` : ' · trong định mức km'}
                </div>
              )}
              {data.returned.note && <p className="text-xs text-slate-600">{data.returned.note}</p>}
            </Card>
          )}
        </div>
      )}

      {data.status === 'HUY' && (
        <Card className="p-4 text-sm text-slate-600">
          Đơn đặt thuê đã huỷ{data.cancelReason ? `: "${data.cancelReason}"` : ''}.
        </Card>
      )}

      {data.cancellableByCustomer && (
        <Card className="p-4">
          {!cancelOpen ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-slate-600">Bạn có thể huỷ yêu cầu đặt trước khi garage chưa xác minh giấy tờ & ký cọc.</span>
              <Button variant="outline" onClick={() => setCancelOpen(true)} data-testid="rental-cancel-open">
                Huỷ đặt thuê
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Field label="Lý do huỷ">
                {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: Thay đổi lịch trình công tác…" />}
              </Field>
              <div className="flex gap-2">
                <Button className="bg-rose-600 hover:bg-rose-700" onClick={doCancel} disabled={busy} data-testid="rental-cancel-confirm">
                  Xác nhận huỷ
                </Button>
                <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={busy}>
                  Đóng
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
