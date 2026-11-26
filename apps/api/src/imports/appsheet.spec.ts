import {
  analyzeCustomers,
  analyzeVehicles,
  classifyPlate,
  decodeFile,
  detectKind,
  importPhone,
  mapSource,
  parseDate,
  parseMoney,
  parseOwner,
  parseTable,
  type ExistingData,
} from './appsheet';

/** Dữ liệu GIẢ mô phỏng định dạng xuất từ AppSheet (không dùng dữ liệu khách thật). */
const CUSTOMER_HEADER =
  '"Tên khách hàng","Điện thoại","Thông tin khách hàng","Địa chỉ","CCCD","Mail","Đại diện","Chức vụ","MST","STK","Ngân hàng","Người tạo","Ngày tạo","Tổng tiền","Đã thu","Còn nợ","Công nợ ban đầu","Ghi chú","Nguồn khách hàng","Chi nhánh","Chi tiết xe",';

function csv(lines: string[]): Buffer {
  return Buffer.from('﻿' + [CUSTOMER_HEADER, ...lines].join('\r\n'), 'utf8');
}
const row = (o: { name: string; phone: string; plates?: string; source?: string; branch?: string; debt?: string; date?: string; tax?: string }) =>
  `"${o.name}","${o.phone}","${o.name} - ${o.phone}","","","","","","${o.tax ?? ''}","","","","${o.date ?? ''}","0","0","0","${o.debt ?? ''}","","${o.source ?? ''}","${o.branch ?? ''}","${o.plates ?? ''}",`;

const empty = (): ExistingData => ({ customersByPhone: new Map(), vehiclesByPlate: new Map(), branchCodes: new Set(['CN1', 'CN2']) });

function analyze(lines: string[], existing = empty()) {
  const { text } = decodeFile(csv(lines));
  const { headers, rows } = parseTable(text);
  return analyzeCustomers(headers, rows, existing);
}

describe('Chuẩn hoá giá trị', () => {
  it('SĐT mất số 0 đầu (Excel) được thêm lại; số rác bị loại', () => {
    expect(importPhone('909735299')).toBe('0909735299');
    expect(importPhone('0909735299')).toBe('0909735299');
    expect(importPhone('+84 909 735 299')).toBe('0909735299');
    for (const bad of ['123', '0', 'CN3', '00', '088', '']) expect(importPhone(bad)).toBeNull();
  });

  it('phân loại biển số: đúng mẫu / thiếu số / không phải biển', () => {
    expect(classifyPlate('61C27999')).toEqual({ kind: 'valid', plateNo: '61C27999' });
    expect(classifyPlate('61LD07621')).toEqual({ kind: 'valid', plateNo: '61LD07621' });
    expect(classifyPlate('93E276')).toEqual({ kind: 'partial', plateNo: '93E276' });
    expect(classifyPlate('XEBAGAC')).toEqual({ kind: 'text', text: 'XEBAGAC' });
  });

  it('nguồn khách theo danh mục AppSheet', () => {
    expect(mapSource('1. Zalo')).toBe('ZALO');
    expect(mapSource('4. Khách cũ giới thiệu')).toBe('GIOI_THIEU');
    expect(mapSource('5. Khách cũ')).toBe('KHACH_CU');
    expect(mapSource('6. Vãng lai')).toBe('VANG_LAI');
    expect(mapSource('8. Cuộc Gọi Nhận (CSKH)')).toBe('CUOC_GOI');
    expect(mapSource('9. Gara')).toBe('GARA');
    expect(mapSource('10. Chăm sóc xe')).toBe('CHAM_SOC_XE');
    expect(mapSource('11. Đại lý')).toBe('DAI_LY');
    expect(mapSource('12. Website')).toBe('WEBSITE');
    expect(mapSource('3. Tiktok')).toBe('TIKTOK');
    expect(mapSource('')).toBe('KHAC');
  });

  it('tiền, ngày, chủ xe dạng "Tên - SĐT"', () => {
    expect(parseMoney('2.190.000')).toBe(2190000);
    expect(parseMoney('')).toBe(0);
    expect(parseDate('11/05/2026')).toBe('2026-05-11');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseOwner('Anh Thành (hội Dream) - 0888809666')).toEqual({ name: 'Anh Thành (hội Dream)', phone: '0888809666' });
    expect(parseOwner('Công Ty A - B - 0784191288')).toEqual({ name: 'Công Ty A - B', phone: '0784191288' });
    expect(parseOwner('Anh Lực - 51D61380')).toEqual({ name: 'Anh Lực - 51D61380', phone: null });
  });
});

