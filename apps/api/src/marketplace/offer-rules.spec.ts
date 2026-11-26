import { availableStock, canMoveOffer, checkOpeningHours, distanceKm, openNow, publicState, reviewerName, shopMissing, slugify, statusAfterEdit, statusOnSubmit, tenantListable } from './offer-rules';

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

describe('Web sàn: giờ mở cửa, khoảng cách, hiển thị', () => {
  const hours = [{ day: 2, open: '07:30', close: '17:30', closed: false }];
  it('mở cửa theo giờ Việt Nam', () => {
    // Thứ 3, 01:00 UTC = 08:00 giờ VN
    expect(openNow(hours, new Date('2026-11-24T01:00:00Z'))).toBe(true);
    // 10:30 UTC = 17:30 VN: đã đóng
    expect(openNow(hours, new Date('2026-11-24T10:30:00Z'))).toBe(false);
    // Thứ 2 không có giờ
    expect(openNow(hours, new Date('2026-11-23T03:00:00Z'))).toBe(false);
  });
  it('khoảng cách, tên người đánh giá, gian hàng được hiện', () => {
    expect(distanceKm({ lat: 10.7769, lng: 106.7009 }, { lat: 10.9804, lng: 106.6519 })).toBeCloseTo(23.2, 0);
    expect(reviewerName('Nguyễn Văn Cường')).toBe('Cường');
    expect(reviewerName('')).toBe('Khách');
    expect(tenantListable({ type: 'PARTNER', status: 'DANG_THIET_LAP', deletedAt: null })).toBe(false);
    expect(tenantListable({ type: 'PARTNER', status: 'HOAT_DONG', deletedAt: null })).toBe(true);
    expect(tenantListable({ type: 'GARAGE', status: 'NHAP', deletedAt: null })).toBe(true);
    expect(tenantListable({ type: 'GARAGE', status: 'TAM_KHOA', deletedAt: null })).toBe(false);
  });
});
