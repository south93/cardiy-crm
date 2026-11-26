import {
  canMoveContract,
  checkRentalPeriod,
  computeSettlement,
  contractTransitionError,
  listingStatusAfterEdit,
  listingStatusOnSubmit,
  periodsOverlap,
  rentalContractCode,
  rentalVehicleCode,
  suggestOverKmFee,
} from './rental-rules';

describe('Quy tắc Thuê xe & máy trạng thái S8 (rental-rules)', () => {
  it('cho phép đúng các bước chuyển của sơ đồ S8 và chặn mọi chuyển tắt', () => {
    expect(canMoveContract('DAT_TRUOC', 'DA_XAC_MINH')).toBe(true);
    expect(canMoveContract('DAT_TRUOC', 'HUY')).toBe(true);
    expect(canMoveContract('DA_XAC_MINH', 'DA_KY_COC')).toBe(true);
    expect(canMoveContract('DA_KY_COC', 'DANG_THUE')).toBe(true);
    expect(canMoveContract('DANG_THUE', 'DA_TRA_XE')).toBe(true);
    expect(canMoveContract('DANG_THUE', 'QUA_HAN')).toBe(true);
    expect(canMoveContract('QUA_HAN', 'DA_TRA_XE')).toBe(true);
    expect(canMoveContract('DA_TRA_XE', 'DA_QUYET_TOAN')).toBe(true);

    // Chặn nhảy cóc hoặc huỷ sau khi đã xác minh / ký cọc / đang thuê
    expect(canMoveContract('DA_XAC_MINH', 'DANG_THUE')).toBe(false);
    expect(canMoveContract('DA_KY_COC', 'HUY')).toBe(false);
    expect(canMoveContract('DANG_THUE', 'DA_QUYET_TOAN')).toBe(false);
    expect(canMoveContract('DA_QUYET_TOAN', 'DAT_TRUOC')).toBe(false);
    expect(contractTransitionError('DANG_THUE', 'HUY')).toContain('không huỷ trực tuyến được nữa');
  });

  it('kiểm duyệt đội xe: PLG đăng lên sàn ngay, Đối tác chờ duyệt và sửa thông tin quan trọng phải duyệt lại', () => {
    expect(listingStatusOnSubmit('NHAP', true)).toBe('DANG_CHO_THUE');
    expect(listingStatusOnSubmit('NHAP', false)).toBe('CHO_DUYET');
    expect(listingStatusOnSubmit('DANG_CHO_THUE', false)).toBeNull();
    expect(listingStatusAfterEdit('DANG_CHO_THUE', true, false)).toBe('CHO_DUYET');
    expect(listingStatusAfterEdit('DANG_CHO_THUE', false, false)).toBe('DANG_CHO_THUE');
    expect(listingStatusAfterEdit('DANG_CHO_THUE', true, true)).toBe('DANG_CHO_THUE');
  });

  it('tính số ngày thuê và phát hiện trùng khoảng thời gian', () => {
    const now = new Date('2026-12-01T08:00:00Z');
    expect(checkRentalPeriod(new Date('2026-12-02T08:00:00Z'), new Date('2026-12-04T10:00:00Z'), now)).toEqual({ days: 3 });
    expect(checkRentalPeriod(new Date('2026-12-02T08:00:00Z'), new Date('2026-12-02T10:00:00Z'), now)).toEqual({
      error: 'Thời gian thuê tối thiểu 4 tiếng',
    });

    const a1 = new Date('2026-12-05T08:00:00Z');
    const a2 = new Date('2026-12-07T08:00:00Z');
    expect(periodsOverlap(a1, a2, new Date('2026-12-06T00:00:00Z'), new Date('2026-12-08T00:00:00Z'))).toBe(true);
    // Trả đúng lúc khách sau nhận: không trùng
    expect(periodsOverlap(a1, a2, new Date('2026-12-07T08:00:00Z'), new Date('2026-12-09T08:00:00Z'))).toBe(false);
  });

  it('gợi ý phụ phí vượt km và tính quyết toán hoàn cọc / thu thêm', () => {
    expect(
      suggestOverKmFee({ handoverKm: 10_000, returnKm: 10_750, rentalDays: 2, kmLimitPerDay: 300, overKmFee: 5_000 }),
    ).toEqual({ drivenKm: 750, overKm: 150, suggestedFee: 750_000 });

    // Cọc 5tr, tiền thuê 2tr + phụ phí 500k - giảm 100k = 2.4tr -> hoàn lại khách 2.6tr
    expect(computeSettlement({ baseTotal: 2_000_000, extraFee: 500_000, discount: 100_000, depositPaid: 5_000_000 })).toEqual({
      finalTotal: 2_400_000,
      depositRefund: 2_600_000,
      extraCollect: 0,
    });

    // Cọc 1tr, tổng thuê + phụ phí 2.5tr -> thu thêm 1.5tr, không hoàn cọc
    expect(computeSettlement({ baseTotal: 2_000_000, extraFee: 500_000, discount: 0, depositPaid: 1_000_000 })).toEqual({
      finalTotal: 2_500_000,
      depositRefund: 0,
      extraCollect: 1_500_000,
    });

    expect(rentalVehicleCode(3)).toBe('TX000003');
    expect(rentalContractCode(12)).toBe('HDT000012');
  });
});
