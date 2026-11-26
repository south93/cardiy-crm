import type { Tone } from '@cardiy/ui';
import { API_URL, ApiError } from './api';

export type SosStatus =
  | 'MOI'
  | 'DANG_TIM_GARAGE'
  | 'DA_NHAN'
  | 'KHONG_CO_GARAGE'
  | 'DANG_DEN'
  | 'TAI_HIEN_TRUONG'
  | 'XU_LY_TAI_CHO'
  | 'DANG_KEO_XE'
  | 'DA_VE_GARAGE'
  | 'HOAN_THANH'
  | 'KHACH_HUY';

export type SosIssueType =
  | 'HET_BINH'
  | 'THUNG_LOP'
  | 'CHET_MAY'
  | 'TAI_NAN'
  | 'HET_NHIEN_LIEU'
  | 'KEO_XE'
  | 'KHAC';

export const SOS_ISSUES: { value: SosIssueType; label: string }[] = [
  { value: 'HET_BINH', label: 'Hết bình / kích ắc quy' },
  { value: 'THUNG_LOP', label: 'Thủng / nổ lốp' },
  { value: 'CHET_MAY', label: 'Chết máy / không đề được' },
  { value: 'TAI_NAN', label: 'Va chạm / tai nạn' },
  { value: 'HET_NHIEN_LIEU', label: 'Hết nhiên liệu / quá nhiệt' },
  { value: 'KEO_XE', label: 'Cần xe cẩu / kéo về xưởng' },
  { value: 'KHAC', label: 'Sự cố khác' },
];

export const SOS_STATUS_UI: Record<SosStatus, { label: string; tone: Tone }> = {
  MOI: { label: 'Mới gửi', tone: 'sky' },
  DANG_TIM_GARAGE: { label: 'Đang tìm garage cứu hộ', tone: 'peach' },
  DA_NHAN: { label: 'Garage đã nhận ca', tone: 'sky' },
  KHONG_CO_GARAGE: { label: 'Chưa có garage nhận trực tuyến', tone: 'rose' },
  DANG_DEN: { label: 'Đội cứu hộ đang đến', tone: 'brand' },
  TAI_HIEN_TRUONG: { label: 'Đã tới hiện trường', tone: 'lav' },
  XU_LY_TAI_CHO: { label: 'Đang xử lý tại chỗ', tone: 'peach' },
  DANG_KEO_XE: { label: 'Đang kéo xe về garage', tone: 'peach' },
  DA_VE_GARAGE: { label: 'Xe đã về tới garage', tone: 'sky' },
  HOAN_THANH: { label: 'Hoàn thành', tone: 'mint' },
  KHACH_HUY: { label: 'Khách đã huỷ', tone: 'slate' },
};

export interface PublicRescueGarage {
  tenantId: string;
  name: string;
  slug: string | null;
  address: string | null;
  hotline: string | null;
  onDuty: boolean;
  radiusKm: number;
  basePrice: number;
  note: string | null;
  distanceKm: number | null;
  inRange: boolean | null;
}

export interface SosDetail {
  id: string;
  code: string;
  status: SosStatus;
  statusLabel: string;
  issueType: SosIssueType;
  issueLabel: string;
  customerName: string;
  phone: string;
  plateNo: string | null;
  vehicleInfo: string | null;
  lat: number;
  lng: number;
  addressText: string | null;
  description: string | null;
  customerImages: { id: string; url: string | null }[];
  sceneImages: { id: string; url: string | null }[];
  candidatesCount: number;
  searchExpiresAt: string;
  remainingSec: number;
  cancellable: boolean;
  canReview: boolean;
  etaMinutes: number | null;
  quotedPrice: number | null;
  finalPrice: number | null;
  sellerNote: string | null;
  cancelReason: string | null;
  acceptedAt: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  distanceFromGarageKm?: number | null;
  assignedGarage: {
    tenantId: string;
    tenantType: string;
    name: string;
    slug: string | null;
    hotline: string | null;
    address: string | null;
    cancelPolicy: string | null;
    branch: { id: string; code: string; name: string } | null;
  } | null;
  assignedStaff: {
    membershipId: string;
    name: string;
    phone: string;
  } | null;
  order: { id: string; code: string; status: string } | null;
  latestTrack: {
    lat: number;
    lng: number;
    note: string | null;
    at: string;
    distanceToCustomerKm: number | null;
  } | null;
  tracks: { id: string; lat: number; lng: number; note: string | null; at: string }[];
  fallbackHotlines: {
    tenantId: string;
    name: string;
    slug: string | null;
    address: string | null;
    hotline: string;
    distanceKm: number | null;
    basePrice: number;
    onDuty: boolean;
  }[];
  review: {
    id: string;
    rating: number;
    comment: string | null;
    reply: string | null;
    repliedAt: string | null;
    createdAt: string;
  } | null;
}

export async function publicSosGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}/api/public/sos${path}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, (data as { message?: string })?.message ?? `Lỗi ${res.status}`);
  }
  return data as T;
}

export async function publicSosPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/api/public/sos${path}`, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const b = (data ?? {}) as { message?: string | string[]; errors?: { field: string; message: string }[] };
    throw new ApiError(res.status, (Array.isArray(b.message) ? b.message.join(', ') : b.message) || `Lỗi ${res.status}`, undefined, b.errors);
  }
  return data as T;
}

export function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${v.toLocaleString('vi-VN')} đ`;
}

export function mapsDirectionUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
