import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, createApp, login, PHONES, randomPhone, randomPlate } from './helpers';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const futureIso = (daysFromNow: number, hour = 9) => {
  const d = new Date(Date.now() + daysFromNow * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

const ALL_GOOD_CHECKLIST = [
  { key: 'BODY_FRAME', status: 'TOT', note: 'Sắt-xi, keo chỉ nguyên bản' },
  { key: 'ENGINE_GEARBOX', status: 'TOT', note: 'Máy êm, khô ráo' },
  { key: 'SUSPENSION_BRAKE', status: 'LUU_Y', note: 'Má phanh sau còn 50%' },
  { key: 'ELECTRICAL_AC', status: 'TOT', note: 'Không mã lỗi OBD' },
  { key: 'INTERIOR_SAFETY', status: 'TOT', note: 'Túi khí nguyên zin' },
  { key: 'LEGAL_ODO', status: 'TOT', note: 'Giấy tờ chính chủ khớp VIN' },
];

describe('Vòng 4.3: Xe cũ & Kiểm định xe cũ (M32, F8, D5, A1.07, A2.09, A3.61, A7.23, A6.31)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let plgOwner: string;
  let sa: string;
  let sales: string;
  let tech: string;
  let storekeeper: string;
  let accountant: string;
  let managerCn2: string;
  let partner: string;
  let plgTenantId: string;
  let partnerTenantId: string;
  let cn1Id: string;
  let techMembershipId: string;

  const tag = `XC${Date.now().toString(36).toUpperCase()}`;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    plgOwner = (await login(app, PHONES.owner)).token;
    const me = (await request(http).get('/api/me').set(bearer(plgOwner))).body;
    plgTenantId = me.workspace.tenantId;
    const pf = me.memberships.find((m: { tenantType: string }) => m.tenantType === 'PLATFORM');
    sa = (await request(http).post('/api/auth/switch').set(bearer(plgOwner)).send({ membershipId: pf.membershipId })).body.accessToken;

    sales = (await login(app, PHONES.sales)).token;
    tech = (await login(app, PHONES.tech)).token;
    storekeeper = (await login(app, PHONES.storekeeper)).token;
    accountant = (await login(app, PHONES.accountant)).token;
    managerCn2 = (await login(app, PHONES.managerCn2)).token;
    partner = (await login(app, PHONES.partnerOwner)).token;

    const partnerMe = (await request(http).get('/api/me').set(bearer(partner))).body;
    partnerTenantId = partnerMe.workspace.tenantId;

    const branches = (await request(http).get('/api/branches').set(bearer(plgOwner))).body as { id: string; code: string }[];
    cn1Id = branches.find((b) => b.code === 'CN1')!.id;

    await request(http)
      .put('/api/used-cars/config')
      .set(bearer(partner))
      .send({ enabled: true, fee: 500_000, note: 'Kiểm định 150 điểm tại Minh Phát' })
      .expect(200);

    const cfgPlg = await request(http)
      .put('/api/used-cars/config')
      .set(bearer(plgOwner))
      .send({ enabled: true, fee: 600_000, branchId: cn1Id, note: 'Kiểm định cầu nâng PLG CN1' })
      .expect(200);
    techMembershipId = cfgPlg.body.technicians.find((t: { phone: string }) => t.phone === PHONES.tech)!.membershipId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('phân quyền RBAC: Thủ kho / Kế toán bị chặn 403; KTV chỉ được chấm kiểm định (không được tạo tin bán hay sửa cấu hình); non-SA bị chặn ở /platform/used-cars', async () => {
    await request(http).get('/api/used-cars/appraisals').set(bearer(storekeeper)).expect(403);
    await request(http).get('/api/used-cars/appraisals').set(bearer(accountant)).expect(403);

    await request(http).get('/api/used-cars/appraisals').set(bearer(tech)).expect(200);
    await request(http)
      .put('/api/used-cars/config')
      .set(bearer(tech))
      .send({ enabled: true, fee: 400_000 })
      .expect(403);
    await request(http)
      .post('/api/used-cars/listings')
      .set(bearer(tech))
      .send({
        title: 'Xe test KTV',
        make: 'Toyota',
        model: 'Vios',
        year: 2021,
        mileageKm: 30_000,
        price: 420_000_000,
        province: 'Bình Phước',
      })
      .expect(403);

    await request(http).get('/api/platform/used-cars/listings').set(bearer(plgOwner)).expect(403);
    await request(http).get('/api/platform/used-cars/listings').set(bearer(partner)).expect(403);
  });

  it('luồng Chủ xe trên App chủ xe (A2.09) -> Đặt kiểm định tại Đối tác (A7.23) -> Sàn duyệt (A6.31) -> Che giấy tờ riêng tư -> Hết hạn 60 ngày, gia hạn & đánh dấu Đã bán', async () => {
    // 1. Tạo tài khoản App chủ xe
    const cust = await request(http)
      .post('/api/customers')
      .set(bearer(sales))
      .send({ name: 'Hoàng Chủ Xe Cũ', phone: randomPhone(), vehicle: { plate: randomPlate(), make: 'Hyundai', model: 'Tucson', year: 2022 } })
      .expect(201);
    const inv = await request(http).post(`/api/customers/${cust.body.id}/app/invite`).set(bearer(sales)).expect(201);
    const ownerToken = (
      await request(http)
        .post('/api/owner/auth/activate')
        .send({ token: inv.body.url.split('/').pop(), password: 'Chuxe2026' })
        .expect(200)
    ).body.accessToken as string;

    const myVehs = await request(http).get('/api/owner/used-cars/my-vehicles').set(bearer(ownerToken)).expect(200);
    expect(myVehs.body.length).toBeGreaterThanOrEqual(1);

    // 2. Chủ xe tải ảnh xe + ảnh cà vẹt riêng tư và tạo tin bán xe nháp
    const carImg = await request(http).post('/api/owner/used-cars/upload').set(bearer(ownerToken)).attach('file', TINY_PNG, 'car.png').expect(201);
    const docImg = await request(http).post('/api/owner/used-cars/upload').set(bearer(ownerToken)).attach('file', TINY_PNG, 'cavet.png').expect(201);

    const created = await request(http)
      .post('/api/owner/used-cars/listings')
      .set(bearer(ownerToken))
      .send({
        vehicleId: myVehs.body[0].id,
        title: `Hyundai Tucson 2.0 Đặc Biệt ${tag}`,
        plateNo: myVehs.body[0].plateNo,
        make: 'Hyundai',
        model: 'Tucson',
        year: 2022,
        mileageKm: 24_000,
        bodyStyle: 'SUV_CUV',
        transmission: 'TU_DONG',
        fuel: 'XANG',
        price: 785_000_000,
        province: 'Hà Nội',
        description: 'Xe gia đình 1 chủ đi giữ gìn, không đâm đụng ngập nước',
        imageFileIds: [carImg.body.id],
        docFileIds: [docImg.body.id],
      })
      .expect(201);
    const listingId = created.body.id as string;
    expect(created.body.docImages).toHaveLength(1);

    // 3. Đặt lịch kiểm định tại Đối tác Minh Phát -> Đối tác xác nhận, chấm nháp rồi hoàn tất xuất báo cáo (94/100, DAT_CHUAN)
    const ap = await request(http)
      .post(`/api/owner/used-cars/listings/${listingId}/appraisals`)
      .set(bearer(ownerToken))
      .send({ tenantId: partnerTenantId, scheduledAt: futureIso(2, 9), note: 'Nhờ kiểm tra kỹ gầm và hộp số' })
      .expect(201);
    const apId = ap.body.id as string;
    expect(ap.body.status).toBe('CHO_XAC_NHAN');

    // Chặn đặt trùng 2 phiếu kiểm định đang mở trên cùng 1 tin
    await request(http)
      .post(`/api/owner/used-cars/listings/${listingId}/appraisals`)
      .set(bearer(ownerToken))
      .send({ tenantId: partnerTenantId, scheduledAt: futureIso(3, 9) })
      .expect(409);

    await request(http).post(`/api/used-cars/appraisals/${apId}/confirm`).set(bearer(partner)).send({}).expect(200);
    await request(http)
      .post(`/api/used-cars/appraisals/${apId}/save-checklist`)
      .set(bearer(partner))
      .send({
        checklist: ALL_GOOD_CHECKLIST,
        noMajorAccident: true,
        noFloodDamage: true,
        validDocuments: true,
        inspectedMileageKm: 24_200,
      })
      .expect(200);

    // Đã bắt đầu chấm kiểm định -> chủ xe không tự huỷ trực tuyến được nữa
    await request(http).post(`/api/owner/used-cars/appraisals/${apId}/cancel`).set(bearer(ownerToken)).send({}).expect(409);

    const completedAp = await request(http)
      .post(`/api/used-cars/appraisals/${apId}/complete`)
      .set(bearer(partner))
      .send({
        checklist: ALL_GOOD_CHECKLIST,
        noMajorAccident: true,
        noFloodDamage: true,
        validDocuments: true,
        inspectedMileageKm: 24_200,
        summary: 'Xe nguyên zin, đạt chuẩn 94/100 điểm',
        finalFee: 500_000,
      })
      .expect(200);
    expect(completedAp.body).toMatchObject({ status: 'HOAN_THANH', score: 94, grade: 'DAT_CHUAN' });

    // 4. Gửi sàn duyệt -> Sàn từ chối -> Sửa & gửi lại -> Sàn duyệt lên sàn (hiệu lực 60 ngày)
    await request(http).post(`/api/owner/used-cars/listings/${listingId}/submit`).set(bearer(ownerToken)).expect(200);
    await request(http)
      .post(`/api/platform/used-cars/listings/${listingId}/reject`)
      .set(bearer(sa))
      .send({ note: 'Bổ sung địa chỉ xem xe cụ thể tại Hà Nội' })
      .expect(200);

    await request(http)
      .put(`/api/owner/used-cars/listings/${listingId}`)
      .set(bearer(ownerToken))
      .send({
        vehicleId: myVehs.body[0].id,
        title: `Hyundai Tucson 2.0 Đặc Biệt ${tag}`,
        plateNo: myVehs.body[0].plateNo,
        make: 'Hyundai',
        model: 'Tucson',
        year: 2022,
        mileageKm: 24_200,
        bodyStyle: 'SUV_CUV',
        transmission: 'TU_DONG',
        fuel: 'XANG',
        price: 785_000_000,
        province: 'Hà Nội',
        addressText: 'Cầu Giấy, Hà Nội',
        description: 'Xe gia đình 1 chủ đi giữ gìn, đã kiểm định 94/100 điểm',
        imageFileIds: [carImg.body.id],
        docFileIds: [docImg.body.id],
      })
      .expect(200);

    await request(http).post(`/api/owner/used-cars/listings/${listingId}/submit`).set(bearer(ownerToken)).expect(200);
    await request(http).post(`/api/platform/used-cars/listings/${listingId}/approve`).set(bearer(sa)).expect(200);

    // 5. Xem trên sàn công khai: thấy huy hiệu Đã kiểm định + báo cáo 94/100, biển số đã che 2 số cuối và KHÔNG lộ ảnh cà vẹt riêng tư
    const pubDetail = await request(http).get(`/api/public/used-cars/${listingId}`).expect(200);
    expect(pubDetail.body).toMatchObject({
      hasVerifiedBadge: true,
      docImages: [],
      plateNo: expect.stringMatching(/\*\*$/),
      appraisalReport: expect.objectContaining({ score: 94, grade: 'DAT_CHUAN' }),
    });

    // 6. Giả lập quá hạn 60 ngày -> tự chuyển HET_HAN (ẩn khỏi sàn) -> Chủ xe gia hạn -> Đánh dấu Đã bán
    await prisma.usedCarListing.update({
      where: { id: listingId },
      data: { expiresAt: new Date(Date.now() - 3_600_000) },
    });
    await request(http).get(`/api/public/used-cars/${listingId}`).expect(404);

    const renewed = await request(http).post(`/api/owner/used-cars/listings/${listingId}/renew`).set(bearer(ownerToken)).expect(200);
    expect(renewed.body.status).toBe('DANG_BAN');
    await request(http).get(`/api/public/used-cars/${listingId}`).expect(200);

    // Lưu tin yêu thích trên App chủ xe rồi bỏ lưu
    const save1 = await request(http).post(`/api/owner/used-cars/saves/${listingId}`).set(bearer(ownerToken)).expect(200);
    expect(save1.body.saved).toBe(true);
    const savedList = await request(http).get('/api/owner/used-cars/saves').set(bearer(ownerToken)).expect(200);
    expect(savedList.body.some((x: { id: string }) => x.id === listingId)).toBe(true);

    const sold = await request(http).post(`/api/owner/used-cars/listings/${listingId}/sold`).set(bearer(ownerToken)).expect(200);
    expect(sold.body.status).toBe('DA_BAN');
  });

  it('luồng PLG (A3.61): phân công KTV chấm kiểm định + tự ghi sổ quỹ PT… (THU_KIEM_DINH), cô lập chi nhánh & khách Chat / Hẹn xem xe', async () => {
    // 1. Tạo chủ xe đặt kiểm định tại PLG (CN1, phí 600.000đ) -> phân công cho KTV chấm hoàn tất -> tự tạo phiếu thu sổ quỹ PT…
    const cust = await request(http)
      .post('/api/customers')
      .set(bearer(sales))
      .send({ name: 'Trần Khách Kiểm Định', phone: randomPhone(), vehicle: { plate: randomPlate(), make: 'Kia', model: 'K3', year: 2023 } })
      .expect(201);
    const inv = await request(http).post(`/api/customers/${cust.body.id}/app/invite`).set(bearer(sales)).expect(201);
    const ownerToken = (
      await request(http)
        .post('/api/owner/auth/activate')
        .send({ token: inv.body.url.split('/').pop(), password: 'Chuxe2026' })
        .expect(200)
    ).body.accessToken as string;

    const ownerListing = await request(http)
      .post('/api/owner/used-cars/listings')
      .set(bearer(ownerToken))
      .send({
        title: `Kia K3 1.6 Premium ${tag}`,
        make: 'Kia',
        model: 'K3',
        year: 2023,
        mileageKm: 18_000,
        price: 575_000_000,
        province: 'Bình Phước',
      })
      .expect(201);

    const apPlg = await request(http)
      .post(`/api/owner/used-cars/listings/${ownerListing.body.id}/appraisals`)
      .set(bearer(ownerToken))
      .send({ tenantId: plgTenantId, scheduledAt: futureIso(2, 10) })
      .expect(201);

    // Quản lý CN2 không can thiệp được phiếu kiểm định của CN1
    await request(http).post(`/api/used-cars/appraisals/${apPlg.body.id}/confirm`).set(bearer(managerCn2)).send({}).expect(403);

    // Bán hàng CN1 xác nhận lịch & phân công KTV CN1
    await request(http)
      .post(`/api/used-cars/appraisals/${apPlg.body.id}/confirm`)
      .set(bearer(sales))
      .send({ assignedMemberId: techMembershipId })
      .expect(200);

    // KTV CN1 chấm hoàn tất kiểm định và thu phí 600.000đ -> tự ghi sổ quỹ PT… (THU_KIEM_DINH)
    const doneByTech = await request(http)
      .post(`/api/used-cars/appraisals/${apPlg.body.id}/complete`)
      .set(bearer(tech))
      .send({
        checklist: ALL_GOOD_CHECKLIST,
        noMajorAccident: true,
        noFloodDamage: true,
        validDocuments: true,
        inspectedMileageKm: 18_100,
        finalFee: 600_000,
        paymentMethod: 'CHUYEN_KHOAN',
      })
      .expect(200);

    expect(doneByTech.body).toMatchObject({
      status: 'HOAN_THANH',
      score: 94,
      grade: 'DAT_CHUAN',
      cashEntry: {
        code: expect.stringMatching(/^PT\d{6}$/),
        amount: 600_000,
      },
    });

    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const cashbook = await request(http)
      .get(`/api/finance/cashbook?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&branchId=${cn1Id}`)
      .set(bearer(accountant))
      .expect(200);
    expect(
      cashbook.body.rows.some(
        (r: { code: string; category: string; amount: number }) =>
          r.code === doneByTech.body.cashEntry.code && r.category === 'Thu phí kiểm định xe cũ' && r.amount === 600_000,
      ),
    ).toBe(true);

    // 2. PLG đăng bán 1 xe cũ tại CN1 -> Sàn duyệt -> Khách vãng lai chat hỏi mua & hẹn lịch xem xe -> PLG xác nhận lịch & phản hồi
    const garageCar = await request(http)
      .post('/api/used-cars/listings')
      .set(bearer(sales))
      .send({
        title: `VinFast VF 8 Eco ${tag}`,
        plateNo: randomPlate(),
        make: 'VinFast',
        model: 'VF 8',
        year: 2023,
        mileageKm: 15_000,
        bodyStyle: 'SUV_CUV',
        transmission: 'TU_DONG',
        fuel: 'DIEN',
        price: 890_000_000,
        branchId: cn1Id,
        province: 'Bình Phước',
      })
      .expect(201);

    await request(http).post(`/api/used-cars/listings/${garageCar.body.id}/hide`).set(bearer(managerCn2)).expect(403);
    await request(http).post(`/api/used-cars/listings/${garageCar.body.id}/submit`).set(bearer(sales)).expect(200);
    await request(http).post(`/api/platform/used-cars/listings/${garageCar.body.id}/approve`).set(bearer(sa)).expect(200);

    const inquiry = await request(http)
      .post(`/api/public/used-cars/${garageCar.body.id}/inquiries`)
      .send({
        name: 'Đặng Người Mua',
        phone: randomPhone(),
        message: 'Xe pin tiên phong hay thuê pin vậy shop?',
        viewingAt: futureIso(3, 10),
      })
      .expect(201);

    const threadId = inquiry.body.threadId as string;
    const threadToken = inquiry.body.token as string;

    await request(http).get(`/api/public/used-cars/inquiries/${threadId}?token=sai-token-999999`).expect(403);
    await request(http).post(`/api/used-cars/threads/${threadId}/viewing`).set(bearer(managerCn2)).send({ status: 'DA_XAC_NHAN' }).expect(403);

    await request(http)
      .post(`/api/used-cars/threads/${threadId}/viewing`)
      .set(bearer(sales))
      .send({ status: 'DA_XAC_NHAN', note: 'Xe kèm pin luôn ạ, mời anh ghé CN1 xem xe!' })
      .expect(200);

    const buyerThread = await request(http)
      .get(`/api/public/used-cars/inquiries/${threadId}?token=${encodeURIComponent(threadToken)}`)
      .expect(200);
    expect(buyerThread.body).toMatchObject({
      viewingStatus: 'DA_XAC_NHAN',
    });
    expect(buyerThread.body.messages.some((m: { senderRole: string; content: string }) => m.senderRole === 'SELLER' && m.content.includes('kèm pin'))).toBe(
      true,
    );
  });
});
