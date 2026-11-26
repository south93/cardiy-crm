import type { Tone } from '@cardiy/ui';

export type BookingStatus = 'CHO_XAC_NHAN' | 'DA_XAC_NHAN' | 'DA_DEN' | 'KHONG_DEN' | 'KHACH_HUY' | 'TU_CHOI';
export type BookingChannel = 'GOI_DIEN' | 'ZALO' | 'FACEBOOK' | 'TRUC_TIEP' | 'WEBSITE' | 'KHAC' | 'APP';

export const BOOKING_STATUS: Record<BookingStatus, { label: string; tone: Tone }> = {
  CHO_XAC_NHAN: { label: 'Chờ xác nhận', tone: 'peach' },
  DA_XAC_NHAN: { label: 'Đã xác nhận', tone: 'sky' },
  DA_DEN: { label: 'Đã đến', tone: 'mint' },
  KHONG_DEN: { label: 'Không đến', tone: 'rose' },
  KHACH_HUY: { label: 'Khách huỷ', tone: 'slate' },
  TU_CHOI: { label: 'Từ chối', tone: 'slate' },
};

export const CHANNELS: { value: BookingChannel; label: string }[] = [
  { value: 'GOI_DIEN', label: 'Gọi điện' },
  { value: 'ZALO', label: 'Zalo' },
  { value: 'FACEBOOK', label: 'Facebook' },
  { value: 'TRUC_TIEP', label: 'Trực tiếp' },
  { value: 'WEBSITE', label: 'Website' },
  { value: 'KHAC', label: 'Khác' },
  { value: 'APP', label: 'App chủ xe' },
];

export interface Booking {
  id: string;
  code: string;
  status: BookingStatus;
  late: boolean;
  scheduledAt: string;
  durationMin: number;
  service: string;
  note: string | null;
  channel: BookingChannel;
  reason: string | null;
  branch: { id: string; code: string; name: string };
  customer: { id: string; name: string; phone: string | null };
  vehicle: { id: string; plate: string; make: string | null; model: string | null } | null;
  technician: { id: string; name: string } | null;
  order: { id: string; code: string; status: string } | null;
}

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Tuần bắt đầu thứ Hai */
export const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const WEEKDAYS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'];
export const hhmm = (d: string | Date) => new Date(d).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
export const ddmm = (d: Date) => d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
/** Giá trị cho <input type="datetime-local"> theo giờ máy */
export const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
