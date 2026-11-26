import {
  appraisalCode,
  appraisalTransitionError,
  buildDefaultChecklist,
  canMoveAppraisal,
  canSubmitUsedCar,
  computeListingExpiry,
  evaluateAppraisalChecklist,
  maskPlatePublic,
  usedCarCode,
  usedCarStatusAfterEdit,
} from './used-car-rules';

describe('Quy tắc Xe cũ & Kiểm định xe cũ (Vòng 4.3 — M32, F8)', () => {
  it('chấm điểm checklist kiểm định 6 nhóm và quyết định cấp huy hiệu Đạt chuẩn', () => {
    const base = buildDefaultChecklist();
    expect(evaluateAppraisalChecklist(base, { noMajorAccident: true, noFloodDamage: true, validDocuments: true })).toEqual({
      score: 100,
      grade: 'DAT_CHUAN',
      earnsVerifiedBadge: true,
    });

    // Một vài nhóm ở mức Lưu ý nhưng vẫn >= 75 điểm -> vẫn Đạt chuẩn
    const minorWear = base.map((item) =>
      item.key === 'SUSPENSION_BRAKE' || item.key === 'INTERIOR_SAFETY' ? { ...item, status: 'LUU_Y' as const } : item,
    );
    expect(evaluateAppraisalChecklist(minorWear, { noMajorAccident: true, noFloodDamage: true, validDocuments: true })).toEqual({
      score: 90,
      grade: 'DAT_CHUAN',
      earnsVerifiedBadge: true,
    });

    // Tất cả nhóm ở mức Lưu ý (60 điểm) -> xếp loại LUU_Y, không cấp huy hiệu Đạt chuẩn
    const medium = base.map((item) => ({ ...item, status: 'LUU_Y' as const }));
    expect(evaluateAppraisalChecklist(medium, { noMajorAccident: true, noFloodDamage: true, validDocuments: true })).toEqual({
      score: 60,
      grade: 'LUU_Y',
      earnsVerifiedBadge: false,
    });

    // Phát hiện thuỷ kích / ngập nước -> bắt buộc KHONG_DAT và khoá trần điểm <= 49 dù các mục khác Tốt
    expect(evaluateAppraisalChecklist(base, { noMajorAccident: true, noFloodDamage: false, validDocuments: true })).toEqual({
      score: 49,
      grade: 'KHONG_DAT',
      earnsVerifiedBadge: false,
    });

    // Khung gầm hoặc động cơ Không đạt -> bắt buộc KHONG_DAT
    const frameBad = base.map((item) => (item.key === 'BODY_FRAME' ? { ...item, status: 'KHONG_DAT' as const } : item));
    expect(evaluateAppraisalChecklist(frameBad, { noMajorAccident: true, noFloodDamage: true, validDocuments: true })).toEqual({
      score: 70,
      grade: 'KHONG_DAT',
      earnsVerifiedBadge: false,
    });
  });

  it('kiểm duyệt lại khi đổi thông tin quan trọng của tin đang bán; giữ nguyên khi chỉ đổi giá/ODO', () => {
    expect(canSubmitUsedCar('NHAP')).toBe(true);
    expect(canSubmitUsedCar('BI_TU_CHOI')).toBe(true);
    expect(canSubmitUsedCar('DANG_BAN')).toBe(false);

    expect(usedCarStatusAfterEdit('BI_TU_CHOI', false)).toBe('NHAP');
    expect(usedCarStatusAfterEdit('DANG_BAN', false)).toBe('DANG_BAN');
    expect(usedCarStatusAfterEdit('DANG_BAN', true)).toBe('CHO_DUYET');
  });

  it('tính hạn tin đăng 60 ngày và che 2 số cuối biển số trên sàn công khai', () => {
    const pub = new Date('2026-11-01T00:00:00.000Z');
    const exp = computeListingExpiry(pub);
    expect((exp.getTime() - pub.getTime()) / 86_400_000).toBe(60);

    expect(maskPlatePublic('30H-567.89')).toBe('30H-567.**');
    expect(maskPlatePublic(null)).toBeNull();
    expect(usedCarCode(12)).toBe('XC000012');
    expect(appraisalCode(5)).toBe('KD000005');
  });

  it('máy trạng thái phiếu kiểm định: chặn huỷ khi đã bắt đầu chấm hoặc hoàn tất', () => {
    expect(canMoveAppraisal('CHO_XAC_NHAN', 'DA_HEN')).toBe(true);
    expect(canMoveAppraisal('DA_HEN', 'HUY')).toBe(true);
    expect(canMoveAppraisal('DANG_KIEM_DINH', 'HUY')).toBe(false);
    expect(appraisalTransitionError('DANG_KIEM_DINH', 'HUY')).toContain('không huỷ trực tuyến');
    expect(canMoveAppraisal('DANG_KIEM_DINH', 'HOAN_THANH')).toBe(true);
    expect(canMoveAppraisal('HOAN_THANH', 'DA_HEN')).toBe(false);
  });
});
