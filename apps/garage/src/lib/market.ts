/** Web sàn công khai (/cho): gọi API phía máy chủ để trang có sẵn nội dung cho Google */

import { notFound } from 'next/navigation';

/** Trong docker, web gọi thẳng API nội bộ (http://api:4000); khi chạy máy dev dùng địa chỉ công khai */
const API = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function marketApi<T>(path: string): Promise<T> {
  const res = await fetch(`${API}/api/public/market${path}`, { cache: 'no-store' });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`Lỗi tải dữ liệu sàn (${res.status})`);
  return (await res.json()) as T;
}

export type Kind = 'PRODUCT' | 'SERVICE';
export interface Category {
  id: string;
  kind: Kind;
  name: string;
  parentId: string | null;
  items: number;
}
export interface ShopCard {
  slug: string;
  name: string;
  intro: string | null;
  phone: string | null;
  address: string | null;
  province: string | null;
  lat: number | null;
  lng: number | null;
  logoUrl: string | null;
  openNow: boolean;
  rating: { avg: number; count: number } | null;
  offers: number;
  services: number;
  distanceKm: number | null;
  bookingUrl: string | null;
  vouchers: { code: string; title: string; summary: string; endsAt: string }[];
}
export interface ItemCard {
  code: string;
  kind: Kind;
  name: string;
  brand: string | null;
  category: string | null;
  specs: { label: string; value: string }[];
  imageUrl: string | null;
  minPrice: number | null;
  sellers: number;
  inStock: boolean;
}
export interface OfferRow {
  id: string;
  kind: Kind;
  item: { code: string; name: string; brand: string | null; category: string | null; imageUrl: string | null };
  price: number;
  listPrice: number | null;
  priceFrom: boolean;
  installIncluded: boolean;
  mfgYear: number | null;
  durationMinutes: number | null;
  note: string | null;
  imageUrl: string | null;
  state: 'CON_HANG' | 'HET_HANG' | 'AN';
  available: number | null;
}
export interface ShopDetail extends ShopCard {
  coverUrl: string | null;
  openingHours: { day: number; open: string; close: string; closed: boolean }[];
  policies: { warranty: string | null; return: string | null; cancel: string | null };
  branches: { name: string; address: string | null; phone: string | null }[];
  productOffers: OfferRow[];
  serviceOffers: OfferRow[];
  reviews: { rating: number; comment: string | null; reply: string | null; createdAt: string; name: string }[];
}
export interface ItemDetail {
  code: string;
  kind: Kind;
  name: string;
  brand: string | null;
  unit: string | null;
  category: { id: string; name: string } | null;
  specs: { label: string; value: string }[];
  description: string | null;
  imageUrl: string | null;
  sellers: (OfferRow & { shop: ShopCard })[];
}

export const money = (v: number) => `${v.toLocaleString('vi-VN')} đ`;
export const itemHref = (kind: Kind, code: string) => `/cho/${kind === 'SERVICE' ? 'dich-vu' : 'san-pham'}/${encodeURIComponent(code.toLowerCase())}`;
export const zaloHref = (phone: string) => `https://zalo.me/${phone.replace(/\D/g, '')}`;
export const mapHref = (s: { lat: number | null; lng: number | null; address: string | null; name: string }) =>
  s.lat != null && s.lng != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.name} ${s.address ?? ''}`)}`;
/** Đặt lịch qua app chủ xe, điền sẵn dịch vụ / sản phẩm */
export const bookingHref = (url: string, what?: string) => (what ? `${url}?dv=${encodeURIComponent(what)}` : url);

/** Giữ vị trí (lat/lng) khi chuyển trang trong /cho */
export function qs(params: Record<string, string | number | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
export type SP = Promise<Record<string, string | string[] | undefined>>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Gửi yêu cầu đặt hàng / đặt lịch qua sàn */
export const requestHref = (offerId: string) => `/cho/dat?tin=${offerId}`;
