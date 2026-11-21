import type { Tone } from '@cardiy/ui';

export type Tier = 'THUONG' | 'BAC' | 'VANG' | 'KIM_CUONG';
export type Source =
  | 'ZALO' | 'FACEBOOK' | 'TIKTOK' | 'GIOI_THIEU' | 'KHACH_CU' | 'VANG_LAI' | 'WEBSITE'
  | 'CUOC_GOI' | 'GARA' | 'CHAM_SOC_XE' | 'DAI_LY' | 'SAN_CARDIY' | 'KHAC';

export const TIERS: { value: Tier; label: string; tone: Tone }[] = [
  { value: 'THUONG', label: 'Thường', tone: 'slate' },
  { value: 'BAC', label: 'Bạc', tone: 'sky' },
  { value: 'VANG', label: 'Vàng', tone: 'peach' },
  { value: 'KIM_CUONG', label: 'Kim cương', tone: 'lav' },
];

export const SOURCES: { value: Source; label: string }[] = [
  { value: 'VANG_LAI', label: 'Vãng lai' },
  { value: 'KHACH_CU', label: 'Khách cũ' },
  { value: 'GIOI_THIEU', label: 'Khách cũ giới thiệu' },
  { value: 'ZALO', label: 'Zalo' },
  { value: 'FACEBOOK', label: 'Facebook' },
  { value: 'TIKTOK', label: 'Tiktok' },
  { value: 'WEBSITE', label: 'Website' },
  { value: 'CUOC_GOI', label: 'Cuộc gọi nhận (CSKH)' },
  { value: 'GARA', label: 'Gara' },
  { value: 'CHAM_SOC_XE', label: 'Chăm sóc xe' },
  { value: 'DAI_LY', label: 'Đại lý' },
  { value: 'SAN_CARDIY', label: 'Sàn CARDIY' },
  { value: 'KHAC', label: 'Khác' },
];

export const tierOf = (t: Tier) => TIERS.find((x) => x.value === t) ?? TIERS[0]!;
export const sourceLabel = (s: Source) => SOURCES.find((x) => x.value === s)?.label ?? s;

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });
}

export function fmtKm(km: number | null | undefined): string {
  return km === null || km === undefined ? '—' : `${km.toLocaleString('vi-VN')} km`;
}

export function fmtMoney(v: number): string {
  return `${v.toLocaleString('vi-VN')} đ`;
}

/** Số ngày còn lại tới hạn (âm = đã quá hạn). */
export function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000);
}

export function expiryTone(days: number | null): Tone {
  if (days === null) return 'slate';
  if (days < 0) return 'rose';
  if (days <= 30) return 'peach';
  return 'mint';
}

export function expiryText(days: number | null, date: string | null | undefined): string {
  if (days === null) return 'Chưa có';
  if (days < 0) return `Quá hạn ${-days} ngày`;
  if (days <= 30) return `Còn ${days} ngày`;
  return fmtDate(date);
}

export function initials(name: string): string {
  return name
    .replace(/^(anh|chị|chi|a\.|c\.|cô|chú|bác|em)\s+/i, '')
    .split(/\s+/)
    .slice(-2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export interface Paged<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}
