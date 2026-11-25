import {
  canEditReview,
  canMoveReport,
  canReviewRequest,
  checkViolationAction,
  combineRating,
  ratePercent,
  statsWindow,
  vnYmd,
} from './review-report-rules';

describe('review-report-rules (Vòng 3.5)', () => {
  it('chỉ cho đánh giá khi yêu cầu đã hoàn tất; sửa được khi chưa trả lời và chưa bị ẩn', () => {
    expect(canReviewRequest('HOAN_THANH')).toBe(true);
    for (const s of ['CHO_XAC_NHAN', 'DA_XAC_NHAN', 'TU_CHOI', 'HET_HAN', 'KHACH_HUY', 'KHONG_DEN']) {
      expect(canReviewRequest(s)).toBe(false);
    }
    expect(canEditReview({ status: 'HIEN', reply: null })).toBe(true);
    expect(canEditReview({ status: 'HIEN', reply: 'Cảm ơn anh' })).toBe(false);
    expect(canEditReview({ status: 'AN', reply: null })).toBe(false);
  });

  it('gộp điểm sao có trọng số từ đơn CRM và yêu cầu sàn', () => {
    expect(combineRating([])).toBeNull();
    expect(combineRating([{ sum: 0, count: 0 }])).toBeNull();
    // 2 đánh giá CRM (tổng 10 sao) + 1 đánh giá sàn (4 sao) = 14 / 3 = 4.7
    expect(
      combineRating([
        { sum: 10, count: 2 },
        { sum: 4, count: 1 },
      ]),
    ).toEqual({ avg: 4.7, count: 3 });
  });

  it('máy trạng thái phản ánh chỉ cho chuyển theo luồng hợp lệ', () => {
    expect(canMoveReport('MOI', 'CHO_GIAI_TRINH')).toBe(true);
    expect(canMoveReport('MOI', 'DA_XU_LY')).toBe(true);
    expect(canMoveReport('MOI', 'DA_GIAI_TRINH')).toBe(false);
    expect(canMoveReport('CHO_GIAI_TRINH', 'DA_GIAI_TRINH')).toBe(true);
    expect(canMoveReport('DA_GIAI_TRINH', 'DA_XU_LY')).toBe(true);
    expect(canMoveReport('DA_GIAI_TRINH', 'TU_CHOI')).toBe(true);
    expect(canMoveReport('DA_XU_LY', 'MOI')).toBe(false);
    expect(canMoveReport('TU_CHOI', 'DA_XU_LY')).toBe(false);
  });

  it('kiểm tra biện pháp xử lý vi phạm theo loại garage và trạng thái', () => {
    expect(checkViolationAction('NHAC_NHO', { type: 'GARAGE', status: 'HOAT_DONG' })).toBeNull();
    expect(checkViolationAction('GO_TIN', { type: 'PARTNER', status: 'HOAT_DONG' }, null)).toMatch(/Chọn tin/);
    expect(checkViolationAction('GO_TIN', { type: 'PARTNER', status: 'HOAT_DONG' }, 'offer-id')).toBeNull();
    expect(checkViolationAction('TAM_KHOA', { type: 'GARAGE', status: 'HOAT_DONG' })).toMatch(/đối tác/);
    expect(checkViolationAction('TAM_KHOA', { type: 'PARTNER', status: 'HOAT_DONG' })).toBeNull();
    expect(checkViolationAction('TAM_KHOA', { type: 'PARTNER', status: 'CHAM_DUT' })).toMatch(/không cho phép/);
  });

  it('tính tỉ lệ chốt, tỉ lệ chuyển đổi và khung ngày theo giờ VN', () => {
    expect(ratePercent(0, 0)).toBeNull();
    expect(ratePercent(0, 5)).toBe(0);
    expect(ratePercent(1, 3)).toBe(33.3);
    expect(ratePercent(3, 4)).toBe(75);

    const ref = new Date('2026-11-25T18:30:00.000Z'); // 01:30 sáng ngày 26/11 giờ VN
    expect(vnYmd(ref)).toBe('2026-11-26');
    const w = statsWindow(7, ref);
    expect(w.days).toBe(7);
    expect(w.keys).toHaveLength(7);
    expect(w.keys[0]).toBe('2026-11-20');
    expect(w.keys[6]).toBe('2026-11-26');
    expect(w.fromTimestamp.toISOString()).toBe('2026-11-19T17:00:00.000Z');
  });
});
