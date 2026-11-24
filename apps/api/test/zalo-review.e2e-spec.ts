import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { RedisService } from '../src/redis/redis.service';
import { FakeTransport, ZaloService } from '../src/zalo/zalo';
import { bearer, createApp, login, PHONES, randomPhone, randomPlate } from './helpers';

const ALL_EVENTS = ['OTP', 'BOOKING_CONFIRMED', 'QUOTE_SENT', 'ORDER_DONE', 'CARE_REMINDER'] as const;
const PARAMS: Record<(typeof ALL_EVENTS)[number], { name: string; source: string }[]> = {
  OTP: [{ name: 'otp', source: 'otp' }],
  BOOKING_CONFIRMED: [
    { name: 'ten_khach', source: 'customer_name' },
    { name: 'gio', source: 'booking_time' },
    { name: 'ngay', source: 'booking_date' },
  ],
  QUOTE_SENT: [
    { name: 'ten_khach', source: 'customer_name' },
    { name: 'ma_don', source: 'order_code' },
    { name: 'link', source: 'app_link' },
  ],
  ORDER_DONE: [
    { name: 'ten_khach', source: 'customer_name' },
    { name: 'bien_so', source: 'plate' },
    { name: 'so_tien', source: 'amount_due' },
  ],
  CARE_REMINDER: [
    { name: 'ten_khach', source: 'customer_name' },
    { name: 'noi_dung', source: 'care_title' },
  ],
};

