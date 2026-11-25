/** Gọi API sàn từ trình duyệt (trang đặt yêu cầu / theo dõi) */
import { API_URL, ApiError } from './api';

export async function marketPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/api/public/market${path}`, { method: 'POST', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const b = (data ?? {}) as { message?: string | string[]; errors?: { field: string; message: string }[] };
    throw new ApiError(res.status, (Array.isArray(b.message) ? b.message.join(', ') : b.message) || `Lỗi ${res.status}`, undefined, b.errors);
  }
  return data as T;
}

export async function marketGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}/api/public/market${path}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (data as { message?: string })?.message ?? `Lỗi ${res.status}`);
  return data as T;
}

export interface Quote {
  shop: { name: string; slug: string };
  lines: { offerId: string; kind: 'PRODUCT' | 'SERVICE'; name: string; quantity: number; unitPrice: number; amount: number; installIncluded: boolean; mfgYear: number | null }[];
  subtotal: number;
  discount: number;
  total: number;
  voucher: { code: string; title: string } | null;
  voucherError: string | null;
  openingHours: { day: number; open: string; close: string; closed: boolean }[];
}

export const REQ_STATUS: Record<string, { label: string; tone: 'sky' | 'mint' | 'rose' | 'slate' | 'peach' }> = {
  CHO_XAC_NHAN: { label: 'Chờ garage xác nhận', tone: 'sky' },
  DA_XAC_NHAN: { label: 'Garage đã xác nhận', tone: 'mint' },
  HOAN_THANH: { label: 'Hoàn tất', tone: 'mint' },
  TU_CHOI: { label: 'Garage từ chối', tone: 'rose' },
  HET_HAN: { label: 'Hết hạn (garage chưa phản hồi)', tone: 'slate' },
  KHACH_HUY: { label: 'Đã huỷ', tone: 'slate' },
  KHONG_DEN: { label: 'Không đến', tone: 'peach' },
};

export const REPORT_REASONS: Record<string, string> = {
  SAI_GIA: 'Báo giá / thu tiền khác thoả thuận',
  HANG_KHONG_DUNG: 'Sản phẩm / dịch vụ không đúng mô tả',
  THAI_DO_PHUC_VU: 'Thái độ phục vụ chưa tốt',
  KHONG_LIEN_LAC_DUOC: 'Không liên lạc được với garage',
  BAO_HANH_DOI_TRA: 'Từ chối bảo hành / đổi trả đã cam kết',
  THONG_TIN_SAI: 'Thông tin gian hàng / địa chỉ sai lệch',
  KHAC: 'Vấn đề khác',
};

export const REPORT_STATUS: Record<string, { label: string; tone: 'sky' | 'mint' | 'rose' | 'slate' | 'peach' | 'lav' }> = {
  MOI: { label: 'Sàn đã tiếp nhận', tone: 'sky' },
  CHO_GIAI_TRINH: { label: 'Chờ garage giải trình', tone: 'peach' },
  DA_GIAI_TRINH: { label: 'Garage đã giải trình', tone: 'lav' },
  DA_XU_LY: { label: 'Sàn đã xử lý', tone: 'mint' },
  TU_CHOI: { label: 'Không có cơ sở', tone: 'slate' },
};

export const VIOLATION_ACTION: Record<string, { label: string; tone: 'peach' | 'rose' | 'slate' }> = {
  NHAC_NHO: { label: 'Nhắc nhở / cảnh cáo', tone: 'peach' },
  GO_TIN: { label: 'Gỡ tin đăng vi phạm', tone: 'rose' },
  TAM_KHOA: { label: 'Tạm khoá gian hàng', tone: 'rose' },
  CHAM_DUT: { label: 'Chấm dứt hợp tác', tone: 'rose' },
};

/** Các ngày tới (giờ VN) và khung giờ 30 phút trong giờ mở cửa */
export function nextDays(n = 14) {
  const out: { ymd: string; dow: number; label: string }[] = [];
  const now = new Date(Date.now() + 7 * 3_600_000);
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i));
    const ymd = d.toISOString().slice(0, 10);
    out.push({ ymd, dow: d.getUTCDay(), label: i === 0 ? 'Hôm nay' : i === 1 ? 'Ngày mai' : `${['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][d.getUTCDay()]} ${ymd.slice(8, 10)}/${ymd.slice(5, 7)}` });
  }
  return out;
}
export function slotsFor(ymd: string, dow: number, hours: Quote['openingHours']): string[] {
  const h = hours.find((x) => x.day === dow);
  const open = !hours.length ? '07:30' : h && !h.closed ? h.open : null;
  const close = !hours.length ? '17:30' : h && !h.closed ? h.close : null;
  if (!open || !close) return [];
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const earliest = Date.now() + 60 * 60_000;
  const out: string[] = [];
  for (let m = Math.ceil(toMin(open) / 30) * 30; m < toMin(close); m += 30) {
    const hm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    if (new Date(`${ymd}T${hm}:00+07:00`).getTime() >= earliest) out.push(hm);
  }
  return out;
}
