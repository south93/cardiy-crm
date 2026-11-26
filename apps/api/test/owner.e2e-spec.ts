import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, DEMO_PASSWORD, login, PHONES, randomPhone, randomPlate } from './helpers';

describe('App chủ xe: lời mời, kích hoạt, xe của tôi, lịch sử sửa chữa', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let sales: string;
  let tech: string;
  let cn1: string;

  async function customerWithHistory(phone = randomPhone()) {
    const c = await request(http)
      .post('/api/customers')
      .set(bearer(sales))
      .send({ name: 'Chủ Xe App', phone, vehicle: { plate: randomPlate(), make: 'Toyota', model: 'Vios' } })
      .expect(201);
    const cd = await request(http).get(`/api/customers/${c.body.id}`).set(bearer(sales));
    const vehicleId = cd.body.vehicles[0].id as string;
    const o = await request(http)
      .post('/api/orders')
      .set(bearer(sales))
      .send({ branchId: cn1, customerId: c.body.id, vehicleId, request: 'Bảo dưỡng', items: [{ kind: 'DICH_VU', name: 'Bảo dưỡng 10.000 km', quantity: 1, unitPrice: 850_000 }] })
      .expect(201);
    for (const to of ['DANG_SUA', 'HOAN_THANH']) await request(http).post(`/api/orders/${o.body.id}/status`).set(bearer(sales)).send({ to }).expect(200);
    await request(http).post(`/api/orders/${o.body.id}/payments`).set(bearer(sales)).send({ amount: 850_000, method: 'TIEN_MAT' }).expect(201);
    await request(http).post(`/api/orders/${o.body.id}/status`).set(bearer(sales)).send({ to: 'DA_GIAO' }).expect(200);
    return { customerId: c.body.id as string, vehicleId, orderId: o.body.id as string, phone };
  }
  async function invite(customerId: string) {
    const r = await request(http).post(`/api/customers/${customerId}/app/invite`).set(bearer(sales)).expect(201);
    expect(r.body.url).toMatch(/\/app\/kich-hoat\/[\w-]{20,}$/);
    expect(r.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    return r.body.url.split('/').pop() as string;
  }

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    sales = (await login(app, PHONES.sales)).token;
    tech = (await login(app, PHONES.tech)).token;
    const branches = await request(http).get('/api/branches').set(bearer(sales));
    cn1 = branches.body.find((b: { code: string }) => b.code === 'CN1').id;
  });
  afterAll(() => app.close());

  it('mời → kích hoạt (đặt mật khẩu) → xem xe, lịch sử, chi tiết đơn → cập nhật km → đăng nhập lại, làm mới phiên', async () => {
    const a = await customerWithHistory();
    await request(http).post(`/api/customers/${a.customerId}/app/invite`).set(bearer(tech)).expect(403);
    const token = await invite(a.customerId);
    const st = await request(http).get(`/api/customers/${a.customerId}/app`).set(bearer(sales)).expect(200);
    expect(st.body).toMatchObject({ canInvite: true, linked: null });
    expect(st.body.invite.expiresAt).toBeTruthy();

    const pv = await request(http).get(`/api/owner/auth/invite/${token}`).expect(200);
    expect(pv.body).toMatchObject({ customerName: 'Chủ Xe App', hasAccount: false });
    expect(pv.body.phone).toMatch(/^\d{4}\*\*\*\d{3}$/);
    await request(http).get('/api/owner/auth/invite/khong-phai-token-that-0000000').expect(404);

    await request(http).post('/api/owner/auth/activate').send({ token, password: '123' }).expect(400);
    const act = await request(http).post('/api/owner/auth/activate').send({ token, password: 'Chuxe2026' }).expect(200);
    const owner = act.body.accessToken as string;
    expect(String(act.headers['set-cookie'])).toContain('cardiy_ort=');
    // Link dùng một lần
    await request(http).post('/api/owner/auth/activate').send({ token, password: 'Chuxe2026' }).expect(410);
    expect((await request(http).get(`/api/customers/${a.customerId}/app`).set(bearer(sales))).body.linked).toBeTruthy();
    await request(http).post(`/api/customers/${a.customerId}/app/invite`).set(bearer(sales)).expect(409);

    const me = await request(http).get('/api/owner/me').set(bearer(owner)).expect(200);
    expect(me.body.garages).toHaveLength(1);
    const vs = await request(http).get('/api/owner/vehicles').set(bearer(owner)).expect(200);
    expect(vs.body).toHaveLength(1);
    expect(vs.body[0]).toMatchObject({ id: a.vehicleId, make: 'Toyota', visits: 1, openOrder: null });

    const v = await request(http).get(`/api/owner/vehicles/${a.vehicleId}`).set(bearer(owner)).expect(200);
    expect(v.body.orders).toHaveLength(1);
    expect(v.body.orders[0]).toMatchObject({ id: a.orderId, status: 'DA_GIAO', total: 850_000, items: ['Bảo dưỡng 10.000 km'] });
    const o = await request(http).get(`/api/owner/orders/${a.orderId}`).set(bearer(owner)).expect(200);
    expect(o.body).toMatchObject({ total: 850_000, paid: 850_000, due: 0, paymentState: 'DA_THU_DU' });
    expect(o.body.history.map((h: { status: string }) => h.status)).toContain('DA_GIAO');

    await request(http).post(`/api/owner/vehicles/${a.vehicleId}/odometer`).set(bearer(owner)).send({ km: 12000 }).expect(201);
    await request(http).post(`/api/owner/vehicles/${a.vehicleId}/odometer`).set(bearer(owner)).send({ km: 11000 }).expect(400);
    const veh = await request(http).get(`/api/vehicles/${a.vehicleId}`).set(bearer(sales)).expect(200);
    expect(veh.body.odometerKm).toBe(12000);

    // Đăng nhập lại bằng SĐT + mật khẩu, làm mới phiên bằng cookie riêng của app
    const lg = await request(http).post('/api/owner/auth/login').send({ phone: a.phone, password: 'Chuxe2026' }).expect(200);
    const cookie = (lg.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('cardiy_ort='))!.split(';')[0]!;
    const rf = await request(http).post('/api/owner/auth/refresh').set('Cookie', cookie).expect(200);
    expect(rf.body.accessToken).toBeTruthy();
    await request(http).post('/api/owner/auth/login').send({ phone: a.phone, password: 'sai-mat-khau-1' }).expect(401);
  });

  it('phạm vi dữ liệu: không xem được xe / đơn của khách khác; token nhân viên và token chủ xe không dùng lẫn', async () => {
    const a = await customerWithHistory();
    const b = await customerWithHistory();
    const owner = (
      await request(http)
        .post('/api/owner/auth/activate')
        .send({ token: await invite(a.customerId), password: 'Chuxe2026' })
        .expect(200)
    ).body.accessToken as string;

    await request(http).get(`/api/owner/vehicles/${b.vehicleId}`).set(bearer(owner)).expect(404);
    await request(http).get(`/api/owner/orders/${b.orderId}`).set(bearer(owner)).expect(404);
    await request(http).post(`/api/owner/vehicles/${b.vehicleId}/odometer`).set(bearer(owner)).send({ km: 999999 }).expect(404);
    await request(http).get('/api/owner/vehicles').set(bearer(sales)).expect(401);
    await request(http).get('/api/customers').set(bearer(owner)).expect(401);
    await request(http).get('/api/owner/vehicles').expect(401);

    // Chủ xe đã bán xe: hết quyền xem xe đó
    await request(http)
      .post(`/api/vehicles/${a.vehicleId}/transfer`)
      .set(bearer(sales))
      .send({ customerId: b.customerId })
      .expect((r) => expect([200, 201]).toContain(r.status));
    expect((await request(http).get('/api/owner/vehicles').set(bearer(owner)).expect(200)).body).toHaveLength(0);

    // Garage gỡ liên kết
    await request(http).post(`/api/customers/${a.customerId}/app/unlink`).set(bearer(sales)).expect(200);
    await request(http).post('/api/owner/auth/login').send({ phone: a.phone, password: 'Chuxe2026' }).expect(401);
  });

  it('SĐT đã có tài khoản (VD: nhân viên cũng là khách) thì kích hoạt bằng mật khẩu sẵn có', async () => {
    const c = await customerWithHistory(PHONES.tech).catch(() => null);
    // Khách mang SĐT của KTV có thể đã được tạo ở lần chạy trước
    const list = await request(http).get('/api/customers').query({ q: PHONES.tech }).set(bearer(sales)).expect(200);
    const customerId = c?.customerId ?? list.body.items[0].id;
    const st = await request(http).get(`/api/customers/${customerId}/app`).set(bearer(sales)).expect(200);
    if (st.body.linked) await request(http).post(`/api/customers/${customerId}/app/unlink`).set(bearer(sales)).expect(200);
    const token = await invite(customerId);
    expect((await request(http).get(`/api/owner/auth/invite/${token}`).expect(200)).body.hasAccount).toBe(true);
    await request(http).post('/api/owner/auth/activate').send({ token, password: 'Matkhaumoi2026' }).expect(401);
    await request(http).post('/api/owner/auth/activate').send({ token, password: DEMO_PASSWORD }).expect(200);
    // Vẫn đăng nhập CRM bình thường
    await login(app, PHONES.tech);
  });
});
