import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, login, PHONES, randomPhone, randomPlate } from './helpers';

/** Biển số ngẫu nhiên hợp lệ cho mỗi lần chạy (dữ liệu giả). */

/** CSV giả theo đúng định dạng AppSheet của PLG (không dùng dữ liệu khách thật). */
export function appsheetCsv(rows: { name: string; phone: string; plates: string; source?: string; branch?: string }[]) {
  const head = '"Tên khách hàng","Điện thoại","Thông tin khách hàng","Địa chỉ","CCCD","Mail","Đại diện","Chức vụ","MST","STK","Ngân hàng","Người tạo","Ngày tạo","Tổng tiền","Đã thu","Còn nợ","Công nợ ban đầu","Ghi chú","Nguồn khách hàng","Chi nhánh","Chi tiết xe",';
  const lines = rows.map((r) => `"${r.name}","${r.phone}","${r.name} - ${r.phone}","","","","","","","","","","15/10/2026","0","0","0","","","${r.source ?? ''}","${r.branch ?? ''}","${r.plates}",`);
  return Buffer.from('﻿' + [head, ...lines].join('\r\n'), 'utf8');
}

describe('Khách hàng & Xe', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let owner: string;
  let tech: string;
  let manager: string;
  let partner: string;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    owner = (await login(app, PHONES.owner)).token;
    tech = (await login(app, PHONES.tech)).token;
    manager = (await login(app, PHONES.managerCn1)).token;
    partner = (await login(app, PHONES.partnerOwner)).token;
  });
  afterAll(() => app.close());

  describe('Khách hàng', () => {
    it('thêm khách kèm xe: sinh mã KH, chuẩn hoá SĐT và biển số; trùng SĐT → 409', async () => {
      const phone = randomPhone();
      const plate = randomPlate();
      const res = await request(http)
        .post('/api/customers')
        .set(bearer(owner))
        .send({ name: 'Nguyễn Văn Thử', phone: `${phone.slice(0, 4)} ${phone.slice(4)}`, source: 'ZALO', vehicle: { plate: `${plate.slice(0, 3)}-${plate.slice(3, 6)}.${plate.slice(6)}`, make: 'Toyota', model: 'Vios', year: 2020, odometerKm: 30000 } })
        .expect(201);
      expect(res.body.code).toMatch(/^KH\d{6}$/);
      const c = await request(http).get(`/api/customers/${res.body.id}`).set(bearer(owner)).expect(200);
      expect(c.body).toMatchObject({ phone, source: 'ZALO' });
      expect(c.body.vehicles[0]).toMatchObject({ make: 'Toyota', odometerKm: 30000 });
      expect(c.body.vehicles[0].plate).toBe(`${plate.slice(0, 3)}-${plate.slice(3, 6)}.${plate.slice(6)}`);
      await request(http).post('/api/customers').set(bearer(owner)).send({ name: 'Trùng', phone }).expect(409);
    });

    it('tìm theo tên không dấu, SĐT, biển số', async () => {
      const phone = randomPhone();
      const plate = randomPlate();
      await request(http).post('/api/customers').set(bearer(owner)).send({ name: 'Chị Phương Thảo Tìm Kiếm', phone, vehicle: { plate } }).expect(201);
      for (const q of ['phuong thao tim kiem', phone.slice(-6), plate.toLowerCase(), `${plate.slice(0, 3)}-${plate.slice(3)}`]) {
        const r = await request(http).get('/api/customers').query({ q }).set(bearer(owner)).expect(200);
        expect(r.body.items.some((i: { phone: string }) => i.phone === phone)).toBe(true);
      }
      const look = await request(http).get('/api/lookup').query({ q: plate }).set(bearer(owner)).expect(200);
      expect(look.body.vehicles[0].ownerName).toBe('Chị Phương Thảo Tìm Kiếm');
    });

    it('khách không SĐT vẫn tạo được; SĐT sai → 400', async () => {
      await request(http).post('/api/customers').set(bearer(owner)).send({ name: 'Khách vãng lai' }).expect(201);
      await request(http).post('/api/customers').set(bearer(owner)).send({ name: 'X', phone: '123' }).expect(400);
    });

    it('khách còn xe thì không xoá được; chuyển xe đi rồi mới xoá', async () => {
      const a = await request(http).post('/api/customers').set(bearer(owner)).send({ name: 'Chủ cũ', phone: randomPhone(), vehicle: { plate: randomPlate() } }).expect(201);
      const b = await request(http).post('/api/customers').set(bearer(owner)).send({ name: 'Chủ mới', phone: randomPhone() }).expect(201);
      await request(http).delete(`/api/customers/${a.body.id}`).set(bearer(owner)).expect(409);
      const ca = await request(http).get(`/api/customers/${a.body.id}`).set(bearer(owner));
      await request(http).post(`/api/vehicles/${ca.body.vehicles[0].id}/transfer`).set(bearer(owner)).send({ customerId: b.body.id }).expect(200);
      await request(http).delete(`/api/customers/${a.body.id}`).set(bearer(owner)).expect(200);
      await request(http).get(`/api/customers/${a.body.id}`).set(bearer(owner)).expect(404);
    });
  });

  describe('Xe', () => {
    it('chuyển chủ giữ lịch sử; biển trùng → 409; VIN sai → 400', async () => {
      const plate = randomPlate();
      const a = await request(http).post('/api/customers').set(bearer(owner)).send({ name: 'A', phone: randomPhone(), vehicle: { plate } }).expect(201);
      const b = await request(http).post('/api/customers').set(bearer(owner)).send({ name: 'B', phone: randomPhone() }).expect(201);
      const vid = (await request(http).get(`/api/customers/${a.body.id}`).set(bearer(owner))).body.vehicles[0].id;
      await request(http).post(`/api/vehicles/${vid}/transfer`).set(bearer(owner)).send({ customerId: b.body.id }).expect(200);
      const v = await request(http).get(`/api/vehicles/${vid}`).set(bearer(owner)).expect(200);
      expect(v.body.owner.id).toBe(b.body.id);
      expect(v.body.owners).toHaveLength(2);
      const aAfter = await request(http).get(`/api/customers/${a.body.id}`).set(bearer(owner));
      expect(aAfter.body.vehicles).toHaveLength(0);
      expect(aAfter.body.pastVehicles).toHaveLength(1);
      await request(http).post('/api/vehicles').set(bearer(owner)).send({ plate }).expect(409);
      await request(http).post('/api/vehicles').set(bearer(owner)).send({ plate: randomPlate(), vin: 'ABC' }).expect(400);
    });

    it('số km lùi bị chặn trừ khi đánh dấu sửa sai; KTV ghi được số km', async () => {
      const c = await request(http).post('/api/customers').set(bearer(owner)).send({ name: 'Km', phone: randomPhone(), vehicle: { plate: randomPlate(), odometerKm: 50000 } }).expect(201);
      const vid = (await request(http).get(`/api/customers/${c.body.id}`).set(bearer(owner))).body.vehicles[0].id;
      await request(http).post(`/api/vehicles/${vid}/odometer`).set(bearer(owner)).send({ km: 40000 }).expect(400);
      await request(http).post(`/api/vehicles/${vid}/odometer`).set(bearer(owner)).send({ km: 40000, correction: true }).expect(200);
      await request(http).post(`/api/vehicles/${vid}/odometer`).set(bearer(tech)).send({ km: 41000 }).expect(200);
      const v = await request(http).get(`/api/vehicles/${vid}`).set(bearer(owner));
      expect(v.body.odometerKm).toBe(41000);
      expect(v.body.odometers.map((o: { km: number }) => o.km)).toEqual([41000, 40000, 50000]);
    });
  });

  describe('Phân quyền', () => {
    it('KTV xem được xe, không xem được danh sách khách; tìm nhanh chỉ trả xe', async () => {
      await request(http).get('/api/customers').set(bearer(tech)).expect(403);
      await request(http).get('/api/vehicles').set(bearer(tech)).expect(200);
      await request(http).post('/api/vehicles').set(bearer(tech)).send({ plate: randomPlate() }).expect(403);
      const look = await request(http).get('/api/lookup').query({ q: '61C' }).set(bearer(tech)).expect(200);
      expect(look.body.customers).toEqual([]);
    });

    it('Đối tác không truy cập được khách / xe của PLG', async () => {
      await request(http).get('/api/customers').set(bearer(partner)).expect(403);
      await request(http).get('/api/vehicles').set(bearer(partner)).expect(403);
      await request(http).get('/api/lookup').query({ q: '0909' }).set(bearer(partner)).expect(403);
    });

    it('Quản lý chi nhánh không được nhập dữ liệu hàng loạt', async () => {
      await request(http).post('/api/imports/preview').set(bearer(manager)).attach('file', appsheetCsv([]), 'a.csv').expect(403);
    });
  });

  describe('Nhập dữ liệu AppSheet', () => {
    it('xem trước → xác nhận → nhập lại không tạo trùng; tải được danh sách vấn đề', async () => {
      const p1 = randomPhone();
      const p2 = randomPhone();
      const [v1, v2, v3] = [randomPlate(), randomPlate(), randomPlate()];
      const file = appsheetCsv([
        { name: 'Anh Nhập Một', phone: p1.slice(1), plates: `${v1} , ${v2}`, source: '1. Zalo', branch: 'CN1' }, // SĐT mất số 0
        { name: 'Anh Nhập Một', phone: p1, plates: v3 }, // trùng SĐT → gộp
        { name: 'Khách lẻ nhập', phone: '123', plates: randomPlate() }, // SĐT rác → khách không SĐT
        { name: 'Không gì', phone: '0', plates: '' }, // bỏ qua
        { name: 'Chị Nhập Hai', phone: p2, plates: 'XEBAGAC' }, // không phải biển → ghi chú
      ]);
      const prev = await request(http).post('/api/imports/preview').set(bearer(owner)).attach('file', file, 'khach_hang.csv').expect(201);
      expect(prev.body).toMatchObject({ kind: 'CUSTOMERS', status: 'PREVIEW' });
      expect(prev.body.summary).toMatchObject({ rows: 5, newCustomers: 3, newVehicles: 4, mergedRows: 1, customersWithoutPhone: 1, skippedRows: 1 });

      const csv = await request(http).get(`/api/imports/${prev.body.id}/issues.csv`).set(bearer(owner)).expect(200);
      expect(csv.text.startsWith('﻿"Dòng trong file"')).toBe(true);

      const done = await request(http).post(`/api/imports/${prev.body.id}/commit`).set(bearer(owner)).send({}).expect(200);
      expect(done.body).toMatchObject({ customers: 3, vehicles: 4 });
      await request(http).post(`/api/imports/${prev.body.id}/commit`).set(bearer(owner)).send({}).expect(409);

      const found = await request(http).get('/api/customers').query({ q: p1 }).set(bearer(owner)).expect(200);
      expect(found.body.items[0]).toMatchObject({ name: 'Anh Nhập Một', source: 'ZALO' });
      expect(found.body.items[0].vehicles).toHaveLength(3);
      const c2 = await request(http).get('/api/customers').query({ q: p2 }).set(bearer(owner));
      const c2d = await request(http).get(`/api/customers/${c2.body.items[0].id}`).set(bearer(owner));
      expect(c2d.body.note).toContain('XEBAGAC');

      const again = await request(http).post('/api/imports/preview').set(bearer(owner)).attach('file', file, 'khach_hang.csv').expect(201);
      expect(again.body.summary).toMatchObject({ newCustomers: 0, newVehicles: 0 });
    });

    it('mã chi nhánh lạ trong file gộp vào chi nhánh đã có', async () => {
      const phone = randomPhone();
      const file = appsheetCsv([{ name: 'Khách Chi Nhánh Cũ', phone, plates: randomPlate(), branch: 'CNX9' }]);
      const prev = await request(http).post('/api/imports/preview').set(bearer(owner)).attach('file', file, 'kh.csv').expect(201);
      expect(prev.body.summary.missingBranchCodes).toEqual(['CNX9']);
      const branches = await request(http).get('/api/branches').set(bearer(owner)).expect(200);
      const cn1 = branches.body.find((b: { code: string }) => b.code === 'CN1');
      await request(http).post(`/api/imports/${prev.body.id}/commit`).set(bearer(owner)).send({ branchMap: { CNX9: '00000000-0000-4000-8000-000000000000' } }).expect(400);
      const done = await request(http).post(`/api/imports/${prev.body.id}/commit`).set(bearer(owner)).send({ branchMap: { CNX9: cn1.id } }).expect(200);
      expect(done.body.createdBranches).toBe(0);
      const found = await request(http).get('/api/customers').query({ q: phone }).set(bearer(owner)).expect(200);
      expect(found.body.items[0].branchName).toBe(cn1.name);
      const after = await request(http).get('/api/branches').set(bearer(owner));
      expect(after.body.some((b: { code: string }) => b.code === 'CNX9')).toBe(false);
    });

    it('file bảng mã cũ mất dấu → báo xuất lại; file lạ → báo không nhận ra', async () => {
      const legacy = Buffer.from('T\xEAn kh\xE1ch h\xE0ng\t?i?n tho?i\nTr?n V?n Ti?p\t909735299\n', 'latin1');
      const r1 = await request(http).post('/api/imports/preview').set(bearer(owner)).attach('file', legacy, 'cu.csv').expect(400);
      expect(r1.body.message).toMatch(/mất dấu/);
      const r2 = await request(http).post('/api/imports/preview').set(bearer(owner)).attach('file', Buffer.from('a,b\n1,2\n'), 'la.csv').expect(400);
      expect(r2.body.message).toMatch(/Không nhận ra file/);
    });
  });
});
