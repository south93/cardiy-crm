import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, createApp, login, PHONES, randomPhone } from './helpers';

const randomPlate = () => `61C${String(Math.floor(10000 + Math.random() * 89999))}`;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const days = (n: number) => new Date(Date.now() + 7 * 3_600_000 + n * 86_400_000);

type Task = { id: string; kind: string; customer: { id: string }; vehicle: { id: string } | null; dueDate: string; status: string };

describe('Lịch gọi chăm sóc khách', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let owner: string;
  let cskh: string;
  let sales: string;
  let tech: string;
  let cn1: string;

  const tasks = async (view: string, token = cskh) => (await request(http).get('/api/care/tasks').query({ view, refresh: 'true', pageSize: 100 }).set(bearer(token)).expect(200)).body as { items: Task[]; counts: Record<string, number> };
  async function customerWithCar(vehicle: Record<string, unknown> = {}) {
    const res = await request(http).post('/api/customers').set(bearer(owner)).send({ name: 'Khách Chăm Sóc', phone: randomPhone(), vehicle: { plate: randomPlate(), ...vehicle } }).expect(201);
    const c = await request(http).get(`/api/customers/${res.body.id}`).set(bearer(owner));
    return { customerId: res.body.id as string, vehicleId: c.body.vehicles[0].id as string };
  }
  async function deliveredOrder(customerId: string, vehicleId: string) {
    const o = await request(http).post('/api/orders').set(bearer(sales)).send({ branchId: cn1, customerId, vehicleId, items: [{ kind: 'DICH_VU', name: 'Bảo dưỡng', quantity: 1, unitPrice: 500_000 }] }).expect(201);
    for (const to of ['DANG_SUA', 'HOAN_THANH']) await request(http).post(`/api/orders/${o.body.id}/status`).set(bearer(sales)).send({ to }).expect(200);
    await request(http).post(`/api/orders/${o.body.id}/status`).set(bearer(sales)).send({ to: 'DA_GIAO', allowDebt: true }).expect(200);
    return o.body.id as string;
  }

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    owner = (await login(app, PHONES.owner)).token;
    cskh = (await login(app, PHONES.cskh)).token;
    sales = (await login(app, PHONES.sales)).token;
    tech = (await login(app, PHONES.tech)).token;
    const branches = await request(http).get('/api/branches').set(bearer(owner));
    cn1 = branches.body.find((b: { code: string }) => b.code === 'CN1').id;
    await request(http).put('/api/care/settings').set(bearer(owner)).send({ registrationDays: 30, insuranceDays: 30, maintenanceMonths: 6, followUpDays: 3, maxAttempts: 3 }).expect(200);
  });
  afterAll(() => app.close());

  it('tự tạo việc gọi: đăng kiểm sắp hết (hôm nay), bảo hiểm (sắp tới), hỏi thăm sau sửa, đến kỳ bảo dưỡng; quét lại không trùng', async () => {
    const a = await customerWithCar({ registrationExpiry: ymd(days(20)), insuranceExpiry: ymd(days(35)) });
    const b = await customerWithCar();
    const orderB = await deliveredOrder(b.customerId, b.vehicleId);
    const c = await customerWithCar();
    const orderC = await deliveredOrder(c.customerId, c.vehicleId);
    // Đơn của C giao cách đây 6 tháng
    const sixMonths = new Date();
    sixMonths.setMonth(sixMonths.getMonth() - 6);
    await app.get(PrismaService).repairOrder.update({ where: { id: orderC }, data: { deliveredAt: sixMonths } });

    const today = await tasks('hom-nay');
    const soon = await tasks('sap-toi');
    const find = (list: Task[], kind: string, customerId: string) => list.filter((t) => t.kind === kind && t.customer.id === customerId);
    expect(find(today.items, 'DANG_KIEM', a.customerId)).toHaveLength(1);
    expect(find(soon.items, 'BAO_HIEM', a.customerId)).toHaveLength(1);
    expect(find(soon.items, 'HOI_THAM', b.customerId)).toHaveLength(1);
    expect(find(today.items, 'BAO_DUONG', c.customerId)).toHaveLength(1);
    expect(orderB).toBeTruthy();

    // Quét lại không tạo trùng
    const again = await tasks('hom-nay');
    expect(find(again.items, 'DANG_KIEM', a.customerId)).toHaveLength(1);
    expect(today.counts['hom-nay']).toBeGreaterThan(0);
  });

  it('ghi cuộc gọi: không nghe máy → gọi lại mai; hẹn gọi lại; đã tư vấn → xong; lịch sử trên hồ sơ khách; quyền', async () => {
    const a = await customerWithCar({ registrationExpiry: ymd(days(10)) });
    const t = (await tasks('hom-nay')).items.find((x) => x.customer.id === a.customerId && x.kind === 'DANG_KIEM')!;
    await request(http).post(`/api/care/tasks/${t.id}/calls`).set(bearer(tech)).send({ outcome: 'KHONG_NGHE' }).expect(403);

    const r1 = await request(http).post(`/api/care/tasks/${t.id}/calls`).set(bearer(cskh)).send({ outcome: 'KHONG_NGHE' }).expect(200);
    expect(r1.body).toMatchObject({ status: 'GOI_LAI', dueDate: ymd(days(1)) });
    expect((await tasks('hom-nay')).items.some((x) => x.id === t.id)).toBe(false);
    expect((await tasks('sap-toi')).items.some((x) => x.id === t.id)).toBe(true);

    await request(http).post(`/api/care/tasks/${t.id}/calls`).set(bearer(cskh)).send({ outcome: 'GOI_LAI_SAU' }).expect(400);
    await request(http).post(`/api/care/tasks/${t.id}/calls`).set(bearer(cskh)).send({ outcome: 'GOI_LAI_SAU', nextAt: ymd(days(4)), note: 'Khách đi công tác' }).expect(200);
    await request(http).post(`/api/care/tasks/${t.id}/calls`).set(bearer(cskh)).send({ outcome: 'DA_TU_VAN', note: 'Khách tự đi đăng kiểm' }).expect(200);
    expect((await tasks('da-xu-ly')).items.some((x) => x.id === t.id)).toBe(true);
    await request(http).post(`/api/care/tasks/${t.id}/calls`).set(bearer(cskh)).send({ outcome: 'DA_TU_VAN' }).expect(409);

    const h = await request(http).get(`/api/care/customers/${a.customerId}`).set(bearer(cskh)).expect(200);
    expect(h.body[0].calls.map((c: { outcome: string }) => c.outcome)).toEqual(['DA_TU_VAN', 'GOI_LAI_SAU', 'KHONG_NGHE']);
    expect(h.body[0].calls[1].note).toBe('Khách đi công tác');
  });

  it('tạo việc gọi tay; cài đặt mốc chỉ chủ garage sửa', async () => {
    const a = await customerWithCar();
    await request(http).post('/api/care/tasks').set(bearer(cskh)).send({ customerId: a.customerId, title: 'Gọi báo giá lốp', dueDate: ymd(days(0)) }).expect(201);
    expect((await tasks('hom-nay')).items.some((x) => x.customer.id === a.customerId && x.kind === 'KHAC')).toBe(true);
    await request(http).put('/api/care/settings').set(bearer(cskh)).send({ registrationDays: 15, insuranceDays: 15, maintenanceMonths: 6, followUpDays: 3, maxAttempts: 3 }).expect(403);
    const s = await request(http).get('/api/care/settings').set(bearer(cskh)).expect(200);
    expect(s.body).toMatchObject({ registrationDays: 30, followUpDays: 3 });
  });
});
