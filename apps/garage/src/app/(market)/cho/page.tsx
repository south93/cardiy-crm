import { ArrowRight, Search } from 'lucide-react';
import Link from 'next/link';
import { ItemCardView, ShopCardView } from '@/components/market/cards';
import { marketApi, type Category, type ItemCard, type ShopCard } from '@/lib/market';

export const dynamic = 'force-dynamic';

const API_INTERNAL = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface HomeBanner {
  id: string;
  title: string;
  subtitle: string | null;
  linkUrl: string | null;
  ctaLabel: string | null;
}

/** A1.01 Trang chủ sàn */
export default async function MarketHome() {
  const [d, homeBanners] = await Promise.all([
    marketApi<{ categories: Category[]; shops: ShopCard[]; items: ItemCard[]; stats: { shops: number } }>('/home'),
    fetch(`${API_INTERNAL}/api/public/community/banners?position=HOME`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<HomeBanner[]>) : []))
      .catch(() => [] as HomeBanner[]),
  ]);
  const roots = d.categories.filter((c) => !c.parentId);
  return (
    <div className="space-y-10">
      <section className="rounded-3xl bg-gradient-to-br from-brand-600 to-brand-700 px-6 py-10 text-white md:px-10">
        <h1 className="text-2xl font-bold md:text-3xl">Tìm garage uy tín, so giá trước khi sửa xe</h1>
        <p className="mt-2 max-w-2xl text-brand-50/90">Lốp, ắc quy, dầu nhớt, bảo dưỡng… so giá giữa {d.stats.shops} garage trên sàn. Gọi, nhắn Zalo hoặc đặt lịch trực tiếp với garage.</p>
        <form action="/cho/san-pham" className="relative mt-5 max-w-xl">
          <Search className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-slate-400" />
          <input name="q" placeholder="Tìm theo kích cỡ lốp, tên sản phẩm…" aria-label="Tìm trên sàn" className="w-full rounded-full py-3 pl-12 pr-28 text-slate-900 focus:outline-none" />
          <button className="absolute right-1.5 top-1.5 rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white">Tìm</button>
        </form>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <Link href="/cho/tim-garage" className="rounded-full bg-white/15 px-3 py-1.5 hover:bg-white/25">
            Tìm garage gần bạn
          </Link>
          <Link href="/cho/dich-vu" className="rounded-full bg-white/15 px-3 py-1.5 hover:bg-white/25">
            So giá dịch vụ
          </Link>
          <Link href="/cho/xe-cu" className="rounded-full bg-white/15 px-3 py-1.5 hover:bg-white/25" data-testid="market-used-car-cta">
            Xe cũ đã kiểm định
          </Link>
          <Link href="/cho/thue-xe" className="rounded-full bg-white/15 px-3 py-1.5 hover:bg-white/25" data-testid="market-rental-cta">
            Thuê xe tự lái
          </Link>
          <Link href="/cho/cong-dong" className="rounded-full bg-white/15 px-3 py-1.5 hover:bg-white/25" data-testid="market-community-cta">
            Cộng đồng & Sách nói
          </Link>
          <Link href="/cho/cuu-ho" className="rounded-full bg-rose-500 px-3.5 py-1.5 font-semibold text-white hover:bg-rose-600" data-testid="market-sos-cta">
            Cứu hộ SOS 24/7
          </Link>
        </div>
      </section>

      {homeBanners.length > 0 && (
        <section className="grid gap-3 md:grid-cols-2" data-testid="market-home-banners">
          {homeBanners.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-5 py-4">
              <div>
                <div className="font-semibold text-slate-900">{b.title}</div>
                {b.subtitle && <p className="mt-0.5 text-xs text-slate-600">{b.subtitle}</p>}
              </div>
              {b.linkUrl && (
                <Link href={b.linkUrl} className="rounded-full bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">
                  {b.ctaLabel ?? 'Xem ngay'}
                </Link>
              )}
            </div>
          ))}
        </section>
      )}

      {roots.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Danh mục</h2>
          <div className="flex flex-wrap gap-2" data-testid="home-categories">
            {roots.map((c) => (
              <Link
                key={c.id}
                href={`/cho/${c.kind === 'SERVICE' ? 'dich-vu' : 'san-pham'}?nhom=${c.id}`}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium hover:border-brand-200 hover:text-brand-700"
              >
                {c.name} <span className="text-slate-400">{c.items}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {d.items.length > 0 && (
        <section>
          <div className="mb-3 flex items-center">
            <h2 className="flex-1 text-lg font-semibold">Sản phẩm mới trên sàn</h2>
            <Link href="/cho/san-pham" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700">
              Xem tất cả <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {d.items.map((i) => (
              <ItemCardView key={i.code} i={i} />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center">
          <h2 className="flex-1 text-lg font-semibold">Garage trên sàn</h2>
          <Link href="/cho/tim-garage" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700">
            Tìm garage <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        {d.shops.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {d.shops.map((s) => (
              <ShopCardView key={s.slug} s={s} />
            ))}
          </div>
        ) : (
          <p className="rounded-2xl bg-white p-8 text-center text-slate-500">Sàn đang chuẩn bị, các garage sẽ sớm có mặt.</p>
        )}
      </section>

      <section className="rounded-3xl border border-brand-100 bg-brand-50 p-6 md:flex md:items-center md:gap-6">
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-brand-700">Bạn có garage?</h2>
          <p className="mt-1 text-sm text-slate-600">Đưa garage lên sàn CARDIY: khách tìm thấy, so giá và gọi / đặt lịch trực tiếp với bạn.</p>
        </div>
        <Link href="/dang-ky-doi-tac" className="mt-3 inline-block rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white md:mt-0">
          Đăng ký đối tác
        </Link>
      </section>
    </div>
  );
}
