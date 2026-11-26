import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, createApp, login, PHONES, randomPhone, randomPlate } from './helpers';

describe('Thu chi & công nợ', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let owner: string;
  let sales: string;
  let kt: string;
  let managerCn2: string;
  let cn1: string;
  const range = () => ({ from: new Date(Date.now() - 3_600_000).toISOString(), to: new Date(Date.now() + 3_600_000).toISOString() });

  async function customer() {
    const res = await request(http).post('/api/customers').set(bearer(owner)).send({ name: 'Khách Công Nợ', phone: randomPhone(), vehicle: { plate: randomPlate() } }).expect(201);
    const c = await request(http).get(`/api/customers/${res.body.id}`).set(bearer(owner));
    return { customerId: res.body.id as string, vehicleId: c.body.vehicles[0].id as string };
  }
  async function deliveredOrder(customerId: string, price: number, vehicleId?: string) {
    const o = await request(http).post('/api/orders').set(bearer(sales)).send({ branchId: cn1, customerId, vehicleId, items: [{ kind: 'DICH_VU', name: 'Sửa chữa', quantity: 1, unitPrice: price }] }).expect(201);
    for (const to of ['DANG_SUA', 'HOAN_THANH']) await request(http).post(`/api/orders/${o.body.id}/status`).set(bearer(sales)).send({ to }).expect(200);
    await request(http).post(`/api/orders/${o.body.id}/status`).set(bearer(sales)).send({ to: 'DA_GIAO', allowDebt: true }).expect(200);
    return o.body.id as string;
  }

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    owner = (await login(app, PHONES.owner)).token;
    sales = (await login(app, PHONES.sales)).token;
    kt = (await login(app, PHONES.accountant)).token;
    managerCn2 = (await login(app, PHONES.managerCn2)).token;
    const branches = await request(http).get('/api/branches').set(bearer(owner));
    cn1 = branches.body.find((b: { code: string }) => b.code === 'CN1').id;
  });
  afterAll(() => app.close());

  it('sổ quỹ: tiền thu theo đơn + phiếu chi; huỷ phiếu không tính; quyền & chi nhánh', async () => {
    const { customerId, vehicleId } = await customer();
    const o = await request(http).post('/api/orders').set(bearer(sales)).send({ branchId: cn1, customerId, vehicleId, items: [{ kind: 'DICH_VU', name: 'Rửa xe', quantity: 1, unitPrice: 777_000 }] }).expect(201);
    await request(http).post(`/api/orders/${o.body.id}/payments`).set(bearer(sales)).send({ amount: 777_000, method: 'TIEN_MAT' }).expect(201);

    const before = await request(http).get('/api/finance/cashbook').query({ ...range(), branchId: cn1 }).set(bearer(kt)).expect(200);
    await request(http).post('/api/finance/entries').set(bearer(sales)).send({ type: 'CHI', branchId: cn1, category: 'LUONG', amount: 1, method: 'TIEN_MAT' }).expect(403);
    await request(http).post('/api/finance/entries').set(bearer(kt)).send({ type: 'CHI', branchId: cn1, category: 'KHONG_CO', amount: 1, method: 'TIEN_MAT' }).expect(400);
    await request(http).post('/api/finance/entries').set(bearer(kt)).send({ type: 'CHI', branchId: cn1, category: 'LUONG', amount: 1, method: 'BAO_HIEM' }).expect(400);
    const chi = await request(http).post('/api/finance/entries').set(bearer(kt)).send({ type: 'CHI', branchId: cn1, category: 'DIEN_NUOC', amount: 333_000, method: 'CHUYEN_KHOAN', counterparty: 'Điện lực', note: 'Tiền điện tháng 11' }).expect(201);
    expect(chi.body.code).toMatch(/^PCH\d{6}$/);

    const book = await request(http).get('/api/finance/cashbook').query({ ...range(), branchId: cn1 }).set(bearer(kt)).expect(200);
    expect(book.body.chi - before.body.chi).toBe(333_000);
    expect(book.body.rows.some((r: { code: string; amount: number; category: string }) => r.code === o.body.code && r.amount === 777_000 && r.category === 'Thu tiền đơn hàng')).toBe(true);
    expect(book.body.byMethod.CHUYEN_KHOAN.chi - before.body.byMethod.CHUYEN_KHOAN.chi).toBe(333_000);
    expect(book.body.closing).toBe(book.body.opening + book.body.thu - book.body.chi);

    await request(http).post(`/api/finance/entries/${chi.body.id}/void`).set(bearer(kt)).send({ reason: 'Nhập nhầm' }).expect(200);
    const after = await request(http).get('/api/finance/cashbook').query({ ...range(), branchId: cn1 }).set(bearer(kt)).expect(200);
    expect(after.body.chi).toBe(before.body.chi);
    expect(after.body.rows.find((r: { id: string }) => r.id === chi.body.id).voided).toBe(true);

    await request(http).get('/api/finance/cashbook').query({ ...range(), branchId: cn1 }).set(bearer(managerCn2)).expect(403);
    await request(http).get('/api/finance/cashbook').query(range()).set(bearer(sales)).expect(403);
  });

  it('công nợ: nợ đầu kỳ (AppSheet) + đơn nợ; thu nợ gộp trả đơn cũ trước, dư trừ nợ đầu kỳ', async () => {
    const { customerId } = await customer();
    await app.get(PrismaService).customer.update({ where: { id: customerId }, data: { openingDebt: 1_000_000n } });
    const o1 = await deliveredOrder(customerId, 300_000);
    const o2 = await deliveredOrder(customerId, 500_000);

    const d = await request(http).get(`/api/finance/debts/${customerId}`).set(bearer(kt)).expect(200);
    expect(d.body).toMatchObject({ openingLeft: 1_000_000, total: 1_800_000 });
    expect(d.body.orders.map((o: { id: string }) => o.id)).toEqual([o1, o2]);
    const list = await request(http).get('/api/finance/debts').query({ q: 'Khách Công Nợ', pageSize: 100 }).set(bearer(kt)).expect(200);
    expect(list.body.items.find((x: { id: string }) => x.id === customerId)).toMatchObject({ debt: 1_800_000, openingLeft: 1_000_000, orderDebt: 800_000, orders: 2 });

    await request(http).post(`/api/finance/debts/${customerId}/collect`).set(bearer(kt)).send({ amount: 2_000_000, method: 'TIEN_MAT', branchId: cn1 }).expect(400);
    const r = await request(http).post(`/api/finance/debts/${customerId}/collect`).set(bearer(kt)).send({ amount: 1_000_000, method: 'CHUYEN_KHOAN', branchId: cn1 }).expect(201);
    expect(r.body).toMatchObject({ orders: 2, toOpening: 200_000 });
    expect(r.body.entry).toMatch(/^PT\d{6}$/);

    const o = await request(http).get(`/api/orders/${o2}`).set(bearer(sales));
    expect(o.body).toMatchObject({ paid: 500_000, due: 0, paymentState: 'DA_THU_DU' });
    const c = await request(http).get(`/api/customers/${customerId}`).set(bearer(owner));
    expect(c.body).toMatchObject({ openingLeft: 800_000, orderDebt: 0, debt: 800_000 });

    // Phiếu thu nợ đầu kỳ tay: không vượt phần còn lại
    await request(http).post('/api/finance/entries').set(bearer(kt)).send({ type: 'THU', branchId: cn1, category: 'THU_NO_DAU_KY', amount: 900_000, method: 'TIEN_MAT', customerId }).expect(400);
    await request(http).post('/api/finance/entries').set(bearer(kt)).send({ type: 'THU', branchId: cn1, category: 'THU_NO_DAU_KY', amount: 800_000, method: 'TIEN_MAT', customerId }).expect(201);
    const done = await request(http).get(`/api/finance/debts/${customerId}`).set(bearer(kt));
    expect(done.body.total).toBe(0);
  });
});
