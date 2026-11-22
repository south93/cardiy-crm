import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, login, PHONES, randomPhone } from './helpers';

const randomPlate = () => `61D${String(Math.floor(10000 + Math.random() * 89999))}`;

describe('App kỹ thuật viên: việc của tôi & phiếu kiểm tra', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let sales: string;
  let tech: string;
  let manager: string;
  let managerCn2: string;
  let cn1: string;

  async function newOrder() {
    const c = await request(http)
      .post('/api/customers')
      .set(bearer(sales))
      .send({ name: 'Khách KTV', phone: randomPhone(), vehicle: { plate: randomPlate() } })
      .expect(201);
    const cd = await request(http).get(`/api/customers/${c.body.id}`).set(bearer(sales));
    const o = await request(http)
      .post('/api/orders')
      .set(bearer(sales))
      .send({ branchId: cn1, customerId: c.body.id, vehicleId: cd.body.vehicles[0].id, request: 'Kêu gầm', items: [{ kind: 'DICH_VU', name: 'Kiểm tra gầm', quantity: 1, unitPrice: 200_000 }] })
      .expect(201);
    return o.body as { id: string; code: string };
  }

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    sales = (await login(app, PHONES.sales)).token;
    tech = (await login(app, PHONES.tech)).token;
    manager = (await login(app, PHONES.managerCn1)).token;
    managerCn2 = (await login(app, PHONES.managerCn2)).token;
    const branches = await request(http).get('/api/branches').set(bearer(sales));
    cn1 = branches.body.find((b: { code: string }) => b.code === 'CN1').id;
  });
  afterAll(() => app.close());

  it('KTV nhận việc: đơn chưa có người → vào "việc của tôi"; đơn người khác đã nhận thì không giành được', async () => {
    const o = await newOrder();
    const open = await request(http).get('/api/orders').query({ view: 'open', tech: 'none', q: o.code, pageSize: 100 }).set(bearer(tech)).expect(200);
    expect(open.body.items.map((x: { id: string }) => x.id)).toContain(o.id);

    await request(http).post(`/api/orders/${o.id}/claim`).set(bearer(tech)).expect(200);
    const mine = await request(http).get('/api/orders').query({ view: 'open', tech: 'me', q: o.code }).set(bearer(tech)).expect(200);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0].technician.name).toBeTruthy();
    expect(mine.body.items[0].total).toBeNull();
    await request(http).post(`/api/orders/${o.id}/claim`).set(bearer(tech)).expect(200);

    // Quản lý giao lại cho mình; KTV không giành lại được
    await request(http).post(`/api/orders/${o.id}/claim`).set(bearer(manager)).expect(200);
    await request(http).post(`/api/orders/${o.id}/claim`).set(bearer(tech)).expect(409);
    // Chi nhánh khác không thấy đơn
    await request(http).post(`/api/orders/${o.id}/claim`).set(bearer(managerCn2)).expect(404);
  });

  it('phiếu kiểm tra: lưu nháp, hoàn tất; tóm tắt chú ý / thay thế; in kèm kết quả; khoá sau khi giao xe', async () => {
    const o = await newOrder();
    const empty = await request(http).get(`/api/orders/${o.id}/inspection`).set(bearer(tech)).expect(200);
    expect(empty.body).toMatchObject({ data: {}, completedAt: null, editable: true });

    const data = {
      requests: ['Bảo dưỡng'],
      tyres: { FL: { wear: 'TOT', pressure: 2.3, tread: 6 }, RR: { wear: 'THAY_THE', brand: 'Michelin 205/55R16', tread: 1.5 } },
      safety: { 'Má phanh': 'CHU_Y', 'Dầu động cơ': 'TOT' },
      underFront: { 'Rotuyn lái ngoài': { L: 'TOT', R: 'THAY_THE' } },
      recommendation: 'Thay rotuyn lái ngoài phải, lốp sau phải',
    };
    const saved = await request(http).put(`/api/orders/${o.id}/inspection`).set(bearer(tech)).send({ data }).expect(200);
    expect(saved.body.completedAt).toBeNull();
    expect(saved.body.summary).toEqual({ checked: 6, attention: 1, replace: 2 });
    // KTV ghi phiếu thì tự nhận việc
    const ord = await request(http).get(`/api/orders/${o.id}`).set(bearer(sales)).expect(200);
    expect(ord.body.technician).toBeTruthy();

    // Dữ liệu sai bị chặn
    await request(http)
      .put(`/api/orders/${o.id}/inspection`)
      .set(bearer(tech))
      .send({ data: { safety: { 'Má phanh': 'HONG' } } })
      .expect(400);
    await request(http)
      .put(`/api/orders/${o.id}/inspection`)
      .set(bearer(tech))
      .send({ data: { hack: 1 } })
      .expect(400);
    const done = await request(http)
      .put(`/api/orders/${o.id}/inspection`)
      .set(bearer(tech))
      .send({ data: { ...data, final: { 'Hệ thống phanh bình thường': true } }, complete: true })
      .expect(200);
    expect(done.body.completedAt).toBeTruthy();
    expect(done.body.inspector).toBeTruthy();

    const list = await request(http).get('/api/orders').query({ view: 'open', tech: 'me', q: o.code }).set(bearer(tech)).expect(200);
    expect(list.body.items[0].inspection).toMatchObject({ attention: 1, replace: 2 });

    const print = await request(http).get(`/api/orders/${o.id}/print`).query({ form: 'kiem-tra' }).set(bearer(tech)).expect(200);
    expect(print.body.inspection.data.tyres.RR.wear).toBe('THAY_THE');
    expect(print.body.inspection.completedAt).toBeTruthy();

    // Giao xe xong thì khoá phiếu
    for (const to of ['DANG_SUA', 'HOAN_THANH']) await request(http).post(`/api/orders/${o.id}/status`).set(bearer(sales)).send({ to }).expect(200);
    await request(http).post(`/api/orders/${o.id}/status`).set(bearer(sales)).send({ to: 'DA_GIAO', allowDebt: true }).expect(200);
    await request(http).put(`/api/orders/${o.id}/inspection`).set(bearer(tech)).send({ data }).expect(409);
    const locked = await request(http).get(`/api/orders/${o.id}/inspection`).set(bearer(tech)).expect(200);
    expect(locked.body.editable).toBe(false);
  });

  it('KTV không ghi được phiếu của đơn người khác phụ trách', async () => {
    const o = await newOrder();
    await request(http).post(`/api/orders/${o.id}/claim`).set(bearer(manager)).expect(200);
    await request(http).put(`/api/orders/${o.id}/inspection`).set(bearer(tech)).send({ data: {} }).expect(403);
    const r = await request(http).get(`/api/orders/${o.id}/inspection`).set(bearer(tech)).expect(200);
    expect(r.body.editable).toBe(false);
  });
});
