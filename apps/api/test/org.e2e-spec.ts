import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, createApp, login, PHONES, randomPhone } from './helpers';

describe('Nhân viên, vai trò, chi nhánh, phân quyền', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let owner: string;
  let manager: string;
  let tech: string;
  let partner: string;
  const role: Record<string, string> = {};
  const branch: Record<string, string> = {};

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    for (const r of await prisma.role.findMany({ where: { tenantId: null } })) role[r.code] = r.id;
    const plg = await prisma.tenant.findUniqueOrThrow({ where: { taxCode: 'PLG-DEMO-0001' } });
    for (const b of await prisma.branch.findMany({ where: { tenantId: plg.id } })) branch[b.code] = b.id;
    // Dọn dữ liệu của lần chạy trước để test chạy lại được nhiều lần
    const partnerTenant = await prisma.tenant.findUniqueOrThrow({ where: { taxCode: 'DOITAC-DEMO-0001' } });
    await prisma.membership.deleteMany({ where: { tenantId: partnerTenant.id, user: { phone: { not: PHONES.partnerOwner } } } });
    await prisma.role.deleteMany({ where: { tenantId: plg.id, name: 'Rửa xe' } });
    await prisma.branch.deleteMany({ where: { tenantId: plg.id, name: 'Chi nhánh thử' } });
    owner = (await login(app, PHONES.owner)).token;
    manager = (await login(app, PHONES.managerCn1)).token;
    tech = (await login(app, PHONES.tech)).token;
    partner = (await login(app, PHONES.partnerOwner)).token;
  });
  afterAll(() => app.close());

  it('KTV không xem được danh sách nhân viên (403)', async () => {
    await request(http).get('/api/staff').set(bearer(tech)).expect(403);
  });

  it('Chủ garage thêm nhân viên: nhận mật khẩu tạm; nhân viên mới bị buộc đổi mật khẩu', async () => {
    const phone = randomPhone();
    const res = await request(http)
      .post('/api/staff')
      .set(bearer(owner))
      .send({ fullName: 'KTV Mới', phone, roles: [{ roleId: role.KTV, branchId: branch.CN1 }] })
      .expect(201);
    expect(res.body.tempPassword).toMatch(/^[A-Za-z2-9]{10}$/);
    const first = await login(app, phone, res.body.tempPassword);
    expect(first.body).toMatchObject({ limited: true, mustChangePassword: true });
    await request(http).get('/api/branches').set(bearer(first.token)).expect(403);
    await request(http).post('/api/auth/change-password').set(bearer(first.token)).send({ currentPassword: res.body.tempPassword, newPassword: 'ngan' }).expect(400);
    const ok = await request(http).post('/api/auth/change-password').set(bearer(first.token)).send({ currentPassword: res.body.tempPassword, newPassword: 'KtvMoi2026' }).expect(200);
    expect(ok.body.limited).toBe(false);
    await request(http).get('/api/branches').set(bearer(ok.body.accessToken)).expect(200);
  });

  it('thêm trùng số điện thoại trong cùng garage → 409', async () => {
    await request(http).post('/api/staff').set(bearer(owner)).send({ fullName: 'Trùng', phone: PHONES.sales, roles: [{ roleId: role.BH, branchId: null }] }).expect(409);
  });

  it('Quản lý CN1 không tự nâng quyền: không cấp được vai trò Kế toán (có quyền tài chính)', async () => {
    const res = await request(http).post('/api/staff').set(bearer(manager)).send({ fullName: 'Thử', phone: randomPhone(), roles: [{ roleId: role.KT, branchId: branch.CN1 }] }).expect(403);
    expect(res.body.message).toMatch(/Kế toán/);
  });

  it('Quản lý CN1 không cấp được vai trò ở CN2, cũng không cấp "mọi chi nhánh"', async () => {
    await request(http).post('/api/staff').set(bearer(manager)).send({ fullName: 'Thử', phone: randomPhone(), roles: [{ roleId: role.BH, branchId: branch.CN2 }] }).expect(403);
    await request(http).post('/api/staff').set(bearer(manager)).send({ fullName: 'Thử', phone: randomPhone(), roles: [{ roleId: role.BH, branchId: null }] }).expect(403);
  });

  it('Quản lý CN1 chỉ thấy nhân viên CN1, không thấy Quản lý CN2', async () => {
    const res = await request(http).get('/api/staff').set(bearer(manager)).expect(200);
    const phones = res.body.map((s: { phone: string }) => s.phone);
    expect(phones).toContain(PHONES.tech);
    expect(phones).not.toContain(PHONES.managerCn2);
  });

  it('Quản lý không sửa / khoá được Chủ garage; không ai tự khoá chính mình', async () => {
    const staff = (await request(http).get('/api/staff').set(bearer(owner))).body as { membershipId: string; phone: string }[];
    const ownerM = staff.find((s) => s.phone === PHONES.owner)!;
    await request(http).post(`/api/staff/${ownerM.membershipId}/lock`).set(bearer(manager)).expect(403);
    await request(http).post(`/api/staff/${ownerM.membershipId}/lock`).set(bearer(owner)).expect(403);
  });

  it('khoá nhân viên: phiên hiện tại mất hiệu lực ngay, đăng nhập lại bị từ chối; mở khoá thì vào lại được', async () => {
    const phone = randomPhone();
    const created = await request(http).post('/api/staff').set(bearer(owner)).send({ fullName: 'Sẽ bị khoá', phone, roles: [{ roleId: role.CS, branchId: null }] }).expect(201);
    const s = await login(app, phone, created.body.tempPassword);
    await request(http).get('/api/me').set(bearer(s.token)).expect(200);
    await request(http).post(`/api/staff/${created.body.membershipId}/lock`).set(bearer(owner)).expect(200);
    await request(http).get('/api/me').set(bearer(s.token)).expect(401);
    await request(http).post('/api/auth/refresh').set('Cookie', s.cookie).expect(401);
    await request(http).post('/api/auth/login').send({ phone, password: created.body.tempPassword }).expect(401);
    await request(http).post(`/api/staff/${created.body.membershipId}/unlock`).set(bearer(owner)).expect(200);
    await login(app, phone, created.body.tempPassword);
  });

  it('đặt lại mật khẩu: mật khẩu cũ hết dùng, phải đổi khi đăng nhập', async () => {
    const phone = randomPhone();
    const created = await request(http).post('/api/staff').set(bearer(owner)).send({ fullName: 'Quên mật khẩu', phone, roles: [{ roleId: role.TK, branchId: null }] }).expect(201);
    const reset = await request(http).post(`/api/staff/${created.body.membershipId}/reset-password`).set(bearer(owner)).expect(200);
    await request(http).post('/api/auth/login').send({ phone, password: created.body.tempPassword }).expect(401);
    const s = await login(app, phone, reset.body.tempPassword);
    expect(s.body.mustChangePassword).toBe(true);
  });

  describe('Cách ly dữ liệu giữa các garage', () => {
    it('Chủ garage đối tác chỉ thấy nhân viên của garage mình', async () => {
      const res = await request(http).get('/api/staff').set(bearer(partner)).expect(200);
      expect(res.body.map((s: { phone: string }) => s.phone)).toEqual([PHONES.partnerOwner]);
    });

    it('Chủ garage đối tác không thao tác được nhân viên của PLG (404)', async () => {
      const plgStaff = (await request(http).get('/api/staff').set(bearer(owner))).body as { membershipId: string; phone: string }[];
      const target = plgStaff.find((s) => s.phone === PHONES.tech)!;
      await request(http).post(`/api/staff/${target.membershipId}/lock`).set(bearer(partner)).expect(404);
      await request(http).post(`/api/staff/${target.membershipId}/reset-password`).set(bearer(partner)).expect(404);
    });

    it('không gán được chi nhánh hay vai trò tuỳ chỉnh của garage khác', async () => {
      await request(http).post('/api/staff').set(bearer(partner)).send({ fullName: 'X', phone: randomPhone(), roles: [{ roleId: role.BH, branchId: branch.CN1 }] }).expect(400);
    });

    it('thêm nhân viên đã có tài khoản ở garage khác: không đổi mật khẩu của họ, không cho đặt lại mật khẩu', async () => {
      const res = await request(http).post('/api/staff').set(bearer(partner)).send({ fullName: 'Lê Bán Hàng', phone: PHONES.sales, roles: [{ roleId: role.BH, branchId: null }] }).expect(201);
      expect(res.body).toMatchObject({ existingAccount: true, tempPassword: null });
      await request(http).post(`/api/staff/${res.body.membershipId}/reset-password`).set(bearer(partner)).expect(409);
      await request(http).post(`/api/staff/${res.body.membershipId}/lock`).set(bearer(partner)).expect(200);
    });

    it('nhật ký thao tác chỉ chứa dữ liệu của garage mình', async () => {
      const res = await request(http).get('/api/audit-logs?limit=100').set(bearer(partner)).expect(200);
      const plg = await prisma.tenant.findUniqueOrThrow({ where: { taxCode: 'PLG-DEMO-0001' } });
      const ids = res.body.items.map((i: { id: number }) => BigInt(i.id));
      const rows = await prisma.auditLog.findMany({ where: { id: { in: ids } } });
      expect(rows.every((r) => r.tenantId !== plg.id)).toBe(true);
    });
  });

  describe('Vai trò tuỳ chỉnh', () => {
    it('Chủ garage tạo vai trò "Rửa xe" chỉ có quyền xem lệnh; không thêm được quyền sàn', async () => {
      await request(http).post('/api/roles').set(bearer(owner)).send({ name: 'Sai', permissions: ['platform.partner.review'] }).expect(400);
      const res = await request(http).post('/api/roles').set(bearer(owner)).send({ name: 'Rửa xe', permissions: ['ro.view', 'file.upload'] }).expect(201);
      const list = await request(http).get('/api/roles').set(bearer(owner)).expect(200);
      expect(list.body.find((r: { id: string }) => r.id === res.body.id)).toMatchObject({ name: 'Rửa xe', isSystem: false });
    });

    it('vai trò hệ thống không sửa được; garage khác không thấy vai trò tuỳ chỉnh của PLG', async () => {
      await request(http).patch(`/api/roles/${role.KTV}`).set(bearer(owner)).send({ name: 'Đổi tên' }).expect(404);
      const partnerRoles = await request(http).get('/api/roles').set(bearer(partner)).expect(200);
      expect(partnerRoles.body.some((r: { name: string }) => r.name === 'Rửa xe')).toBe(false);
    });

    it('Quản lý (không có role.manage) không tạo được vai trò', async () => {
      await request(http).post('/api/roles').set(bearer(manager)).send({ name: 'X', permissions: ['ro.view'] }).expect(403);
    });
  });

  describe('Chi nhánh', () => {
    it('Chủ garage thêm chi nhánh; trùng mã → 409; Quản lý không thêm được', async () => {
      const code = 'T' + Math.floor(Math.random() * 1e6);
      await request(http).post('/api/branches').set(bearer(owner)).send({ code, name: 'Chi nhánh thử', bays: 2 }).expect(201);
      await request(http).post('/api/branches').set(bearer(owner)).send({ code, name: 'Trùng', bays: 2 }).expect(409);
      await prisma.branch.deleteMany({ where: { code } });
      await request(http).post('/api/branches').set(bearer(manager)).send({ code: 'X1', name: 'X' }).expect(403);
    });

    it('Quản lý CN1 chỉ thấy CN1', async () => {
      const res = await request(http).get('/api/branches').set(bearer(manager)).expect(200);
      expect(res.body.map((b: { code: string }) => b.code)).toEqual(['CN1']);
    });
  });

  describe('Nhật ký thao tác', () => {
    it('ghi lại thao tác, không lộ mật khẩu', async () => {
      const res = await request(http).get('/api/audit-logs?action=staff.&limit=20').set(bearer(owner)).expect(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tempPassword|\$2[aby]\$/);
    });

    it('không sửa, không xoá được kể cả trực tiếp trong database', async () => {
      const row = await prisma.auditLog.findFirstOrThrow();
      await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: 'sua' } })).rejects.toThrow(/chỉ được thêm/);
      await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/chỉ được thêm/);
    });

    it('KTV không xem được nhật ký', async () => {
      await request(http).get('/api/audit-logs').set(bearer(tech)).expect(403);
    });
  });
});
