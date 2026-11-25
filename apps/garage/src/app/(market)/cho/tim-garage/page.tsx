import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ShopCardView } from '@/components/market/cards';
import { NearMe } from '@/components/market/near-me';
import { marketApi, one, qs, type Category, type ShopCard, type SP } from '@/lib/market';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Tìm garage ô tô gần bạn',
  description: 'Danh sách garage trên sàn CARDIY: giờ mở cửa, đánh giá, dịch vụ, khoảng cách. Gọi, nhắn Zalo hoặc đặt lịch trực tiếp.',
};

/** A1.02 Tìm garage: lọc tỉnh, nhóm dịch vụ, từ khoá; sắp xếp gần nhất / đánh giá */
export default async function FindGarage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const p = { q: one(sp.q), province: one(sp.tinh), categoryId: one(sp.nhom), lat: one(sp.lat), lng: one(sp.lng), sort: one(sp.sort) };
  const [data, cats] = await Promise.all([marketApi<{ provinces: string[]; items: ShopCard[] }>(`/shops${qs(p)}`), marketApi<Category[]>('/categories')]);
  const sel = 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm';
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Tìm garage</h1>
      <form className="flex flex-wrap items-center gap-2" data-testid="shop-filters">
        <input name="q" defaultValue={p.q} placeholder="Tên garage, địa chỉ…" aria-label="Tìm garage" className={`${sel} w-full sm:w-64`} />
        <select name="tinh" defaultValue={p.province ?? ''} aria-label="Tỉnh / thành" className={sel}>
          <option value="">Mọi tỉnh / thành</option>
          {data.provinces.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select name="nhom" defaultValue={p.categoryId ?? ''} aria-label="Có bán / làm" className={sel}>
          <option value="">Mọi sản phẩm, dịch vụ</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.parentId ? '— ' : ''}
              {c.name}
            </option>
          ))}
        </select>
        <select name="sort" defaultValue={p.sort ?? ''} aria-label="Sắp xếp" className={sel}>
          <option value="">Nhiều tin đăng</option>
          <option value="danh-gia">Đánh giá cao</option>
          {p.lat && <option value="gan">Gần nhất</option>}
        </select>
        {p.lat && <input type="hidden" name="lat" value={p.lat} />}
        {p.lng && <input type="hidden" name="lng" value={p.lng} />}
        <button className="rounded-full bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white">Lọc</button>
        <Suspense>
          <NearMe />
        </Suspense>
      </form>
      <p className="text-sm text-slate-500">{data.items.length} garage</p>
      <div className="grid gap-3 md:grid-cols-2" data-testid="shop-list">
        {data.items.map((s) => (
          <ShopCardView key={s.slug} s={s} />
        ))}
      </div>
      {!data.items.length && <p className="rounded-2xl bg-white p-8 text-center text-slate-500">Không có garage phù hợp.</p>}
    </div>
  );
}
