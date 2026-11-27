/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import { ItemCardView, ShopCardView } from '@/components/market/cards';
import { MarketIcon, type MarketIconName } from '@/components/market/market-icons';
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

const HERO_QUICK_LINKS: { href: string; icon: MarketIconName; label: string }[] = [
  { href: '/cho/san-pham?q=Lốp', icon: 'tire', label: 'Lốp xe' },
  { href: '/cho/dich-vu', icon: 'oil', label: 'Bảo dưỡng nhanh' },
  { href: '/cho/dich-vu?q=Gầm', icon: 'shock', label: 'Gầm xe' },
  { href: '/cho/dich-vu?q=Ngoại thất', icon: 'car', label: 'Dịch vụ ngoại thất' },
];

const BENEFITS: { icon: MarketIconName; line1: string; line2: string }[] = [
  { icon: 'bolt', line1: 'Ưu tiên tiếp nhận', line2: 'khi đặt lịch' },
  { icon: 'clock', line1: 'Hoàn tất nhanh', line2: 'đúng hẹn' },
  { icon: 'shield', line1: 'Kỹ thuật chuẩn', line2: '& an toàn' },
  { icon: 'badge', line1: 'Sản phẩm chính hãng', line2: 'đầy đủ thương hiệu' },
  { icon: 'people', line1: 'Hệ thống trạm', line2: 'Bình Dương – TP.HCM – Đồng Nai' },
];

const FEATURED_SERVICES: {
  href: string;
  icon: MarketIconName;
  title: string;
  subtitle: string;
  photo: string;
}[] = [
  {
    href: '/cho/san-pham',
    icon: 'tire',
    title: 'Lốp xe',
    subtitle: 'Tra cứu lốp theo xe ›',
    photo: '/cho/images/tires.webp',
  },
  {
    href: '/cho/dich-vu',
    icon: 'oil',
    title: 'Bảo dưỡng nhanh',
    subtitle: 'Đúng chuẩn – Tiết kiệm thời gian ›',
    photo: '/cho/images/maintenance.webp',
  },
  {
    href: '/cho/dich-vu?q=Gầm',
    icon: 'shock',
    title: 'Gầm xe',
    subtitle: 'Êm hơn – An toàn hơn ›',
    photo: '/cho/images/suspension.webp',
  },
  {
    href: '/cho/dich-vu?q=Ngoại thất',
    icon: 'car',
    title: 'Dịch vụ ngoại thất',
    subtitle: 'Sạch – Bền – Giữ giá trị xe ›',
    photo: '/cho/images/exterior.webp',
  },
];

