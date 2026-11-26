import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, createApp, login, PHONES, randomPhone, randomPlate } from './helpers';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const futureIso = (daysFromNow: number, hour = 8) => {
  const d = new Date(Date.now() + daysFromNow * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

describe('Vòng 4.2: Thuê xe tự lái (M31, F9, S8, D5, A1.08, A2.08, A3.60, A7.22)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let plgOwner: string;
  let sa: string;
  let sales: string;
  let tech: string;
  let accountant: string;
  let managerCn2: string;
  let partner: string;
  let cn1Id: string;

  const tag = `TX${Date.now().toString(36).toUpperCase()}`;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    plgOwner = (await login(app, PHONES.owner)).token;
    const me = (await request(http).get('/api/me').set(bearer(plgOwner))).body;
    const pf = me.memberships.find((m: { tenantType: string }) => m.tenantType === 'PLATFORM');
    sa = (await request(http).post('/api/auth/switch').set(bearer(plgOwner)).send({ membershipId: pf.membershipId })).body.accessToken;

    sales = (await login(app, PHONES.sales)).token;
    tech = (await login(app, PHONES.tech)).token;
    accountant = (await login(app, PHONES.accountant)).token;
    managerCn2 = (await login(app, PHONES.managerCn2)).token;
    partner = (await login(app, PHONES.partnerOwner)).token;

    const branches = (await request(http).get('/api/branches').set(bearer(plgOwner))).body as { id: string; code: string }[];
    cn1Id = branches.find((b) => b.code === 'CN1')!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('phân quyền RBAC & kiểm duyệt sàn: KTV bị chặn 403; Kế toán chỉ xem được (không sửa); non-SA bị chặn 403 ở /platform/rentals', async () => {
    await request(http).get('/api/rentals/vehicles').set(bearer(tech)).expect(403);
    await request(http).get('/api/rentals/contracts').set(bearer(tech)).expect(403);

    await request(http).get('/api/rentals/vehicles').set(bearer(accountant)).expect(200);
    await request(http).get('/api/rentals/contracts').set(bearer(accountant)).expect(200);
    await request(http)
      .post('/api/rentals/vehicles')
      .set(bearer(accountant))
      .send({
        title: 'Xe test kế toán',
        plateNo: randomPlate(),
        make: 'Toyota',
        model: 'Vios',
        year: 2022,
        dailyPrice: 600_000,
        deposit: 3_000_000,
      })
      .expect(403);

    await request(http).get('/api/platform/rentals/vehicles').set(bearer(plgOwner)).expect(403);
    await request(http).get('/api/platform/rentals/vehicles').set(bearer(partner)).expect(403);
  });

  it('luồng Đối tác đăng xe -> Sàn từ chối rồi duyệt -> Khách đặt trên sàn, khoá trùng lịch, chạy trọn S8 (kể cả quá hạn & vượt km)', async () => {
    const plate = randomPlate();

    // 1. Đối tác tạo xe nháp -> gửi sàn duyệt (CHO_DUYET, chưa hiện trên sàn công khai)
    const createdVeh = await request(http)
      .post('/api/rentals/vehicles')
      .set(bearer(partner))
      .send({
        title: `Honda CR-V L ${tag}`,
        plateNo: plate,
        make: 'Honda',
        model: 'CR-V',
        year: 2023,
        seats: 7,
        transmission: 'TU_DONG',
        fuel: 'XANG',
        ownerType: 'GARAGE',
        dailyPrice: 900_000,
        deposit: 5_000_000,
        kmLimitPerDay: 300,
        overKmFee: 5_000,
        province: 'Hà Nội',
        pickupAddress: 'Hà Đông, Hà Nội',
        terms: 'CCCD gắn chip + GPLX B2',
      })
      .expect(201);

    const vehId = createdVeh.body.id as string;
    expect(createdVeh.body.status).toBe('NHAP');

    const sub1 = await request(http).post(`/api/rentals/vehicles/${vehId}/submit`).set(bearer(partner)).expect(200);
    expect(sub1.body.status).toBe('CHO_DUYET');
    await request(http).get(`/api/public/rentals/vehicles/${vehId}`).expect(404);

    // 2. Admin sàn từ chối -> Đối tác sửa lại -> gửi duyệt -> Admin sàn duyệt lên sàn
    await request(http)
      .post(`/api/platform/rentals/vehicles/${vehId}/reject`)
      .set(bearer(sa))
      .send({ note: 'Bổ sung mô tả bảo hiểm thân vỏ' })
      .expect(200);

    const edited = await request(http)
      .put(`/api/rentals/vehicles/${vehId}`)
      .set(bearer(partner))
      .send({
        title: `Honda CR-V L ${tag}`,
        plateNo: plate,
        make: 'Honda',
        model: 'CR-V',
        year: 2023,
        seats: 7,
        transmission: 'TU_DONG',
        fuel: 'XANG',
        ownerType: 'GARAGE',
        dailyPrice: 900_000,
        deposit: 5_000_000,
        kmLimitPerDay: 300,
        overKmFee: 5_000,
        province: 'Hà Nội',
        pickupAddress: 'Hà Đông, Hà Nội',
        terms: 'CCCD gắn chip + GPLX B2 + Bảo hiểm 2 chiều',
        description: 'Xe gia đình sạch đẹp, cam hành trình trước sau',
      })
      .expect(200);
    expect(edited.body.status).toBe('NHAP');

    await request(http).post(`/api/rentals/vehicles/${vehId}/submit`).set(bearer(partner)).expect(200);
    await request(http).post(`/api/platform/rentals/vehicles/${vehId}/approve`).set(bearer(sa)).expect(200);

    const pubList = await request(http).get(`/api/public/rentals/vehicles?province=${encodeURIComponent('Hà Nội')}&q=${tag}`).expect(200);
    expect(pubList.body.items.some((x: { id: string }) => x.id === vehId)).toBe(true);

    // 3. Khách đặt thuê 2 ngày [ngày +3 -> ngày +5]
    const startAt = futureIso(3, 8);
    const endAt = futureIso(5, 8);
    const booked = await request(http)
      .post('/api/public/rentals/contracts')
      .send({
        rentalVehicleId: vehId,
        startAt,
        endAt,
        name: 'Phạm Hoàng Nam',
        phone: randomPhone(),
        idCardNo: '001095012345',
        driverLicenseNo: '0102345678',
        note: 'Nhận xe đúng 8h sáng',
      })
      .expect(201);

    expect(booked.body).toMatchObject({ status: 'DAT_TRUOC' });
    const contractId = booked.body.id as string;
    const token = booked.body.token as string;

    // 4. Chặn đặt trùng lịch giao nhau [ngày +4 -> ngày +6] và ẩn khỏi bộ lọc ngày trùng
    await request(http)
      .post('/api/public/rentals/contracts')
      .send({
        rentalVehicleId: vehId,
        startAt: futureIso(4, 8),
        endAt: futureIso(6, 8),
        name: 'Khách Trùng Lịch',
        phone: randomPhone(),
      })
      .expect(409);

    const overlapSearch = await request(http)
      .get(`/api/public/rentals/vehicles?q=${tag}&startAt=${encodeURIComponent(futureIso(4, 8))}&endAt=${encodeURIComponent(futureIso(6, 8))}`)
      .expect(200);
    expect(overlapSearch.body.items.some((x: { id: string }) => x.id === vehId)).toBe(false);

    const freeSearch = await request(http)
      .get(`/api/public/rentals/vehicles?q=${tag}&startAt=${encodeURIComponent(futureIso(7, 8))}&endAt=${encodeURIComponent(futureIso(9, 8))}`)
      .expect(200);
    expect(freeSearch.body.items.some((x: { id: string }) => x.id === vehId)).toBe(true);

    // 5. Chặn chuyển trạng thái nhảy cóc ngoài sơ đồ S8
    await request(http).post(`/api/rentals/contracts/${contractId}/deposit`).set(bearer(partner)).send({ depositPaid: 5_000_000 }).expect(409);
    await request(http)
      .post(`/api/rentals/contracts/${contractId}/handover`)
      .set(bearer(partner))
      .send({ handoverKm: 10_000, handoverFuel: 80 })
      .expect(409);

    // 6. Xác minh GPLX + CCCD (DAT_TRUOC -> DA_XAC_MINH) -> khách không còn tự huỷ trực tuyến được (theo S8)
    const verified = await request(http)
      .post(`/api/rentals/contracts/${contractId}/verify`)
      .set(bearer(partner))
      .send({ idCardNo: '001095012345', driverLicenseNo: '0102345678 (B2)', kycNote: 'Đã đối chiếu bản gốc' })
      .expect(200);
    expect(verified.body.status).toBe('DA_XAC_MINH');

    await request(http).post(`/api/public/rentals/contracts/${contractId}/cancel`).send({ token, reason: 'Đổi ý' }).expect(409);

    // 7. Ký hợp đồng & đặt cọc (DA_XAC_MINH -> DA_KY_COC) -> Bàn giao xe kèm ảnh (DA_KY_COC -> DANG_THUE)
    await request(http)
      .post(`/api/rentals/contracts/${contractId}/deposit`)
      .set(bearer(partner))
      .send({ depositPaid: 5_000_000, sellerNote: 'Đã ký hợp đồng trực tiếp & nhận cọc CK' })
      .expect(200);

    const img = await request(http).post('/api/files').set(bearer(partner)).attach('file', TINY_PNG, 'handover.png').expect(201);
    const handed = await request(http)
      .post(`/api/rentals/contracts/${contractId}/handover`)
      .set(bearer(partner))
      .send({ handoverKm: 10_000, handoverFuel: 85, handoverImageIds: [img.body.id], handoverNote: '8 góc không trầy xước' })
      .expect(200);
    expect(handed.body.status).toBe('DANG_THUE');

    // 8. Giả lập quá giờ trả xe -> tự động chuyển sang QUA_HAN khi đọc hợp đồng; token sai bị chặn 403
    await prisma.rentalContract.update({
      where: { id: contractId },
      data: { endAt: new Date(Date.now() - 2 * 3_600_000) },
    });
    await request(http).get(`/api/public/rentals/contracts/${contractId}?token=sai-token-123456`).expect(403);
    const overdueView = await request(http).get(`/api/public/rentals/contracts/${contractId}?token=${encodeURIComponent(token)}`).expect(200);
    expect(overdueView.body.status).toBe('QUA_HAN');

    // 9. Nhận trả xe (QUA_HAN -> DA_TRA_XE): chặn km trả < km giao; tự động gợi ý phụ phí vượt 150km * 5.000đ = 750.000đ
    await request(http)
      .post(`/api/rentals/contracts/${contractId}/return`)
      .set(bearer(partner))
      .send({ returnKm: 9_900, returnFuel: 80 })
      .expect(400);

    const returned = await request(http)
      .post(`/api/rentals/contracts/${contractId}/return`)
      .set(bearer(partner))
      .send({ returnKm: 10_750, returnFuel: 85, returnNote: 'Vượt 150km, xe sạch đẹp' })
      .expect(200);
    expect(returned.body).toMatchObject({
      status: 'DA_TRA_XE',
      extraFee: 750_000,
    });

    // 10. Quyết toán hợp đồng (DA_TRA_XE -> DA_QUYET_TOAN): 1.800.000 + 750.000 - 50.000 = 2.500.000; hoàn cọc 2.500.000
    const settled = await request(http)
      .post(`/api/rentals/contracts/${contractId}/settle`)
      .set(bearer(partner))
      .send({ extraFee: 750_000, discount: 50_000, paymentMethod: 'CHUYEN_KHOAN', sellerNote: 'Đã hoàn lại cọc 2,5 triệu' })
      .expect(200);
    expect(settled.body).toMatchObject({
      status: 'DA_QUYET_TOAN',
      finalTotal: 2_500_000,
      depositRefund: 2_500_000,
      cashEntry: null,
    });
  });

  it('luồng PLG (GARAGE) + App chủ xe (/api/owner/rentals): lên sàn ngay, cô lập chi nhánh, huỷ giải phóng lịch & tự ghi sổ quỹ PT… (THU_THUE_XE)', async () => {
    // 1. PLG (CN1) đăng xe ký gửi -> mở cho thuê ngay không cần chờ duyệt; quản lý CN2 không can thiệp được
    const plgVeh = await request(http)
      .post('/api/rentals/vehicles')
      .set(bearer(sales))
      .send({
        title: `Mazda CX-5 Luxury ${tag}`,
        plateNo: randomPlate(),
        make: 'Mazda',
        model: 'CX-5',
        year: 2024,
        seats: 5,
        transmission: 'TU_DONG',
        fuel: 'XANG',
        ownerType: 'CONSIGN',
        dailyPrice: 800_000,
        deposit: 3_000_000,
        kmLimitPerDay: 300,
        overKmFee: 5_000,
        branchId: cn1Id,
        province: 'Bình Phước',
        pickupAddress: 'CN1 Đồng Xoài',
      })
      .expect(201);
    const plgVehId = plgVeh.body.id as string;

    const plgSub = await request(http).post(`/api/rentals/vehicles/${plgVehId}/submit`).set(bearer(sales)).expect(200);
    expect(plgSub.body.status).toBe('DANG_CHO_THUE');

    await request(http).post(`/api/rentals/vehicles/${plgVehId}/hide`).set(bearer(managerCn2)).expect(403);
    await request(http).get(`/api/rentals/contracts?branchId=${cn1Id}`).set(bearer(managerCn2)).expect(403);

    // 2. Tạo tài khoản App chủ xe
    const cust = await request(http)
      .post('/api/customers')
      .set(bearer(sales))
      .send({ name: 'Lê Minh Chủ Xe', phone: randomPhone(), vehicle: { plate: randomPlate(), make: 'Kia', model: 'Seltos', year: 2022 } })
      .expect(201);
    const inv = await request(http).post(`/api/customers/${cust.body.id}/app/invite`).set(bearer(sales)).expect(201);
    const ownerToken = (
      await request(http)
        .post('/api/owner/auth/activate')
        .send({ token: inv.body.url.split('/').pop(), password: 'Chuxe2026' })
        .expect(200)
    ).body.accessToken as string;

    // 3. Chủ xe đặt lịch [ngày +10 -> ngày +12] rồi tự huỷ -> đặt lại đúng khung ngày đó thành công
    const sAt = futureIso(10, 9);
    const eAt = futureIso(12, 9);

    const firstBook = await request(http)
      .post('/api/owner/rentals/contracts')
      .set(bearer(ownerToken))
      .send({ rentalVehicleId: plgVehId, startAt: sAt, endAt: eAt, note: 'Đặt lần 1' })
      .expect(201);

    await request(http)
      .post(`/api/owner/rentals/contracts/${firstBook.body.id}/cancel`)
      .set(bearer(ownerToken))
      .send({ reason: 'Đổi giờ nhận xe' })
      .expect(200);

    const secondBook = await request(http)
      .post('/api/owner/rentals/contracts')
      .set(bearer(ownerToken))
      .send({ rentalVehicleId: plgVehId, startAt: sAt, endAt: eAt, idCardNo: '070091009999', driverLicenseNo: '700112233', note: 'Đặt lại khung giờ đã huỷ' })
      .expect(201);
    const cid = secondBook.body.id as string;

    // Quản lý CN2 không xử lý được hợp đồng của CN1
    await request(http)
      .post(`/api/rentals/contracts/${cid}/verify`)
      .set(bearer(managerCn2))
      .send({ idCardNo: '070091009999', driverLicenseNo: '700112233' })
      .expect(403);

    // 4. Nhân viên CN1 xử lý trọn quy trình và quyết toán -> kiểm tra tự sinh phiếu thu sổ quỹ PT… (THU_THUE_XE)
    await request(http)
      .post(`/api/rentals/contracts/${cid}/verify`)
      .set(bearer(sales))
      .send({ idCardNo: '070091009999', driverLicenseNo: '700112233' })
      .expect(200);
    await request(http).post(`/api/rentals/contracts/${cid}/deposit`).set(bearer(sales)).send({ depositPaid: 3_000_000 }).expect(200);
    await request(http)
      .post(`/api/rentals/contracts/${cid}/handover`)
      .set(bearer(sales))
      .send({ handoverKm: 20_000, handoverFuel: 90 })
      .expect(200);
    await request(http)
      .post(`/api/rentals/contracts/${cid}/return`)
      .set(bearer(sales))
      .send({ returnKm: 20_350, returnFuel: 90 })
      .expect(200);

    const settled = await request(http)
      .post(`/api/rentals/contracts/${cid}/settle`)
      .set(bearer(sales))
      .send({ extraFee: 0, discount: 0, paymentMethod: 'CHUYEN_KHOAN' })
      .expect(200);

    expect(settled.body).toMatchObject({
      status: 'DA_QUYET_TOAN',
      finalTotal: 1_600_000,
      depositRefund: 1_400_000,
      cashEntry: {
        code: expect.stringMatching(/^PT\d{6}$/),
        amount: 1_600_000,
      },
    });

    const ownerView = await request(http).get(`/api/owner/rentals/contracts/${cid}`).set(bearer(ownerToken)).expect(200);
    expect(ownerView.body).toMatchObject({ status: 'DA_QUYET_TOAN', finalTotal: 1_600_000, depositRefund: 1_400_000 });

    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const cashbook = await request(http)
      .get(`/api/finance/cashbook?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&branchId=${cn1Id}`)
      .set(bearer(accountant))
      .expect(200);
    expect(
      cashbook.body.rows.some(
        (e: { code: string; category: string; amount: number }) =>
          e.code === settled.body.cashEntry.code && e.category === 'Thu tiền cho thuê xe' && e.amount === 1_600_000,
      ),
    ).toBe(true);
  });
});
