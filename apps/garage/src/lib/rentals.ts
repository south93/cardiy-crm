import type { Tone } from '@cardiy/ui';
import { API_URL, ApiError } from './api';

export type RentalListingStatus = 'NHAP' | 'CHO_DUYET' | 'DANG_CHO_THUE' | 'BI_TU_CHOI' | 'TAM_AN' | 'BI_GO';

export type RentalContractStatus =
  | 'DAT_TRUOC'
  | 'DA_XAC_MINH'
  | 'DA_KY_COC'
  | 'DANG_THUE'
  | 'QUA_HAN'
  | 'DA_TRA_XE'
  | 'DA_QUYET_TOAN'
  | 'HUY';

export const RENTAL_LISTING_UI: Record<RentalListingStatus, { label: string; tone: Tone }> = {
  NHAP: { label: 'Bản nháp', tone: 'slate' },
  CHO_DUYET: { label: 'Chờ sàn duyệt', tone: 'peach' },
  DANG_CHO_THUE: { label: 'Đang cho thuê', tone: 'mint' },
  BI_TU_CHOI: { label: 'Bị từ chối', tone: 'rose' },
  TAM_AN: { label: 'Tạm ẩn', tone: 'slate' },
  BI_GO: { label: 'Bị sàn gỡ', tone: 'rose' },
};

export const RENTAL_CONTRACT_UI: Record<RentalContractStatus, { label: string; tone: Tone }> = {
  DAT_TRUOC: { label: 'Đặt trước (chờ xác minh)', tone: 'sky' },
  DA_XAC_MINH: { label: 'Đã xác minh giấy tờ', tone: 'lav' },
  DA_KY_COC: { label: 'Đã ký HĐ & đặt cọc', tone: 'brand' },
  DANG_THUE: { label: 'Đang thuê xe', tone: 'mint' },
  QUA_HAN: { label: 'Quá hạn trả xe', tone: 'rose' },
  DA_TRA_XE: { label: 'Đã trả xe (chờ quyết toán)', tone: 'peach' },
  DA_QUYET_TOAN: { label: 'Đã quyết toán', tone: 'mint' },
  HUY: { label: 'Đã huỷ', tone: 'slate' },
};

export const TRANSMISSION_LABEL: Record<string, string> = {
  TU_DONG: 'Số tự động',
  SO_SAN: 'Số sàn',
};

export const FUEL_LABEL: Record<string, string> = {
  XANG: 'Xăng',
  DAU: 'Dầu Diesel',
  DIEN: 'Xe điện',
  HYBRID: 'Hybrid',
};

export interface RentalVehicleItem {
  id: string;
  tenantId: string;
  code: string;
  title: string;
  plateNo: string;
  make: string;
  model: string;
  year: number;
  seats: number;
  transmission: 'TU_DONG' | 'SO_SAN';
  fuel: 'XANG' | 'DAU' | 'DIEN' | 'HYBRID';
  ownerType: 'GARAGE' | 'CONSIGN';
  dailyPrice: number;
  deposit: number;
  kmLimitPerDay: number;
  overKmFee: number;
  province: string | null;
  pickupAddress: string | null;
  terms: string | null;
  description: string | null;
  status: RentalListingStatus;
  statusLabel: string;
  reviewNote: string | null;
  submittedAt: string | null;
  updatedAt: string;
  images: { id: string; url: string | null }[];
  branch: { id: string; code: string; name: string } | null;
  shop: { name: string; slug: string | null; phone: string | null; address: string | null } | null;
  estimatedTotal?: number | null;
  sellerType?: string;
  bookedSlots?: { startAt: string; endAt: string }[];
}

export interface RentalContractDetail {
  id: string;
  code: string;
  status: RentalContractStatus;
  statusLabel: string;
  allowedNext: RentalContractStatus[];
  cancellableByCustomer: boolean;
  customerName: string;
  phone: string;
  idCardNo: string | null;
  driverLicenseNo: string | null;
  kycNote: string | null;
  startAt: string;
  endAt: string;
  rentalDays: number;
  dailyPrice: number;
  depositRequired: number;
  depositPaid: number;
  baseTotal: number;
  extraFee: number;
  discount: number;
  finalTotal: number | null;
  depositRefund: number | null;
  paymentMethod: string | null;
  previewSettlement: { finalTotal: number; depositRefund: number; extraCollect: number };
  overKmSummary: { drivenKm: number; overKm: number; suggestedFee: number } | null;
  cashEntry: { id: string; code: string; amount: number } | null;
  handover: {
    km: number | null;
    fuel: number | null;
    note: string | null;
    at: string | null;
    images: { id: string; url: string | null }[];
  };
  returned: {
    km: number | null;
    fuel: number | null;
    note: string | null;
    at: string | null;
    images: { id: string; url: string | null }[];
  };
  customerNote: string | null;
  sellerNote: string | null;
  cancelReason: string | null;
  verifiedAt: string | null;
  depositSignedAt: string | null;
  settledAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  vehicle: {
    id: string;
    code: string;
    title: string;
    plateNo: string;
    seats: number;
    transmission: string;
    fuel: string;
    kmLimitPerDay: number;
    overKmFee: number;
    pickupAddress: string | null;
    terms: string | null;
  };
  garage: {
    tenantId: string;
    tenantType: string;
    name: string;
    slug: string | null;
    phone: string | null;
    address: string | null;
    branch: { id: string; code: string; name: string } | null;
  };
}

export async function publicRentalGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}/api/public/rentals${path}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, (data as { message?: string })?.message ?? `Lỗi ${res.status}`);
  }
  return data as T;
}

export async function publicRentalPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/api/public/rentals${path}`, {
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

export function fmtVnd(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${v.toLocaleString('vi-VN')} đ`;
}

/** Mặc định nhận xe 08:00 ngày mai và trả 08:00 hai ngày sau (chuỗi datetime-local theo giờ VN) */
export function defaultRentalDates() {
  const vnNow = new Date(Date.now() + 7 * 3_600_000);
  const d1 = new Date(Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate() + 1, 8, 0));
  const d2 = new Date(Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate() + 3, 8, 0));
  return {
    startLocal: d1.toISOString().slice(0, 16),
    endLocal: d2.toISOString().slice(0, 16),
  };
}

export function localInputToIso(localVal: string): string {
  return new Date(`${localVal}:00+07:00`).toISOString();
}
