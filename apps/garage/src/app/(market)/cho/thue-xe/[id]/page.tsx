'use client';

import { Alert, Badge, Button, Card, Field, Input, Spinner } from '@cardiy/ui';
import { ArrowLeft, CalendarRange, CarFront, KeyRound, MapPin, Phone, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/orders';
import {
  defaultRentalDates,
  fmtVnd,
  FUEL_LABEL,
  localInputToIso,
  publicRentalGet,
  publicRentalPost,
  TRANSMISSION_LABEL,
  type RentalVehicleItem,
} from '@/lib/rentals';

/** A1.08 Chi tiết xe cho thuê + form đặt thuê trực tuyến gửi tới garage */
export default function PublicRentalVehicleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const def = defaultRentalDates();

  const [vehicle, setVehicle] = useState<RentalVehicleItem | null>(null);
  const [startLocal, setStartLocal] = useState(sp.get('start') || def.startLocal);
  const [endLocal, setEndLocal] = useState(sp.get('end') || def.endLocal);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [idCardNo, setIdCardNo] = useState('');
  const [driverLicenseNo, setDriverLicenseNo] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    publicRentalGet<RentalVehicleItem>(`/vehicles/${id}`)
      .then(setVehicle)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Không tìm thấy xe'));
  }, [id]);

  const estimate = useMemo(() => {
    if (!vehicle || !startLocal || !endLocal) return null;
    const s = new Date(localInputToIso(startLocal));
    const e = new Date(localInputToIso(endLocal));
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) return null;
    const days = Math.max(1, Math.ceil((e.getTime() - s.getTime()) / 86_400_000));
    return { days, baseTotal: days * vehicle.dailyPrice };
  }, [vehicle, startLocal, endLocal]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await publicRentalPost<{ trackUrl: string }>('/contracts', {
        rentalVehicleId: id,
        startAt: localInputToIso(startLocal),
        endAt: localInputToIso(endLocal),
        name,
        phone,
        idCardNo: idCardNo || null,
        driverLicenseNo: driverLicenseNo || null,
        note: note || null,
      });
      router.push(res.trackUrl);
    } catch (ex) {
      setError(ex instanceof ApiError ? ex.message : 'Đặt thuê thất bại');
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !vehicle) return <Alert>{error}</Alert>;
  if (!vehicle) return <Spinner className="h-6 w-6 text-brand-600" />;

  return (
    <div className="space-y-4">
      <Link href="/cho/thue-xe" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Quay lại danh sách xe cho thuê
      </Link>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card className="overflow-hidden p-0">
            <div className="grid h-64 place-items-center bg-slate-100 text-slate-400">
              {vehicle.images[0]?.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={vehicle.images[0].url} alt={vehicle.title} className="h-64 w-full object-cover" />
              ) : (
                <CarFront className="h-16 w-16" />
              )}
            </div>
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap gap-2">
                <Badge tone="mint">{TRANSMISSION_LABEL[vehicle.transmission]}</Badge>
                <Badge tone="sky">{vehicle.seats} chỗ</Badge>
                <Badge tone="slate">{FUEL_LABEL[vehicle.fuel]}</Badge>
                <Badge tone="lav">Đời {vehicle.year}</Badge>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900" data-testid="rental-vehicle-title">
                  {vehicle.title}
                </h1>
                <p className="text-sm text-slate-500">
                  Biển số: <b className="font-mono">{vehicle.plateNo}</b> · Mã xe: {vehicle.code}
                </p>
              </div>

              <div className="grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm sm:grid-cols-3">
                <div>
                  <div className="text-xs text-slate-500">Giá thuê theo ngày</div>
                  <div className="text-lg font-bold text-emerald-700">{fmtVnd(vehicle.dailyPrice)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Tiền đặt cọc tại garage</div>
                  <div className="text-base font-semibold text-slate-900">{fmtVnd(vehicle.deposit)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Định mức km / ngày</div>
                  <div className="text-base font-semibold text-slate-900">
                    {vehicle.kmLimitPerDay > 0 ? `${vehicle.kmLimitPerDay} km` : 'Không giới hạn'}
                  </div>
                  {vehicle.kmLimitPerDay > 0 && <div className="text-xs text-slate-500">Vượt thu {fmtVnd(vehicle.overKmFee)}/km</div>}
                </div>
              </div>

              {vehicle.description && (
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">Mô tả xe</h2>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{vehicle.description}</p>
                </div>
              )}

              {vehicle.terms && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-950">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <ShieldAlert className="h-4 w-4 text-amber-600" /> Điều kiện thuê & giấy tờ cần chuẩn bị
                  </div>
                  <p className="mt-1 whitespace-pre-line text-amber-900">{vehicle.terms}</p>
                </div>
              )}

              {vehicle.shop && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 p-4 text-sm">
                  <div>
                    <div className="text-xs text-slate-500">Đơn vị cho thuê</div>
                    <div className="font-semibold text-slate-900">
                      {vehicle.shop.slug ? (
                        <Link href={`/cho/garage/${vehicle.shop.slug}`} className="hover:text-brand-700 hover:underline">
                          {vehicle.shop.name}
                        </Link>
                      ) : (
                        vehicle.shop.name
                      )}
                    </div>
                    {vehicle.shop.address && (
                      <div className="flex items-center gap-1 text-xs text-slate-600">
                        <MapPin className="h-3.5 w-3.5" /> {vehicle.shop.address}
                      </div>
                    )}
                  </div>
                  {vehicle.shop.phone && (
                    <a
                      href={`tel:${vehicle.shop.phone}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                    >
                      <Phone className="h-4 w-4" /> {vehicle.shop.phone}
                    </a>
                  )}
                </div>
              )}

              {(vehicle.bookedSlots?.length ?? 0) > 0 && (
                <div className="space-y-1 text-xs text-slate-500">
                  <div className="flex items-center gap-1 font-semibold text-slate-700">
                    <CalendarRange className="h-4 w-4" /> Các khung ngày đã có khách đặt:
                  </div>
                  <ul className="list-inside list-disc">
                    {vehicle.bookedSlots!.map((s, idx) => (
                      <li key={idx}>
                        {fmtDateTime(s.startAt)} → {fmtDateTime(s.endAt)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Card>
        </div>

        <aside className="lg:col-span-2">
          <Card className="sticky top-20 p-5">
            <h2 className="text-lg font-semibold text-slate-900">Đặt thuê xe này</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Sàn chuyển yêu cầu đặt thuê tới garage; bạn đối chiếu giấy tờ, ký hợp đồng và thanh toán trực tiếp tại garage.
            </p>

            <form onSubmit={submit} className="mt-4 space-y-3.5" data-testid="public-rental-book-form">
              {error && <Alert>{error}</Alert>}

              <Field label="Nhận xe *">
                {(fid) => <Input id={fid} type="datetime-local" required value={startLocal} onChange={(e) => setStartLocal(e.target.value)} />}
              </Field>
              <Field label="Trả xe *">
                {(fid) => <Input id={fid} type="datetime-local" required value={endLocal} onChange={(e) => setEndLocal(e.target.value)} />}
              </Field>

              {estimate && (
                <div className="rounded-2xl bg-emerald-50/80 p-3.5 text-sm space-y-1" data-testid="rental-price-estimate">
                  <div className="flex justify-between text-slate-700">
                    <span>Tiền thuê ({estimate.days} ngày):</span>
                    <b className="tabular-nums">{fmtVnd(estimate.baseTotal)}</b>
                  </div>
                  <div className="flex justify-between text-slate-700">
                    <span>Đặt cọc tại garage:</span>
                    <b className="tabular-nums">{fmtVnd(vehicle.deposit)}</b>
                  </div>
                </div>
              )}

              <Field label="Họ và tên người thuê *">
                {(fid) => <Input id={fid} required value={name} onChange={(e) => setName(e.target.value)} placeholder="Nguyễn Văn A" />}
              </Field>
              <Field label="Số điện thoại *">
                {(fid) => <Input id={fid} required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0912345678" />}
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Số CCCD">
                  {(fid) => <Input id={fid} value={idCardNo} onChange={(e) => setIdCardNo(e.target.value)} placeholder="07909..." />}
                </Field>
                <Field label="Số GPLX">
                  {(fid) => <Input id={fid} value={driverLicenseNo} onChange={(e) => setDriverLicenseNo(e.target.value)} placeholder="79012... (B2)" />}
                </Field>
              </div>
              <Field label="Ghi chú cho garage">
                {(fid) => <Input id={fid} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Nhận xe lúc 8h sáng đúng giờ…" />}
              </Field>

              <Button type="submit" disabled={submitting} className="w-full justify-center py-2.5 text-base" data-testid="rental-book-submit">
                <KeyRound className="h-4 w-4" /> {submitting ? 'Đang gửi yêu cầu…' : 'Gửi yêu cầu đặt thuê'}
              </Button>
            </form>
          </Card>
        </aside>
      </div>
    </div>
  );
}
