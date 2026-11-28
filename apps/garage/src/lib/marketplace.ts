import type { Tone } from '@cardiy/ui';
import { api } from './api';
import { convertImageToWebp } from './image-webp';

export type CatalogKind = 'PRODUCT' | 'SERVICE';

export interface CatalogCategory {
  id: string;
  kind: CatalogKind;
  name: string;
  parentId: string | null;
  sortOrder: number;
  items: number;
}

export interface CatalogItem {
  id: string;
  kind: CatalogKind;
  code: string;
  name: string;
  categoryId: string | null;
  category: string | null;
  brand: string | null;
  unit: string | null;
  specs: { label: string; value: string }[];
  description: string | null;
  imageFileId: string | null;
  imageUrl: string | null;
  active: boolean;
}

export type OfferStatus = 'NHAP' | 'CHO_DUYET' | 'DANG_BAN' | 'BI_TU_CHOI' | 'TAM_AN' | 'BI_GO';
export const OFFER_STATUS: Record<OfferStatus, { label: string; tone: Tone }> = {
  NHAP: { label: 'Nháp', tone: 'slate' },
  CHO_DUYET: { label: 'Chờ sàn duyệt', tone: 'sky' },
  DANG_BAN: { label: 'Đang bán', tone: 'mint' },
  BI_TU_CHOI: { label: 'Bị từ chối', tone: 'rose' },
  TAM_AN: { label: 'Tạm ẩn', tone: 'peach' },
  BI_GO: { label: 'Bị gỡ', tone: 'rose' },
};

export interface Offer {
  id: string;
  kind: CatalogKind;
  status: OfferStatus;
  catalogItem: CatalogItem;
  product: { id: string; code: string; name: string; salePrice: number | null } | null;
  manualStock: number | null;
  stock: number | null;
  publicState: 'CON_HANG' | 'HET_HANG' | 'AN';
  branchIds: string[];
  price: number;
  listPrice: number | null;
  priceFrom: boolean;
  installIncluded: boolean;
  mfgYear: number | null;
  durationMinutes: number | null;
  note: string | null;
  images: { id: string; url: string | null }[];
  reviewNote: string | null;
  submittedAt: string | null;
  updatedAt: string;
  seller?: string;
  sellerType?: string | null;
}

export interface OpeningDay {
  day: number;
  open: string;
  close: string;
  closed: boolean;
}
export const DAY_NAMES = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
/** Mặc định: T2–T7 7:30–17:30, CN nghỉ */
export const defaultHours = (): OpeningDay[] => [1, 2, 3, 4, 5, 6, 0].map((day) => ({ day, open: day ? '07:30' : '', close: day ? '17:30' : '', closed: day === 0 }));
/** Sắp T2 → CN, đủ 7 ngày */
export function fullWeek(h: OpeningDay[]): OpeningDay[] {
  const base = defaultHours();
  return base.map((d) => h.find((x) => x.day === d.day) ?? { ...d, closed: true, open: '', close: '' });
}

export interface ShopInfo {
  saved: boolean;
  shop: {
    name: string;
    slug: string | null;
    intro: string | null;
    phone: string | null;
    address: string | null;
    province: string | null;
    lat: number | null;
    lng: number | null;
    openingHours: OpeningDay[];
    returnPolicy: string | null;
    warrantyPolicy: string | null;
    cancelPolicy: string | null;
    logoFileId: string | null;
    coverFileId: string | null;
    logoUrl: string | null;
    coverUrl: string | null;
  };
  tenantStatus: string;
  tenantType: string;
  liveOffers: number;
  missing: string[];
  branches: { id: string; code: string; name: string }[];
}

/** Tải ảnh lên (ảnh của garage / sàn), trả id + link xem */
export async function uploadImage(file: File) {
  const webpFile = await convertImageToWebp(file);
  const form = new FormData();
  form.append('file', webpFile);
  return api<{ id: string; url: string }>('/files', { form });
}

/** "10.9625, 106.8862" hoặc link Google Maps (…@10.96,106.88… / ?q=10.96,106.88) → toạ độ */
export function parseLatLng(s: string): { lat: number; lng: number } | null {
  const m = s.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
