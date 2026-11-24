import { analyzeProductWorkbook, lotCosts, productCode, type ExistingProducts, type SheetRow } from './product-import-rules';

// Dữ liệu GIẢ theo đúng cấu trúc cột của file AppSheet
const SP: SheetRow[] = [
  { ma_sp: 'LOP-A1', ten_sp: 'Lốp Thử A1 205/55R16', loai_hang: 'Hàng hóa', nhom_hang: 'LX', nhom_hang_1: 'LX', hang: 'Hãng A', dvt: 'cái', gia_ban: 1_500_000, gia_nhap_ht: 1_100_000, ton_min: 2 },
  { ma_sp: 691314.0, ten_sp: 'Gạt mưa thử 14"', loai_hang: 'Hàng hóa', nhom_hang: 'PTBD', nhom_hang_1: 'GẠT MƯA', hang: null, dvt: 'Cái', gia_ban: null },
  { ma_sp: 'DV-01', ten_sp: 'Công thay lốp', loai_hang: 'Dịch vụ', nhom_hang: 'DV', nhom_hang_1: 'Dịch vụ lốp', dvt: 'Lần', gia_ban: 50_000 },
  { ma_sp: 'LOP-A1', ten_sp: 'Lốp Thử A1 205/55R16', loai_hang: 'Hàng hóa', nhom_hang: 'LX', gia_ban: 1_500_000 },
  { ma_sp: null, ten_sp: 'Không có mã' },
  { ma_sp: 'OLD-1', ten_sp: 'Má phanh thử', loai_hang: 'Dịch vụ', nhom_hang: 'PTSC', gia_ban: 400_000 },
];
const BG: SheetRow[] = [
  { MA_HANG: 'LOP-A1', HANG: 'HÃNG A', NHOM: 'LX', TEN_HANG: 'Lốp Thử A1 205/55R16', DVT: 'Cái', GIA_BD: 1_450_000, GIA_BP: 1_500_000, GIA_VAT: 1_620_000, TON_CN1: 4, TON_CN2: -2, TON_CN3: 3 },
  { MA_HANG: '691314', HANG: 'MIC', NHOM: 'PTBD', TEN_HANG: 'Gạt mưa thử 14"', DVT: 'Cái', GIA_BD: 180_000, GIA_BP: 190_000, GIA_VAT: null, TON_CN1: 349_999, TON_CN2: 2.5, TON_CN3: null, TON_CN4: 1 },
  { MA_HANG: 'BG-ONLY', HANG: 'KUMHO', NHOM: 'LX', TEN_HANG: 'Kumho thử 185/70R14', DVT: 'Cái', GIA_BD: null, GIA_BP: null, TON_CN3: 6 },
  { MA_HANG: 'NONAME', HANG: '(CHƯA', NHOM: 'CHƯA CÓ SP', TEN_HANG: '(CHƯA CÓ TÊN - cần bổ sung)', TON_CN2: 2 },
  { MA_HANG: 'DV-01', TEN_HANG: 'Công thay lốp', TON_CN1: 5 },
];
const existing: ExistingProducts = {
  byCode: new Map([['OLD-1', { id: 'p-old', kind: 'PHU_TUNG' as const, hasMoves: true }]]),
  branchCodes: new Set(['CN1', 'CN2', 'CN3']),
};

describe('Giá vốn theo lô', () => {
  it('bình quân theo số lượng còn trong kho; không còn tồn thì bình quân thường', () => {
    const m = lotCosts([
      { ma_sp: 'A', gia_von: 100_000, sl_trong_kho: 1 },
      { ma_sp: 'A', gia_von: 130_000, sl_trong_kho: 2 },
      { ma_sp: 'B', gia_von: 50_000, sl_trong_kho: 0 },
      { ma_sp: 'B', gia_von: 70_000, sl_trong_kho: 0 },
      { ma_sp: 'C', gia_von: null, sl_trong_kho: 3 },
    ]);
    expect(Object.fromEntries(m)).toEqual({ A: 120_000, B: 60_000 });
  });
  it('dùng giá vốn lô khi sheet SẢN PHẨM không có giá nhập', () => {
    const { plan } = analyzeProductWorkbook([{ ma_sp: 'X1', ten_sp: 'Lốp X1', gia_ban: 1_000_000 }], [], { byCode: new Map(), branchCodes: new Set() }, [
      { ma_sp: 'X1', gia_von: 700_000, sl_trong_kho: 2 },
    ]);
    expect(plan.products[0]).toMatchObject({ costPrice: 700_000 });
  });
});

