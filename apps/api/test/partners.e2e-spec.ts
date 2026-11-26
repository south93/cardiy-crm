import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { RedisService } from '../src/redis/redis.service';
import { bearer, createApp, login, PHONES, randomPhone } from './helpers';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const randomTax = () => String(Math.floor(1_000_000_000 + Math.random() * 8_999_999_999));

describe('Vòng 3.1: đăng ký đối tác, duyệt, phí gói', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let sa: string; // Super Admin ở không gian Sàn
  let garage: string; // Chủ garage PLG (không phải sàn)
  let planId: string;
  const planCode = `T${Date.now().toString(36).toUpperCase()}`.slice(0, 12);
  const phone = randomPhone();
  const taxCode = randomTax();
  let code: string;
  let token: string;
  let appId: string;
  let tenantId: string;
  let tempPassword: string;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    const redis = app.get(RedisService);
    const keys = await redis.client.keys('partner-app:*');
    if (keys.length) await redis.client.del(...keys);
    const o = await login(app, PHONES.owner);
    garage = o.token;
    const me = await request(http).get('/api/me').set(bearer(o.token));
    const pf = me.body.memberships.find((m: { tenantType: string }) => m.tenantType === 'PLATFORM');
    const sw = await request(http).post('/api/auth/switch').set(bearer(o.token)).set('Cookie', o.cookie).send({ membershipId: pf.membershipId }).expect(200);
    sa = sw.body.accessToken;
  });
  afterAll(() => app.close());

  it('sàn tạo gói, giá sửa được; gói hiện trên trang đăng ký công khai', async () => {
    const c = await request(http)
      .post('/api/platform/plans')
      .set(bearer(sa))
      .send({ code: planCode, name: 'Gói test', monthlyFee: 400000, billingMonths: 1, features: ['Gian hàng'] })
      .expect(201);
    planId = c.body.id;
    await request(http).post('/api/platform/plans').set(bearer(sa)).send({ code: planCode, name: 'Trùng', monthlyFee: 1, billingMonths: 1 }).expect(409);
    await request(http)
      .put(`/api/platform/plans/${planId}`)
      .set(bearer(sa))
      .send({ code: planCode, name: 'Gói test', monthlyFee: 350000, billingMonths: 1, features: ['Gian hàng'] })
      .expect(200);
    const pub = await request(http).get('/api/public/plans').expect(200);
    expect(pub.body.find((p: { id: string }) => p.id === planId).monthlyFee).toBe(350000);
    // Garage thường không quản lý gói sàn
    await request(http).get('/api/platform/plans').set(bearer(garage)).expect(403);
  });

  it('nộp hồ sơ không cần đăng nhập; trùng SĐT đang chờ → 409; link theo dõi cần đúng token', async () => {
    const dto = { garageName: 'Garage Thử Nghiệm', taxCode, address: '12 Đường Test, Phường 1', province: 'Bình Dương', representative: 'Nguyễn Văn Test', phone, planId };
    await request(http)
      .post('/api/public/partner-applications')
      .send({ ...dto, taxCode: '123' })
      .expect(400);
    const r = await request(http).post('/api/public/partner-applications').send(dto).expect(201);
    expect(r.body.code).toMatch(/^HS\d{6}$/);
    code = r.body.code;
    token = r.body.token;
    await request(http).post('/api/public/partner-applications').send(dto).expect(409);
    await request(http).get(`/api/public/partner-applications/${code}?t=sai`).expect(404);
    const v = await request(http).get(`/api/public/partner-applications/${code}?t=${token}`).expect(200);
    expect(v.body).toMatchObject({ status: 'CHO_DUYET', garageName: 'Garage Thử Nghiệm', editable: true });
  });

  it('tải giấy tờ: chỉ ảnh / PDF, đúng loại giấy tờ', async () => {
    await request(http).post(`/api/public/partner-applications/${code}/files?t=${token}&kind=GPKD`).attach('file', Buffer.from('xin chao'), 'a.txt').expect(400);
    await request(http).post(`/api/public/partner-applications/${code}/files?t=${token}&kind=XYZ`).attach('file', PNG, 'a.png').expect(400);
    const up = await request(http).post(`/api/public/partner-applications/${code}/files?t=${token}&kind=GPKD`).attach('file', PNG, 'gpkd.png').expect(201);
    expect(up.body).toMatchObject({ kind: 'GPKD', name: 'gpkd.png' });
    await request(http).post(`/api/public/partner-applications/${code}/files?t=wrong&kind=GPKD`).attach('file', PNG, 'x.png').expect(404);
  });

  it('sàn xem hồ sơ, yêu cầu bổ sung; người nộp sửa và gửi lại', async () => {
    await request(http).get('/api/platform/applications').set(bearer(garage)).expect(403);
    const list = await request(http).get(`/api/platform/applications?q=${code}`).set(bearer(sa)).expect(200);
    appId = list.body.items[0].id;
    expect(list.body.items[0]).toMatchObject({ code, status: 'CHO_DUYET', documents: 1 });
    const d = await request(http).get(`/api/platform/applications/${appId}`).set(bearer(sa)).expect(200);
    expect(d.body.documents[0].url).toBeTruthy();

    await request(http).post(`/api/platform/applications/${appId}/request-info`).set(bearer(sa)).send({ note: 'Bổ sung ảnh CCCD người đại diện' }).expect(200);
    const v = await request(http).get(`/api/public/partner-applications/${code}?t=${token}`).expect(200);
    expect(v.body).toMatchObject({ status: 'CAN_BO_SUNG', reviewNote: 'Bổ sung ảnh CCCD người đại diện' });
    await request(http).post(`/api/platform/applications/${appId}/approve`).set(bearer(sa)).send({ planId }).expect(409);

    await request(http).post(`/api/public/partner-applications/${code}/files?t=${token}&kind=CCCD`).attach('file', PNG, 'cccd.png').expect(201);
    const u = await request(http)
      .put(`/api/public/partner-applications/${code}?t=${token}`)
      .send({ garageName: 'Garage Thử Nghiệm', taxCode, address: '12 Đường Test, Phường 1', representative: 'Nguyễn Văn Test', phone, planId })
      .expect(200);
    expect(u.body.status).toBe('CHO_DUYET');
    expect(u.body.documents).toHaveLength(2);
  });

  it('duyệt: tạo đối tác đang thiết lập + tài khoản + hoá đơn kỳ đầu; quá hạn được tính', async () => {
    const start = new Date(Date.now() - 45 * 86_400_000);
    const r = await request(http)
      .post(`/api/platform/applications/${appId}/approve`)
      .set(bearer(sa))
      .send({ planId, startDate: ymd(start) })
      .expect(200);
    expect(r.body.tempPassword).toHaveLength(10);
    expect(r.body.invoice).toMatchObject({ amount: 350000 });
    tenantId = r.body.tenantId;
    tempPassword = r.body.tempPassword;
    await request(http).post(`/api/platform/applications/${appId}/approve`).set(bearer(sa)).send({ planId }).expect(409);
    const v = await request(http).get(`/api/public/partner-applications/${code}?t=${token}`).expect(200);
    expect(v.body).toMatchObject({ status: 'DA_DUYET', editable: false });

    const partners = await request(http).get('/api/platform/partners?status=DANG_THIET_LAP').set(bearer(sa)).expect(200);
    const p = partners.body.find((x: { id: string }) => x.id === tenantId);
    expect(p).toMatchObject({ status: 'DANG_THIET_LAP', unpaid: 350000, account: { phone } });
    expect(p.maxOverdueDays).toBeGreaterThan(30);
  });

  it('đối tác đăng nhập bằng mật khẩu tạm, xem phí; sàn ghi nhận thanh toán → đối tác hoạt động', async () => {
    const first = await login(app, phone, tempPassword);
    const ch = await request(http).post('/api/auth/change-password').set(bearer(first.token)).send({ currentPassword: tempPassword, newPassword: 'DoiTac2026x' }).expect(200);
    const pt = ch.body.accessToken as string;
    const b = await request(http).get('/api/partner/billing').set(bearer(pt)).expect(200);
    expect(b.body).toMatchObject({ status: 'DANG_THIET_LAP', dueTotal: 350000 });
    expect(b.body.invoices[0]).toMatchObject({ status: 'DA_PHAT_HANH', amount: 350000 });
    // Đối tác không vào được khu sàn / garage
    await request(http).get('/api/platform/invoices').set(bearer(pt)).expect(403);
    await request(http).get('/api/partner/billing').set(bearer(garage)).expect(403);

    const inv = await request(http).get(`/api/platform/invoices?tenantId=${tenantId}`).set(bearer(sa)).expect(200);
    expect(inv.body.items).toHaveLength(1);
    expect(inv.body.items[0].overdueDays).toBeGreaterThan(30);
    const pay = await request(http).post(`/api/platform/invoices/${inv.body.items[0].id}/pay`).set(bearer(sa)).send({ method: 'CK', note: 'UNC test' }).expect(200);
    expect(pay.body.activated).toBe(true);
    await request(http).post(`/api/platform/invoices/${inv.body.items[0].id}/pay`).set(bearer(sa)).send({ method: 'CK' }).expect(409);
    const b2 = await request(http).get('/api/partner/billing').set(bearer(pt)).expect(200);
    expect(b2.body).toMatchObject({ status: 'HOAT_DONG', dueTotal: 0 });

    // Tài khoản nhận phí của sàn: kế toán sàn nhập, đối tác thấy kèm QR khi còn nợ phí
    await request(http).put('/api/platform/fee-bank').set(bearer(sa)).send({ bankBin: '000', accountNo: '123' }).expect(400);
    await request(http).put('/api/platform/fee-bank').set(bearer(sa)).send({ bankBin: '970436', accountNo: '0011223344', accountName: 'san test' }).expect(200);
    const fb = await request(http).get('/api/platform/fee-bank').set(bearer(sa)).expect(200);
    expect(fb.body).toMatchObject({ bankBin: '970436', accountNo: '0011223344', accountName: 'SAN TEST' });
    await request(http).put('/api/platform/fee-bank').set(bearer(garage)).send({}).expect(403);
  });

  it('phát hành kỳ tiếp theo: không trùng khi chạy lại; huỷ hoá đơn cần lý do', async () => {
    await request(http).post('/api/platform/invoices/issue-due').set(bearer(sa)).expect(200);
    await request(http).post('/api/platform/invoices/issue-due').set(bearer(sa)).expect(200);
    const inv = await request(http).get(`/api/platform/invoices?tenantId=${tenantId}`).set(bearer(sa)).expect(200);
    expect(inv.body.items).toHaveLength(2);
    const next = inv.body.items.find((i: { status: string }) => i.status === 'DA_PHAT_HANH');
    expect(next.amount).toBe(350000);
    await request(http).post(`/api/platform/invoices/${next.id}/void`).set(bearer(sa)).send({ note: '' }).expect(400);
    await request(http).post(`/api/platform/invoices/${next.id}/void`).set(bearer(sa)).send({ note: 'Miễn phí tháng đầu' }).expect(200);
  });

  it('tạm khoá đối tác: đăng nhập bị chặn ngay; mở lại dùng được', async () => {
    const before = await login(app, phone, 'DoiTac2026x');
    await request(http).post(`/api/platform/partners/${tenantId}/status`).set(bearer(sa)).send({ status: 'TAM_KHOA', note: 'Quá hạn phí' }).expect(200);
    await request(http).get('/api/partner/billing').set(bearer(before.token)).expect(401);
    await request(http).post(`/api/platform/partners/${tenantId}/status`).set(bearer(sa)).send({ status: 'DANG_THIET_LAP' }).expect(400);
    await request(http).post(`/api/platform/partners/${tenantId}/status`).set(bearer(sa)).send({ status: 'HOAT_DONG' }).expect(200);
    await request(http).get('/api/partner/billing').set(bearer(before.token)).expect(200);
  });

  it('từ chối hồ sơ: người nộp thấy lý do, không sửa được nữa', async () => {
    const r = await request(http)
      .post('/api/public/partner-applications')
      .send({ garageName: 'Garage Bị Từ Chối', address: '1 Đường Test', representative: 'Trần Test', phone: randomPhone() })
      .expect(201);
    const l = await request(http).get(`/api/platform/applications?q=${r.body.code}`).set(bearer(sa)).expect(200);
    await request(http).post(`/api/platform/applications/${l.body.items[0].id}/reject`).set(bearer(sa)).send({ note: 'Không đủ điều kiện' }).expect(200);
    const v = await request(http).get(`/api/public/partner-applications/${r.body.code}?t=${r.body.token}`).expect(200);
    expect(v.body).toMatchObject({ status: 'TU_CHOI', reviewNote: 'Không đủ điều kiện', editable: false });
    await request(http)
      .put(`/api/public/partner-applications/${r.body.code}?t=${r.body.token}`)
      .send({ garageName: 'X Garage', address: '1 Đường Test', representative: 'Trần Test', phone: randomPhone() })
      .expect(409);
  });
});
