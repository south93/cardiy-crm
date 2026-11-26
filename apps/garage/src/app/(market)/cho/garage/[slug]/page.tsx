/* eslint-disable @next/next/no-img-element -- ảnh là link có chữ ký, hết hạn sau 1 giờ: không tối ưu qua next/image */
import type { Metadata } from 'next';
import { MapPin, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { ContactButtons, OpenBadge, Stars } from '@/components/market/cards';
import { ShopReportButton } from '@/components/market/shop-report-button';
import { ViewTracker } from '@/components/market/view-tracker';
import { itemHref, marketApi, money, requestHref, type OfferRow, type ShopDetail } from '@/lib/market';

export const dynamic = 'force-dynamic';
type P = { params: Promise<{ slug: string }> };
const DAYS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const s = await marketApi<ShopDetail>(`/shops/${encodeURIComponent((await params).slug)}`);
  return { title: s.name, description: s.intro ?? `${s.name}${s.address ? ` · ${s.address}` : ''}: bảng giá sản phẩm, dịch vụ, giờ mở cửa, đánh giá.` };
}

function OfferList({ rows }: { rows: OfferRow[] }) {
  return (
    <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200/70 bg-white">
      {rows.map((o) => (
        <div key={o.id} className="flex items-center gap-3 p-3" data-testid="shop-offer">
          {(o.imageUrl ?? o.item.imageUrl) ? (
            <img src={(o.imageUrl ?? o.item.imageUrl)!} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
          ) : (
            <span className="h-14 w-14 shrink-0 rounded-xl bg-slate-100" />
          )}
          <div className="min-w-0 flex-1">
            <Link href={o.kind ? itemHref(o.kind, o.item.code) : '#'} className="font-medium hover:text-brand-700">
              {o.item.name}
            </Link>
            <div className="text-xs text-slate-500">
              {[
                o.installIncluded && 'gồm lắp đặt',
                o.mfgYear && `sản xuất ${o.mfgYear}`,
                o.durationMinutes && `khoảng ${o.durationMinutes >= 60 ? `${Math.round(o.durationMinutes / 6) / 10} giờ` : `${o.durationMinutes} phút`}`,
                o.state === 'HET_HANG' && 'tạm hết hàng',
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <div className="text-right">
            <div className="font-bold text-brand-700">
              {o.priceFrom && <span className="text-xs font-normal text-slate-500">từ </span>}
              {money(o.price)}
            </div>
            {o.listPrice && <div className="text-xs text-slate-400 line-through">{money(o.listPrice)}</div>}
            {o.state !== 'HET_HANG' && (
              <Link href={requestHref(o.id)} className="text-xs font-medium text-brand-700 hover:underline" data-testid="shop-request">
                {o.kind === 'SERVICE' ? 'Đặt lịch' : 'Đặt hàng'}
              </Link>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A1.03 Trang garage */
export default async function ShopPage({ params }: P) {
  const s = await marketApi<ShopDetail>(`/shops/${encodeURIComponent((await params).slug)}`);
  const week = [1, 2, 3, 4, 5, 6, 0].map((d) => s.openingHours.find((h) => h.day === d) ?? { day: d, open: '', close: '', closed: true });
  return (
    <div className="space-y-6">
      <ViewTracker tenantId={s.tenantId} />
      <section className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white">
        {s.coverUrl ? <img src={s.coverUrl} alt="" className="h-40 w-full object-cover md:h-56" /> : <div className="h-24 bg-gradient-to-r from-brand-600 to-brand-700" />}
        <div className="space-y-3 p-5">
          <div className="flex items-start gap-4">
            {s.logoUrl ? <img src={s.logoUrl} alt="" className="-mt-12 h-20 w-20 rounded-2xl border-4 border-white object-cover" /> : null}
            <div className="min-w-0">
              <h1 className="text-2xl font-bold" data-testid="shop-name">
                {s.name}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                {s.rating && <Stars value={s.rating.avg} count={s.rating.count} />}
                <OpenBadge open={s.openNow} />
              </div>
              {s.address && (
                <p className="mt-1 flex items-start gap-1 text-sm text-slate-600">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                  {s.address}
                </p>
              )}
            </div>
          </div>
          {s.intro && <p className="whitespace-pre-line text-sm text-slate-700">{s.intro}</p>}
          <ContactButtons shop={s} />
          {s.vouchers.length > 0 && (
            <div className="flex flex-wrap gap-2" data-testid="shop-vouchers">
              {s.vouchers.map((v) => (
                <div key={v.code} className="rounded-xl border border-dashed border-peach-500 bg-peach-100/50 px-3 py-2 text-sm">
                  <div className="font-semibold text-peach-700">
                    {v.code} · {v.title}
                  </div>
                  <div className="text-xs text-slate-600">
                    {v.summary} · đến {new Date(v.endsAt).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {s.serviceOffers.length > 0 && (
            <section>
              <h2 className="mb-2 text-lg font-semibold">Bảng giá dịch vụ</h2>
              <OfferList rows={s.serviceOffers} />
            </section>
          )}
          {s.productOffers.length > 0 && (
            <section>
              <h2 className="mb-2 text-lg font-semibold">Sản phẩm đang bán</h2>
              <OfferList rows={s.productOffers} />
            </section>
          )}
          <section>
            <h2 className="mb-2 text-lg font-semibold">Đánh giá</h2>
            {s.reviews.length ? (
              <div className="space-y-3" data-testid="shop-reviews">
                {s.reviews.map((r, i) => (
                  <div key={i} className="rounded-2xl border border-slate-200/70 bg-white p-4 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.name}</span>
                      <Stars value={r.rating} />
                      <span className="text-xs text-slate-400">{new Date(r.createdAt).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</span>
                    </div>
                    {r.items && r.items.length > 0 && <div className="mt-0.5 text-xs text-slate-500">Đã sử dụng: {r.items.join(', ')}</div>}
                    {r.comment && <p className="mt-1 text-slate-700">{r.comment}</p>}
                    {r.reply && <p className="mt-2 rounded-xl bg-slate-50 p-2 text-slate-600">Garage trả lời: {r.reply}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Chưa có đánh giá.</p>
            )}
          </section>
        </div>
        <aside className="space-y-4">
          <section className="rounded-2xl border border-slate-200/70 bg-white p-4 text-sm">
            <h2 className="mb-2 font-semibold">Giờ mở cửa</h2>
            <dl className="space-y-1" data-testid="shop-hours">
              {week.map((d) => (
                <div key={d.day} className="flex justify-between">
                  <dt className="text-slate-500">{DAYS[d.day]}</dt>
                  <dd>{d.closed ? 'Nghỉ' : `${d.open} – ${d.close}`}</dd>
                </div>
              ))}
            </dl>
          </section>
          {s.branches.length > 1 && (
            <section className="rounded-2xl border border-slate-200/70 bg-white p-4 text-sm">
              <h2 className="mb-2 font-semibold">Chi nhánh</h2>
              <ul className="space-y-2">
                {s.branches.map((b) => (
                  <li key={b.name}>
                    <div className="font-medium">{b.name}</div>
                    {b.address && <div className="text-xs text-slate-500">{b.address}</div>}
                    {b.phone && (
                      <a href={`tel:${b.phone}`} className="text-xs text-brand-700">
                        {b.phone}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(s.policies.warranty || s.policies.return || s.policies.cancel) && (
            <section className="rounded-2xl border border-slate-200/70 bg-white p-4 text-sm">
              <h2 className="mb-2 flex items-center gap-1.5 font-semibold">
                <ShieldCheck className="h-4 w-4 text-emerald-600" /> Chính sách của garage
              </h2>
              {[
                ['Bảo hành', s.policies.warranty],
                ['Đổi trả', s.policies.return],
                ['Huỷ lịch / đơn', s.policies.cancel],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="mb-2">
                    <div className="text-xs font-medium text-slate-500">{k}</div>
                    <p className="whitespace-pre-line text-slate-700">{v}</p>
                  </div>
                ))}
            </section>
          )}
          <div className="px-1">
            <ShopReportButton slug={s.slug} shopName={s.name} />
          </div>
        </aside>
      </div>
    </div>
  );
}
