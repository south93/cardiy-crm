/** Máy trạng thái lịch hẹn S2 (docs/05-trang-thai.md). Thuần, để test riêng. */
export type BookingStatus = 'CHO_XAC_NHAN' | 'DA_XAC_NHAN' | 'DA_DEN' | 'KHONG_DEN' | 'KHACH_HUY' | 'TU_CHOI';

export const BOOKING_LABEL: Record<BookingStatus, string> = {
  CHO_XAC_NHAN: 'Chờ xác nhận',
  DA_XAC_NHAN: 'Đã xác nhận',
  DA_DEN: 'Đã đến',
  KHONG_DEN: 'Không đến',
  KHACH_HUY: 'Khách huỷ',
  TU_CHOI: 'Từ chối',
};

/** Còn hiệu lực (chiếm chỗ trên lịch, sửa giờ được) */
export const ACTIVE: BookingStatus[] = ['CHO_XAC_NHAN', 'DA_XAC_NHAN'];

const NEXT: Record<BookingStatus, BookingStatus[]> = {
  CHO_XAC_NHAN: ['DA_XAC_NHAN', 'TU_CHOI', 'KHACH_HUY', 'DA_DEN'],
  DA_XAC_NHAN: ['DA_DEN', 'KHONG_DEN', 'KHACH_HUY'],
  DA_DEN: [],
  KHONG_DEN: [],
  KHACH_HUY: [],
  TU_CHOI: [],
};

/** Lý do bắt buộc khi từ chối / khách huỷ */
export const NEED_REASON: BookingStatus[] = ['TU_CHOI', 'KHACH_HUY'];

export function bookingTransitionError(from: BookingStatus, to: BookingStatus): string | null {
  if (!NEXT[from].includes(to)) return `Không chuyển được lịch hẹn từ "${BOOKING_LABEL[from]}" sang "${BOOKING_LABEL[to]}"`;
  return null;
}

/** Quá giờ hẹn 60 phút mà chưa đến → gợi ý đánh dấu "Không đến" */
export function isLate(status: BookingStatus, scheduledAt: Date, now = new Date()) {
  return ACTIVE.includes(status) && now.getTime() - scheduledAt.getTime() > 60 * 60_000;
}

/** Hai khung giờ có chồng nhau không */
export function overlaps(aStart: Date, aMin: number, bStart: Date, bMin: number) {
  const a1 = aStart.getTime(), a2 = a1 + aMin * 60_000, b1 = bStart.getTime(), b2 = b1 + bMin * 60_000;
  return a1 < b2 && b1 < a2;
}
