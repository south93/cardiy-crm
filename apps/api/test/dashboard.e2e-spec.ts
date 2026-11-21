import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, login, PHONES, randomPhone } from './helpers';

describe('Tổng quan', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let owner: string;
  let sales: string;
  let cskh: string;
  let tech: string;
  let managerCn2: string;
  let cn1: string;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    owner = (await login(app, PHONES.owner)).token;
    sales = (await login(app, PHONES.sales)).token;
    cskh = (await login(app, PHONES.cskh)).token;
    tech = (await login(app, PHONES.tech)).token;
    managerCn2 = (await login(app, PHONES.managerCn2)).token;
    const branches = await request(http).get('/api/branches').set(bearer(owner));
    cn1 = branches.body.find((b: { code: string }) => b.code === 'CN1').id;
  });
  afterAll(() => app.close());

  it('số liệu thật: doanh thu hôm nay, đã thu, công nợ, đơn đang mở, top hạng mục', async () => {
    const before = await request(http).get('/api/dashboard').query({ branchId: cn1 }).set(bearer(owner)).expect(200);
    const tag = Math.random().toString(36).slice(2, 7);
    // Giá cao hơn hạng mục đang đứng đầu để chắc chắn lên top (CSDL kiểm thử tích luỹ qua các lần chạy)
    const price = Math.max(50_000_000_000, (before.body.top?.[0]?.revenue ?? 0) + 1_000_000_000);
    const c = await request(http).post('/api/customers').set(bearer(owner)).send({ name: 'Khách Tổng Quan', phone: randomPhone() }).expect(201);
    const o = await request(http)
      .post('/api/orders')
      .set(bearer(sales))
      .send({ branchId: cn1, customerId: c.body.id, items: [{ kind: 'DICH_VU', name: `Gói chăm sóc ${tag}`, quantity: 1, unitPrice: price }] })
      .expect(201);
    const mid = await request(http).get('/api/dashboard').query({ branchId: cn1 }).set(bearer(owner));
    expect(mid.body.orders.TIEP_NHAN - before.body.orders.TIEP_NHAN).toBe(1);
    for (const to of ['DANG_SUA', 'HOAN_THANH']) await request(http).post(`/api/orders/${o.body.id}/status`).set(bearer(sales)).send({ to }).expect(200);
    await request(http).post(`/api/orders/${o.body.id}/payments`).set(bearer(sales)).send({ amount: 9_000_000, method: 'TIEN_MAT' }).expect(201);
    await request(http).post(`/api/orders/${o.body.id}/status`).set(bearer(sales)).send({ to: 'DA_GIAO', allowDebt: true }).expect(200);

    const after = await request(http).get('/api/dashboard').query({ branchId: cn1 }).set(bearer(owner)).expect(200);
    expect(after.body.revenue.today - before.body.revenue.today).toBe(price);
    expect(after.body.revenue.collectedToday - before.body.revenue.collectedToday).toBe(9_000_000);
    expect(after.body.revenue.debt - before.body.revenue.debt).toBe(price - 9_000_000);
    expect(after.body.revenue.days).toHaveLength(30);
    expect(after.body.revenue.days.at(-1).revenue).toBe(after.body.revenue.today);
    expect(after.body.top[0]).toMatchObject({ name: `Gói chăm sóc ${tag}`, revenue: price });
    expect(after.body.orders.TIEP_NHAN).toBe(before.body.orders.TIEP_NHAN);
  });

  it('CSKH thấy tổng quan nhưng không thấy tiền; KTV không vào; chi nhánh ngoài phạm vi → 403', async () => {
    const r = await request(http).get('/api/dashboard').set(bearer(cskh)).expect(200);
    expect(r.body).toMatchObject({ money: false, revenue: null, top: [] });
    expect(typeof r.body.careDue).toBe('number');
    await request(http).get('/api/dashboard').set(bearer(tech)).expect(403);
    await request(http).get('/api/dashboard').query({ branchId: cn1 }).set(bearer(managerCn2)).expect(403);
  });
});
