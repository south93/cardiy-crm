'use client';

import { Badge, Card, Field, Input, Select, Spinner } from '@cardiy/ui';
import { Car, Gauge, MapPin, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { BODY_STYLE_LABEL, fmtCarPrice, FUEL_LABEL, publicUsedCarGet, TRANSMISSION_LABEL, type UsedCarListingItem } from '@/lib/used-cars';

/** A1.07 Danh sách & bộ lọc tìm xe cũ trên sàn công khai */
export default function PublicUsedCarsPage() {
  const [q, setQ] = useState('');
  const [province, setProvince] = useState('');
  const [make, setMake] = useState('');
  const [bodyStyle, setBodyStyle] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [sort, setSort] = useState('moi-nhat');
  const [data, setData] = useState<{ provinces: string[]; makes: string[]; items: UsedCarListingItem[] } | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (q.trim()) qs.set('q', q.trim());
    if (province) qs.set('province', province);
    if (make) qs.set('make', make);
    if (bodyStyle) qs.set('bodyStyle', bodyStyle);
    if (maxPrice) qs.set('maxPrice', maxPrice);
    if (verifiedOnly) qs.set('verifiedOnly', 'true');
    if (sort) qs.set('sort', sort);
    const res = await publicUsedCarGet<{ provinces: string[]; makes: string[]; items: UsedCarListingItem[] }>(`?${qs}`);
    setData(res);
  }, [q, province, make, bodyStyle, maxPrice, verifiedOnly, sort]);

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-gradient-to-br from-indigo-700 to-brand-700 p-6 text-white md:p-8">
        <h1 className="text-2xl font-bold md:text-3xl">Mua bán xe cũ minh bạch · Kèm báo cáo kiểm định garage</h1>
        <p className="mt-1 max-w-2xl text-sm text-indigo-100">
          Xe đăng bán từ chủ xe và các garage trên toàn quốc. Ưu tiên xe có huy hiệu <b>Đã kiểm định 150 hạng mục</b> với biên bản kỹ thuật công khai.
        </p>

        <Card className="mt-5 grid gap-3 p-4 text-slate-800 sm:grid-cols-2 lg:grid-cols-5" data-testid="used-car-search-bar">
          <Field label="Tìm tên xe / hãng">
            {(id) => <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Corolla Cross, CX-5, City…" />}
          </Field>
          <Field label="Tỉnh / thành phố">
            {(id) => (
              <Select id={id} value={province} onChange={(e) => setProvince(e.target.value)}>
                <option value="">Toàn quốc</option>
                {(data?.provinces ?? []).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Hãng xe">
            {(id) => (
              <Select id={id} value={make} onChange={(e) => setMake(e.target.value)}>
                <option value="">Tất cả hãng</option>
                {(data?.makes ?? []).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Kiểu dáng">
            {(id) => (
              <Select id={id} value={bodyStyle} onChange={(e) => setBodyStyle(e.target.value)}>
                <option value="">Mọi kiểu dáng</option>
                {Object.entries(BODY_STYLE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Tầm giá tối đa">
            {(id) => (
              <Select id={id} value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)}>
                <option value="">Mọi mức giá</option>
                <option value="500000000">Dưới 500 triệu</option>
                <option value="800000000">Dưới 800 triệu</option>
                <option value="1200000000">Dưới 1,2 tỷ</option>
              </Select>
            )}
          </Field>
        </Card>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-slate-600">{data ? <>Có <b>{data.items.length}</b> xe đang đăng bán</> : 'Đang tải…'}</span>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3.5 py-1.5 text-xs font-semibold text-emerald-800">
            <input
              type="checkbox"
              checked={verifiedOnly}
              onChange={(e) => setVerifiedOnly(e.target.checked)}
              data-testid="used-car-verified-filter"
            />
            <ShieldCheck className="h-4 w-4 text-emerald-600" /> Chỉ hiện xe Đã kiểm định
          </label>
        </div>

        <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-auto rounded-full" aria-label="Sắp xếp xe cũ">
          <option value="moi-nhat">Ưu tiên đã kiểm định & mới nhất</option>
          <option value="gia-tang">Giá thấp → cao</option>
          <option value="gia-giam">Giá cao → thấp</option>
          <option value="odo-thap">Số ODO thấp nhất</option>
        </Select>
      </div>

      {!data ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : !data.items.length ? (
        <Card className="p-10 text-center text-sm text-slate-500">Không tìm thấy tin bán xe phù hợp bộ lọc hiện tại.</Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="public-used-car-grid">
          {data.items.map((l) => (
            <Link key={l.id} href={`/cho/xe-cu/${l.id}`} className="block transition hover:-translate-y-0.5" data-testid="public-used-car-card">
              <Card className="flex h-full flex-col overflow-hidden p-0">
                <div className="relative grid h-44 place-items-center bg-slate-100 text-slate-400">
                  {l.images[0]?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.images[0].url} alt={l.title} className="h-44 w-full object-cover" />
                  ) : (
                    <Car className="h-12 w-12" />
                  )}
                  {l.hasVerifiedBadge && (
                    <span
                      className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow"
                      data-testid="used-car-verified-badge"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> Đã kiểm định
                      {l.appraisalReport?.score ? ` · ${l.appraisalReport.score}/100` : ''}
                    </span>
                  )}
                </div>

                <div className="flex flex-1 flex-col justify-between space-y-3 p-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone="sky">Đời {l.year}</Badge>
                      <Badge tone="slate">{TRANSMISSION_LABEL[l.transmission]}</Badge>
                      <Badge tone="lav">{FUEL_LABEL[l.fuel]}</Badge>
                    </div>
                    <h2 className="font-semibold text-slate-900 line-clamp-2">{l.title}</h2>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <Gauge className="h-3.5 w-3.5" /> {l.mileageKm.toLocaleString('vi-VN')} km
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" /> {l.province}
                      </span>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-2.5 flex items-baseline justify-between">
                    <div>
                      <span className="text-lg font-bold text-emerald-700">{fmtCarPrice(l.price)}</span>
                      {l.negotiable && <span className="ml-1 text-xs text-slate-400">· Thương lượng</span>}
                    </div>
                    <span className="text-xs text-slate-500">{l.sellerType === 'GARAGE' ? l.sellerShop?.name : 'Chính chủ'}</span>
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