describe('Đọc file', () => {
  it('nhận UTF-8 có BOM; báo mất dấu khi file bảng mã Windows-1252', () => {
    expect(decodeFile(csv([])).encoding).toBe('utf-8');
    const legacy = Buffer.from('T\xEAn kh\xE1ch h\xE0ng\tTr?n V?n Ti?p', 'latin1');
    const d = decodeFile(legacy);
    expect(d.encoding).toBe('windows-1252');
    expect(d.lossy).toBe(true);
  });

  it('tự nhận dấu phân cách tab / phẩy và loại file', () => {
    const t = parseTable('Tên khách hàng\tĐiện thoại\nA\t0909735299\n');
    expect(t.rows).toEqual([['A', '0909735299']]);
    expect(detectKind(t.headers)).toBe('CUSTOMERS');
    expect(detectKind(['Thông tin khách hàng', 'Biển số', 'Hãng xe'])).toBe('VEHICLES');
    expect(detectKind(['Cột lạ'])).toBeNull();
  });
});

describe('Phân tích file khách hàng', () => {
  it('khách bình thường + nhiều biển trong một ô', () => {
    const r = analyze([row({ name: 'Chị Hảo', phone: '903952546', plates: '61C21425 , 61LD07621', source: '5. Khách cũ', branch: 'CN1', debt: '500.000', date: '11/05/2026' })]);
    expect(r.summary).toMatchObject({ newCustomers: 1, newVehicles: 2, errors: 0 });
    const c = r.plan.newCustomers[0]!;
    expect(c).toMatchObject({ name: 'Chị Hảo', phone: '0903952546', source: 'KHACH_CU', branchCode: 'CN1', openingDebt: 500000, createdAt: '2026-05-11' });
    expect(r.plan.newVehicles.map((v) => v.ownerId)).toEqual([c.id, c.id]);
  });

  it('nhiều dòng cùng SĐT → gộp 1 khách, gom đủ biển số', () => {
    const r = analyze([row({ name: 'Anh Dũng', phone: '0792502520', plates: '61C30951' }), row({ name: 'Anh Dũng', phone: '792502520', plates: '61C30952' })]);
    expect(r.summary).toMatchObject({ newCustomers: 1, mergedRows: 1, newVehicles: 2 });
  });

  it('SĐT rác + có biển → khách không SĐT; SĐT rác + không biển → lỗi bỏ qua', () => {
    const r = analyze([row({ name: 'Khách lẻ', phone: '123', plates: '61A12345' }), row({ name: 'Không gì', phone: '0', plates: '' })]);
    expect(r.summary).toMatchObject({ newCustomers: 1, customersWithoutPhone: 1, skippedRows: 1, errors: 1 });
    expect(r.plan.newCustomers[0]!.phone).toBeNull();
  });

  it('biển ghi ở 2 khách → gán khách đầu, cảnh báo', () => {
    const r = analyze([row({ name: 'A', phone: '0911111111', plates: '61A59091' }), row({ name: 'B', phone: '0922222222', plates: '61A59091' })]);
    expect(r.plan.newVehicles).toHaveLength(1);
    expect(r.plan.newVehicles[0]!.ownerId).toBe(r.plan.newCustomers[0]!.id);
    expect(r.issues.some((i) => i.message.includes('ghi ở nhiều khách'))).toBe(true);
  });

  it('biển thiếu số → nhập nhưng đánh dấu; chữ không phải biển → ghi chú khách', () => {
    const r = analyze([row({ name: 'C', phone: '0933333333', plates: '93E276, XEBAGAC' })]);
    expect(r.plan.newVehicles).toEqual([expect.objectContaining({ plateNo: '93E276', plateValid: false })]);
    expect(r.plan.newCustomers[0]!.note).toContain('Ghi chú xe cũ: XEBAGAC');
    expect(r.summary.partialPlates).toBe(1);
  });

  it('khách đã có (theo SĐT) → không tạo trùng, chỉ bổ sung xe mới; xe đã có → bỏ qua', () => {
    const ex = empty();
    ex.customersByPhone.set('0944444444', 'id-cu');
    ex.vehiclesByPlate.set('61C00001', { id: 'xe-cu', ownerCustomerId: 'id-cu', filled: {} });
    const r = analyze([row({ name: 'D', phone: '0944444444', plates: '61C00001, 61C00002' })], ex);
    expect(r.summary).toMatchObject({ newCustomers: 0, existingCustomers: 1, newVehicles: 1 });
    expect(r.plan.newVehicles[0]).toMatchObject({ plateNo: '61C00002', ownerId: 'id-cu' });
  });

  it('nhập lại: khách không SĐT được nhận diện theo biển số đã có, không tạo trùng', () => {
    const ex = empty();
    ex.vehiclesByPlate.set('61A12345', { id: 'xe', ownerCustomerId: 'khach-khong-sdt', filled: {} });
    const r = analyze([row({ name: 'Khách lẻ', phone: '123', plates: '61A12345, 61A12346' })], ex);
    expect(r.summary).toMatchObject({ newCustomers: 0, existingCustomers: 1, newVehicles: 1, customersWithoutPhone: 0 });
    expect(r.plan.newVehicles[0]).toMatchObject({ plateNo: '61A12346', ownerId: 'khach-khong-sdt' });
  });

  it('chi nhánh chưa có được liệt kê; công ty được nhận diện', () => {
    const r = analyze([row({ name: 'CÔNG TY TNHH ABC', phone: '0955555555', branch: 'CN3', tax: '0301412222' })]);
    expect(r.plan.missingBranchCodes).toEqual(['CN3']);
    expect(r.plan.newCustomers[0]).toMatchObject({ type: 'COMPANY', taxCode: '0301412222' });
  });
});

