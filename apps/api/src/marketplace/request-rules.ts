/** Quy tắc yêu cầu đặt hàng từ sàn & voucher (thuần, test riêng) */
import type { OpeningDay } from './offer-rules';

export type RequestStatus = 'CHO_XAC_NHAN' | 'DA_XAC_NHAN' | 'HOAN_THANH' | 'TU_CHOI' | 'HET_HAN' | 'KHACH_HUY' | 'KHONG_DEN';

/** Chờ garage xác nhận tối đa 24 giờ, quá thì tự hết hạn và nhả tồn */
export const REQUEST_TTL_HOURS = 24;
/** Đặt hẹn xa nhất 30 ngày, sớm nhất sau 1 giờ */
export const MAX_DAYS_AHEAD = 30;
export const MIN_LEAD_MINUTES = 60;
/** Yêu cầu đang giữ tồn */
export const HOLDING: RequestStatus[] = ['CHO_XAC_NHAN', 'DA_XAC_NHAN'];

const FLOW: Record<RequestStatus, RequestStatus[]> = {
  CHO_XAC_NHAN: ['DA_XAC_NHAN', 'TU_CHOI', 'HET_HAN', 'KHACH_HUY'],
  DA_XAC_NHAN: ['HOAN_THANH', 'KHACH_HUY', 'KHONG_DEN', 'TU_CHOI'],
  HOAN_THANH: [],
  TU_CHOI: [],
  HET_HAN: [],
  KHACH_HUY: [],
  KHONG_DEN: [],
};
export const canMoveRequest = (from: RequestStatus, to: RequestStatus) => FLOW[from].includes(to);

export interface VoucherLike {
  kind: 'PERCENT' | 'AMOUNT';
  value: number;
  minOrder: number;
  maxDiscount: number | null;
  appliesTo: string;
  startsAt: Date;
  endsAt: Date;
  usageLimit: number | null;
  active: boolean;
}

/**
 * Số tiền giảm của voucher cho các dòng yêu cầu. Trả về lỗi (tiếng Việt) nếu không dùng được.
 * Chỉ tính trên dòng đúng loại (ALL / PRODUCT / SERVICE); giảm không vượt quá tiền các dòng đó.
 */
export function voucherDiscount(v: VoucherLike, lines: { kind: string; amount: number }[], used: number, now = new Date()): { discount: number } | { error: string } {
  if (!v.active || now < v.startsAt || now > v.endsAt) return { error: 'Voucher đã hết hạn hoặc chưa đến ngày dùng' };
  if (v.usageLimit !== null && used >= v.usageLimit) return { error: 'Voucher đã hết lượt dùng' };
  const base = lines.filter((l) => v.appliesTo === 'ALL' || l.kind === v.appliesTo).reduce((s, l) => s + l.amount, 0);
  if (base <= 0) return { error: v.appliesTo === 'SERVICE' ? 'Voucher chỉ áp dụng cho dịch vụ' : 'Voucher chỉ áp dụng cho sản phẩm' };
  if (base < v.minOrder) return { error: `Đơn tối thiểu ${v.minOrder.toLocaleString('vi-VN')} đ để dùng voucher` };
  let d = v.kind === 'PERCENT' ? Math.floor((base * v.value) / 100) : v.value;
  if (v.kind === 'PERCENT' && v.maxDiscount !== null) d = Math.min(d, v.maxDiscount);
  return { discount: Math.min(d, base) };
}

/** Giờ hẹn hợp lệ: tương lai (≥ 1 giờ), trong 30 ngày, đúng giờ mở cửa của garage (nếu garage có nhập giờ) */
export function checkSchedule(at: Date, hours: OpeningDay[], now = new Date()): string | null {
  if (at.getTime() < now.getTime() + MIN_LEAD_MINUTES * 60_000) return 'Chọn giờ hẹn sau thời điểm hiện tại ít nhất 1 giờ';
  if (at.getTime() > now.getTime() + MAX_DAYS_AHEAD * 86_400_000) return `Chỉ đặt hẹn trong ${MAX_DAYS_AHEAD} ngày tới`;
  if (!hours.length) return null;
  const vn = new Date(at.getTime() + 7 * 3_600_000);
  const d = hours.find((h) => h.day === vn.getUTCDay());
  if (!d || d.closed) return 'Garage nghỉ ngày này, vui lòng chọn ngày khác';
  const hm = `${String(vn.getUTCHours()).padStart(2, '0')}:${String(vn.getUTCMinutes()).padStart(2, '0')}`;
  if (hm < d.open || hm >= d.close) return `Garage mở cửa ${d.open} – ${d.close} ngày này`;
  return null;
}
