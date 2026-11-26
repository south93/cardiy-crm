import { bookingTransitionError, isLate, overlaps } from './booking-rules';

describe('Luật lịch hẹn', () => {
  it('chuyển trạng thái theo sơ đồ S2', () => {
    expect(bookingTransitionError('CHO_XAC_NHAN', 'DA_XAC_NHAN')).toBeNull();
    expect(bookingTransitionError('CHO_XAC_NHAN', 'TU_CHOI')).toBeNull();
    expect(bookingTransitionError('DA_XAC_NHAN', 'DA_DEN')).toBeNull();
    expect(bookingTransitionError('DA_XAC_NHAN', 'KHONG_DEN')).toBeNull();
    expect(bookingTransitionError('CHO_XAC_NHAN', 'KHONG_DEN')).toMatch(/Không chuyển được/);
    expect(bookingTransitionError('DA_XAC_NHAN', 'TU_CHOI')).toMatch(/Không chuyển được/);
    expect(bookingTransitionError('DA_DEN', 'KHACH_HUY')).toMatch(/Không chuyển được/);
  });

  it('quá giờ 60 phút; chồng giờ', () => {
    const t = new Date('2026-11-21T08:00:00Z');
    expect(isLate('DA_XAC_NHAN', t, new Date('2026-11-21T09:01:00Z'))).toBe(true);
    expect(isLate('DA_XAC_NHAN', t, new Date('2026-11-21T08:59:00Z'))).toBe(false);
    expect(isLate('DA_DEN', t, new Date('2026-11-21T12:00:00Z'))).toBe(false);
    expect(overlaps(t, 60, new Date('2026-11-21T08:30:00Z'), 30)).toBe(true);
    expect(overlaps(t, 60, new Date('2026-11-21T09:00:00Z'), 30)).toBe(false);
  });
});
