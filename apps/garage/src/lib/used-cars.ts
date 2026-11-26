import type { Tone } from '@cardiy/ui';
import { API_URL, ApiError } from './api';
import { ownerApi } from './owner';

export type UsedCarListingStatus =
  | 'NHAP'
  | 'CHO_DUYET'
  | 'DANG_BAN'
  | 'BI_TU_CHOI'
  | 'TAM_AN'
  | 'DA_BAN'
  | 'HET_HAN'
  | 'BI_GO';

export type UsedCarAppraisalStatus =
  | 'CHO_XAC_NHAN'
  | 'DA_HEN'
  | 'DANG_KIEM_DINH'
  | 'HOAN_THANH'
  | 'TU_CHOI'
  | 'HUY';

export type AppraisalGrade = 'DAT_CHUAN' | 'LUU_Y' | 'KHONG_DAT';

export type ChecklistItemStatus = 'TOT' | 'LUU_Y' | 'KHONG_DAT';

export const USED_CAR_LISTING_UI: Record<UsedCarListingStatus, { label: string; tone: Tone }> = {
  NHAP: { label: 'Bản nháp', tone: 'slate' },
  CHO_DUYET: { label: 'Chờ sàn duyệt', tone: 'peach' },
  DANG_BAN: { label: 'Đang đăng bán', tone: 'mint' },
  BI_TU_CHOI: { label: 'Bị từ chối', tone: 'rose' },
  TAM_AN: { label: 'Tạm ẩn', tone: 'slate' },
  DA_BAN: { label: 'Đã bán', tone: 'brand' },
  HET_HAN: { label: 'Hết hạn (60 ngày)', tone: 'peach' },
  BI_GO: { label: 'Bị sàn gỡ', tone: 'rose' },
};

export const APPRAISAL_STATUS_UI: Record<UsedCarAppraisalStatus, { label: string; tone: Tone }> = {
  CHO_XAC_NHAN: { label: 'Chờ xác nhận', tone: 'sky' },
  DA_HEN: { label: 'Đã hẹn lịch', tone: 'lav' },
  DANG_KIEM_DINH: { label: 'Đang kiểm định', tone: 'peach' },
  HOAN_THANH: { label: 'Đã hoàn tất', tone: 'mint' },
  TU_CHOI: { label: 'Từ chối', tone: 'rose' },
  HUY: { label: 'Đã huỷ', tone: 'slate' },
};

export const APPRAISAL_GRADE_UI: Record<AppraisalGrade, { label: string; tone: Tone }> = {
  DAT_CHUAN: { label: 'Đạt chuẩn kiểm định', tone: 'mint' },
  LUU_Y: { label: 'Có hạng mục lưu ý', tone: 'peach' },
  KHONG_DAT: { label: 'Không đạt kiểm định', tone: 'rose' },
};

export type ViewingStatus = 'NONE' | 'CHO_XAC_NHAN' | 'DA_XAC_NHAN' | 'TU_CHOI';

export const VIEWING_STATUS_UI: Record<ViewingStatus, { label: string; tone: Tone }> = {
  NONE: { label: 'Chưa hẹn ngày xem', tone: 'slate' },
  CHO_XAC_NHAN: { label: 'Chờ xác nhận lịch xem xe', tone: 'peach' },
  DA_XAC_NHAN: { label: 'Đã xác nhận lịch xem xe', tone: 'mint' },
  TU_CHOI: { label: 'Từ chối lịch xem xe', tone: 'rose' },
};