describe('Phân tích file xe', () => {
  const head = 'Thông tin khách hàng,Biển số,Thông tin hiển thị,Hãng xe,Dòng xe,Đời xe,Màu xe,Số vin,Size lốp,Km,Loại nhiên liệu,Loại hộp số,Ghi chú,Người tạo,Ngày tạo';
  const parseVehicles = (lines: string[], ex = empty()) => {
    const { headers, rows } = parseTable([head, ...lines].join('\n'));
    return analyzeVehicles(headers, rows, ex);
  };

  it('xe mới + chủ mới từ chuỗi "Tên - SĐT"', () => {
    const r = parseVehicles(['Anh Huy - 0918750686,61K37515,,Toyota,Vios,2019,Trắng,,185/60R15,45.000,Xăng,Số tự động,,admin,28/04/2026']);
    expect(r.summary).toMatchObject({ newCustomers: 1, newVehicles: 1 });
    expect(r.plan.newVehicles[0]).toMatchObject({ plateNo: '61K37515', make: 'Toyota', model: 'Vios', year: 2019, km: 45000, tireSize: '185/60R15' });
  });

  it('xe đã có: chỉ điền chỗ trống, không đổi chủ tự động', () => {
    const ex = empty();
    ex.customersByPhone.set('0918750686', 'chu-moi');
    ex.vehiclesByPlate.set('61K37515', { id: 'xe1', ownerCustomerId: 'chu-cu', filled: { make: 'Mazda', model: null } });
    const r = parseVehicles(['Anh Huy - 0918750686,61K37515,,Toyota,Vios,,,,,,,,,,'], ex);
    expect(r.plan.vehicleUpdates[0]).toMatchObject({ vehicleId: 'xe1', data: { model: 'Vios' }, setOwnerId: null });
    expect(r.issues.some((i) => i.message.includes('không đổi chủ tự động'))).toBe(true);
  });
});
