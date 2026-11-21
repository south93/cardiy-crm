import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, login, PHONES, randomPhone } from './helpers';

const randomPlate = () => `61C${String(Math.floor(10000 + Math.random() * 89999))}`;
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

describe('Lịch hẹn', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let owner: string;
  let sales: string;
  let cskh: string;
  let tech: string;
  let managerCn2: string;
  let cn1: string;

  async function customerWithCar() {
    const res = await request(http).post('/api/customers').set(bearer(owner)).send({ name: 'Khách Đặt Lịch', phone: randomPhone(), vehicle: { plate: randomPlate(), odometerKm: 30_000 } }).expect(201);
    const c = await request(http).get(`/api/customers/${res.body.id}`).set(bearer(owner));
    return { customerId: res.body.id as string, vehicleId: c.body.vehicles[0].id as string };
  }

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

  it('CSKH đặt lịch → xác nhận → bán hàng nhận xe tạo đơn; lịch chuyển "Đã đến" gắn mã đơn', async () => {
    const { customerId, vehicleId } = await customerWithCar();
    const at = inHours(26);
    const res = await request(http).post('/api/bookings').set(bearer(cskh)).send({ branchId: cn1, customerId, vehicleId, scheduledAt: at, durationMin: 90, service: 'Bảo dưỡng 30.000 km', channel: 'ZALO' }).expect(201);
    expect(res.body.code).toMatch(/^LH\d{6}$/);
    expect(res.body.warnings).toEqual([]);

    // Đặt trùng giờ cùng xe → vẫn lưu nhưng có cảnh báo
    const dup = await request(http).post('/api/bookings').set(bearer(cskh)).send({ branchId: cn1, customerId, vehicleId, scheduledAt: at, service: 'Rửa xe' }).expect(201);
    expect(dup.body.warnings.join(' ')).toContain('trùng giờ');
    await request(http).post(`/api/bookings/${dup.body.id}/status`).set(bearer(cskh)).send({ to: 'KHACH_HUY' }).expect(400); // cần lý do
    await request(http).post(`/api/bookings/${dup.body.id}/status`).set(bearer(cskh)).send({ to: 'KHACH_HUY', reason: 'Đặt nhầm' }).expect(200);

    await request(http).post(`/api/bookings/${res.body.id}/status`).set(bearer(cskh)).send({ to: 'KHONG_DEN' }).expect(409); // phải xác nhận trước
    await request(http).post(`/api/bookings/${res.body.id}/status`).set(bearer(cskh)).send({ to: 'DA_XAC_NHAN' }).expect(200);
    await request(http).post(`/api/bookings/${res.body.id}/check-in`).set(bearer(cskh)).send({}).expect(403); // CSKH không tạo đơn

    const order = await request(http).post(`/api/bookings/${res.body.id}/check-in`).set(bearer(sales)).send({ odometerKm: 31_000 }).expect(201);
    expect(order.body.code).toMatch(/^DH\d{6}$/);
    const o = await request(http).get(`/api/orders/${order.body.id}`).set(bearer(sales));
    expect(o.body).toMatchObject({ request: 'Bảo dưỡng 30.000 km', odometerKm: 31_000, status: 'TIEP_NHAN' });

    const b = await request(http).get(`/api/bookings/${res.body.id}`).set(bearer(sales)).expect(200);
    expect(b.body).toMatchObject({ status: 'DA_DEN', order: { code: order.body.code } });
    await request(http).post(`/api/bookings/${res.body.id}/check-in`).set(bearer(sales)).send({}).expect(409);
    await request(http).patch(`/api/bookings/${res.body.id}`).set(bearer(sales)).send({ scheduledAt: inHours(30) }).expect(409);
  });

  it('lịch theo khoảng ngày; đổi giờ; quá giờ 60 phút được đánh dấu; phân quyền & chi nhánh', async () => {
    const { customerId, vehicleId } = await customerWithCar();
    const res = await request(http).post('/api/bookings').set(bearer(sales)).send({ branchId: cn1, customerId, vehicleId, scheduledAt: inHours(48), service: 'Thay lốp' }).expect(201);
    const day = new Date(Date.now() + 48 * 3_600_000);
    const from = new Date(day.getTime() - 3 * 3_600_000).toISOString();
    const to = new Date(day.getTime() + 3 * 3_600_000).toISOString();
    const list = await request(http).get('/api/bookings').query({ from, to, branchId: cn1 }).set(bearer(sales)).expect(200);
    expect(list.body.map((x: { id: string }) => x.id)).toContain(res.body.id);

    // Đổi sang 2 giờ trước (đã qua) → lịch hiện "quá giờ"
    await request(http).patch(`/api/bookings/${res.body.id}`).set(bearer(sales)).send({ scheduledAt: inHours(-2) }).expect(200);
    const late = await request(http).get(`/api/bookings/${res.body.id}`).set(bearer(sales));
    expect(late.body.late).toBe(true);

    await request(http).get('/api/bookings').query({ from, to }).set(bearer(tech)).expect(403);
    await request(http).get(`/api/bookings/${res.body.id}`).set(bearer(managerCn2)).expect(404);
    await request(http).get('/api/bookings').query({ from, to, branchId: cn1 }).set(bearer(managerCn2)).expect(403);
    await request(http).get('/api/bookings').query({ from: to, to: from }).set(bearer(sales)).expect(400);
  });
});