export const BODY_STYLE_LABEL: Record<string, string> = {
  SEDAN: 'Sedan',
  SUV_CUV: 'SUV / CUV',
  HATCHBACK: 'Hatchback',
  MPV: 'MPV đa dụng',
  PICKUP: 'Bán tải',
  OTHER: 'Khác',
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

export interface AppraisalChecklistItem {
  key: string;
  group: string;
  label: string;
  maxPoints: number;
  status: ChecklistItemStatus;
  note: string | null;
}

export interface UsedCarAppraisalItem {
  id: string;
  code: string;
  listingId: string;
  status: UsedCarAppraisalStatus;
  statusLabel: string;
  scheduledAt: string;
  quotedFee: number;
  finalFee: number | null;
  paymentMethod: string | null;
  cashEntry: { id: string; code: string; amount: number } | null;
  checklist: AppraisalChecklistItem[];
  noMajorAccident: boolean;
  noFloodDamage: boolean;
  validDocuments: boolean;
  inspectedMileageKm: number | null;
  score: number | null;
  grade: AppraisalGrade | null;
  gradeLabel: string | null;
  summary: string | null;
  customerNote: string | null;
  rejectReason: string | null;
  completedAt: string | null;
  createdAt: string;
  assignedMemberId: string | null;
  assigneeName: string | null;
  reportImages: { id: string; url: string | null }[];
  garage: {
    tenantId: string;
    name: string;
    slug: string | null;
    phone: string | null;
    address: string | null;
    branch: { id: string; code: string; name: string } | null;
  };
  listing?: UsedCarListingItem;
}

export interface UsedCarListingItem {
  id: string;
  code: string;
  sellerType: 'OWNER' | 'GARAGE';
  title: string;
  plateNo: string | null;
  vin: string | null;
  make: string;
  model: string;
  year: number;
  mileageKm: number;
  bodyStyle: string;
  transmission: 'TU_DONG' | 'SO_SAN';
  fuel: 'XANG' | 'DAU' | 'DIEN' | 'HYBRID';
  exteriorColor: string | null;
  seats: number;
  ownersCount: number;
  price: number;
  negotiable: boolean;
  province: string;
  addressText: string | null;
  contactName: string;
  contactPhone: string;
  description: string | null;
  hasVerifiedBadge: boolean;
  status: UsedCarListingStatus;
  statusLabel: string;
  reviewNote: string | null;
  publishedAt: string | null;
  expiresAt: string | null;
  soldAt: string | null;
  viewsCount: number;
  createdAt: string;
  updatedAt: string;
  saved: boolean;
  threadsCount: number;
  images: { id: string; url: string | null }[];
  docImages: { id: string; url: string | null }[];
  branch: { id: string; code: string; name: string } | null;
  sellerShop: {
    tenantId: string;
    tenantType: string;
    name: string;
    slug: string | null;
  } | null;
  appraisalReport: UsedCarAppraisalItem | null;
  appraisals?: UsedCarAppraisalItem[];
}

export interface AppraisalGarageItem {
  tenantId: string;
  tenantType: string;
  name: string;
  slug: string | null;
  phone: string | null;
  address: string | null;
  province: string | null;
  fee: number;
  note: string | null;
}

export interface UsedCarThreadItem {
  id: string;
  listingId: string;
  buyerName: string;
  buyerPhone: string;
  viewingAt: string | null;
  viewingStatus: 'NONE' | 'CHO_XAC_NHAN' | 'DA_XAC_NHAN' | 'TU_CHOI';
  lastMessageAt: string;
  createdAt: string;
  myRole?: 'BUYER' | 'SELLER';
  listing: {
    id: string;
    code: string;
    title: string;
    price: number;
    province: string;
    contactName: string;
    contactPhone: string;
    status: string;
    hasVerifiedBadge: boolean;
  };
  messages: {
    id: string;
    senderRole: 'BUYER' | 'SELLER';
    senderName: string;
    content: string;
    createdAt: string;
  }[];
}

export function fmtVnd(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toLocaleString('vi-VN')} đ`;
}

/** Hiển thị giá xe thân thiện kiểu Việt Nam (VD: 735 triệu, 1,25 tỷ) */
export function fmtCarPrice(n: number): string {
  if (n >= 1_000_000_000) {
    const ty = Math.floor(n / 1_000_000_000);
    const trieu = Math.round((n % 1_000_000_000) / 1_000_000);
    return trieu > 0 ? `${ty} tỷ ${trieu} triệu` : `${ty} tỷ`;
  }
  if (n >= 1_000_000) {
    return `${Math.round(n / 1_000_000).toLocaleString('vi-VN')} triệu`;
  }
  return fmtVnd(n);
}

export function defaultInspectionDateTime(): string {
  const d = new Date(Date.now() + 86_400_000);
  d.setHours(9, 0, 0, 0);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

export function localInputToIso(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}

export async function publicUsedCarGet<T>(path: string): Promise<T> {
  const sep = path.startsWith('/') ? '' : '/';
  const suffix = path === '' ? '' : `${sep}${path}`;
  const res = await fetch(`${API_URL}/api/public/used-cars${suffix}`, { cache: 'no-store' });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.message ?? 'Lỗi tải dữ liệu xe cũ', data?.details);
  return data as T;
}

export async function publicUsedCarPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/api/public/used-cars${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.message ?? 'Gửi yêu cầu thất bại', data?.details);
  return data as T;
}

export async function ownerUploadUsedCarPhoto(file: File): Promise<{ id: string }> {
  const form = new FormData();
  form.append('file', file);
  return ownerApi<{ id: string }>('/used-cars/upload', { form });
}
