import {
  buildMaintenanceChecklistByKm,
  detectBookingIntent,
  matchMarketplaceOffers,
  parseVehicleAndKmFromText,
  proposeOwnerBookingSlots,
  proposeShopRequestSlots,
} from './chatbot-rules';

describe('chatbot-rules (Vòng 5.3 · Chatbot AI đặt lịch & Tư vấn chủ xe)', () => {
  it('bóc tách đúng hãng xe và số km từ câu hỏi tiếng Việt ("4 vạn", "40.000 km", "20k km")', () => {
    expect(parseVehicleAndKmFromText('Xe Mazda CX-5 đi 4 vạn cần bảo dưỡng gì?')).toEqual({
      make: 'Mazda',
      odometerKm: 40_000,
    });
    expect(parseVehicleAndKmFromText('Toyota Vios chạy 19.600 km thay gì?')).toEqual({
      make: 'Toyota',
      odometerKm: 19_600,
    });
    expect(parseVehicleAndKmFromText('Bảo dưỡng mốc 20k km cho Honda City')).toEqual({
      make: 'Honda',
      odometerKm: 20_000,
    });
  });

  it('xây dựng đúng danh mục bảo dưỡng theo cấp nhỏ / trung / lớn dựa trên số km', () => {
    const capNho = buildMaintenanceChecklistByKm(4_800, 'Hyundai Accent');
    expect(capNho.milestoneKm).toBe(5_000);
    expect(capNho.tierCode).toBe('CAP_NHO');

    const capTrung = buildMaintenanceChecklistByKm(19_200, 'Mazda CX-5');
    expect(capTrung.milestoneKm).toBe(20_000);
    expect(capTrung.tierCode).toBe('CAP_TRUNG');

    const capLon = buildMaintenanceChecklistByKm(40_000, 'Toyota Camry');
    expect(capLon.milestoneKm).toBe(40_000);
    expect(capLon.tierCode).toBe('CAP_LON');
    expect(capLon.checklist.join(' ')).toContain('DOT4');
  });

  it('xếp hạng đúng tin sản phẩm / dịch vụ đang bán trên sàn và loại bỏ sản phẩm hết hàng', () => {
    const offers = [
      {
        offerId: 'o1',
        tenantId: 't1',
        shopName: 'Garage A',
        shopSlug: 'garage-a',
        kind: 'PRODUCT' as const,
        itemCode: 'DAU-5W30',
        name: 'Dầu nhớt Castrol EDGE 5W-30 4L',
        brand: 'Castrol',
        category: 'Dầu nhớt',
        price: 890_000,
        priceFrom: false,
        installIncluded: true,
        durationMinutes: null,
        available: 5,
        openingHours: [],
      },
      {
        offerId: 'o2',
        tenantId: 't2',
        shopName: 'Garage B',
        shopSlug: 'garage-b',
        kind: 'PRODUCT' as const,
        itemCode: 'DAU-HET',
        name: 'Dầu nhớt Castrol hết tồn',
        brand: 'Castrol',
        category: 'Dầu nhớt',
        price: 750_000,
        priceFrom: false,
        installIncluded: true,
        durationMinutes: null,
        available: 0,
        openingHours: [],
      },
    ];

    const matched = matchMarketplaceOffers('Báo giá thay dầu nhớt 5W-30 trên sàn', offers);
    expect(matched).toHaveLength(1);
    expect(matched[0]?.offerId).toBe('o1');
  });

  it('đề xuất khung giờ hẹn tránh xung đột ±3h trên App chủ xe và tránh ngày nghỉ trên Sàn', () => {
    const now = new Date('2026-11-26T02:00:00.000Z'); // 09:00 giờ VN (Thứ 5)
    // Giả sử 14:00 giờ VN hôm nay (07:00 UTC) đã có lịch hẹn -> cả 14:00 và 15:30 đều nằm trong ±3h nên phải tránh!
    const existing = [new Date('2026-11-26T07:00:00.000Z')];
    const ownerSlots = proposeOwnerBookingSlots({ now, existingScheduledAts: existing, count: 3 });

    expect(ownerSlots).toHaveLength(3);
    expect(ownerSlots).not.toContain('2026-11-26T07:00:00.000Z');
    expect(ownerSlots).not.toContain('2026-11-26T08:30:00.000Z');
    // Sáng hôm sau 08:30 VN = 01:30 UTC phải xuất hiện
    expect(ownerSlots).toContain('2026-11-27T01:30:00.000Z');

    // Gian hàng nghỉ Thứ 5 (day=4), chỉ mở Thứ 6 (day=5) từ 08:00 - 17:00
    const shopSlots = proposeShopRequestSlots({
      now,
      count: 2,
      openingHours: [
        { day: 4, open: '08:00', close: '17:00', closed: true },
        { day: 5, open: '08:00', close: '17:00', closed: false },
      ],
    });
    expect(shopSlots).toEqual(['2026-11-27T01:30:00.000Z', '2026-11-27T03:00:00.000Z']);
    expect(detectBookingIntent('Cho tôi đặt lịch bảo dưỡng sáng mai')).toBe(true);
  });
});
