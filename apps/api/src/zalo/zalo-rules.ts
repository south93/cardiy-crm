/** Zalo ZNS: sự kiện, ghép tham số mẫu tin, chuẩn hoá số điện thoại, mã hoá token (thuần, test riêng). */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { normalizeVnPhone } from '@cardiy/shared';

/** Dữ liệu CRM ghép vào tham số mẫu ZNS */
export const SOURCES = {
  customer_name: 'Tên khách',
  plate: 'Biển số xe',
  vehicle: 'Hãng / dòng xe',
  order_code: 'Mã đơn',
  order_total: 'Tổng tiền đơn',
  amount_due: 'Số tiền còn phải trả',
  booking_code: 'Mã lịch hẹn',
  booking_time: 'Giờ hẹn (08:30)',
  booking_date: 'Ngày hẹn (25/11/2026)',
  branch_name: 'Tên chi nhánh',
  branch_address: 'Địa chỉ chi nhánh',
  branch_phone: 'SĐT chi nhánh',
  garage_name: 'Tên garage',
  care_title: 'Nội dung nhắc (VD: Đăng kiểm sắp hết hạn)',
  due_date: 'Ngày đến hạn',
  otp: 'Mã OTP',
  app_link: 'Link app chủ xe',
} as const;
export type Source = keyof typeof SOURCES;

export const EVENTS = {
  OTP: { label: 'Mã OTP (đăng ký / quên mật khẩu app)', sources: ['otp', 'garage_name'] },
  BOOKING_CONFIRMED: {
    label: 'Garage xác nhận lịch hẹn',
    sources: ['customer_name', 'plate', 'booking_code', 'booking_time', 'booking_date', 'branch_name', 'branch_address', 'branch_phone', 'garage_name'],
  },
  QUOTE_SENT: { label: 'Gửi báo giá chờ khách duyệt', sources: ['customer_name', 'plate', 'order_code', 'order_total', 'branch_name', 'branch_phone', 'garage_name', 'app_link'] },
  ORDER_DONE: {
    label: 'Xe sửa xong, mời nhận xe',
    sources: ['customer_name', 'plate', 'order_code', 'order_total', 'amount_due', 'branch_name', 'branch_address', 'branch_phone', 'garage_name', 'app_link'],
  },
  CARE_REMINDER: { label: 'Nhắc bảo dưỡng / đăng kiểm / bảo hiểm', sources: ['customer_name', 'plate', 'vehicle', 'care_title', 'due_date', 'branch_name', 'branch_phone', 'garage_name', 'app_link'] },
} as const satisfies Record<string, { label: string; sources: readonly Source[] }>;
export type ZaloEvent = keyof typeof EVENTS;

export interface TemplateConfig {
  enabled: boolean;
  templateId: string;
  /** Tên tham số trong mẫu ZNS (VD customer_name) → dữ liệu CRM */
  params: { name: string; source: Source }[];
}
export interface ZaloSettings {
  enabled: boolean;
  /** development: Zalo chỉ gửi tới SĐT quản trị OA (thử mẫu, không mất phí); production: gửi thật */
  mode: 'development' | 'production';
  templates: Partial<Record<ZaloEvent, TemplateConfig>>;
}
export const DEFAULT_ZALO: ZaloSettings = { enabled: false, mode: 'development', templates: {} };

/** 0912345678 / +84912345678 → 84912345678 (định dạng Zalo yêu cầu) */
export function zaloPhone(raw: string | null | undefined): string | null {
  const p = raw ? normalizeVnPhone(raw) : null;
  return p ? `84${p.slice(1)}` : null;
}

/** Ghép template_data; thiếu dữ liệu thì trả lỗi để không gửi tin trống */
export function buildTemplateData(params: TemplateConfig['params'], ctx: Partial<Record<Source, string | number | null | undefined>>) {
  const data: Record<string, string> = {};
  const missing: string[] = [];
  for (const p of params) {
    const v = ctx[p.source];
    if (v === null || v === undefined || v === '') missing.push(`${p.name} (${SOURCES[p.source]})`);
    else data[p.name] = typeof v === 'number' ? v.toLocaleString('vi-VN') : String(v).slice(0, 200);
  }
  return { data, missing };
}

// Mã hoá token lưu CSDL: AES-256-GCM, khoá suy ra từ JWT_SECRET
const keyOf = (secret: string) => createHash('sha256').update(`zalo-token:${secret}`).digest();
export function encrypt(plain: string, secret: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}
export function decrypt(box: string, secret: string) {
  const [iv, tag, enc] = box.split('.').map((s) => Buffer.from(s, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', keyOf(secret), iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(enc!), d.final()]).toString('utf8');
}
