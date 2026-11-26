import {
  canMoveSos,
  matchRescueGarages,
  nearestFallbackHotlines,
  sosCode,
  sosTransitionError,
  type RescueGarageInput,
} from './sos-rules';

const baseGarage = (over: Partial<RescueGarageInput> = {}): RescueGarageInput => ({
  tenantId: 't1',
  tenantType: 'PARTNER',
  tenantStatus: 'HOAT_DONG',
  tenantDeletedAt: null,
  name: 'Cứu hộ Minh Phát',
  slug: 'minh-phat',
  address: 'Hà Đông, Hà Nội',
  hotline: '0900000010',
  lat: 20.97,
  lng: 105.77,
  enabled: true,
  onDuty: true,
  radiusKm: 20,
  basePrice: 300_000,
  note: null,
  ...over,
});

describe('Quy tắc Cứu hộ SOS & máy trạng thái S6 (sos-rules)', () => {
  it('cho phép đúng các bước chuyển của sơ đồ S6: xử lý tại chỗ và kéo về garage', () => {
    expect(canMoveSos('MOI', 'DANG_TIM_GARAGE')).toBe(true);
    expect(canMoveSos('DANG_TIM_GARAGE', 'DA_NHAN')).toBe(true);
    expect(canMoveSos('DANG_TIM_GARAGE', 'KHONG_CO_GARAGE')).toBe(true);
    expect(canMoveSos('DA_NHAN', 'DANG_DEN')).toBe(true);
    expect(canMoveSos('DANG_DEN', 'TAI_HIEN_TRUONG')).toBe(true);
    // Nhánh xử lý tại chỗ
    expect(canMoveSos('TAI_HIEN_TRUONG', 'XU_LY_TAI_CHO')).toBe(true);
    expect(canMoveSos('XU_LY_TAI_CHO', 'HOAN_THANH')).toBe(true);
    // Nhánh kéo xe về garage
    expect(canMoveSos('TAI_HIEN_TRUONG', 'DANG_KEO_XE')).toBe(true);
    expect(canMoveSos('DANG_KEO_XE', 'DA_VE_GARAGE')).toBe(true);
    expect(canMoveSos('DA_VE_GARAGE', 'HOAN_THANH')).toBe(true);
  });

  it('chặn mọi chuyển tắt hoặc sai chiều ngoài S6, kể cả khách tự huỷ sau khi đội đã xuất phát', () => {
    expect(canMoveSos('MOI', 'KHACH_HUY')).toBe(true);
    expect(canMoveSos('DANG_TIM_GARAGE', 'KHACH_HUY')).toBe(true);
    expect(canMoveSos('DA_NHAN', 'KHACH_HUY')).toBe(true);

    // Đội đang đến trở đi: khách không tự huỷ trực tuyến được nữa
    expect(canMoveSos('DANG_DEN', 'KHACH_HUY')).toBe(false);
    expect(sosTransitionError('DANG_DEN', 'KHACH_HUY')).toContain('đội cứu hộ đã xuất phát');

    // Không cho nhảy cóc từ DA_NHAN thẳng sang HOAN_THANH hay TAI_HIEN_TRUONG
    expect(canMoveSos('DA_NHAN', 'TAI_HIEN_TRUONG')).toBe(false);
    expect(canMoveSos('DA_NHAN', 'HOAN_THANH')).toBe(false);
    expect(canMoveSos('DANG_KEO_XE', 'HOAN_THANH')).toBe(false);
    expect(canMoveSos('HOAN_THANH', 'DA_NHAN')).toBe(false);
    expect(canMoveSos('KHONG_CO_GARAGE', 'DA_NHAN')).toBe(false);
  });

  it('lọc đúng garage đang bật cứu hộ, đang trực, không bị khoá và nằm trong bán kính phục vụ, xếp gần trước', () => {
    const pos = { lat: 20.98, lng: 105.78 };
    const matched = matchRescueGarages(pos, [
      baseGarage({ tenantId: 'far-ok', name: 'Xa hơn nhưng đủ bán kính', lat: 21.05, lng: 105.85, radiusKm: 25 }),
      baseGarage({ tenantId: 'near-ok', name: 'Gần nhất', lat: 20.981, lng: 105.781, radiusKm: 15 }),
      baseGarage({ tenantId: 'out-of-range', lat: 21.3, lng: 105.8, radiusKm: 10 }),
      baseGarage({ tenantId: 'off-duty', onDuty: false, lat: 20.981, lng: 105.781 }),
      baseGarage({ tenantId: 'disabled', enabled: false, lat: 20.981, lng: 105.781 }),
      baseGarage({ tenantId: 'suspended', tenantStatus: 'TAM_KHOA', lat: 20.981, lng: 105.781 }),
    ]);

    expect(matched.map((g) => g.tenantId)).toEqual(['near-ok', 'far-ok']);
    expect(matched[0]!.distanceKm).toBeLessThan(matched[1]!.distanceKm);
  });

  it('trả danh sách hotline gần nhất khi quá 3 phút chưa có garage nhận, bỏ qua đối tác bị khoá', () => {
    const pos = { lat: 11.53, lng: 106.88 };
    const fallbacks = nearestFallbackHotlines(pos, [
      baseGarage({ tenantId: 'hn', name: 'Hà Nội', lat: 20.97, lng: 105.77, hotline: '0900000010', onDuty: false }),
      baseGarage({ tenantId: 'bp', tenantType: 'GARAGE', name: 'PLG Đồng Xoài', lat: 11.54, lng: 106.89, hotline: '0900000001' }),
      baseGarage({ tenantId: 'locked', tenantStatus: 'TAM_KHOA', lat: 11.531, lng: 106.881, hotline: '0900000099' }),
    ]);

    expect(fallbacks.map((g) => g.tenantId)).toEqual(['bp', 'hn']);
    expect(fallbacks[0]!.hotline).toBe('0900000001');
  });

  it('định dạng mã SOS 6 chữ số', () => {
    expect(sosCode(1)).toBe('SOS000001');
    expect(sosCode(42)).toBe('SOS000042');
  });
});
