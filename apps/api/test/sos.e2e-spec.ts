import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, createApp, login, PHONES, randomPhone, randomPlate } from './helpers';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('Vòng 4.1: Cứu hộ SOS (M33, F5, S6, A1.09, A2.10, A3.43, A5, A7.21, A6.61)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let plgOwner: string;
  let sa: string;
  let cskh: string;
  let sales: string;
  let tech: string;
  let managerCn2: string;
  let rescueCrew: string;
  let rescueMembershipId: string;
  let partner: string;
  let cn1Id: string;

  const hours = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '07:00', close: '18:00', closed: false }));
  const tag = `SOS${Date.now().toString(36).toUpperCase()}`;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    plgOwner = (await login(app, PHONES.owner)).token;
    const me = (await request(http).get('/api/me').set(bearer(plgOwner))).body;
    const pf = me.memberships.find((m: { tenantType: string }) => m.tenantType === 'PLATFORM');
    sa = (await request(http).post('/api/auth/switch').set(bearer(plgOwner)).send({ membershipId: pf.membershipId })).body.accessToken;

    cskh = (await login(app, PHONES.cskh)).token;
    sales = (await login(app, PHONES.sales)).token;
    tech = (await login(app, PHONES.tech)).token;
    managerCn2 = (await login(app, PHONES.managerCn2)).token;
    rescueCrew = (await login(app, PHONES.rescue)).token;
    partner = (await login(app, PHONES.partnerOwner)).token;

    const branches = (await request(http).get('/api/branches').set(bearer(plgOwner))).body as { id: string; code: string }[];
    cn1Id = branches.find((b) => b.code === 'CN1')!.id;

    // Thiết lập toạ độ gian hàng cho Đối tác (Hà Nội) và PLG (Bình Phước) + ít nhất 1 tin đang bán để hiện trên sàn
    const item = await request(http)
      .post('/api/platform/catalog/items')
      .set(bearer(sa))
      .send({ kind: 'SERVICE', code: `DV-SOS-${tag}`, name: `Cứu hộ lưu động ${tag}` })
      .expect(201);

    await request(http)
      .put('/api/shop')
      .set(bearer(partner))
      .send({ name: 'Minh Phát Auto', phone: '0900000010', address: 'Hà Đông, Hà Nội', province: 'Hà Nội', lat: 20.97, lng: 105.77, openingHours: hours })
      .expect(200);
    const po = await request(http)
      .post('/api/shop/offers')
      .set(bearer(partner))
      .send({ kind: 'SERVICE', catalogItemId: item.body.id, price: 250_000, priceFrom: true })
      .expect(201);
    await request(http).post(`/api/shop/offers/${po.body.id}/submit`).set(bearer(partner)).expect(200);
    await request(http).post(`/api/platform/offers/${po.body.id}/approve`).set(bearer(sa)).expect(200);

    await request(http)
      .put('/api/shop')
      .set(bearer(plgOwner))
      .send({ name: 'Garage PLG', phone: '0900000001', address: 'Đồng Xoài, Bình Phước', province: 'Bình Phước', lat: 11.53, lng: 106.88, openingHours: hours })
      .expect(200);
    await request(http)
      .post('/api/shop/offers')
      .set(bearer(plgOwner))
      .send({ kind: 'SERVICE', catalogItemId: item.body.id, price: 300_000, priceFrom: true })
      .expect(201);

    // Cấu hình cứu hộ cho Đối tác (Hà Nội, bán kính 25km) và PLG (Bình Phước, CN1, bán kính 35km)
    await request(http)
      .put('/api/sos/config')
      .set(bearer(partner))
      .send({ enabled: true, onDuty: true, hotline: '0900000010', radiusKm: 25, basePrice: 250_000, note: 'Cứu hộ Hà Đông 24/7' })
      .expect(200);

    await request(http)
      .put('/api/sos/config')
      .set(bearer(plgOwner))
      .send({ enabled: true, onDuty: true, hotline: '0900000001', radiusKm: 35, basePrice: 300_000, branchId: cn1Id, note: 'Xe sàn trượt Bình Phước' })
      .expect(200);

    const staff = (await request(http).get(`/api/sos/staff?branchId=${cn1Id}`).set(bearer(cskh)).expect(200)).body as {
      membershipId: string;
      phone: string;
      roles: string[];
    }[];
    rescueMembershipId = staff.find((s) => s.phone === PHONES.rescue)!.membershipId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('phân quyền cấu hình & danh sách cứu hộ: KTV / Bán hàng không có quyền cứu hộ bị chặn 403', async () => {
    await request(http).get('/api/sos/cases').set(bearer(tech)).expect(403);
    await request(http).get('/api/sos/cases').set(bearer(sales)).expect(403);
    await request(http)
      .put('/api/sos/config')
      .set(bearer(rescueCrew))
      .send({ enabled: true, onDuty: true, radiusKm: 20, basePrice: 200_000 })
      .expect(403);

    const garages = await request(http).get('/api/public/sos/garages?lat=20.975&lng=105.775').expect(200);
    expect(garages.body[0]).toMatchObject({ name: 'Minh Phát Auto', onDuty: true, inRange: true });
  });

  it('luồng xử lý tại chỗ của Đối tác (A1.09 -> A7.21): lọc đúng vùng, chặn nhảy trạng thái S6, cập nhật GPS, đánh giá & trả lời', async () => {
    const custPhone = randomPhone();
    const plate = randomPlate();

    // 1. Khách vãng lai tại Hà Đông gửi SOS -> chỉ Minh Phát nằm trong bán kính 25km
    const created = await request(http)
      .post('/api/public/sos')
      .send({
        name: 'Nguyễn Văn Tài',
        phone: custPhone,
        plateNo: plate,
        vehicleInfo: 'Honda City 2022',
        lat: 20.975,
        lng: 105.775,
        addressText: 'Quang Trung, Hà Đông',
        issueType: 'HET_BINH',
        description: 'Để quên đèn qua đêm hết ắc quy',
      })
      .expect(201);

    expect(created.body).toMatchObject({ status: 'DANG_TIM_GARAGE', candidatesCount: 1 });
    const sosId = created.body.id as string;
    const token = created.body.token as string;

    // PLG ở Bình Phước không thấy ca ở Hà Nội và không nhận được
    const plgIncoming = await request(http).get('/api/sos/cases?tab=incoming').set(bearer(cskh)).expect(200);
    expect(plgIncoming.body.items.some((x: { id: string }) => x.id === sosId)).toBe(false);
    await request(http).post(`/api/sos/cases/${sosId}/accept`).set(bearer(cskh)).send({ quotedPrice: 300_000, etaMinutes: 20 }).expect(404);

    // Minh Phát thấy ca mới và nhận ca
    const partnerIncoming = await request(http).get('/api/sos/cases?tab=incoming').set(bearer(partner)).expect(200);
    expect(partnerIncoming.body.items.some((x: { id: string }) => x.id === sosId)).toBe(true);

    const accepted = await request(http)
      .post(`/api/sos/cases/${sosId}/accept`)
      .set(bearer(partner))
      .send({ quotedPrice: 250_000, etaMinutes: 12, sellerNote: 'Thợ kích bình đang chuẩn bị đi' })
      .expect(200);
    expect(accepted.body.status).toBe('DA_NHAN');

    // Chặn chuyển trạng thái nhảy cóc ngoài sơ đồ S6 (từ DA_NHAN nhảy thẳng sang TAI_HIEN_TRUONG hoặc HOAN_THANH)
    await request(http).post(`/api/sos/cases/${sosId}/arrive`).set(bearer(partner)).send({}).expect(409);
    await request(http).post(`/api/sos/cases/${sosId}/complete`).set(bearer(partner)).send({ finalPrice: 250_000 }).expect(409);

    // 2. Đối tác xuất phát (DA_NHAN -> DANG_DEN) + gửi toạ độ GPS
    await request(http)
      .post(`/api/sos/cases/${sosId}/dispatch`)
      .set(bearer(partner))
      .send({ etaMinutes: 10, lat: 20.97, lng: 105.77 })
      .expect(200);

    // Đội cứu hộ đã xuất phát -> khách không tự huỷ trực tuyến được nữa (theo S6)
    await request(http).post(`/api/public/sos/${sosId}/cancel`).send({ token, reason: 'Đổi ý' }).expect(409);

    await request(http)
      .post(`/api/sos/cases/${sosId}/track`)
      .set(bearer(partner))
      .send({ lat: 20.973, lng: 105.773, etaMinutes: 4, note: 'Cách xe khách 400m' })
      .expect(200);

    // Khách mở link theo dõi bằng token sai bị chặn 403; token đúng thấy vị trí GPS realtime
    await request(http).get(`/api/public/sos/${sosId}?token=sai-token-123456`).expect(403);
    const tracking = await request(http).get(`/api/public/sos/${sosId}?token=${encodeURIComponent(token)}`).expect(200);
    expect(tracking.body).toMatchObject({
      status: 'DANG_DEN',
      quotedPrice: 250_000,
      cancellable: false,
      latestTrack: expect.objectContaining({ lat: 20.973, lng: 105.773, note: 'Cách xe khách 400m' }),
    });

    // 3. Tới hiện trường -> chụp ảnh hiện trường -> xử lý tại chỗ -> hoàn thành
    const img = await request(http).post('/api/files').set(bearer(partner)).attach('file', TINY_PNG, 'scene.png').expect(201);
    await request(http)
      .post(`/api/sos/cases/${sosId}/arrive`)
      .set(bearer(partner))
      .send({ lat: 20.975, lng: 105.775, sceneImageIds: [img.body.id], finalPrice: 250_000 })
      .expect(200);

    await request(http).post(`/api/sos/cases/${sosId}/handle-onsite`).set(bearer(partner)).send({ finalPrice: 250_000 }).expect(200);
    const done = await request(http)
      .post(`/api/sos/cases/${sosId}/complete`)
      .set(bearer(partner))
      .send({ finalPrice: 250_000, sellerNote: 'Đã kích bình nổ máy tốt' })
      .expect(200);
    expect(done.body).toMatchObject({ status: 'HOAN_THANH', finalPrice: 250_000 });

    // 4. Khách đánh giá 5 sao -> đối tác trả lời -> gộp lên trang gian hàng công khai
    await request(http)
      .post(`/api/public/sos/${sosId}/review`)
      .send({ token, rating: 5, comment: `Cứu hộ cực nhanh ${tag}` })
      .expect(201);
    // Không cho đánh giá lần 2
    await request(http).post(`/api/public/sos/${sosId}/review`).send({ token, rating: 4 }).expect(409);

    await request(http)
      .post(`/api/sos/cases/${sosId}/reply`)
      .set(bearer(partner))
      .send({ reply: 'Cảm ơn anh Tài đã tin tưởng Minh Phát!' })
      .expect(200);

    const shopPublic = await request(http).get('/api/public/market/shops/minh-phat-auto').expect(200);
    expect(shopPublic.body.reviews.some((r: { comment: string }) => r.comment === `Cứu hộ cực nhanh ${tag}`)).toBe(true);
  });

  it('luồng App chủ xe + kéo xe về xưởng PLG: điều đội cứu hộ (CH), cô lập chi nhánh và tự tạo lệnh sửa chữa DH…', async () => {
    // Tạo chủ xe có tài khoản App chủ xe và xe tại PLG
    const cust = await request(http)
      .post('/api/customers')
      .set(bearer(sales))
      .send({ name: 'Trần Chủ Xe SOS', phone: randomPhone(), vehicle: { plate: randomPlate(), make: 'Mazda', model: 'CX-5', year: 2023 } })
      .expect(201);
    const custDetail = await request(http).get(`/api/customers/${cust.body.id}`).set(bearer(sales)).expect(200);
    const vehicleId = custDetail.body.vehicles[0].id as string;
    const inv = await request(http).post(`/api/customers/${cust.body.id}/app/invite`).set(bearer(sales)).expect(201);
    const ownerToken = (
      await request(http)
        .post('/api/owner/auth/activate')
        .send({ token: inv.body.url.split('/').pop(), password: 'Chuxe2026' })
        .expect(200)
    ).body.accessToken as string;

    // Chủ xe tải ảnh sự cố và bấm gửi SOS tại Đồng Xoài (gần PLG CN1)
    const up = await request(http).post('/api/owner/sos/upload').set(bearer(ownerToken)).attach('file', TINY_PNG, 'breakdown.png').expect(201);
    const sos = await request(http)
      .post('/api/owner/sos')
      .set(bearer(ownerToken))
      .send({
        vehicleId,
        lat: 11.535,
        lng: 106.885,
        addressText: 'QL14 Đồng Xoài',
        issueType: 'CHET_MAY',
        description: 'Báo đèn cá vàng và chết máy giữa đường',
        imageFileIds: [up.body.id],
      })
      .expect(201);

    const sosId = sos.body.id as string;

    // CSKH PLG nhận ca cho CN1 và phân công cho nhân viên đội cứu hộ (0900000009)
    await request(http)
      .post(`/api/sos/cases/${sosId}/accept`)
      .set(bearer(cskh))
      .send({ quotedPrice: 600_000, etaMinutes: 20, branchId: cn1Id, assignedStaffId: rescueMembershipId })
      .expect(200);

    // Quản lý CN2 không được thao tác ca cứu hộ thuộc CN1 (cô lập chi nhánh)
    await request(http).post(`/api/sos/cases/${sosId}/dispatch`).set(bearer(managerCn2)).send({}).expect(403);

    // Nhân viên Đội cứu hộ (CH) thấy ca chờ xuất phát ở chế độ crewOnly và thực hiện trọn luồng kéo xe về xưởng
    const crewWaiting = await request(http).get('/api/sos/cases?tab=incoming&crewOnly=1').set(bearer(rescueCrew)).expect(200);
    expect(crewWaiting.body.items.some((x: { id: string }) => x.id === sosId)).toBe(true);

    await request(http).post(`/api/sos/cases/${sosId}/dispatch`).set(bearer(rescueCrew)).send({ lat: 11.53, lng: 106.88 }).expect(200);
    await request(http).post(`/api/sos/cases/${sosId}/arrive`).set(bearer(rescueCrew)).send({ lat: 11.535, lng: 106.885, finalPrice: 700_000 }).expect(200);
    await request(http).post(`/api/sos/cases/${sosId}/start-tow`).set(bearer(rescueCrew)).send({ finalPrice: 700_000 }).expect(200);

    const arrivedGarage = await request(http).post(`/api/sos/cases/${sosId}/arrive-garage`).set(bearer(rescueCrew)).send({}).expect(200);
    expect(arrivedGarage.body.status).toBe('DA_VE_GARAGE');
    expect(arrivedGarage.body.order).toMatchObject({ code: expect.stringMatching(/^DH\d{6}$/), status: 'TIEP_NHAN' });

    // Chủ xe xem trên App chủ xe thấy mã lệnh sửa chữa vừa tạo
    const ownerView = await request(http).get(`/api/owner/sos/${sosId}`).set(bearer(ownerToken)).expect(200);
    expect(ownerView.body.order.code).toBe(arrivedGarage.body.order.code);

    await request(http).post(`/api/sos/cases/${sosId}/complete`).set(bearer(rescueCrew)).send({ finalPrice: 700_000 }).expect(200);
    await request(http).post(`/api/owner/sos/${sosId}/review`).set(bearer(ownerToken)).send({ rating: 5, comment: 'Kéo xe cẩn thận' }).expect(201);
  });

  it('quá 3 phút không có garage nhận -> chuyển KHONG_CO_GARAGE kèm hotline gần nhất; khách tự huỷ; Admin sàn giám sát (A6.61)', async () => {
    // 1. Gửi ở Đà Nẵng (ngoài bán kính mọi garage) -> chuyển KHONG_CO_GARAGE ngay kèm hotline dự phòng
    const far = await request(http)
      .post('/api/public/sos')
      .send({
        name: 'Lê Khách Xa',
        phone: randomPhone(),
        lat: 16.05,
        lng: 108.2,
        issueType: 'THUNG_LOP',
      })
      .expect(201);
    expect(far.body.status).toBe('KHONG_CO_GARAGE');
    const farDetail = await request(http).get(`/api/public/sos/${far.body.id}?token=${encodeURIComponent(far.body.token)}`).expect(200);
    expect(farDetail.body.fallbackHotlines.length).toBeGreaterThanOrEqual(2);

    // 2. Ca trong bán kính nhưng quá 3 phút chưa ai bấm nhận -> tự chuyển KHONG_CO_GARAGE khi đọc
    const stale = await request(http)
      .post('/api/public/sos')
      .send({
        name: 'Phạm Quá Hạn',
        phone: randomPhone(),
        lat: 20.972,
        lng: 105.772,
        issueType: 'HET_BINH',
      })
      .expect(201);
    expect(stale.body.status).toBe('DANG_TIM_GARAGE');
    await prisma.sosRequest.update({
      where: { id: stale.body.id },
      data: { searchExpiresAt: new Date(Date.now() - 5_000) },
    });
    const staleDetail = await request(http).get(`/api/public/sos/${stale.body.id}?token=${encodeURIComponent(stale.body.token)}`).expect(200);
    expect(staleDetail.body.status).toBe('KHONG_CO_GARAGE');
    expect(staleDetail.body.fallbackHotlines[0].hotline).toBe('0900000010');

    // 3. Khách gửi rồi tự huỷ khi đang tìm garage
    const c = await request(http)
      .post('/api/public/sos')
      .send({ name: 'Hoàng Tự Huỷ', phone: randomPhone(), lat: 20.971, lng: 105.771, issueType: 'KHAC' })
      .expect(201);
    await request(http).post(`/api/public/sos/${c.body.id}/cancel`).send({ token: c.body.token, reason: 'Xe tự đề lại được' }).expect(200);

    // 4. Admin sàn giám sát cứu hộ (A6.61); tài khoản đối tác / garage bị chặn 403
    await request(http).get('/api/platform/sos').set(bearer(partner)).expect(403);
    await request(http).get('/api/platform/sos').set(bearer(plgOwner)).expect(403);

    const sup = await request(http).get('/api/platform/sos').set(bearer(sa)).expect(200);
    expect(sup.body.kpis.completed).toBeGreaterThanOrEqual(2);
    expect(sup.body.kpis.noGarage).toBeGreaterThanOrEqual(2);
    expect(sup.body.kpis.cancelled).toBeGreaterThanOrEqual(1);
    expect(sup.body.kpis.onDutyGarages).toBeGreaterThanOrEqual(2);
  });
});
