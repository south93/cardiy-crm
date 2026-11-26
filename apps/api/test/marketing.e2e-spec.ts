import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, login, PHONES, randomPhone, randomPlate } from './helpers';

describe('Vòng 5.1: Marketing, Phân khúc, Chiến dịch, Điểm thưởng & Quyền riêng tư (M35, D1, D5, A3.62, A6.63, A2.07, A2.12, A2.13)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let plgOwner: string;
  let sa: string;
  let sales: string;
  let tech: string;
  let storekeeper: string;
  let accountant: string;
  let cskh: string;
  let managerCn2: string;
  let partner: string;
  let cn1Id: string;

  const tag = `MK${Date.now().toString(36).toUpperCase()}`;

  async function createLinkedCustomer(name: string, orderTotalVnd: number) {
    const cust = await request(http)
      .post('/api/customers')
      .set(bearer(sales))
      .send({
        name,
        phone: randomPhone(),
        marketingConsent: false,
        vehicle: { plate: randomPlate(), make: 'Mazda', model: 'CX-8', year: 2023 },
      })
      .expect(201);
    const cd = await request(http).get(`/api/customers/${cust.body.id}`).set(bearer(sales)).expect(200);
    const inv = await request(http).post(`/api/customers/${cust.body.id}/app/invite`).set(bearer(sales)).expect(201);
    const act = await request(http)
      .post('/api/owner/auth/activate')
      .send({ token: inv.body.url.split('/').pop(), password: 'Chuxe2026' })
      .expect(200);
    const ownerToken = act.body.accessToken as string;

    const ro = await request(http)
      .post('/api/orders')
      .set(bearer(sales))
      .send({
        branchId: cn1Id,
        customerId: cust.body.id,
        vehicleId: cd.body.vehicles[0].id,
        items: [{ kind: 'DICH_VU', name: 'Gói bảo dưỡng toàn diện', quantity: 1, unitPrice: orderTotalVnd }],
      })
      .expect(201);
    await request(http).post(`/api/orders/${ro.body.id}/status`).set(bearer(sales)).send({ to: 'DANG_SUA' }).expect(200);
    await request(http).post(`/api/orders/${ro.body.id}/status`).set(bearer(sales)).send({ to: 'HOAN_THANH' }).expect(200);
    await request(http)
      .post(`/api/orders/${ro.body.id}/payments`)
      .set(bearer(sales))
      .send({ amount: orderTotalVnd, method: 'CHUYEN_KHOAN' })
      .expect(201);
    await request(http).post(`/api/orders/${ro.body.id}/status`).set(bearer(sales)).send({ to: 'DA_GIAO' }).expect(200);

    return { customerId: cust.body.id as string, ownerToken, orderCode: ro.body.code as string };
  }

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();

    plgOwner = (await login(app, PHONES.owner)).token;
    const me = (await request(http).get('/api/me').set(bearer(plgOwner))).body;
    const pf = me.memberships.find((m: { tenantType: string }) => m.tenantType === 'PLATFORM');
    sa = (await request(http).post('/api/auth/switch').set(bearer(plgOwner)).send({ membershipId: pf.membershipId })).body.accessToken;

    sales = (await login(app, PHONES.sales)).token;
    tech = (await login(app, PHONES.tech)).token;
    storekeeper = (await login(app, PHONES.storekeeper)).token;
    accountant = (await login(app, PHONES.accountant)).token;
    cskh = (await login(app, PHONES.cskh)).token;
    managerCn2 = (await login(app, PHONES.managerCn2)).token;
    partner = (await login(app, PHONES.partnerOwner)).token;

    const branches = (await request(http).get('/api/branches').set(bearer(plgOwner))).body as { id: string; code: string }[];
    cn1Id = branches.find((b) => b.code === 'CN1')!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('phân quyền RBAC & cô lập chi nhánh cho phân hệ Marketing (A3.62) và Thông báo sàn (A6.63)', async () => {
    // BH, KTV, TK, KT, Partner không có marketing.manage -> 403
    for (const tok of [sales, tech, storekeeper, accountant, partner]) {
      await request(http).get('/api/marketing/overview').set(bearer(tok)).expect(403);
      await request(http).get('/api/marketing/segments').set(bearer(tok)).expect(403);
    }

    // CG, QL, CS có marketing.manage -> 200
    for (const tok of [plgOwner, managerCn2, cskh]) {
      await request(http).get('/api/marketing/overview').set(bearer(tok)).expect(200);
    }

    // Quản lý CN2 cố tình xem trước hoặc tạo phân khúc cho CN1 -> 403
    await request(http)
      .post('/api/marketing/segments/preview')
      .set(bearer(managerCn2))
      .send({ tiers: [], sources: [], branchId: cn1Id })
      .expect(403);

    await request(http)
      .post('/api/marketing/segments')
      .set(bearer(managerCn2))
      .send({ name: 'Phân khúc vượt quyền CN1', rules: { tiers: [], sources: [], branchId: cn1Id } })
      .expect(403);

    // Chặn GARAGE & PARTNER vào /api/platform/notifications
    await request(http).get('/api/platform/notifications/templates').set(bearer(plgOwner)).expect(403);
    await request(http).get('/api/platform/notifications/templates').set(bearer(partner)).expect(403);
    await request(http).get('/api/platform/notifications/templates').set(bearer(sa)).expect(200);
  });

  it('tự động tích điểm & nâng hạng khi giao xe (DA_GIAO), đổi điểm, đồng bộ Consent và chiến dịch CHỈ gửi đúng tập khách đã đồng ý nhận tin', async () => {
    // 1. Tạo 2 chủ xe cùng chi tiêu >= 5.5tr tại CN1:
    // - ownerYes: bật đồng ý nhận tin trên App chủ xe (A2.13)
    // - ownerNo: giữ mặc định chưa đồng ý nhận tin
    const yes = await createLinkedCustomer(`Anh Đồng Ý ${tag}`, 6_000_000);
    const no = await createLinkedCustomer(`Chị Chưa Đồng Ý ${tag}`, 5_500_000);

    // 2. Kiểm tra tự động tích điểm 6.000.000đ -> +60 điểm & tự lên Hạng Bạc (>= 50 điểm)
    const loy1 = await request(http).get('/api/owner/loyalty').set(bearer(yes.ownerToken)).expect(200);
    expect(loy1.body.wallets).toHaveLength(1);
    expect(loy1.body.wallets[0].balance).toBe(60);
    expect(loy1.body.wallets[0].tier).toBe('BAC');

    // Đổi 15 điểm tại quầy -> còn 45 điểm; cố đổi quá số dư (100 điểm) -> 409
    await request(http)
      .post('/api/marketing/loyalty/adjust')
      .set(bearer(cskh))
      .send({ customerId: yes.customerId, type: 'REDEEM', points: 100, note: 'Đổi vượt số dư' })
      .expect(409);

    const redeemed = await request(http)
      .post('/api/marketing/loyalty/adjust')
      .set(bearer(cskh))
      .send({ customerId: yes.customerId, type: 'REDEEM', points: 15, note: 'Đổi gói khử mùi nội thất' })
      .expect(201);
    expect(redeemed.body.balanceAfter).toBe(45);

    // 3. Chủ xe A bật Đồng ý nhận tin trên App chủ xe -> đồng bộ sang Customer.marketingConsent = true
    const consentRes = await request(http)
      .put('/api/owner/privacy/consent')
      .set(bearer(yes.ownerToken))
      .send({ granted: true, channel: 'ALL' })
      .expect(200);
    expect(consentRes.body.marketingConsent).toBe(true);
    expect(consentRes.body.history.length).toBeGreaterThanOrEqual(1);

    // 4. Tạo phân khúc khách chi tiêu >= 5.500.000đ tại CN1 & phát hành chiến dịch
    const seg = await request(http)
      .post('/api/marketing/segments')
      .set(bearer(plgOwner))
      .send({
        name: `Khách chi tiêu lớn ${tag}`,
        description: 'Chi tiêu từ 5.5 triệu trở lên',
        rules: { tiers: ['BAC', 'VANG', 'KIM_CUONG'], sources: [], branchId: cn1Id, minSpent: 5_500_000 },
      })
      .expect(201);
    expect(seg.body.code).toMatch(/^PK\d{6}$/);
    expect(seg.body.totalMatched).toBeGreaterThanOrEqual(2);
    expect(seg.body.consentedCount).toBeGreaterThanOrEqual(1);
    expect(seg.body.unconsentedCount).toBeGreaterThanOrEqual(1);

    const camp = await request(http)
      .post('/api/marketing/campaigns')
      .set(bearer(cskh))
      .send({
        name: `Tri ân Hội viên Bạc ${tag}`,
        channel: 'APP_PUSH',
        segmentId: seg.body.id,
        title: `Ưu đãi riêng cho {{ten_khach}}`,
        bodyTemplate: `Chào {{ten_khach}} ({{hang_the}}, dư {{diem_thuong}} điểm) từ {{ten_garage}} [${tag}]`,
      })
      .expect(201);
    expect(camp.body.status).toBe('NHAP');

    const sent = await request(http).post(`/api/marketing/campaigns/${camp.body.id}/send`).set(bearer(cskh)).send({}).expect(200);
    expect(sent.body.status).toBe('HOAN_THANH');
    expect(sent.body.sentCount).toBeGreaterThanOrEqual(1);
    expect(sent.body.skippedNoConsent).toBeGreaterThanOrEqual(1);

    const yesDelivery = sent.body.deliveries.find((d: { customerId: string }) => d.customerId === yes.customerId);
    const noDelivery = sent.body.deliveries.find((d: { customerId: string }) => d.customerId === no.customerId);
    expect(yesDelivery.status).toBe('SENT');
    expect(yesDelivery.renderedBody).toContain('Hạng Bạc');
    expect(yesDelivery.renderedBody).toContain('45 điểm');
    expect(noDelivery.status).toBe('SKIPPED_NO_CONSENT');

    // 5. Kiểm tra hộp thư thông báo trên App chủ xe: ownerYes nhận được tin chiến dịch, ownerNo KHÔNG nhận tin chiến dịch!
    const notifsYes = await request(http).get('/api/owner/notifications').set(bearer(yes.ownerToken)).expect(200);
    expect(notifsYes.body.items.some((n: { kind: string; body: string }) => n.kind === 'CAMPAIGN' && n.body.includes(tag))).toBe(true);

    const notifsNo = await request(http).get('/api/owner/notifications').set(bearer(no.ownerToken)).expect(200);
    expect(notifsNo.body.items.some((n: { kind: string; body: string }) => n.kind === 'CAMPAIGN' && n.body.includes(tag))).toBe(false);

    // 6. Quản trị sàn (A6.63): tạo mẫu thông báo chuẩn & phát hành chiến dịch toàn sàn (vẫn tuân thủ consent)
    const tplCode = `TPL_${tag}`;
    await request(http)
      .post('/api/platform/notifications/templates')
      .set(bearer(sa))
      .send({
        code: tplCode,
        name: `Mẫu chiến dịch ${tag}`,
        channel: 'PUSH',
        title: 'Thông báo từ Sàn CARDIY',
        body: 'Chào {{ten_khach}}, kiểm tra xe miễn phí tuần này!',
        active: true,
      })
      .expect(201);

    const pfCamp = await request(http)
      .post('/api/platform/notifications/campaigns/send')
      .set(bearer(sa))
      .send({
        name: `Chiến dịch toàn sàn ${tag}`,
        channel: 'APP_PUSH',
        templateCode: tplCode,
        title: 'Tuần lễ an toàn CARDIY',
        bodyTemplate: `Chào {{ten_khach}}, thông báo toàn sàn [${tag}]`,
      })
      .expect(201);
    expect(pfCamp.body.sentCount).toBeGreaterThanOrEqual(1);
    expect(pfCamp.body.skippedNoConsent).toBeGreaterThanOrEqual(1);

    // 7. Chủ xe xuất toàn bộ dữ liệu cá nhân (A2.13)
    const exported = await request(http).get('/api/owner/privacy/export').set(bearer(yes.ownerToken)).expect(200);
    expect(exported.body.account.fullName).toContain(tag);
    expect(exported.body.repairOrders.some((o: { code: string }) => o.code === yes.orderCode)).toBe(true);
    expect(exported.body.loyaltyTransactions.length).toBe(2);
    expect(exported.body.consentHistory.length).toBeGreaterThanOrEqual(1);
  });
});
