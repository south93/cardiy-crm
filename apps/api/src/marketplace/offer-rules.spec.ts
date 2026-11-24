import { availableStock, canMoveOffer, checkOpeningHours, publicState, shopMissing, slugify, statusAfterEdit, statusOnSubmit } from './offer-rules';

describe('Tin đăng trên sàn', () => {
  it('gửi duyệt: PLG bán ngay, đối tác chờ duyệt; chỉ gửi được từ Nháp', () => {
    expect(statusOnSubmit('NHAP', true)).toBe('DANG_BAN');
    expect(statusOnSubmit('NHAP', false)).toBe('CHO_DUYET');
    expect(statusOnSubmit('DANG_BAN', false)).toBeNull();
  });

  it('sửa tin: đổi thông tin quan trọng thì duyệt lại; đổi giá / tồn giữ nguyên; bị từ chối về Nháp', () => {
    expect(statusAfterEdit('DANG_BAN', true, false)).toBe('CHO_DUYET');
    expect(statusAfterEdit('DANG_BAN', false, false)).toBe('DANG_BAN');
    expect(statusAfterEdit('DANG_BAN', true, true)).toBe('DANG_BAN');
    expect(statusAfterEdit('TAM_AN', true, false)).toBe('CHO_DUYET');
    expect(statusAfterEdit('BI_TU_CHOI', false, false)).toBe('NHAP');
    expect(canMoveOffer('BI_GO', 'DANG_BAN')).toBe(false);
    expect(canMoveOffer('CHO_DUYET', 'BI_TU_CHOI')).toBe(true);
  });

  it('tồn khả dụng: PLG cộng tồn chi nhánh bán (bỏ tồn âm), đối tác nhập tay, dịch vụ không tính', () => {
    const levels = [
      { branchId: 'a', quantity: 3 },
      { branchId: 'b', quantity: -2 },
      { branchId: 'c', quantity: 4.5 },
    ];
    expect(availableStock({ kind: 'PRODUCT', productId: 'p', manualStock: null, branchIds: [] }, levels)).toBe(7);
    expect(availableStock({ kind: 'PRODUCT', productId: 'p', manualStock: null, branchIds: ['a', 'b'] }, levels)).toBe(3);
    expect(availableStock({ kind: 'PRODUCT', productId: null, manualStock: 5, branchIds: [] }, [])).toBe(5);
    expect(availableStock({ kind: 'SERVICE', productId: null, manualStock: null, branchIds: [] }, [])).toBeNull();
    expect(publicState('DANG_BAN', 0)).toBe('HET_HANG');
    expect(publicState('DANG_BAN', null)).toBe('CON_HANG');
    expect(publicState('TAM_AN', 9)).toBe('AN');
  });

  it('giờ mở cửa, slug, điều kiện hiện gian hàng', () => {
    expect(checkOpeningHours([{ day: 1, open: '07:30', close: '17:30', closed: false }])).toBeNull();
    expect(checkOpeningHours([{ day: 1, open: '18:00', close: '08:00', closed: false }])).toMatch(/trước/);
    expect(checkOpeningHours([{ day: 1, open: '7h', close: '17:00', closed: false }])).toMatch(/dạng/);
    expect(checkOpeningHours([{ day: 1, open: '', close: '', closed: true }])).toBeNull();
    expect(slugify('Garage Đức Phát – Thủ Đức!')).toBe('garage-duc-phat-thu-duc');
    const shop = { name: 'G', phone: '1', address: 'x', lat: 10, openingHours: [{ day: 1, open: '07:00', close: '17:00', closed: false }] };
    expect(shopMissing(shop, 1, 'HOAT_DONG')).toEqual([]);
    expect(shopMissing(shop, 0, 'DANG_THIET_LAP')).toHaveLength(2);
    expect(shopMissing(null, 0, 'HOAT_DONG').length).toBeGreaterThan(2);
  });
});
