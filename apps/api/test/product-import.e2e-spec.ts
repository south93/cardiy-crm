import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { bearer, createApp, login, PHONES } from './helpers';

/** File Excel GIẢ theo đúng cấu trúc file kho AppSheet (sheet SẢN PHẨM, BANG_GIA_3CN, LO DATE) */
async function fakeWorkbook(tag: string, opts: { cn1Qty: number; price: number }) {
  const wb = new ExcelJS.Workbook();
  const sp = wb.addWorksheet('SẢN PHẨM');
  sp.addRow(['id', 'loai_hang', 'nhom_hang', 'nhom_hang_1', 'hang', 'phan_loai', 'ma_sp', 'ten_sp', 'dvt', 'gia_ban', 'gia_nhap_ht', 'ton_min']);
  sp.addRow(['x1', 'Hàng hóa', 'LX', 'LX', 'Hãng Thử', 'Bán trực tiếp', `LOP${tag}`, `Lốp thử ${tag} 205/55R16`, 'cái', opts.price, null, 2]);
  sp.addRow(['x2', 'Hàng hóa', 'PTBD', 'LỌC NHỚT', 'Hãng Lọc', 'Bán trực tiếp', `LOC${tag}`, `Lọc nhớt thử ${tag}`, 'Cái', 120_000, 80_000, null]);
  sp.addRow(['x3', 'Dịch vụ', 'DV', 'Dịch vụ lốp', null, null, `DV${tag}`, `Công thử ${tag}`, 'Lần', 50_000, null, null]);
  sp.addRow(['x4', 'Hàng hóa', 'LX', 'LX', 'Hãng Thử', null, `LOP${tag}`, `Lốp thử ${tag} 205/55R16`, 'cái', opts.price, null, 2]);
  const bg = wb.addWorksheet('BANG_GIA_3CN');
  bg.addRow(['MA_HANG', 'HANG', 'NHOM', 'SIZE', 'TEN_HANG', 'DVT', 'GIA_BD', 'GIA_BP', 'GIA_VAT', 'TON_CN1', 'TON_CN2', 'TON_CN3']);
  bg.addRow([`LOP${tag}`, 'HÃNG THỬ', 'LX', '205/55R16', `Lốp thử ${tag} 205/55R16`, 'Cái', opts.price - 50_000, opts.price, opts.price + 120_000, opts.cn1Qty, -3, 20_000]);
  bg.addRow([`LOC${tag}`, 'HÃNG LỌC', 'PTBD', null, `Lọc nhớt thử ${tag}`, 'Cái', 110_000, 120_000, null, 4.5, 2, null]);
  bg.addRow([`DV${tag}`, null, 'DV', null, `Công thử ${tag}`, 'Lần', null, 50_000, null, 9, null, null]);
  const lots = wb.addWorksheet('LO DATE ');
  lots.addRow(['id', 'so_lo', 'chi_nhanh', 'ma_sp', 'sl_trong_kho', 'gia_von']);
  lots.addRow(['l1', 'L1', 'CN1', `LOP${tag}`, 2, 1_000_000]);
  lots.addRow(['l2', 'L2', 'CN1', `LOP${tag}`, 1, 1_300_000]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('Nhập sản phẩm & tồn đầu kỳ từ file Excel AppSheet', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let owner: string;
  let tk: string;
  let sales: string;
  const branch: Record<string, string> = {};

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    owner = (await login(app, PHONES.owner)).token;
    tk = (await login(app, PHONES.storekeeper)).token;
    sales = (await login(app, PHONES.sales)).token;
    for (const b of (await request(http).get('/api/branches').set(bearer(owner))).body) branch[b.code] = b.id;
  });
  afterAll(() => app.close());

  it('xem trước → xác nhận: sản phẩm, nhóm hàng, giá BP/BD/VAT, giá vốn theo lô, phiếu tồn đầu kỳ; nhập lại thì cập nhật, không nhân đôi tồn', async () => {
    const tag = Math.random().toString(36).slice(2, 7).toUpperCase();
    const file = await fakeWorkbook(tag, { cn1Qty: 6, price: 1_500_000 });
    await request(http).post('/api/products/import/preview').set(bearer(sales)).attach('file', file, 'kho.xlsx').expect(403);
    await request(http).post('/api/products/import/preview').set(bearer(owner)).attach('file', Buffer.from('khong phai excel'), 'kho.xlsx').expect(400);

    const pv = await request(http).post('/api/products/import/preview').set(bearer(owner)).attach('file', file, 'kho.xlsx').expect(201);
    expect(pv.body.summary).toMatchObject({ products: 3, newProducts: 3, services: 1, duplicates: 1, negativeZeroed: 1, abnormalSkipped: 1 });
    expect(pv.body.summary.stock).toEqual({ CN1: { items: 2, qty: 10.5 }, CN2: { items: 1, qty: 2 } });
    expect(pv.body.sample.find((p: { code: string }) => p.code === `LOP${tag}`)).toMatchObject({ salePrice: 1_500_000, salePriceBd: 1_450_000, vatPrice: 1_620_000, group: 'Lốp xe' });

    const res = await request(http).post(`/api/products/import/${pv.body.id}/commit`).set(bearer(owner)).expect(201);
    expect(res.body).toMatchObject({ created: 3, updated: 0 });
    expect(res.body.documents.map((d: { branch: string; lines: number }) => [d.branch, d.lines]).sort()).toEqual([
      ['CN1', 2],
      ['CN2', 1],
    ]);
    await request(http).post(`/api/products/import/${pv.body.id}/commit`).set(bearer(owner)).expect(409);

    const list = await request(http).get('/api/products').query({ q: tag, branchId: branch.CN1 }).set(bearer(owner)).expect(200);
    const lop = list.body.items.find((p: { code: string }) => p.code === `LOP${tag}`);
    expect(lop).toMatchObject({ salePrice: 1_500_000, salePriceBd: 1_450_000, price: 1_500_000, costPrice: 1_100_000, stock: 6, unit: 'Cái', category: { name: 'Lốp xe' } });
    expect(list.body.items.find((p: { code: string }) => p.code === `LOC${tag}`)).toMatchObject({ stock: 4.5, costPrice: 80_000, category: { name: 'Phụ tùng bảo dưỡng › LỌC NHỚT' } });
    expect(list.body.items.find((p: { code: string }) => p.code === `DV${tag}`)).toMatchObject({ kind: 'DICH_VU', stock: null });

    // File mới hơn: giá đổi, tồn CN1 đổi → cập nhật theo mã, phiếu điều chỉnh chỉ ghi chênh lệch
    const pv2 = await request(http)
      .post('/api/products/import/preview')
      .set(bearer(owner))
      .attach('file', await fakeWorkbook(tag, { cn1Qty: 4, price: 1_600_000 }), 'kho.xlsx')
      .expect(201);
    expect(pv2.body.summary).toMatchObject({ newProducts: 0, updatedProducts: 3 });
    const res2 = await request(http).post(`/api/products/import/${pv2.body.id}/commit`).set(bearer(owner)).expect(201);
    expect(res2.body).toMatchObject({ created: 0, updated: 3, newGroups: 0 });
    expect(res2.body.documents).toEqual([expect.objectContaining({ branch: 'CN1', lines: 1 })]);
    const after = await request(http)
      .get('/api/products')
      .query({ q: `LOP${tag}`, branchId: branch.CN1 })
      .set(bearer(owner))
      .expect(200);
    expect(after.body.items[0]).toMatchObject({ salePrice: 1_600_000, stock: 4 });

    // Thủ kho xem trước được nhưng không xác nhận (cần quyền duyệt điều chỉnh tồn)
    const pv3 = await request(http).post('/api/products/import/preview').set(bearer(tk)).attach('file', file, 'kho.xlsx').expect(201);
    await request(http).post(`/api/products/import/${pv3.body.id}/commit`).set(bearer(tk)).expect(403);
    const csv = await request(http).get(`/api/products/import/${pv2.body.id}/issues.csv`).set(bearer(owner)).expect(200);
    expect(csv.text).toContain('Tồn âm');
  });

  it('bảng giá theo chi nhánh: chi nhánh vùng BD lấy giá Bình Dương khi chọn sản phẩm', async () => {
    const tag = Math.random().toString(36).slice(2, 7).toUpperCase();
    const p = await request(http)
      .post('/api/products')
      .set(bearer(owner))
      .send({ name: `Lốp vùng ${tag}`, kind: 'PHU_TUNG', salePrice: 1_000_000, salePriceBd: 950_000, vatPrice: 1_080_000 })
      .expect(201);
    const before = (await request(http).get('/api/branches').set(bearer(owner))).body.find((b: { id: string }) => b.id === branch.CN3).priceZone as string;
    await request(http).patch(`/api/branches/${branch.CN3}`).set(bearer(owner)).send({ priceZone: 'BD' }).expect(200);
    try {
      const at3 = await request(http).get('/api/products').query({ q: p.body.code, branchId: branch.CN3 }).set(bearer(owner)).expect(200);
      const at1 = await request(http).get('/api/products').query({ q: p.body.code, branchId: branch.CN1 }).set(bearer(owner)).expect(200);
      expect(at3.body.items[0].price).toBe(950_000);
      expect(at1.body.items[0].price).toBe(1_000_000);
      // Bỏ giá BD → vùng BD dùng giá chính
      await request(http).patch(`/api/products/${p.body.id}`).set(bearer(owner)).send({ salePriceBd: null }).expect(200);
      expect((await request(http).get('/api/products').query({ q: p.body.code, branchId: branch.CN3 }).set(bearer(owner))).body.items[0].price).toBe(1_000_000);
    } finally {
      await request(http).patch(`/api/branches/${branch.CN3}`).set(bearer(owner)).send({ priceZone: before }).expect(200);
    }
  });
});
