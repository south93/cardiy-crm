'use client';

import { Badge, Card, Field, Input, Select, Spinner } from '@cardiy/ui';
import { CarFront, MapPin, Users } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { defaultRentalDates, fmtVnd, FUEL_LABEL, localInputToIso, publicRentalGet, TRANSMISSION_LABEL, type RentalVehicleItem } from '@/lib/rentals';

/** A1.08 Tìm xe cho thuê trên sàn theo ngày và địa điểm */
export default function PublicRentalListPage() {
  const initDates = defaultRentalDates();
  const [province, setProvince] = useState('');
  const [seats, setSeats] = useState('');
  const [transmission, setTransmission] = useState('');
  const [startLocal, setStartLocal] = useState(initDates.startLocal);
  const [endLocal, setEndLocal] = useState(initDates.endLocal);
  const [sort, setSort] = useState('gia-tang');
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ provinces: string[]; estimatedDays: number | null; items: RentalVehicleItem[] } | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (province) qs.set('province', province);
    if (seats) qs.set('seats', seats);
    if (transmission) qs.set('transmission', transmission);
    if (startLocal && endLocal) {
      qs.set('startAt', localInputToIso(startLocal));
      qs.set('endAt', localInputToIso(endLocal));
    }
    if (sort) qs.set('sort', sort);
    if (q.trim()) qs.set('q', q.trim());
    const res = await publicRentalGet<{ provinces: string[]; estimatedDays: number | null; items: RentalVehicleItem[] }>(`/vehicles?${qs}`);
    setData(res);
  }, [province, seats, transmission, startLocal, endLocal, sort, q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-700 p-6 text-white md:p-8">
        <h1 className="text-2xl font-bold md:text-3xl">Thuê xe tự lái từ các garage uy tín</h1>
        <p className="mt-1 max-w-2xl text-sm text-emerald-50">
          Xe được bảo dưỡng định kỳ tại garage. Đặt lịch trực tuyến, đối chiếu giấy tờ, ký hợp đồng và đặt cọc trực tiếp với garage cho thuê.
        </p>

        <Card className="mt-5 grid gap-3 p-4 text-slate-800 sm:grid-cols-2 lg:grid-cols-6" data-testid="rental-search-bar">
          <Field label="Địa điểm / tỉnh">
            {(id) => (
              <Select id={id} value={province} onChange={(e) => setProvince(e.target.value)}>
                <option value="">Mọi khu vực</option>
                {(data?.provinces ?? []).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Nhận xe">
            {(id) => <Input id={id} type="datetime-local" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} />}
          </Field>

          <Field label="Trả xe">
            {(id) => <Input id={id} type="datetime-local" value={endLocal} onChange={(e) => setEndLocal(e.target.value)} />}
          </Field>

          <Field label="Số chỗ">
            {(id) => (
              <Select id={id} value={seats} onChange={(e) => setSeats(e.target.value)}>
                <option value="">Mọi số chỗ</option>
                <option value="4">4 chỗ</option>
                <option value="5">5 chỗ</option>
                <option value="7">7 chỗ</option>
                <option value="16">16 chỗ</option>
              </Select>
            )}
          </Field>

          <Field label="Hộp số">
            {(id) => (
              <Select id={id} value={transmission} onChange={(e) => setTransmission(e.target.value)}>
                <option value="">Tất cả</option>
                <option value="TU_DONG">Số tự động</option>
                <option value="SO_SAN">Số sàn</option>
              </Select>
            )}
          </Field>

          <Field label="Sắp xếp / tìm tên xe">
            {(id) => <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Toyota, Mazda…" />}
          </Field>
        </Card>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="text-slate-600">
          {data ? (
            <>
              Tìm thấy <b>{data.items.length}</b> xe trống lịch
              {data.estimatedDays ? ` (${data.estimatedDays} ngày)` : ''}
            </>
          ) : (
            'Đang tìm xe…'
          )}
        </div>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-auto rounded-full" aria-label="Sắp xếp theo giá">
          <option value="gia-tang">Giá thấp → cao</option>
          <option value="gia-giam">Giá cao → thấp</option>
        </Select>
      </div>

      {!data ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : !data.items.length ? (
        <Card className="p-10 text-center text-sm text-slate-500">Không có xe nào còn trống trong khoảng thời gian này. Hãy thử đổi ngày hoặc khu vực.</Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="public-rental-grid">
          {data.items.map((v) => (
            <Link
              key={v.id}
              href={`/cho/thue-xe/${v.id}?start=${encodeURIComponent(startLocal)}&end=${encodeURIComponent(endLocal)}`}
              className="block transition hover:-translate-y-0.5"
              data-testid="public-rental-card"
            >
              <Card className="flex h-full flex-col overflow-hidden p-0">
                <div className="grid h-40 place-items-center bg-slate-100 text-slate-400">
                  {v.images[0]?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.images[0].url} alt={v.title} className="h-40 w-full object-cover" />
                  ) : (
                    <CarFront className="h-12 w-12" />
                  )}
                </div>
                <div className="flex flex-1 flex-col justify-between space-y-3 p-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone="mint">{TRANSMISSION_LABEL[v.transmission]}</Badge>
                      <Badge tone="sky">
                        <Users className="h-3 w-3" /> {v.seats} chỗ
                      </Badge>
                      <Badge tone="slate">{FUEL_LABEL[v.fuel]}</Badge>
                    </div>
                    <h2 className="font-semibold text-slate-900">{v.title}</h2>
                    {v.shop && (
                      <div className="flex items-center gap-1 text-xs text-slate-500">
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          {v.shop.name}
                          {v.province ? ` · ${v.province}` : ''}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="border-t border-slate-100 pt-2.5">
                    <div className="flex items-baseline justify-between">
                      <div>
                        <span className="text-lg font-bold text-emerald-700">{fmtVnd(v.dailyPrice)}</span>
                        <span className="text-xs text-slate-500"> / ngày</span>
                      </div>
                      <span className="text-xs text-slate-500">Cọc {fmtVnd(v.deposit)}</span>
                    </div>
                    {v.estimatedTotal != null && (
                      <div className="mt-0.5 text-xs font-medium text-slate-600">Tạm tính {data.estimatedDays} ngày: {fmtVnd(v.estimatedTotal)}</div>
                    )}
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
