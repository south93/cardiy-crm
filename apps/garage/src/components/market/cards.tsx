/* eslint-disable @next/next/no-img-element -- ảnh là link có chữ ký, hết hạn sau 1 giờ: không tối ưu qua next/image */
import { Clock, MapPin, Navigation, Phone, Star } from 'lucide-react';
import Link from 'next/link';
import { itemHref, mapHref, money, zaloHref, type ItemCard, type ShopCard } from '@/lib/market';

export function Stars({ value, count }: { value: number; count?: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm" aria-label={`${value} trên 5 sao`}>
      <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
      <span className="font-semibold">{value.toFixed(1)}</span>
      {count !== undefined && <span className="text-slate-500">({count})</span>}
    </span>
  );
}

export function OpenBadge({ open }: { open: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${open ? 'text-emerald-700' : 'text-slate-500'}`}>
      <Clock className="h-3.5 w-3.5" />
      {open ? 'Đang mở cửa' : 'Đã đóng cửa'}
    </span>
  );
}

/** Nút liên hệ garage: gọi, Zalo, chỉ đường (+ đặt lịch nếu có) */
export function ContactButtons({ shop, what, compact }: { shop: ShopCard; what?: string; compact?: boolean }) {
  const size = compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm';
  const btn = `inline-flex items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white font-medium text-slate-700 hover:border-brand-200 hover:text-brand-700 ${size}`;
  const primary = `inline-flex items-center justify-center gap-1.5 rounded-full bg-brand-600 font-semibold text-white hover:bg-brand-700 ${size}`;
  return (
    <div className="flex flex-wrap gap-2">
      {shop.bookingUrl && (
        <a href={`${shop.bookingUrl}${what ? `?dv=${encodeURIComponent(what)}` : ''}`} className={primary} data-testid="book-button">
          Đặt lịch
        </a>
      )}
      {shop.phone && (
        <a href={`tel:${shop.phone}`} className={btn}>
          <Phone className="h-4 w-4" /> Gọi
        </a>
      )}
      {shop.phone && (
        <a href={zaloHref(shop.phone)} target="_blank" rel="noreferrer" className={btn}>
          Zalo
        </a>
      )}
      <a href={mapHref(shop)} target="_blank" rel="noreferrer" className={btn}>
        <Navigation className="h-4 w-4" /> Chỉ đường
      </a>
    </div>
  );
}

export function ShopCardView({ s }: { s: ShopCard }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm" data-testid="shop-card">
      <Link href={`/cho/garage/${s.slug}`} className="flex gap-3">
        {s.logoUrl ? (
          <img src={s.logoUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
        ) : (
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-brand-50 text-lg font-bold text-brand-700">{s.name.slice(0, 1)}</span>
        )}
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-900 hover:text-brand-700">{s.name}</h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {s.rating && <Stars value={s.rating.avg} count={s.rating.count} />}
            <OpenBadge open={s.openNow} />
            {s.distanceKm !== null && <span className="text-xs font-medium text-brand-700">{s.distanceKm.toLocaleString('vi-VN')} km</span>}
          </div>
          {s.address && (
            <p className="mt-1 flex items-start gap-1 text-xs text-slate-500">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {s.address}
            </p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            {s.offers} sản phẩm · {s.services} dịch vụ
          </p>
        </div>
      </Link>
      <ContactButtons shop={s} compact />
    </div>
  );
}

export function ItemCardView({ i }: { i: ItemCard }) {
  return (
    <Link href={itemHref(i.kind, i.code)} className="flex flex-col rounded-2xl border border-slate-200/70 bg-white p-3 shadow-sm hover:border-brand-200" data-testid="item-card">
      <div className="grid aspect-square place-items-center overflow-hidden rounded-xl bg-slate-100">
        {i.imageUrl ? <img src={i.imageUrl} alt={i.name} className="h-full w-full object-cover" /> : <span className="px-2 text-center text-xs text-slate-400">{i.brand ?? i.category ?? ''}</span>}
      </div>
      <h3 className="mt-2 line-clamp-2 text-sm font-medium text-slate-900">{i.name}</h3>
      {i.minPrice !== null && (
        <div className="mt-1 text-sm">
          <span className="text-slate-500">{i.kind === 'SERVICE' || i.sellers > 1 ? 'từ ' : ''}</span>
          <span className="font-bold text-brand-700">{money(i.minPrice)}</span>
        </div>
      )}
      <div className="mt-auto pt-1 text-xs text-slate-500">
        {i.sellers} garage {i.kind === 'PRODUCT' && !i.inStock && <span className="text-rose-600">· tạm hết hàng</span>}
      </div>
    </Link>
  );
}