describe('Nhập sản phẩm từ file AppSheet', () => {
  const { plan, summary, issues } = analyzeProductWorkbook(SP, BG, existing);
  const byCode = new Map(plan.products.map((p) => [p.code, p]));

  it('mã số thực của Excel thành mã chữ, chữ in hoa', () => {
    expect(productCode(691314.0)).toBe('691314');
    expect(productCode(' spFa12 ')).toBe('SPFA12');
    expect(byCode.has('691314')).toBe(true);
  });

  it('giá BP = giá bán; giá BD, VAT lấy từ bảng giá; thiếu giá bán thì lấy BP rồi BD của bảng giá', () => {
    expect(byCode.get('LOP-A1')).toMatchObject({
      salePrice: 1_500_000,
      salePriceBd: 1_450_000,
      vatPrice: 1_620_000,
      costPrice: 1_100_000,
      minStock: 2,
      unit: 'Cái',
      group: 'Lốp xe',
      subgroup: null,
      brand: 'Hãng A',
    });
    expect(byCode.get('691314')).toMatchObject({ salePrice: 190_000, salePriceBd: 180_000, vatPrice: null, group: 'Phụ tùng bảo dưỡng', subgroup: 'GẠT MƯA', brand: 'Mic' });
    expect(byCode.get('DV-01')).toMatchObject({ kind: 'DICH_VU', group: 'Dịch vụ', subgroup: 'Dịch vụ lốp' });
  });

  it('mã chỉ có ở bảng giá vẫn nhập; mã chưa có tên bị bỏ qua; mã trùng lấy dòng đầu', () => {
    expect(byCode.get('BG-ONLY')).toMatchObject({ name: 'Kumho thử 185/70R14', brand: 'Kumho', salePrice: 0 });
    expect(byCode.has('NONAME')).toBe(false);
    expect(summary).toMatchObject({ duplicates: 1, skipped: 2, noPrice: 1, services: 1 });
  });

  it('sản phẩm đã có xuất nhập kho thì giữ loại cũ, đánh dấu cập nhật', () => {
    expect(byCode.get('OLD-1')).toMatchObject({ kind: 'PHU_TUNG', existingId: 'p-old' });
    expect(summary).toMatchObject({ newProducts: 4, updatedProducts: 1 });
    expect(issues.some((i) => i.level === 'warning' && i.value === 'OLD-1')).toBe(true);
  });

  it('tồn đầu kỳ: bỏ tồn âm, bỏ số bất thường, bỏ chi nhánh không có, dịch vụ không có tồn, giữ số lẻ', () => {
    expect(plan.stock).toEqual([
      { branchCode: 'CN1', code: 'LOP-A1', qty: 4 },
      { branchCode: 'CN3', code: 'LOP-A1', qty: 3 },
      { branchCode: 'CN2', code: '691314', qty: 2.5 },
      { branchCode: 'CN3', code: 'BG-ONLY', qty: 6 },
    ]);
    expect(summary).toMatchObject({ negativeZeroed: 1, abnormalSkipped: 1, missingBranchCodes: ['CN4'] });
    expect(summary.stock).toEqual({ CN1: { items: 1, qty: 4 }, CN3: { items: 2, qty: 9 }, CN2: { items: 1, qty: 2.5 } });
  });

  it('nhóm hàng cha → con', () => {
    expect(plan.groups).toHaveLength(4);
    expect(plan.groups).toEqual(
      expect.arrayContaining([
        { name: 'Dịch vụ', children: ['Dịch vụ lốp'] },
        { name: 'Lốp xe', children: [] },
        { name: 'Phụ tùng bảo dưỡng', children: ['GẠT MƯA'] },
        { name: 'Phụ tùng sửa chữa', children: [] },
      ]),
    );
  });
});
