'use client';

import { Alert, Badge, Button, Card, Field, Input } from '@cardiy/ui';
import { CheckCircle2, Clock, ExternalLink, LifeBuoy, MapPin, Navigation, Phone, Star, Truck, Wrench, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/orders';
import { fmtMoney, mapsDirectionUrl, SOS_STATUS_UI, type SosDetail, type SosStatus } from '@/lib/sos';

const STEPS: { key: SosStatus[]; label: string }[] = [
  { key: ['DA_NHAN'], label: 'Đã nhận ca' },
  { key: ['DANG_DEN'], label: 'Đang đến' },
  { key: ['TAI_HIEN_TRUONG'], label: 'Tại hiện trường' },
  { key: ['XU_LY_TAI_CHO', 'DANG_KEO_XE', 'DA_VE_GARAGE'], label: 'Đang xử lý / kéo xe' },
  { key: ['HOAN_THANH'], label: 'Hoàn thành' },
];

function stepIndexOf(status: SosStatus): number {
  return STEPS.findIndex((s) => s.key.includes(status));
}

export function SosTrackerView({
  data,
  ownerMode = false,
  onCancel,
  onReview,
}: {
  data: SosDetail;
  ownerMode?: boolean;
  onCancel: (reason: string) => Promise<void>;
  onReview: (rating: number, comment: string) => Promise<void>;
}) {
  const [countdown, setCountdown] = useState(data.remainingSec);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setCountdown(data.remainingSec);
    if (data.status !== 'DANG_TIM_GARAGE') return;
    const t = setInterval(() => {
      setCountdown((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [data.remainingSec, data.status]);

  const stepIdx = stepIndexOf(data.status);
  const st = SOS_STATUS_UI[data.status];

  async function submitCancel() {
    setBusy(true);
    setErr(null);
    try {
      await onCancel(cancelReason);
      setCancelOpen(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Không huỷ được yêu cầu');
    } finally {
      setBusy(false);
    }
  }

  async function submitReview(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await onReview(rating, comment);
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'Không gửi được đánh giá');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="sos-tracker">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-rose-600">
              <LifeBuoy className="h-4 w-4" /> Yêu cầu cứu hộ khẩn cấp
            </div>
            <h1 className="mt-1 font-mono text-2xl font-bold" data-testid="sos-code">
              {data.code}
            </h1>
            <p className="text-sm text-slate-500">
              Gửi lúc {fmtDateTime(data.createdAt)} · {data.issueLabel}
            </p>
          </div>
          <div data-testid="sos-status">
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>
        </div>

        <div className="mt-4 grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs text-slate-500">Khách hàng & xe</div>
            <div className="font-medium text-slate-800">
              {data.customerName} · {data.phone}
            </div>
            {(data.plateNo || data.vehicleInfo) && (
              <div className="text-slate-600">{[data.plateNo, data.vehicleInfo].filter(Boolean).join(' · ')}</div>
            )}
          </div>
          <div>
            <div className="text-xs text-slate-500">Vị trí sự cố</div>
            <div className="font-medium text-slate-800">{data.addressText || `${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}`}</div>
            <a
              href={mapsDirectionUrl(data.lat, data.lng)}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
            >
              <MapPin className="h-3.5 w-3.5" /> Mở trên bản đồ <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          {data.description && (
            <div className="sm:col-span-2">
              <div className="text-xs text-slate-500">Mô tả tình trạng</div>
              <div className="text-slate-700">{data.description}</div>
            </div>
          )}
        </div>

        {data.customerImages.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {data.customerImages.map(
              (img) =>
                img.url && (
                  <a key={img.id} href={img.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-slate-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt="Ảnh sự cố" className="h-20 w-28 object-cover" />
                  </a>
                ),
            )}
          </div>
        )}
      </Card>

      {err && <Alert>{err}</Alert>}

      {data.status === 'DANG_TIM_GARAGE' && (
        <Card className="border-amber-200 bg-amber-50/70 p-5" data-testid="sos-searching-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-semibold text-amber-900">
                <Clock className="h-5 w-5 text-amber-600" />
                Đang gửi tín hiệu tới {data.candidatesCount} garage cứu hộ trong khu vực…
              </div>
              <p className="text-sm text-amber-800">
                Thời gian chờ phản hồi còn lại:{' '}
                <b className="font-mono">
                  {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
                </b>
                . Nếu quá 3 phút chưa có garage nhận, hệ thống sẽ hiện danh sách hotline cứu hộ gần nhất để bạn gọi trực tiếp.
              </p>
            </div>
          </div>
        </Card>
      )}

      {data.status === 'KHONG_CO_GARAGE' && (
        <Card className="border-rose-200 bg-rose-50/60 p-5 space-y-3" data-testid="sos-fallback-card">
          <div className="flex items-start gap-2.5 text-rose-900">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
            <div>
              <div className="font-semibold">Chưa có garage nhận trực tuyến trong 3 phút</div>
              <p className="text-sm text-rose-800">
                Bạn vui lòng gọi trực tiếp hotline cứu hộ 24/7 của các garage gần vị trí của bạn bên dưới để được hỗ trợ ngay:
              </p>
            </div>
          </div>
          {data.fallbackHotlines.length > 0 ? (
            <ul className="space-y-2" data-testid="sos-fallback-list">
              {data.fallbackHotlines.map((g) => (
                <li key={g.tenantId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-3.5 shadow-sm">
                  <div>
                    <div className="font-semibold text-slate-900">
                      {g.slug ? (
                        <Link href={`/cho/garage/${g.slug}`} className="hover:text-brand-700 hover:underline">
                          {g.name}
                        </Link>
                      ) : (
                        g.name
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      {[g.distanceKm !== null ? `Cách ~${g.distanceKm} km` : null, g.address, g.basePrice > 0 ? `Giá từ ${fmtMoney(g.basePrice)}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <a
                    href={`tel:${g.hotline}`}
                    className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
                  >
                    <Phone className="h-4 w-4" /> Gọi {g.hotline}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-600">Hiện chưa có garage cứu hộ nào đăng ký gần vị trí này.</p>
          )}
          <div>
            <Link
              href={ownerMode ? '/app/cuu-ho' : '/cho/cuu-ho'}
              className="inline-flex items-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Gửi lại yêu cầu cứu hộ mới
            </Link>
          </div>
        </Card>
      )}

      {stepIdx >= 0 && (
        <Card className="p-5 space-y-4" data-testid="sos-assigned-card">
          <ol className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
            {STEPS.map((s, idx) => {
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

          {data.assignedGarage && (
            <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200/80 p-4">
              <div className="space-y-1">
                <div className="text-xs text-slate-500">Garage tiếp nhận cứu hộ</div>
                <div className="text-lg font-semibold text-slate-900" data-testid="sos-garage-name">
                  {data.assignedGarage.slug ? (
                    <Link href={`/cho/garage/${data.assignedGarage.slug}`} className="hover:text-brand-700 hover:underline">
                      {data.assignedGarage.name}
                    </Link>
                  ) : (
                    data.assignedGarage.name
                  )}
                </div>
                {data.assignedGarage.branch && <div className="text-xs text-slate-500">Chi nhánh: {data.assignedGarage.branch.name}</div>}
                {data.assignedGarage.address && <div className="text-sm text-slate-600">{data.assignedGarage.address}</div>}
                {data.assignedStaff && (
                  <div className="text-sm text-slate-700">
                    Nhân viên cứu hộ: <b>{data.assignedStaff.name}</b> ({data.assignedStaff.phone})
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {(data.assignedStaff?.phone || data.assignedGarage.hotline) && (
                  <a
                    href={`tel:${data.assignedStaff?.phone ?? data.assignedGarage.hotline}`}
                    className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                  >
                    <Phone className="h-4 w-4" /> Gọi cứu hộ
                  </a>
                )}
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 p-3.5">
              <div className="text-xs text-slate-500">Dự kiến tới nơi (ETA)</div>
              <div className="mt-0.5 text-base font-semibold text-slate-900">
                {data.arrivedAt ? 'Đã tới hiện trường' : data.etaMinutes !== null ? `~${data.etaMinutes} phút` : '—'}
              </div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3.5">
              <div className="text-xs text-slate-500">Giá dự kiến garage báo</div>
              <div className="mt-0.5 text-base font-semibold tabular-nums text-slate-900" data-testid="sos-quoted-price">
                {fmtMoney(data.quotedPrice)}
              </div>
            </div>
            <div className="rounded-2xl bg-emerald-50/70 p-3.5">
              <div className="text-xs text-emerald-700">Giá chốt (trả trực tiếp garage)</div>
              <div className="mt-0.5 text-base font-bold tabular-nums text-emerald-800" data-testid="sos-final-price">
                {fmtMoney(data.finalPrice)}
              </div>
            </div>
          </div>

          {data.sellerNote && (
            <div className="rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-3 text-sm text-sky-900">
              <b>Ghi chú từ garage:</b> {data.sellerNote}
            </div>
          )}

          {data.latestTrack && (
            <div className="rounded-2xl border border-brand-100 bg-brand-50/50 p-4 space-y-2" data-testid="sos-live-gps">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold text-brand-900">
                  <Navigation className="h-4 w-4 text-brand-600" />
                  Vị trí đội cứu hộ: {data.latestTrack.lat.toFixed(5)}, {data.latestTrack.lng.toFixed(5)}
                  {data.latestTrack.distanceToCustomerKm !== null && (
                    <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-brand-700">
                      Cách bạn ~{data.latestTrack.distanceToCustomerKm} km
                    </span>
                  )}
                </div>
                <a
                  href={mapsDirectionUrl(data.latestTrack.lat, data.latestTrack.lng)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                >
                  Xem trên Google Maps <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <div className="text-xs text-slate-600">
                Cập nhật lúc {fmtDateTime(data.latestTrack.at)}
                {data.latestTrack.note ? ` · ${data.latestTrack.note}` : ''}
              </div>
            </div>
          )}

          {data.sceneImages.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-slate-500">Ảnh hiện trường từ đội cứu hộ</div>
              <div className="flex flex-wrap gap-2">
                {data.sceneImages.map(
                  (img) =>
                    img.url && (
                      <a key={img.id} href={img.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-slate-200">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img.url} alt="Ảnh hiện trường" className="h-20 w-28 object-cover" />
                      </a>
                    ),
                )}
              </div>
            </div>
          )}

          {data.order && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4" data-testid="sos-linked-order">
              <div className="flex items-center gap-2 text-sm text-indigo-950">
                <Wrench className="h-4 w-4 text-indigo-600" />
                <span>
                  Xe đã được tiếp nhận tại xưởng theo lệnh sửa chữa <b className="font-mono">{data.order.code}</b>
                </span>
              </div>
              {ownerMode && (
                <Link href={`/app/don/${data.order.id}`} className="rounded-full bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700">
                  Theo dõi đơn sửa chữa
                </Link>
              )}
            </div>
          )}

          <p className="text-xs text-slate-500">
            <Truck className="mr-1 inline h-3.5 w-3.5" />
            Sàn CARDIY kết nối yêu cầu cứu hộ tới garage; khách thanh toán chi phí cứu hộ trực tiếp cho garage thực hiện.
          </p>
        </Card>
      )}

      {data.status === 'KHACH_HUY' && (
        <Card className="p-4 text-sm text-slate-600">
          Bạn đã huỷ yêu cầu cứu hộ này{data.cancelReason ? `: "${data.cancelReason}"` : ''}.
        </Card>
      )}

      {data.cancellable && (
        <Card className="p-4">
          {!cancelOpen ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-slate-600">
                {data.assignedGarage?.cancelPolicy ? `Chính sách huỷ của garage: ${data.assignedGarage.cancelPolicy}` : 'Bạn có thể huỷ yêu cầu trước khi đội cứu hộ xuất phát.'}
              </div>
              <Button variant="outline" onClick={() => setCancelOpen(true)} data-testid="sos-cancel-open">
                Huỷ yêu cầu cứu hộ
              </Button>
            </div>
          ) : (
            <div className="space-y-3" data-testid="sos-cancel-box">
              <Field label="Lý do huỷ (không bắt buộc)">
                {(id) => <Input id={id} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="VD: Xe đã tự nổ máy lại được…" />}
              </Field>
              <div className="flex gap-2">
                <Button className="bg-rose-600 hover:bg-rose-700" onClick={submitCancel} disabled={busy} data-testid="sos-cancel-confirm">
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

      {data.canReview && (
        <Card className="p-5" data-testid="sos-review-form">
          <h2 className="text-base font-semibold">Đánh giá dịch vụ cứu hộ</h2>
          <p className="mt-0.5 text-sm text-slate-500">Chia sẻ trải nghiệm thực tế của bạn để giúp các chủ xe khác.</p>
          <form onSubmit={submitReview} className="mt-3 space-y-3">
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  type="button"
                  key={n}
                  onClick={() => setRating(n)}
                  aria-label={`${n} sao`}
                  data-testid={`sos-star-${n}`}
                  className="rounded-lg p-1 transition hover:scale-110"
                >
                  <Star className={`h-7 w-7 ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
                </button>
              ))}
              <span className="ml-2 text-sm font-medium text-slate-700">{rating}/5 sao</span>
            </div>
            <Field label="Nhận xét">
              {(id) => <Input id={id} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Đội cứu hộ tới nhanh, hỗ trợ nhiệt tình…" />}
            </Field>
            <Button type="submit" disabled={busy} data-testid="sos-review-submit">
              Gửi đánh giá
            </Button>
          </form>
        </Card>
      )}

      {data.review && (
        <Card className="p-5 space-y-2" data-testid="sos-review-done">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900">Đánh giá của bạn:</span>
            <span className="flex items-center gap-0.5 text-amber-500">
              {Array.from({ length: data.review.rating }).map((_, idx) => (
                <Star key={idx} className="h-4 w-4 fill-amber-400 text-amber-400" />
              ))}
            </span>
          </div>
          {data.review.comment && <p className="text-sm text-slate-700">{data.review.comment}</p>}
          {data.review.reply && (
            <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700" data-testid="sos-review-reply">
              <b>Phản hồi từ garage:</b> {data.review.reply}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