describe('Vòng 2.3: Zalo ZNS, OTP, đánh giá, thông tin thanh toán', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let owner: string;
  let sales: string;
  let cn1: string;
  let outbox: FakeTransport['outbox'];
  let before: unknown;

  /** Chờ tin gửi nền (gửi sau khi lưu, không chặn thao tác của nhân viên) */
  async function waitFor(event: string, phone84: string) {
    for (let i = 0; i < 40; i++) {
      const m = outbox.find((x) => x.phone === phone84 && x.template_id === `tpl-${event}`);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Không thấy tin ${event} tới ${phone84}`);
  }
  const p84 = (p: string) => `84${p.slice(1)}`;

  beforeAll(async () => {
    app = await createApp({ ZALO_TRANSPORT: 'fake' });
    http = app.getHttpServer();
    outbox = (app.get(ZaloService).transport as FakeTransport).outbox;
    owner = (await login(app, PHONES.owner)).token;
    sales = (await login(app, PHONES.sales)).token;
    cn1 = (await request(http).get('/api/branches').set(bearer(owner))).body.find((b: { code: string }) => b.code === 'CN1').id;
    before = (await request(http).get('/api/zalo/settings').set(bearer(owner))).body.settings;
  });
  afterAll(async () => {
    // Trả lại cài đặt Zalo cũ để các bộ test khác không gửi tin
    if (before) await request(http).put('/api/zalo/settings').set(bearer(owner)).send(before);
    await app.close();
  });

  it('cài đặt: kết nối OA bằng refresh token, cấu hình mẫu tin, gửi thử, nhật ký', async () => {
    await request(http).get('/api/zalo/settings').set(bearer(sales)).expect(403);
    const st = await request(http).get('/api/zalo/settings').set(bearer(owner)).expect(200);
    expect(st.body).toMatchObject({ appConfigured: true });
    expect(st.body.events.map((e: { code: string }) => e.code)).toEqual([...ALL_EVENTS]);

    await request(http).post('/api/zalo/connect').set(bearer(owner)).send({ refreshToken: 'sai-token-1234567890' }).expect(400);
    const c = await request(http).post('/api/zalo/connect').set(bearer(owner)).send({ refreshToken: 'refresh-token-that-1234567890' }).expect(200);
    expect(c.body).toMatchObject({ connected: true, lastError: null });

    const bad = { enabled: true, mode: 'production', templates: { OTP: { enabled: true, templateId: '', params: [] } } };
    await request(http).put('/api/zalo/settings').set(bearer(owner)).send(bad).expect(400);
    const wrongSource = { enabled: true, mode: 'production', templates: { OTP: { enabled: true, templateId: 'tpl-OTP', params: [{ name: 'x', source: 'order_total' }] } } };
    await request(http).put('/api/zalo/settings').set(bearer(owner)).send(wrongSource).expect(400);
    const templates = Object.fromEntries(ALL_EVENTS.map((e) => [e, { enabled: true, templateId: `tpl-${e}`, params: PARAMS[e] }]));
    await request(http).put('/api/zalo/settings').set(bearer(owner)).send({ enabled: true, mode: 'production', templates }).expect(200);

    const t = await request(http).post('/api/zalo/test').set(bearer(owner)).send({ event: 'ORDER_DONE', phone: '0912345678' }).expect(200);
    expect(t.body.status).toBe('SENT');
    expect(outbox.at(-1)).toMatchObject({ phone: '84912345678', template_id: 'tpl-ORDER_DONE', template_data: { ten_khach: 'Nguyễn Văn Thử', bien_so: '61A-123.45', so_tien: '1.250.000' } });
    const log = await request(http).get('/api/zalo/messages').set(bearer(owner)).expect(200);
    expect(log.body[0]).toMatchObject({ event: 'ORDER_DONE', status: 'SENT', phone: '84912345678' });
  });

  it('sự kiện: xác nhận lịch, gửi báo giá, xe sửa xong, nhắc chăm sóc → tin Zalo tới khách', async () => {
    const phone = randomPhone();
    const c = await request(http)
      .post('/api/customers')
      .set(bearer(sales))
      .send({ name: 'Khách Zalo', phone, vehicle: { plate: randomPlate(), registrationExpiry: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10) } })
      .expect(201);
    const cd = await request(http).get(`/api/customers/${c.body.id}`).set(bearer(sales));
    const vehicleId = cd.body.vehicles[0].id;

    const at = new Date(Date.now() + 2 * 86_400_000);
    at.setUTCHours(2, 0, 0, 0);
    const b = await request(http).post('/api/bookings').set(bearer(sales)).send({ branchId: cn1, customerId: c.body.id, vehicleId, scheduledAt: at.toISOString(), service: 'Bảo dưỡng' }).expect(201);
    await request(http).post(`/api/bookings/${b.body.id}/status`).set(bearer(sales)).send({ to: 'DA_XAC_NHAN' });
    expect((await waitFor('BOOKING_CONFIRMED', p84(phone))).template_data).toMatchObject({ ten_khach: 'Khách Zalo', gio: '09:00' });

    const o = await request(http)
      .post('/api/orders')
      .set(bearer(sales))
      .send({ branchId: cn1, customerId: c.body.id, vehicleId, items: [{ kind: 'DICH_VU', name: 'Bảo dưỡng', quantity: 1, unitPrice: 800_000 }] })
      .expect(201);
    await request(http).post(`/api/orders/${o.body.id}/quotes`).set(bearer(sales)).send({}).expect(201);
    expect((await waitFor('QUOTE_SENT', p84(phone))).template_data).toMatchObject({ ma_don: o.body.code, link: expect.stringMatching(/\/app$/) });
    for (const to of ['DANG_SUA', 'HOAN_THANH']) await request(http).post(`/api/orders/${o.body.id}/status`).set(bearer(sales)).send({ to }).expect(200);
    expect((await waitFor('ORDER_DONE', p84(phone))).template_data).toMatchObject({ so_tien: '800.000' });

    const tasks = await request(http).get('/api/care/tasks').query({ view: 'hom-nay', refresh: 'true', pageSize: 100, q: phone }).set(bearer(owner)).expect(200);
    const task = tasks.body.items.find((t: { kind: string }) => t.kind === 'DANG_KIEM');
    const r = await request(http).post(`/api/care/tasks/${task.id}/zalo`).set(bearer(owner)).expect(200);
    expect(r.body.status).toBe('SENT');
    expect(outbox.at(-1)).toMatchObject({ phone: p84(phone), template_id: 'tpl-CARE_REMINDER' });
  });

  it('OTP qua Zalo: khách tự đăng ký (tự liên kết hồ sơ), quên mật khẩu; chặn gửi dồn, sai mã', async () => {
    const phone = randomPhone();
    await request(http)
      .post('/api/customers')
      .set(bearer(sales))
      .send({ name: 'Khách Tự Đăng Ký', phone, vehicle: { plate: randomPlate() } })
      .expect(201);
    await request(http).post('/api/owner/auth/otp/request').send({ phone: randomPhone(), purpose: 'REGISTER' }).expect(404);
    await request(http).post('/api/owner/auth/otp/request').send({ phone, purpose: 'RESET' }).expect(404);

    await request(http).post('/api/owner/auth/otp/request').send({ phone, purpose: 'REGISTER' }).expect(200);
    await request(http).post('/api/owner/auth/otp/request').send({ phone, purpose: 'REGISTER' }).expect(429);
    const code = outbox.filter((m) => m.phone === p84(phone) && m.template_id === 'tpl-OTP').at(-1)!.template_data.otp!;
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === '000000' ? '111111' : '000000';
    await request(http).post('/api/owner/auth/otp/verify').send({ phone, purpose: 'REGISTER', code: wrong, password: 'Chuxe2026' }).expect(400);
    await request(http).post('/api/owner/auth/otp/verify').send({ phone, purpose: 'REGISTER', code, password: '123' }).expect(400);
    const reg = await request(http).post('/api/owner/auth/otp/verify').send({ phone, purpose: 'REGISTER', code, password: 'Chuxe2026' }).expect(200);
    const vs = await request(http).get('/api/owner/vehicles').set(bearer(reg.body.accessToken)).expect(200);
    expect(vs.body).toHaveLength(1);
    await request(http).post('/api/owner/auth/otp/verify').send({ phone, purpose: 'REGISTER', code, password: 'Chuxe2026' }).expect(400);

    // Quên mật khẩu
    await app.get(RedisService).client.del(`otp:cool:${phone}`);
    await request(http).post('/api/owner/auth/otp/request').send({ phone, purpose: 'REGISTER' }).expect(409);
    await request(http).post('/api/owner/auth/otp/request').send({ phone, purpose: 'RESET' }).expect(200);
    const code2 = outbox.filter((m) => m.phone === p84(phone) && m.template_id === 'tpl-OTP').at(-1)!.template_data.otp!;
    await request(http).post('/api/owner/auth/otp/verify').send({ phone, purpose: 'RESET', code: code2, password: 'Matkhaumoi2026' }).expect(200);
    await request(http).post('/api/owner/auth/login').send({ phone, password: 'Chuxe2026' }).expect(401);
    await request(http).post('/api/owner/auth/login').send({ phone, password: 'Matkhaumoi2026' }).expect(200);

    // Tài khoản nhân viên không đặt lại mật khẩu qua app chủ xe
    await request(http)
      .post('/api/owner/auth/otp/request')
      .send({ phone: PHONES.sales, purpose: 'REGISTER' })
      .expect((r) => expect([404, 409]).toContain(r.status));
  });

  it('đánh giá sau khi nhận xe + garage trả lời; thông tin chuyển khoản VietQR cho phần còn nợ; lịch sử thanh toán', async () => {
    const phone = randomPhone();
    const c = await request(http)
      .post('/api/customers')
      .set(bearer(sales))
      .send({ name: 'Khách Đánh Giá', phone, vehicle: { plate: randomPlate() } })
      .expect(201);
    const cd = await request(http).get(`/api/customers/${c.body.id}`).set(bearer(sales));
    const inv = await request(http).post(`/api/customers/${c.body.id}/app/invite`).set(bearer(sales)).expect(201);
    const tok = (
      await request(http)
        .post('/api/owner/auth/activate')
        .send({ token: inv.body.url.split('/').pop(), password: 'Chuxe2026' })
        .expect(200)
    ).body.accessToken as string;

    // Cài tài khoản nhận tiền của garage
    const ps = (await request(http).get('/api/print-settings').set(bearer(owner))).body;
    const { banks: _b, tenantName: _n, tenantTaxCode: _t, ...base } = ps;
    await request(http)
      .put('/api/print-settings')
      .set(bearer(owner))
      .send({ ...base, bankBin: '970436', accountNo: '0123456789', accountName: 'GARAGE THU NGHIEM' })
      .expect(200);

    const o = await request(http)
      .post('/api/orders')
      .set(bearer(sales))
      .send({ branchId: cn1, customerId: c.body.id, vehicleId: cd.body.vehicles[0].id, items: [{ kind: 'DICH_VU', name: 'Thay dầu', quantity: 1, unitPrice: 600_000 }] })
      .expect(201);
    await request(http).post(`/api/orders/${o.body.id}/payments`).set(bearer(sales)).send({ amount: 200_000, method: 'TIEN_MAT' }).expect(201);
    const view = await request(http).get(`/api/owner/orders/${o.body.id}`).set(bearer(tok)).expect(200);
    expect(view.body.payInfo).toMatchObject({ amount: 400_000, bank: { accountNo: '0123456789', accountName: 'GARAGE THU NGHIEM' }, note: expect.stringContaining(o.body.code) });
    expect(view.body.payInfo.qr).toMatch(/^data:image\/png;base64,/);
    expect(view.body.canReview).toBe(false);
    await request(http).post(`/api/owner/orders/${o.body.id}/review`).set(bearer(tok)).send({ rating: 5 }).expect(409);

    for (const to of ['DANG_SUA', 'HOAN_THANH']) await request(http).post(`/api/orders/${o.body.id}/status`).set(bearer(sales)).send({ to }).expect(200);
    await request(http).post(`/api/orders/${o.body.id}/status`).set(bearer(sales)).send({ to: 'DA_GIAO', allowDebt: true }).expect(200);
    await request(http).post(`/api/owner/orders/${o.body.id}/review`).set(bearer(tok)).send({ rating: 6 }).expect(400);
    await request(http).post(`/api/owner/orders/${o.body.id}/review`).set(bearer(tok)).send({ rating: 4, comment: 'Làm nhanh, giá hợp lý' }).expect(200);
    await request(http).post(`/api/owner/orders/${o.body.id}/review`).set(bearer(tok)).send({ rating: 5, comment: 'Sửa lại: rất hài lòng' }).expect(200);

    const staff = await request(http).get(`/api/orders/${o.body.id}`).set(bearer(sales)).expect(200);
    expect(staff.body.review).toMatchObject({ rating: 5, comment: 'Sửa lại: rất hài lòng', reply: null });
    await request(http).post(`/api/orders/${o.body.id}/review/reply`).set(bearer(sales)).send({ reply: 'Cảm ơn anh đã tin tưởng garage!' }).expect(200);
    const again = await request(http).get(`/api/owner/orders/${o.body.id}`).set(bearer(tok)).expect(200);
    expect(again.body.review).toMatchObject({ rating: 5, reply: 'Cảm ơn anh đã tin tưởng garage!' });

    const pays = await request(http).get('/api/owner/payments').set(bearer(tok)).expect(200);
    expect(pays.body[0]).toMatchObject({ amount: 200_000, method: 'TIEN_MAT', order: { code: o.body.code } });
    const vs = await request(http).get('/api/owner/vehicles').set(bearer(tok)).expect(200);
    expect(vs.body[0].nextMaintenance).toBeTruthy();
    const dash = await request(http).get('/api/dashboard').set(bearer(owner)).expect(200);
    expect(dash.body.rating.count).toBeGreaterThan(0);
  });
});
