import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, login, PHONES, randomPhone, randomPlate } from './helpers';

/** Thời điểm theo giờ VN, n ngày sau hôm nay */
function vnAt(daysAhead: number, h: number, m = 0) {
  const now = new Date(Date.now() + 7 * 3_600_000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysAhead, h - 7, m)).toISOString();
}

describe('App chủ xe 2.2: đặt lịch online, duyệt báo giá', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let sales: string;
  let tech: string;
  let cn1: string;

  /** Khách có xe, đã kích hoạt app → token chủ xe */
  async function owner() {
    const c = await request(http)
      .post('/api/customers')
      .set(bearer(sales))
      .send({ name: 'Chủ Xe Đặt Lịch', phone: randomPhone(), vehicle: { plate: randomPlate(), make: 'Kia', model: 'Seltos' } })
      .expect(201);
    const cd = await request(http).get(`/api/customers/${c.body.id}`).set(bearer(sales));
    const inv = await request(http).post(`/api/customers/${c.body.id}/app/invite`).set(bearer(sales)).expect(201);
    const token = (
      await request(http)
        .post('/api/owner/auth/activate')
        .send({ token: inv.body.url.split('/').pop(), password: 'Chuxe2026' })
        .expect(200)
    ).body.accessToken as string;
    return { token, customerId: c.body.id as string, vehicleId: cd.body.vehicles[0].id as string };
  }

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    sales = (await login(app, PHONES.sales)).token;
    tech = (await login(app, PHONES.tech)).token;
    cn1 = (await request(http).get('/api/branches').set(bearer(sales))).body.find((b: { code: string }) => b.code === 'CN1').id;
  });
  afterAll(() => app.close());

  it('đặt lịch: chọn chi nhánh + xe + giờ hợp lệ → vào lịch garage (Chờ xác nhận, kênh App); trùng giờ / quá giới hạn bị chặn; khách huỷ được', async () => {
    const o = await owner();
    const opt = await request(http).get('/api/owner/bookings/options').set(bearer(o.token)).expect(200);
    expect(opt.body.garages[0].branches.map((b: { id: string }) => b.id)).toContain(cn1);
    expect(opt.body.garages[0].vehicles).toEqual([expect.objectContaining({ id: o.vehicleId, make: 'Kia' })]);

    const base = { branchId: cn1, vehicleId: o.vehicleId, service: 'Bảo dưỡng 20.000 km' };
    await request(http)
      .post('/api/owner/bookings')
      .set(bearer(o.token))
      .send({ ...base, scheduledAt: vnAt(1, 6) })
      .expect(400);
    await request(http)
      .post('/api/owner/bookings')
      .set(bearer(o.token))
      .send({ ...base, scheduledAt: vnAt(1, 9, 15) })
      .expect(400);
    await request(http)
      .post('/api/owner/bookings')
      .set(bearer(o.token))
      .send({ ...base, scheduledAt: vnAt(-1, 9) })
      .expect(400);
    await request(http)
      .post('/api/owner/bookings')
      .set(bearer(o.token))
      .send({ ...base, scheduledAt: vnAt(90, 9) })
      .expect(400);

    const b = await request(http)
      .post('/api/owner/bookings')
      .set(bearer(o.token))
      .send({ ...base, scheduledAt: vnAt(1, 9), note: 'Kêu phanh' })
      .expect(201);
    expect(b.body).toMatchObject({ status: 'CHO_XAC_NHAN' });
    expect(b.body.code).toMatch(/^LH\d{6}$/);
    await request(http)
      .post('/api/owner/bookings')
      .set(bearer(o.token))
      .send({ ...base, scheduledAt: vnAt(1, 10) })
      .expect(409);

    const cal = await request(http)
      .get('/api/bookings')
      .query({ from: vnAt(1, 0), to: vnAt(2, 0), branchId: cn1 })
      .set(bearer(sales))
      .expect(200);
    const items = (Array.isArray(cal.body) ? cal.body : cal.body.items) as { code: string; channel: string; status: string }[];
    expect(items.find((x) => x.code === b.body.code)).toMatchObject({ channel: 'APP', status: 'CHO_XAC_NHAN' });

    // Garage xác nhận → khách thấy trạng thái mới
    await request(http)
      .post(`/api/bookings/${b.body.id}/status`)
      .set(bearer(sales))
      .send({ to: 'DA_XAC_NHAN' })
      .expect((r) => expect([200, 201]).toContain(r.status));
    const mine = await request(http).get('/api/owner/bookings').set(bearer(o.token)).expect(200);
    expect(mine.body[0]).toMatchObject({ code: b.body.code, status: 'DA_XAC_NHAN', statusLabel: 'Đã xác nhận', cancellable: true });

    // Giới hạn 3 lịch chưa tới
    await request(http)
      .post('/api/owner/bookings')
      .set(bearer(o.token))
      .send({ ...base, scheduledAt: vnAt(3, 9) })
      .expect(201);
    await request(http)
      .post('/api/owner/bookings')
      .set(bearer(o.token))
      .send({ ...base, scheduledAt: vnAt(5, 9) })
      .expect(201);
    await request(http)
      .post('/api/owner/bookings')
      .set(bearer(o.token))
      .send({ ...base, scheduledAt: vnAt(7, 9) })
      .expect(409);

    // Khách khác không huỷ được; chủ lịch huỷ được một lần
    const other = await owner();
    await request(http).post(`/api/owner/bookings/${b.body.id}/cancel`).set(bearer(other.token)).send({}).expect(404);
    await request(http).post(`/api/owner/bookings/${other.vehicleId}/cancel`).set(bearer(o.token)).send({}).expect(404);
    await request(http)
      .post('/api/owner/bookings')
      .set(bearer(o.token))
      .send({ ...base, vehicleId: other.vehicleId, scheduledAt: vnAt(8, 9) })
      .expect(404);
    await request(http).post(`/api/owner/bookings/${b.body.id}/cancel`).set(bearer(o.token)).send({ reason: 'Bận đột xuất' }).expect(201);
    await request(http).post(`/api/owner/bookings/${b.body.id}/cancel`).set(bearer(o.token)).send({}).expect(409);
  });

  it('báo giá: garage gửi → khách đồng ý một phần → dòng bị từ chối bỏ khỏi đơn, tổng tính lại; sửa hạng mục làm báo giá cũ hết hiệu lực', async () => {
    const o = await owner();
    const items = [
      { kind: 'DICH_VU', name: 'Thay dầu máy', quantity: 1, unitPrice: 300_000 },
      { kind: 'PHU_TUNG', name: 'Má phanh trước', quantity: 1, unitPrice: 900_000 },
      { kind: 'DICH_VU', name: 'Vệ sinh khoang máy', quantity: 1, unitPrice: 200_000 },
    ];
    const ord = await request(http).post('/api/orders').set(bearer(sales)).send({ branchId: cn1, customerId: o.customerId, vehicleId: o.vehicleId, items }).expect(201);
    await request(http).post(`/api/orders/${ord.body.id}/quotes`).set(bearer(tech)).send({}).expect(403);
    const q = await request(http).post(`/api/orders/${ord.body.id}/quotes`).set(bearer(sales)).send({ message: 'Má phanh mòn 80%, nên thay' }).expect(201);
    expect(q.body).toMatchObject({ status: 'CHO_DUYET', total: 1_400_000, customerHasApp: true });

    const vs = await request(http).get('/api/owner/vehicles').set(bearer(o.token)).expect(200);
    expect(vs.body[0].openOrder).toMatchObject({ id: ord.body.id, pendingQuote: true });
    const view = await request(http).get(`/api/owner/orders/${ord.body.id}`).set(bearer(o.token)).expect(200);
    expect(view.body.quote).toMatchObject({ id: q.body.id, status: 'CHO_DUYET', message: 'Má phanh mòn 80%, nên thay' });
    const lines = view.body.quote.items as { itemId: string; name: string }[];
    const keep = lines.filter((l) => l.name !== 'Vệ sinh khoang máy').map((l) => l.itemId);

    await request(http)
      .post(`/api/owner/orders/${ord.body.id}/quotes/${q.body.id}/respond`)
      .set(bearer(o.token))
      .send({ approvedIds: ['00000000-0000-4000-8000-000000000000'] })
      .expect(400);
    const r = await request(http).post(`/api/owner/orders/${ord.body.id}/quotes/${q.body.id}/respond`).set(bearer(o.token)).send({ approvedIds: keep, note: 'Để lần sau vệ sinh' }).expect(200);
    expect(r.body).toMatchObject({ status: 'DUYET_MOT_PHAN', applied: true, customerNote: 'Để lần sau vệ sinh' });
    await request(http).post(`/api/owner/orders/${ord.body.id}/quotes/${q.body.id}/respond`).set(bearer(o.token)).send({ approvedIds: keep }).expect(409);

    const after = await request(http).get(`/api/orders/${ord.body.id}`).set(bearer(sales)).expect(200);
    expect(after.body.total).toBe(1_200_000);
    expect(after.body.items.map((i: { name: string }) => i.name)).toEqual(['Thay dầu máy', 'Má phanh trước']);
    const staffView = await request(http).get(`/api/orders/${ord.body.id}/quotes`).set(bearer(sales)).expect(200);
    expect(staffView.body.quotes[0]).toMatchObject({ status: 'DUYET_MOT_PHAN', approvedIds: expect.arrayContaining(keep) });
    const list = await request(http).get('/api/orders').query({ q: ord.body.code }).set(bearer(sales)).expect(200);
    expect(list.body.items[0].quote).toMatchObject({ status: 'DUYET_MOT_PHAN' });

    // Gửi báo giá mới rồi sửa hạng mục → báo giá cũ hết hiệu lực, khách không duyệt được bản cũ
    const q2 = await request(http).post(`/api/orders/${ord.body.id}/quotes`).set(bearer(sales)).send({}).expect(201);
    await request(http)
      .put(`/api/orders/${ord.body.id}/items`)
      .set(bearer(sales))
      .send({ items: [...items.slice(0, 2), { kind: 'PHU_TUNG', name: 'Lọc gió', quantity: 1, unitPrice: 150_000 }] })
      .expect(200);
    await request(http).post(`/api/owner/orders/${ord.body.id}/quotes/${q2.body.id}/respond`).set(bearer(o.token)).send({ approvedIds: [] }).expect(409);
    expect((await request(http).get(`/api/owner/orders/${ord.body.id}`).set(bearer(o.token))).body.quote).toBeNull();

    // Khách khác không xem / duyệt được
    const other = await owner();
    await request(http).post(`/api/owner/orders/${ord.body.id}/quotes/${q2.body.id}/respond`).set(bearer(other.token)).send({ approvedIds: [] }).expect(404);
  });

  it('đơn đã thu tiền đủ: khách từ chối thì ghi nhận nhưng không tự bỏ hạng mục (garage xử lý)', async () => {
    const o = await owner();
    const ord = await request(http)
      .post('/api/orders')
      .set(bearer(sales))
      .send({ branchId: cn1, customerId: o.customerId, vehicleId: o.vehicleId, items: [{ kind: 'DICH_VU', name: 'Kiểm tra tổng quát', quantity: 1, unitPrice: 500_000 }] })
      .expect(201);
    await request(http).post(`/api/orders/${ord.body.id}/payments`).set(bearer(sales)).send({ amount: 500_000, method: 'TIEN_MAT' }).expect(201);
    const q = await request(http).post(`/api/orders/${ord.body.id}/quotes`).set(bearer(sales)).send({}).expect(201);
    const r = await request(http).post(`/api/owner/orders/${ord.body.id}/quotes/${q.body.id}/respond`).set(bearer(o.token)).send({ approvedIds: [] }).expect(200);
    expect(r.body).toMatchObject({ status: 'TU_CHOI', applied: false });
    expect((await request(http).get(`/api/orders/${ord.body.id}`).set(bearer(sales))).body.total).toBe(500_000);
  });
});