/** A1.01 Trang chủ Sàn CARDIY (/cho) */
export default async function MarketHome() {
  const [d, homeBanners] = await Promise.all([
    marketApi<{ categories: Category[]; shops: ShopCard[]; items: ItemCard[]; stats: { shops: number } }>('/home'),
    fetch(`${API_INTERNAL}/api/public/community/banners?position=HOME`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<HomeBanner[]>) : []))
      .catch(() => [] as HomeBanner[]),
  ]);
  const roots = d.categories.filter((c) => !c.parentId);

  return (
    <div>
      {/* 1. Hero Banner tràn viền chuẩn thiết kế CARDIY */}
      <section className="cd-hero">
        <div className="cd-hero-art" aria-hidden="true" />
        <div className="cd-wrap cd-hero-inner">
          <div className="cd-hero-copy">
            <p className="cd-hero-kicker">Một điểm đến – đa dịch vụ</p>
            <h1 className="cd-hero-title">
              Nâng Tầm
              <br />
              Trải Nghiệm Lái
            </h1>

            <div className="cd-quick">
              {HERO_QUICK_LINKS.map((q) => (
                <Link key={q.label} href={q.href}>
                  <MarketIcon name={q.icon} className="h-9 w-9 md:h-11 md:w-11" />
                  <span className="cd-quick-label">{q.label}</span>
                </Link>
              ))}
            </div>

            <div className="cd-actions">
              <Link href="/cho/dich-vu" className="cd-yellow">
                <MarketIcon name="calendar" className="h-5 w-5" />
                Đặt lịch dịch vụ ngay
                <MarketIcon name="chevron" className="h-4 w-4" />
              </Link>
              <Link href="/cho/tim-garage" className="cd-outline">
                <MarketIcon name="pin" className="h-5 w-5" />
                Tìm trạm CARDIY
                <MarketIcon name="chevron" className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Nội dung chính trên nền trắng, mở đầu bằng dải 5 Lợi ích nổi */}
      <div className="cd-wrap cd-content">
        <section className="cd-benefits" aria-label="Lợi ích">
          {BENEFITS.map((b) => (
            <div key={b.line1} className="cd-benefit-item">
              <MarketIcon name={b.icon} className="cd-benefit-icon" />
              <strong>
                {b.line1}
                <br />
                {b.line2}
              </strong>
            </div>
          ))}
        </section>

        {/* 3. Dịch vụ nổi bật tại CARDIY (4 thẻ ảnh nền chuẩn thiết kế) */}
        <section id="services">
          <div className="cd-section-head">
            <h2 className="cd-section-title">Dịch vụ nổi bật tại CARDIY</h2>
            <Link href="/cho/dich-vu" className="cd-section-more">
              Xem bảng giá dịch vụ
              <MarketIcon name="chevron" className="h-4 w-4" />
            </Link>
          </div>
          <div className="cd-service-grid">
            {FEATURED_SERVICES.map((s) => (
              <Link
                key={s.title}
                href={s.href}
                className="cd-service-card"
                style={{ backgroundImage: `url('${s.photo}')` }}
              >
                <MarketIcon name={s.icon} className="mb-1 h-8 w-8 md:h-9 md:w-9" />
                <span>
                  <strong>{s.title}</strong>
                  <small>{s.subtitle}</small>
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* 4. Dải Promo Lốp & Thương hiệu chính hãng */}
        <section id="offers" className="cd-promo">
          <img className="cd-promo-tires" src="/cho/images/tire-promo.webp" alt="Lốp ô tô" />
          <div className="cd-brand-area">
            <img
              src="/cho/images/brands.webp"
              alt="Michelin, Bridgestone, Kumho, Yokohama, Hankook, Goodyear"
            />
          </div>
          <strong className="cd-promo-copy">
            Ưu đãi lốp chính hãng
            <br />
            An tâm trên mọi hành trình
          </strong>
          <Link href="/cho/san-pham" className="cd-yellow cd-promo-btn">
            Xem ngay
            <MarketIcon name="chevron" className="h-4 w-4" />
          </Link>
        </section>

        {/* 5. Banner sự kiện / chiến dịch động từ quản trị sàn (nếu có) */}
        {homeBanners.length > 0 && (
          <section className="mt-6 grid gap-3.5 md:grid-cols-2" data-testid="market-home-banners">
            {homeBanners.map((b) => (
              <div
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#073477]/15 bg-gradient-to-r from-[#eef5fc] to-white px-5 py-4 shadow-sm"
              >
                <div>
                  <div className="font-bold text-[#091b3a]">{b.title}</div>
                  {b.subtitle && <p className="mt-0.5 text-xs text-slate-600">{b.subtitle}</p>}
                </div>
                {b.linkUrl && (
                  <Link
                    href={b.linkUrl}
                    className="rounded-full bg-[#073477] px-4 py-1.5 text-xs font-bold text-[#ffd400] transition hover:bg-[#0962ba] hover:text-white"
                  >
                    {b.ctaLabel ?? 'Xem ngay'}
                  </Link>
                )}
              </div>
            ))}
          </section>
        )}

        {/* 6. Tiện ích mở rộng trên hệ sinh thái CARDIY */}
        <section className="cd-eco-grid" aria-label="Tiện ích hệ sinh thái">
          <Link href="/cho/cuu-ho" className="cd-eco-card" data-testid="market-sos-cta">
            <span className="cd-eco-badge sos">
              <MarketIcon name="headset" className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-rose-700">Cứu hộ SOS 24/7</div>
              <p className="truncate text-xs text-slate-600">Kích bình, vá lốp, kéo xe khẩn cấp</p>
            </div>
            <MarketIcon name="chevron" className="h-4 w-4 text-slate-400" />
          </Link>

          <Link href="/cho/xe-cu" className="cd-eco-card" data-testid="market-used-car-cta">
            <span className="cd-eco-badge">
              <MarketIcon name="shield" className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-[#091b3a]">Xe cũ đã kiểm định</div>
              <p className="truncate text-xs text-slate-600">Minh bạch lịch sử bảo dưỡng tại trạm</p>
            </div>
            <MarketIcon name="chevron" className="h-4 w-4 text-slate-400" />
          </Link>

          <Link href="/cho/thue-xe" className="cd-eco-card" data-testid="market-rental-cta">
            <span className="cd-eco-badge">
              <MarketIcon name="car" className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-[#091b3a]">Thuê xe tự lái</div>
              <p className="truncate text-xs text-slate-600">Đặt xe nhanh, giao nhận linh hoạt</p>
            </div>
            <MarketIcon name="chevron" className="h-4 w-4 text-slate-400" />
          </Link>

          <Link href="/cho/cong-dong" className="cd-eco-card" data-testid="market-community-cta">
            <span className="cd-eco-badge">
              <MarketIcon name="people" className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-[#091b3a]">Cộng đồng &amp; Sách nói</div>
              <p className="truncate text-xs text-slate-600">Kinh nghiệm chăm xe &amp; audio trên đường</p>
            </div>
            <MarketIcon name="chevron" className="h-4 w-4 text-slate-400" />
          </Link>
        </section>

        {/* 7. Danh mục tra cứu nhanh từ dữ liệu thật */}
        {roots.length > 0 && (
          <section className="mt-8">
            <div className="mb-3 text-sm font-bold uppercase tracking-wider text-[#073477]">
              Danh mục tra cứu nhanh
            </div>
            <div className="flex flex-wrap gap-2" data-testid="home-categories">
              {roots.map((c) => (
                <Link
                  key={c.id}
                  href={`/cho/${c.kind === 'SERVICE' ? 'dich-vu' : 'san-pham'}?nhom=${c.id}`}
                  className="rounded-full border border-slate-200 bg-[#f8fafd] px-4 py-2 text-sm font-semibold text-[#091b3a] transition hover:border-[#073477] hover:bg-[#073477] hover:text-white"
                >
                  {c.name} <span className="ml-1 text-xs opacity-65">({c.items})</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* 8. Sản phẩm mới trên sàn */}
        {d.items.length > 0 && (
          <section>
            <div className="cd-section-head">
              <h2 className="cd-section-title">Sản phẩm &amp; phụ tùng chính hãng</h2>
              <Link href="/cho/san-pham" className="cd-section-more">
                Xem tất cả sản phẩm
                <MarketIcon name="chevron" className="h-4 w-4" />
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
              {d.items.map((i) => (
                <ItemCardView key={i.code} i={i} />
              ))}
            </div>
          </section>
        )}

        {/* 9. Hệ thống trạm & garage uy tín trên sàn */}
        <section>
          <div className="cd-section-head">
            <h2 className="cd-section-title">Tìm garage uy tín trên sàn CARDIY</h2>
            <Link href="/cho/tim-garage" className="cd-section-more">
              Tất cả {d.stats.shops} trạm &amp; garage
              <MarketIcon name="chevron" className="h-4 w-4" />
            </Link>
          </div>
          {d.shops.length ? (
            <div className="grid gap-3.5 md:grid-cols-2">
              {d.shops.map((s) => (
                <ShopCardView key={s.slug} s={s} />
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-slate-200 bg-[#f8fafd] p-8 text-center text-slate-500">
              Hệ thống trạm &amp; garage đang cập nhật danh sách trực tuyến.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
