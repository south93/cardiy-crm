import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, login, PHONES } from './helpers';

describe('Quỹ đầu kỳ chi nhánh & công nợ phải trả nhà cung cấp', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let owner: string;
  let kt: string;
  let tk: string;
  let sales: string;
  let cn1: string;
  const tag = () => Math.random().toString(36).slice(2, 7);

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    owner = (await login(app, PHONES.owner)).token;
    kt = (await login(app, PHONES.accountant)).token;
    tk = (await login(app, PHONES.storekeeper)).token;
    sales = (await login(app, PHONES.sales)).token;
    const branches = await request(http).get('/api/branches').set(bearer(owner));
    cn1 = branches.body.find((b: { code: string }) => b.code === 'CN1').id;
  });
  afterAll(() => app.close());

  it('quỹ đầu kỳ: mỗi chi nhánh một phiếu, vào sổ quỹ tiền mặt; huỷ để nhập lại', async () => {
    const cur = await request(http).get('/api/finance/opening-fund').query({ branchId: cn1 }).set(bearer(kt)).expect(200);
    if (cur.body.fund) await request(http).post(`/api/finance/entries/${cur.body.fund.id}/void`).set(bearer(kt)).send({ reason: 'Nhập lại khi chạy test' }).expect(200);

    const at = new Date(Date.now() - 60_000).toISOString();
    const e = await request(http)
      .post('/api/finance/entries')
      .set(bearer(kt))
      .send({ type: 'THU', branchId: cn1, category: 'QUY_DAU_KY', amount: 18_000_000, method: 'TIEN_MAT', occurredAt: at, note: 'Ký quỹ đầu kỳ' })
      .expect(201);
    await request(http).post('/api/finance/entries').set(bearer(kt)).send({ type: 'THU', branchId: cn1, category: 'QUY_DAU_KY', amount: 1, method: 'TIEN_MAT' }).expect(409);
    const f = await request(http).get('/api/finance/opening-fund').query({ branchId: cn1 }).set(bearer(kt)).expect(200);
    expect(f.body.fund).toMatchObject({ id: e.body.id, amount: 18_000_000, method: 'TIEN_MAT' });

    const book = await request(http)
      .get('/api/finance/cashbook')
      .query({ branchId: cn1, from: new Date(Date.now() - 3_600_000).toISOString(), to: new Date(Date.now() + 3_600_000).toISOString() })
      .set(bearer(kt))
      .expect(200);
    expect(book.body.rows.find((r: { id: string }) => r.id === e.body.id)).toMatchObject({ category: 'Quỹ đầu kỳ chi nhánh (ký quỹ)', amount: 18_000_000 });

    await request(http).post(`/api/finance/entries/${e.body.id}/void`).set(bearer(kt)).send({ reason: 'Nhập sai số' }).expect(200);
    expect((await request(http).get('/api/finance/opening-fund').query({ branchId: cn1 }).set(bearer(kt)).expect(200)).body.fund).toBeNull();
    await request(http).post('/api/finance/entries').set(bearer(kt)).send({ type: 'THU', branchId: cn1, category: 'QUY_DAU_KY', amount: 15_000_000, method: 'TIEN_MAT', occurredAt: at }).expect(201);
  });

  it('công nợ NCC = nợ đầu kỳ + phiếu nhập − phiếu chi trả; không trả quá nợ; huỷ phiếu chi thì nợ quay lại', async () => {
    const name = `NCC Lốp ${tag()}`;
    const sup = await request(http).post('/api/suppliers').set(bearer(tk)).send({ name, phone: '0283777666', openingPayable: 5_000_000 }).expect(201);
    const p = await request(http)
      .post('/api/products')
      .set(bearer(tk))
      .send({ name: `Lốp NCC ${tag()}`, kind: 'PHU_TUNG', unit: 'cái', salePrice: 2_000_000, costPrice: 1_500_000 })
      .expect(201);
    await request(http)
      .post('/api/stock-documents')
      .set(bearer(tk))
      .send({ type: 'NHAP', branchId: cn1, supplierId: sup.body.id, refNo: 'HD-NCC-1', lines: [{ productId: p.body.id, quantity: '4', unitCost: 1_500_000 }] })
      .expect(201);

    const list = await request(http).get('/api/finance/payables').query({ q: name }).set(bearer(kt)).expect(200);
    expect(list.body.items[0]).toMatchObject({ id: sup.body.id, opening: 5_000_000, purchased: 6_000_000, paid: 0, balance: 11_000_000 });
    await request(http).get('/api/finance/payables').set(bearer(sales)).expect(403);

    // Phiếu chi trả NCC bắt buộc chọn NCC và không vượt số nợ
    await request(http).post('/api/finance/entries').set(bearer(kt)).send({ type: 'CHI', branchId: cn1, category: 'CHI_NHA_CUNG_CAP', amount: 100_000, method: 'TIEN_MAT' }).expect(400);
    await request(http).post(`/api/finance/payables/${sup.body.id}/pay`).set(bearer(kt)).send({ amount: 12_000_000, method: 'CHUYEN_KHOAN', branchId: cn1 }).expect(400);
    const pay = await request(http).post(`/api/finance/payables/${sup.body.id}/pay`).set(bearer(kt)).send({ amount: 7_000_000, method: 'CHUYEN_KHOAN', branchId: cn1, note: 'Trả đợt 1' }).expect(201);
    expect(pay.body.code).toMatch(/^PCH\d{6}$/);

    const d = await request(http).get(`/api/finance/payables/${sup.body.id}`).set(bearer(kt)).expect(200);
    expect(d.body).toMatchObject({ opening: 5_000_000, purchased: 6_000_000, paid: 7_000_000, balance: 4_000_000 });
    expect(d.body.rows.map((r: { kind: string; balance: number }) => [r.kind, r.balance])).toEqual([
      ['TRA', 4_000_000],
      ['NHAP', 11_000_000],
    ]);
    const sups = await request(http).get('/api/suppliers').query({ q: name }).set(bearer(tk)).expect(200);
    expect(sups.body[0]).toMatchObject({ openingPayable: 5_000_000, paid: 7_000_000, balance: 4_000_000 });

    await request(http).post(`/api/finance/entries/${pay.body.id}/void`).set(bearer(kt)).send({ reason: 'Chuyển nhầm tài khoản' }).expect(200);
    expect((await request(http).get(`/api/finance/payables/${sup.body.id}`).set(bearer(kt)).expect(200)).body.balance).toBe(11_000_000);

    // Trả hết thì không còn trong danh sách nợ (trừ khi xem tất cả)
    await request(http).post(`/api/finance/payables/${sup.body.id}/pay`).set(bearer(kt)).send({ amount: 11_000_000, method: 'TIEN_MAT', branchId: cn1 }).expect(201);
    expect((await request(http).get('/api/finance/payables').query({ q: name }).set(bearer(kt)).expect(200)).body.items).toHaveLength(0);
    expect((await request(http).get('/api/finance/payables').query({ q: name, all: 'true' }).set(bearer(kt)).expect(200)).body.items).toHaveLength(1);
  });
});
