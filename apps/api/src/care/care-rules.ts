/** Luật chăm sóc khách (thuần, test riêng). Ngày tính theo giờ Việt Nam, dạng YYYY-MM-DD. */
export type CareKind = 'DANG_KIEM' | 'BAO_HIEM' | 'BAO_DUONG' | 'HOI_THAM' | 'KHAC';
export type CareStatus = 'CAN_GOI' | 'GOI_LAI' | 'XONG' | 'BO_QUA';
export type CallOutcome = 'DA_TU_VAN' | 'DAT_LICH' | 'KHONG_NGHE' | 'GOI_LAI_SAU' | 'KHONG_CAN' | 'SAI_SO';

export interface CareSettings {
  /** Gọi / gửi nhắc trước ngày hết hạn đăng kiểm bao nhiêu ngày */
  registrationDays: number;
  /** Gọi / gửi nhắc trước ngày hết hạn bảo hiểm bao nhiêu ngày */
  insuranceDays: number;
  /** Gọi / gửi nhắc trước ngày hết hạn phù hiệu xe bao nhiêu ngày */
  badgeDays: number;
  /** Bảo dưỡng lại sau bao nhiêu tháng kể từ lần giao xe gần nhất (áp dụng chung khi chưa có hạng mục riêng) */
  maintenanceMonths: number;
  /** Gọi hỏi thăm sau khi giao xe bao nhiêu ngày */
  followUpDays: number;
  /** Không nghe máy bao nhiêu lần thì bỏ qua */
  maxAttempts: number;
  /** Tự động đẩy thông báo nhắc hạn vào hộp thư App Chủ xe */
  autoAppEnabled: boolean;
  /** Tự động gửi tin Zalo ZNS (mẫu CARE_REMINDER) khi chạm mốc nhắc */
  autoZaloEnabled: boolean;
  /** Tự động gửi tin nhắn SMS Brandname khi chạm mốc nhắc */
  autoSmsEnabled: boolean;
  /** Tự động gửi SMS dự phòng nếu gửi Zalo ZNS không thành công */
  smsFallbackWhenZaloFails: boolean;
  /** Giờ gửi nhắc tự động hàng ngày theo múi giờ Việt Nam (0–23, mặc định 8h sáng) */
  sendHourVn: number;
}

export const DEFAULT_CARE: CareSettings = {
  registrationDays: 30,
  insuranceDays: 30,
  badgeDays: 30,
  maintenanceMonths: 6,
  followUpDays: 3,
  maxAttempts: 3,
  autoAppEnabled: true,
  autoZaloEnabled: false,
  autoSmsEnabled: false,
  smsFallbackWhenZaloFails: false,
  sendHourVn: 8,
};

export const KIND_LABEL: Record<CareKind, string> = {
  DANG_KIEM: 'Hạn đăng kiểm',
  BAO_HIEM: 'Hạn bảo hiểm',
  BAO_DUONG: 'Đến kỳ bảo dưỡng',
  HOI_THAM: 'Hỏi thăm sau sửa',
  KHAC: 'Khác',
};

const VN_OFFSET = 7 * 3_600_000;
/** Ngày hôm nay theo giờ Việt Nam (00:00 UTC của ngày đó, để lưu cột DATE) */
export function vnToday(now = new Date()): Date {
  const d = new Date(now.getTime() + VN_OFFSET);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
/** Ngày (theo giờ VN) của một thời điểm */
export function vnDate(t: Date): Date {
  return vnToday(t);
}
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
export function addMonths(d: Date, n: number) {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + n);
  return r;
}
export const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Kết quả cuộc gọi → trạng thái việc gọi và hạn gọi mới */
export function applyOutcome(o: CallOutcome, attempts: number, today: Date, nextAt: Date | null, max: number): { status: CareStatus; dueDate?: Date; attempts: number } {
  switch (o) {
    case 'DA_TU_VAN':
    case 'DAT_LICH':
    case 'KHONG_CAN':
      return { status: 'XONG', attempts: attempts + 1 };
    case 'SAI_SO':
      return { status: 'BO_QUA', attempts: attempts + 1 };
    case 'KHONG_NGHE': {
      const n = attempts + 1;
      return n >= max ? { status: 'BO_QUA', attempts: n } : { status: 'GOI_LAI', dueDate: addDays(today, 1), attempts: n };
    }
    case 'GOI_LAI_SAU':
      if (!nextAt || nextAt <= today) throw new RangeError('Chọn ngày gọi lại sau hôm nay');
      return { status: 'GOI_LAI', dueDate: nextAt, attempts: attempts + 1 };
  }
}

/** Ngày cần gọi cho mốc hết hạn: trước N ngày, không sớm hơn hôm nay */
export function dueBefore(expiry: Date, days: number, today: Date) {
  const d = addDays(expiry, -days);
  return d < today ? today : d;
}
