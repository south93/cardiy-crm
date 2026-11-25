import { Suspense } from 'react';
import Link from 'next/link';
import { ContactButtons, ItemCardView, OpenBadge, Stars } from '@/components/market/cards';
import { NearMe } from '@/components/market/near-me';
import { marketApi, money, one, qs, type Category, type ItemCard, type ItemDetail, type Kind, type SP } from '@/lib/market';

const base = (kind: Kind) => (kind === 'SERVICE' ? '/cho/dich-vu' : '/cho/san-pham');

/** A1.04 / A1.06 Danh sách sản phẩm hoặc dịch vụ có garage đang bán */
export async function ItemList({ kind, searchParams }: { kind: Kind; searchParams: SP }) {
  const sp = await searchParams;
  const p = { kind, q: one(sp.q), categoryId: one(sp.nhom), sort: one(sp.sort) };
  const [items, cats] = await Promise.all([marketApi<ItemCard[]>(`/items${qs(p)}`), marketApi<Category[]>('/categories')]);
  const mine = cats.filter((c) => c.kind === kind);
  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm ${on ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-slate-200 bg-white text-slate-700 hover:border-brand-200'}`;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{kind === 'SERVICE' ? 'Dịch vụ: so giá giữa các garage' : p.q ? `Kết quả cho “${p.q}”` : 'Sản phẩm'}</h1>
      <div className="flex flex-wrap gap-2" data-testid="category-chips">
        <Link href={`${base(kind)}${qs({ q: p.q })}`} className={chip(!p.categoryId)}>
          Tất cả
        </Link>
        {mine.map((c) => (
          <Link key={c.id} href={`${base(kind)}${qs({ q: p.q, nhom: c.id })}`} className={chip(p.categoryId === c.id)}>
            {c.name}
          </Link>
        ))}
      </div>
      <form className="flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={p.q}
          placeholder={kind === 'SERVICE' ? 'Tìm dịch vụ…' : 'Kích cỡ, tên, thương hiệu…'}
          aria-label="Từ khoá"
          className="w-full rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm sm:w-72"
        />
        {p.categoryId && <input type="hidden" name="nhom" value={p.categoryId} />}
        <select name="sort" defaultValue={p.sort ?? ''} aria-label="Sắp xếp" className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm">
          <option value="">Nhiều garage bán</option>
          <option value="gia">Giá thấp nhất</option>
        </select>
        <button className="rounded-full bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white">Lọc</button>
      </form>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="item-list">
        {items.map((i) => (
          <ItemCardView key={i.code} i={i} />
        ))}
      </div>
      {!items.length && <p className="rounded-2xl bg-white p-8 text-center text-slate-500">Chưa có garage nào bán mục phù hợp.</p>}
    </div>
  );
}

export async function itemMeta(kind: Kind, code: string) {
  const i = await marketApi<ItemDetail>(`/items/${encodeURIComponent(code)}`);
  const min = Math.min(...i.sellers.map((s) => s.price));
  return { title: i.name, description: `${i.name}: ${i.sellers.length} garage đang ${kind === 'SERVICE' ? 'làm' : 'bán'}, giá từ ${money(min)}. So giá, xem khoảng cách và liên hệ garage.` };
}

/** A1.05 Chi tiết sản phẩm / dịch vụ: thông số + các garage đang bán, so giá, gần nhất */
export async function ItemDetailView({ kind, code, searchParams }: { kind: Kind; code: string; searchParams: SP }) {
  const sp = await searchParams;
  const p = { lat: one(sp.lat), lng: one(sp.lng), sort: one(sp.sort) };
  const i = await marketApi<ItemDetail>(`/items/${encodeURIComponent(code)}${qs(p)}`);
  return (
    <div className="space-y-6">
      <nav className="text-sm text-slate-500">
        <Link href={base(kind)} className="hover:text-brand-700">
          {kind === 'SERVICE' ? 'Dịch vụ' : 'Sản phẩm'}
        </Link>
        {i.category && (
          <>
            {' › '}
            <Link href={`${base(kind)}?nhom=${i.category.id}`} className="hover:text-brand-700">
              {i.category.name}
            </Link>
          </>
        )}
      </nav>
      <section className="grid gap-6 rounded-3xl border border-slate-200/70 bg-white p-5 md:grid-cols-[280px_1fr]">
        <div className="grid aspect-square place-items-center overflow-hidden rounded-2xl bg-slate-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {i.imageUrl ? <img src={i.imageUrl} alt={i.name} className="h-full w-full object-cover" /> : <span className="text-sm text-slate-400">{i.brand}</span>}
        </div>
        <div>
          <h1 className="text-2xl font-bold" data-testid="item-name">
            {i.name}
          </h1>
          <div className="mt-1 text-sm text-slate-500">
            {i.brand && `${i.brand} · `}
            {i.sellers.length} garage · giá từ <span className="font-bold text-brand-700">{money(Math.min(...i.sellers.map((s) => s.price)))}</span>
          </div>
          {i.specs.length > 0 && (
            <dl className="mt-4 grid max-w-md grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {i.specs.map((s) => (
                <div key={s.label} className="contents">
                  <dt className="text-slate-500">{s.label}</dt>
                  <dd className="font-medium">{s.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {i.description && <p className="mt-4 whitespace-pre-line text-sm text-slate-700">{i.description}</p>}
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="flex-1 text-lg font-semibold">Garage đang {kind === 'SERVICE' ? 'làm' : 'bán'}</h2>
          <Link
            href={`?${new URLSearchParams({ ...(p.lat ? { lat: p.lat, lng: p.lng ?? '' } : {}) }).toString()}`}
            className={`rounded-full border px-3 py-1.5 text-sm ${p.sort !== 'gan' ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-slate-200 bg-white'}`}
          >
            Giá tốt
          </Link>
          <Suspense>
            <NearMe label="Gần nhất" />
          </Suspense>
        </div>
        <div className="space-y-3" data-testid="seller-list">
          {i.sellers.map((o) => (
            <div key={o.id} className={`rounded-2xl border border-slate-200/70 bg-white p-4 ${o.state === 'HET_HANG' ? 'opacity-60' : ''}`} data-testid="seller-row">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/cho/garage/${o.shop.slug}`} className="font-semibold hover:text-brand-700">
                    {o.shop.name}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    {o.shop.rating && <Stars value={o.shop.rating.avg} count={o.shop.rating.count} />}
                    <OpenBadge open={o.shop.openNow} />
                    {o.shop.distanceKm !== null && <span className="font-medium text-brand-700">{o.shop.distanceKm.toLocaleString('vi-VN')} km</span>}
                    {o.shop.address && <span>{o.shop.address}</span>}
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    {[o.installIncluded && 'Giá gồm lắp đặt', o.mfgYear && `Sản xuất ${o.mfgYear}`, o.state === 'HET_HANG' && 'Tạm hết hàng', o.note].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-brand-700">
                    {o.priceFrom && <span className="text-xs font-normal text-slate-500">từ </span>}
                    {money(o.price)}
                  </div>
                  {o.listPrice && <div className="text-xs text-slate-400 line-through">{money(o.listPrice)}</div>}
                </div>
              </div>
              <div className="mt-3">
                <ContactButtons shop={o.shop} what={o.state === 'HET_HANG' ? undefined : i.name} compact />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
