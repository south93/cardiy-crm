import {
  buildHeuristicVehicleSummary,
  matchCatalogSuggestions,
  redactPiiForAi,
  scoreKnowledgeDocs,
} from './ai-rules';

describe('ai-rules (Vòng 5.2 · M36 Trợ lý AI Garage)', () => {
  it('che đầy đủ SĐT, Email, CCCD/MST, họ tên và địa chỉ khách trước khi gửi tới AI', () => {
    const raw =
      'Khách Nguyễn Văn An ở 125 Nguyễn Trãi, Thanh Xuân gọi từ 0912 345 678 (email an.nguyen@gmail.com, CCCD 001090123456) báo xe kêu phanh ở 40000 km.';
    const res = redactPiiForAi(raw, {
      names: ['Nguyễn Văn An'],
      addresses: ['125 Nguyễn Trãi, Thanh Xuân'],
    });

    expect(res.text).not.toContain('Nguyễn Văn An');
    expect(res.text).not.toContain('125 Nguyễn Trãi');
    expect(res.text).not.toContain('0912 345 678');
    expect(res.text).not.toContain('an.nguyen@gmail.com');
    expect(res.text).not.toContain('001090123456');
    expect(res.text).toContain('[KHÁCH_HÀNG_ĐÃ_CHE]');
    expect(res.text).toContain('[ĐỊA_CHỈ_ĐÃ_CHE]');
    expect(res.text).toContain('[SĐT_ĐÃ_CHE]');
    expect(res.text).toContain('[EMAIL_ĐÃ_CHE]');
    expect(res.text).toContain('[MÃ_ĐỊNH_DANH_ĐÃ_CHE]');
    // Giữ nguyên dữ liệu kỹ thuật "40000 km" và "kêu phanh"
    expect(res.text).toContain('40000 km');
    expect(res.text).toContain('kêu phanh');
    expect(res.maskedCount).toBe(5);
  });

  it('xếp hạng kho tri thức kỹ thuật đúng theo triệu chứng', () => {
    const docs = [
      {
        code: 'DOC-PHANH',
        title: 'Chẩn đoán phanh kêu rít',
        category: 'LOP_PHANH',
        content: 'Kiểm tra má phanh và đĩa phanh',
        tags: ['ma phanh', 'keu rit'],
        searchText: 'chan doan phanh keu rit ma phanh dia phanh',
      },
      {
        code: 'DOC-AC',
        title: 'Chẩn đoán điều hoà kém mát',
        category: 'CHAN_DOAN',
        content: 'Kiểm tra lọc gió điều hoà và gas R134a',
        tags: ['dieu hoa', 'kem mat'],
        searchText: 'chan doan dieu hoa kem mat loc gio gas',
      },
    ];
    const ranked = scoreKnowledgeDocs('Điều hoà xe thổi gió nóng kém mát', docs);
    expect(ranked[0]?.code).toBe('DOC-AC');
  });

  it('đối chiếu danh mục phụ tùng theo triệu chứng, hãng xe và vùng giá chi nhánh (BP vs BD)', () => {
    const products = [
      {
        id: 'p1',
        code: 'SP001',
        name: 'Dầu động cơ Castrol EDGE 5W-30',
        kind: 'PHU_TUNG' as const,
        unit: 'can',
        salePrice: 850_000,
        salePriceBd: 890_000,
        vehicleMakes: [],
        searchText: 'sp001 dau dong co castrol edge 5w 30',
        onHand: 12,
      },
      {
        id: 'p2',
        code: 'SP002',
        name: 'Má phanh trước Toyota Camry',
        kind: 'PHU_TUNG' as const,
        unit: 'bộ',
        salePrice: 1_200_000,
        salePriceBd: 1_250_000,
        vehicleMakes: ['Toyota'],
        searchText: 'sp002 ma phanh truoc toyota camry',
        onHand: 4,
      },
    ];

    const bdLines = matchCatalogSuggestions({
      symptoms: 'Phanh trước kêu két két và thay dầu bảo dưỡng',
      vehicleMake: 'Toyota',
      priceZone: 'BD',
      products,
    });

    const brake = bdLines.find((l) => l.productId === 'p2');
    expect(brake).toBeDefined();
    expect(brake?.unitPrice).toBe(1_250_000);
    expect(bdLines.some((l) => l.kind === 'DICH_VU')).toBe(true);
  });

  it('tạo bản tóm tắt lịch sử xe rõ ràng kèm cảnh báo phiếu kiểm tra và đăng kiểm', () => {
    const summary = buildHeuristicVehicleSummary({
      plateMaskedOrCode: '30A-123.45',
      makeModelYear: 'Mazda CX-5 2022',
      odometerKm: 39_600,
      registrationDaysLeft: 12,
      insuranceDaysLeft: 90,
      orders: [
        {
          code: 'DH000012',
          date: '10/10/2026',
          km: 35_000,
          status: 'DA_GIAO',
          items: ['Thay dầu 5W-30', 'Lọc dầu'],
          replaceAlerts: ['Má phanh sau'],
          attentionAlerts: ['Lọc gió điều hoà'],
        },
      ],
    });
    expect(summary).toContain('39.600 km');
    expect(summary).toContain('40.000 km');
    expect(summary).toContain('Má phanh sau');
    expect(summary).toContain('Còn 12 ngày hết hạn');
  });
});
