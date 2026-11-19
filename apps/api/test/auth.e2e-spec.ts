import type { INestApplication } from '@nestjs/common';
import { authenticator } from 'otplib';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, createApp, DEMO_PASSWORD, login, PHONES, randomPhone } from './helpers';

describe('Đăng nhập & phiên', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
  });
  afterAll(() => app.close());

  it('đăng nhập đúng: trả access token + cookie refresh httpOnly', async () => {
    const res = await request(http).post('/api/auth/login').send({ phone: '0900 000 001', password: DEMO_PASSWORD }).expect(200);
    expect(res.body).toMatchObject({ status: 'ok', limited: false });
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('cardiy_rt='))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Path=\/api\/auth/);
  });

  it('sai mật khẩu và số không tồn tại trả cùng một thông báo (không lộ tài khoản)', async () => {
    const a = await request(http).post('/api/auth/login').send({ phone: PHONES.sales, password: 'sai-mat-khau-1' }).expect(401);
    const b = await request(http).post('/api/auth/login').send({ phone: '0999999999', password: 'sai-mat-khau-1' }).expect(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it('sai 5 lần liên tiếp thì bị chặn 429, kể cả khi nhập đúng sau đó', async () => {
    const phone = PHONES.managerCn2;
    for (let i = 0; i < 5; i++) await request(http).post('/api/auth/login').send({ phone, password: 'sai-' + i }).expect(401);
    await request(http).post('/api/auth/login').send({ phone, password: DEMO_PASSWORD }).expect(429);
  });

  it('API cần đăng nhập: không token → 401, token sai → 401', async () => {
    await request(http).get('/api/me').expect(401);
    await request(http).get('/api/me').set(bearer('abc.def.ghi')).expect(401);
  });

  it('/me trả quyền, chi nhánh, và 2 không gian làm việc của chủ hệ thống', async () => {
    const { token } = await login(app, PHONES.owner);
    const res = await request(http).get('/api/me').set(bearer(token)).expect(200);
    expect(res.body.workspace.tenantName).toBe('Garage PLG');
    expect(res.body.permissions).toContain('staff.manage');
    expect(res.body.branches.map((b: { code: string }) => b.code)).toEqual(expect.arrayContaining(['CN1', 'CN2']));
    expect(res.body.memberships.map((m: { tenantType: string }) => m.tenantType).sort()).toEqual(['GARAGE', 'PLATFORM']);
  });

  it('chuyển sang không gian Sàn: quyền đổi theo vai trò Super Admin', async () => {
    const { token, cookie } = await login(app, PHONES.owner);
    const me = await request(http).get('/api/me').set(bearer(token));
    const platform = me.body.memberships.find((m: { tenantType: string }) => m.tenantType === 'PLATFORM');
    const sw = await request(http).post('/api/auth/switch').set(bearer(token)).set('Cookie', cookie).send({ membershipId: platform.membershipId }).expect(200);
    const me2 = await request(http).get('/api/me').set(bearer(sw.body.accessToken)).expect(200);
    expect(me2.body.workspace.tenantType).toBe('PLATFORM');
    expect(me2.body.permissions).toContain('platform.partner.review');
    expect(me2.body.permissions).not.toContain('ro.manage');
  });

  it('làm mới phiên xoay vòng token; dùng lại token cũ thì mọi phiên bị thu hồi', async () => {
    const { cookie } = await login(app, PHONES.sales);
    const r1 = await request(http).post('/api/auth/refresh').set('Cookie', cookie).expect(200);
    const cookie2 = ([] as string[]).concat(r1.headers['set-cookie'] ?? []).find((c) => c.startsWith('cardiy_rt='))!;
    expect(cookie2).not.toBe(cookie);
    // Kẻ gian dùng lại token cũ
    await request(http).post('/api/auth/refresh').set('Cookie', cookie).expect(401);
    // Token mới cũng bị thu hồi theo
    await request(http).post('/api/auth/refresh').set('Cookie', cookie2).expect(401);
  });

  it('đăng xuất thu hồi refresh token', async () => {
    const { cookie } = await login(app, PHONES.tech);
    await request(http).post('/api/auth/logout').set('Cookie', cookie).expect(200);
    await request(http).post('/api/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('bật 2FA rồi đăng nhập phải nhập mã; mã sai bị từ chối', async () => {
    const owner = await login(app, PHONES.owner);
    const phone = randomPhone();
    const created = await request(http)
      .post('/api/staff')
      .set(bearer(owner.token))
      .send({ fullName: 'Nhân viên 2FA', phone, roles: [{ roleId: await roleId(app, 'BH'), branchId: null }] })
      .expect(201);
    // Đăng nhập lần đầu, đổi mật khẩu
    const first = await login(app, phone, created.body.tempPassword);
    const changed = await request(http).post('/api/auth/change-password').set(bearer(first.token)).send({ currentPassword: created.body.tempPassword, newPassword: 'MatKhau2026' }).expect(200);
    const setup = await request(http).post('/api/auth/2fa/setup').set(bearer(changed.body.accessToken)).expect(200);
    expect(setup.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    await request(http).post('/api/auth/2fa/enable').set(bearer(changed.body.accessToken)).send({ code: '000000' }).expect(400);
    await request(http).post('/api/auth/2fa/enable').set(bearer(changed.body.accessToken)).send({ code: authenticator.generate(setup.body.secret) }).expect(200);

    const step1 = await request(http).post('/api/auth/login').send({ phone, password: 'MatKhau2026' }).expect(200);
    expect(step1.body.status).toBe('2fa_required');
    expect(step1.body.accessToken).toBeUndefined();
    await request(http).post('/api/auth/2fa/verify').send({ challengeToken: step1.body.challengeToken, code: '123456' }).expect(401);
    const ok = await request(http).post('/api/auth/2fa/verify').send({ challengeToken: step1.body.challengeToken, code: authenticator.generate(setup.body.secret) }).expect(200);
    expect(ok.body.accessToken).toBeTruthy();
  });
});

describe('Bắt buộc 2FA (AUTH_ENFORCE_2FA=true)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp({ AUTH_ENFORCE_2FA: true });
  });
  afterAll(() => app.close());

  it('Chủ garage chưa bật 2FA: tài khoản bị giới hạn, chỉ gọi được /me và thiết lập 2FA', async () => {
    const { token, body } = await login(app, PHONES.owner);
    expect(body).toMatchObject({ limited: true, mustSetup2fa: true });
    await request(app.getHttpServer()).get('/api/me').set(bearer(token)).expect(200);
    const blocked = await request(app.getHttpServer()).get('/api/staff').set(bearer(token)).expect(403);
    expect(blocked.body.code).toBe('ACCOUNT_SETUP_REQUIRED');
  });

  it('Kỹ thuật viên không bắt buộc 2FA', async () => {
    const { body } = await login(app, PHONES.tech);
    expect(body.limited).toBe(false);
  });
});

async function roleId(app: INestApplication, code: string): Promise<string> {
  const r = await app.get(PrismaService).role.findFirstOrThrow({ where: { tenantId: null, code } });
  return r.id;
}
