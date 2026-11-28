import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, createApp, login, PHONES, randomPhone, randomPlate } from './helpers';

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const daysFromNow = (n: number) => new Date(Date.now() + 7 * 3_600_000 + n * 86_400_000);

describe('Nhắc lịch tự động (App/Zalo/SMS), Hạn phù hiệu, Theo dõi bảo dưỡng Km/Tháng & Sê-ri Bảo hành', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  const TAG = `fl${Math.random().toString(36).slice(2, 8)}`;

  let owner: string;
  let sales: string;
  let cskh: string;
  let accountant: string;
  let partner: string;
  let cn1: string;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    owner = (await login(app, PHONES.owner)).token;
    sales = (await login(app, PHONES.sales)).token;
    cskh = (await login(app, PHONES.cskh)).token;
    accountant = (await login(app, PHONES.accountant)).token;
    partner = (await login(app, PHONES.partnerOwner)).token;
    const branches = await request(http).get('/api/branches').set(bearer(owner)).expect(200);
    cn1 = branches.body.find((b: { code: string }) => b.code === 'CN1').id;
  });

  afterAll(async () => {
    // Trả lại cấu hình mặc định để không ảnh hưởng tới các bộ test khác chạy chung DB
    await request(http)
      .put('/api/care/settings')
      .set(bearer(owner))
      .send({
        registrationDays: 30,
        insuranceDays: 30,
        badgeDays: 30,
        maintenanceMonths: 6,
        followUpDays: 3,
        maxAttempts: 3,
        autoAppEnabled: false,
        autoZaloEnabled: false,
        autoSmsEnabled: false,
      });
    await app.close();
  });

  it('bảo vệ phân quyền: Đối tác (PARTNER) và vai trò không có quyền bị chặn truy cập cấu hình SMS, định mức & sê-ri garage', async () => {
    await request(http).get('/api/serials').set(bearer(partner)).expect(403);
    await request(http).get('/api/maintenance/rules').set(bearer(partner)).expect(403);
    await request(http).get('/api/sms/settings').set(bearer(partner)).expect(403);
    await request(http).put('/api/maintenance/rules').set(bearer(cskh)).send({ rules: [] }).expect(403);
    await request(http)
      .post('/api/serials')
      .set(bearer(accountant))
      .send({ serialNo: `BLOCK-${TAG}`, kind: 'LOP', productName: 'Lốp test' })
      .expect(403);
  });

  it('theo dõi phù hiệu xe + số ngày nhắc riêng trên xe, tự ghi nhận bảo dưỡng khi giao đơn DA_GIAO, tính kmDriven & gửi nhắc tự động App + SMS chống trùng', async () => {
    const custPhone = randomPhone();
    const plate = randomPlate();

    // 1. Tạo khách + xe có phù hiệu hết hạn sau 40 ngày, nhưng xe này cài nhắc sớm trước 45 ngày (ghi đè mức chung 30 ngày)
    const createCust = await request(http)
      .post('/api/customers')
      .set(bearer(owner))
      .send({
        name: `Khách Đội Xe ${TAG}`,
        phone: custPhone,
        branchId: cn1,
        vehicle: {
          plate,
          make: 'Toyota',
          model: 'Innova',
          odometerKm: 20_000,
          badgeNo: `PH-${TAG.toUpperCase()}`,
          badgeType: 'XE_HOP_DONG',
          badgeExpiry: ymd(daysFromNow(40)),
          badgeRemindDays: 45,
        },
      })
      .expect(201);

    const customerId = createCust.body.id as string;
    const custDetail = await request(http).get(`/api/customers/${customerId}`).set(bearer(owner)).expect(200);
    const vehicleId = custDetail.body.vehicles[0].id as string;
    const formattedPlate = custDetail.body.vehicles[0].plate as string;

    const vehDetail = await request(http).get(`/api/vehicles/${vehicleId}`).set(bearer(owner)).expect(200);
    expect(vehDetail.body).toMatchObject({
      badgeNo: `PH-${TAG.toUpperCase()}`,
      badgeType: 'XE_HOP_DONG',
      badgeRemindDays: 45,
    });

    // Liên kết khách với tài khoản App Chủ xe để kiểm tra thông báo tự động qua App
    const ownerTenant = await prisma.tenant.findFirstOrThrow({ where: { type: 'GARAGE', deletedAt: null } });
    const appUser = await prisma.user.create({
      data: {
        fullName: `Chủ xe App ${TAG}`,
        phone: custPhone,
        passwordHash: 'x',
      },
    });
    await prisma.customerLink.create({
      data: { customerId, tenantId: ownerTenant.id, userId: appUser.id },
    });

    // 2. Tạo & Giao đơn sửa chữa có thay dầu nhớt ở mốc 20.000 km -> hệ thống tự động ghi nhận hạng mục DAU_NHOT
    const orderRes = await request(http)
      .post('/api/orders')
      .set(bearer(sales))
      .send({
        branchId: cn1,
        customerId,
        vehicleId,
        odometerKm: 20_000,
        items: [{ kind: 'PHU_TUNG', name: 'Dầu nhớt Castrol Magnatec 5W-30', quantity: 4, unitPrice: 180_000 }],
      })
      .expect(201);
    for (const to of ['DANG_SUA', 'HOAN_THANH']) {
      await request(http).post(`/api/orders/${orderRes.body.id}/status`).set(bearer(sales)).send({ to }).expect(200);
    }
    await request(http)
      .post(`/api/orders/${orderRes.body.id}/status`)
      .set(bearer(sales))
      .send({ to: 'DA_GIAO', allowDebt: true })
      .expect(200);

    // Kiểm tra hạng mục bảo dưỡng đã tự động ghi nhận ở 20.000 km (chu kỳ 5.000 km -> mốc tiếp theo 25.000 km)
    const maintBefore = await request(http).get(`/api/maintenance/vehicles/${vehicleId}`).set(bearer(owner)).expect(200);
    expect(maintBefore.body.active).toHaveLength(1);
    expect(maintBefore.body.active[0]).toMatchObject({
      categoryCode: 'DAU_NHOT',
      installedKm: 20_000,
      intervalKm: 5_000,
      nextDueKm: 25_000,
      kmDriven: 0,
      alertState: 'BINH_THUONG',
    });

    // 3. Cập nhật đồng hồ công-tơ-mét lên 24.700 km -> đã chạy 4.700 km, chỉ còn 300 km (<= ngưỡng nhắc trước 500 km)
    await request(http)
      .post(`/api/vehicles/${vehicleId}/odometer`)
      .set(bearer(owner))
      .send({ km: 24_700, correction: false })
      .expect(200);

    const maintAfter = await request(http).get(`/api/maintenance/vehicles/${vehicleId}`).set(bearer(owner)).expect(200);
    expect(maintAfter.body.active[0]).toMatchObject({
      kmDriven: 4_700,
      kmRemaining: 300,
      alertState: 'SAP_DEN_HAN',
    });

    // 4. Quét Lịch gọi -> Phải sinh cả 2 việc hôm nay: Phù hiệu xe (do badgeRemindDays=45) & Bảo dưỡng Dầu nhớt (do còn 300 km)
    const todayTasks = await request(http)
      .get('/api/care/tasks')
      .query({ view: 'hom-nay', refresh: 'true', pageSize: 50, q: TAG })
      .set(bearer(cskh))
      .expect(200);
    const titles = todayTasks.body.items.map((t: { title: string }) => t.title) as string[];
    expect(titles.some((t) => t.toLowerCase().includes('phù hiệu') && t.includes(`PH-${TAG.toUpperCase()}`))).toBe(true);
    expect(titles.some((t) => t.includes('Castrol Magnatec') && t.includes('4.700/5.000 km'))).toBe(true);

    // 5. Cấu hình SMS chế độ giả lập + Bật tự động gửi qua App & SMS -> Chạy gửi nhắc tự động
    await request(http)
      .put('/api/sms/settings')
      .set(bearer(owner))
      .send({
        enabled: true,
        provider: 'ESMS',
        mode: 'development',
        brandname: 'CARDIY',
        templateText: '[{garage_name}] Xe {plate}: {care_title} ({due_date}). LH {branch_phone}',
      })
      .expect(200);

    await request(http)
      .put('/api/care/settings')
      .set(bearer(owner))
      .send({
        badgeDays: 30,
        autoAppEnabled: true,
        autoSmsEnabled: true,
        autoZaloEnabled: false,
        sendHourVn: 8,
      })
      .expect(200);

    const run1 = await request(http).post('/api/care/auto-reminders/run').set(bearer(cskh)).send({}).expect(200);
    expect(run1.body.appSent).toBeGreaterThanOrEqual(2);
    expect(run1.body.smsSent).toBeGreaterThanOrEqual(2);

    // Kiểm tra thông báo đã đẩy thật vào hộp thư App Chủ xe & Nhật ký SMS
    const appNotifs = await prisma.ownerNotification.findMany({ where: { userId: appUser.id, kind: 'REMINDER' } });
    expect(appNotifs.length).toBeGreaterThanOrEqual(2);
    expect(appNotifs.some((n) => n.title.includes(formattedPlate))).toBe(true);

    const smsMessages = await request(http).get('/api/sms/messages').set(bearer(owner)).expect(200);
    expect(smsMessages.body.some((m: { phone: string; content: string; status: string }) => m.phone === custPhone && m.status === 'SIMULATED' && m.content.includes(formattedPlate))).toBe(true);

    // Chạy quét lần 2 ngay lập tức -> Chống gửi trùng lặp tuyệt đối cho khách vừa nhận!
    const notifCountBeforeSecondRun = await prisma.ownerNotification.count({ where: { userId: appUser.id, kind: 'REMINDER' } });
    const run2 = await request(http).post('/api/care/auto-reminders/run').set(bearer(cskh)).send({}).expect(200);
    const notifCountAfterSecondRun = await prisma.ownerNotification.count({ where: { userId: appUser.id, kind: 'REMINDER' } });
    expect(notifCountAfterSecondRun).toBe(notifCountBeforeSecondRun);
    expect(run2.body.skipped).toBeGreaterThanOrEqual(4);
  });

  it('quản lý vòng đời Sê-ri Lốp / Ắc quy / Pin Lithium: lắp mới → đảo vị trí → chuyển sang xe khác → tra cứu bảo hành theo biển số & sê-ri → đổi bảo hành', async () => {
    const plateA = randomPlate();
    const plateB = randomPlate();
    const custRes = await request(http)
      .post('/api/customers')
      .set(bearer(owner))
      .send({
        name: `Khách Bảo Hành Sê-ri ${TAG}`,
        phone: randomPhone(),
        branchId: cn1,
        vehicle: { plate: plateA, make: 'Ford', model: 'Ranger', odometerKm: 30_000 },
      })
      .expect(201);
    const custId = custRes.body.id as string;
    const carAId = (await request(http).get(`/api/customers/${custId}`).set(bearer(owner))).body.vehicles[0].id as string;

    const carBRes = await request(http)
      .post('/api/vehicles')
      .set(bearer(owner))
      .send({ customerId: custId, plate: plateB, make: 'Mazda', model: 'CX-5', odometerKm: 15_000 })
      .expect(201);
    const carBId = carBRes.body.id as string;
    const carBPlateFormatted = carBRes.body.plate as string;

    const tireSerial = `MICH-${TAG.toUpperCase()}-01`;
    const lithiumSerial = `LFP-${TAG.toUpperCase()}-02`;

    // 1. Lắp mới Lốp lên Xe A (Lốp trước trái) & Pin Lithium lên Xe A (Gầm xe)
    const createdTire = await request(http)
      .post('/api/serials')
      .set(bearer(sales))
      .send({
        serialNo: tireSerial,
        kind: 'LOP',
        productName: 'Lốp Michelin Primacy SUV+ 265/60R18',
        brand: 'Michelin',
        dotOrMfg: 'DOT 4026',
        branchId: cn1,
        vehicleId: carAId,
        position: 'TRUOC_TRAI',
        installedKm: 30_000,
        warrantyMonths: 36,
        warrantyKm: 50_000,
      })
      .expect(201);
    const tireId = createdTire.body.id as string;
    expect(createdTire.body).toMatchObject({
      serialNo: tireSerial,
      status: 'DANG_SU_DUNG',
      position: 'TRUOC_TRAI',
      warrantyState: 'CON_BAO_HANH',
      warrantyMaxKm: 80_000,
    });

    await request(http)
      .post('/api/serials')
      .set(bearer(sales))
      .send({
        serialNo: lithiumSerial,
        kind: 'PIN_LITHIUM',
        productName: 'Pack Pin Lithium LiFePO4 12V 100Ah',
        brand: 'CATL',
        branchId: cn1,
        vehicleId: carAId,
        position: 'GAM_XE',
        installedKm: 30_000,
        warrantyMonths: 24,
        warrantyKm: 60_000,
      })
      .expect(201);

    // 2. Đảo vị trí lốp trên Xe A (TRUOC_TRAI -> SAU_PHAI) ở mốc 40.000 km
    const rotated = await request(http)
      .post(`/api/serials/${tireId}/transition`)
      .set(bearer(sales))
      .send({ action: 'DAO_VI_TRI', toPosition: 'SAU_PHAI', odometerKm: 40_000, note: 'Đảo lốp định kỳ 10.000km' })
      .expect(200);
    expect(rotated.body.position).toBe('SAU_PHAI');

    // 3. Chuyển lốp từ Xe A sang Xe B (CHUYEN_XE)
    const transferred = await request(http)
      .post(`/api/serials/${tireId}/transition`)
      .set(bearer(sales))
      .send({ action: 'CHUYEN_XE', toVehicleId: carBId, toPosition: 'TRUOC_PHAI', odometerKm: 16_000, note: 'Chuyển lốp sang xe thứ 2 của khách' })
      .expect(200);
    expect(transferred.body.vehicle.id).toBe(carBId);
    expect(transferred.body.position).toBe('TRUOC_PHAI');

    // 4. Tra cứu bảo hành theo Biển số Xe B -> thấy lốp đang gắn kèm đầy đủ 3 sự kiện vòng đời
    const lookupByPlateB = await request(http)
      .get('/api/serials/lookup')
      .query({ q: carBPlateFormatted })
      .set(bearer(cskh))
      .expect(200);
    const foundTireOnB = lookupByPlateB.body.items.find((i: { serialNo: string }) => i.serialNo === tireSerial);
    expect(foundTireOnB).toBeTruthy();
    expect(foundTireOnB.warrantyState).toBe('CON_BAO_HANH');
    expect(foundTireOnB.events.map((e: { action: string }) => e.action)).toEqual(['CHUYEN_XE', 'DAO_VI_TRI', 'LAP_MOI']);

    // Tra cứu theo Biển số Xe A (cũ) -> vẫn truy vết được lịch sử lốp đã chuyển đi VÀ thấy Pin Lithium đang gắn trên Xe A!
    const lookupByPlateA = await request(http)
      .get('/api/serials/lookup')
      .query({ q: plateA })
      .set(bearer(cskh))
      .expect(200);
    const serialNosOnA = lookupByPlateA.body.items.map((i: { serialNo: string }) => i.serialNo);
    expect(serialNosOnA).toEqual(expect.arrayContaining([tireSerial, lithiumSerial]));

    // 5. Đổi bảo hành (DOI_BAO_HANH) cấp luôn sê-ri mới thay thế ngay trên Xe B
    const replacementSerial = `MICH-${TAG.toUpperCase()}-REPL`;
    const replaced = await request(http)
      .post(`/api/serials/${tireId}/transition`)
      .set(bearer(sales))
      .send({
        action: 'DOI_BAO_HANH',
        odometerKm: 18_000,
        replacementSerialNo: replacementSerial,
        note: 'Bảo hành lỗi nhà sản xuất 1 đổi 1',
      })
      .expect(200);
    expect(replaced.body.status).toBe('BAO_HANH');
    expect(replaced.body.vehicle).toBeNull();

    // Sê-ri thay thế mới tự động gắn vào đúng vị trí TRUOC_PHAI trên Xe B
    const lookupRepl = await request(http)
      .get('/api/serials/lookup')
      .query({ q: replacementSerial })
      .set(bearer(cskh))
      .expect(200);
    expect(lookupRepl.body.items).toHaveLength(1);
    expect(lookupRepl.body.items[0]).toMatchObject({
      serialNo: replacementSerial,
      status: 'DANG_SU_DUNG',
      position: 'TRUOC_PHAI',
      warrantyState: 'CON_BAO_HANH',
    });
    expect(lookupRepl.body.items[0].vehicle.id).toBe(carBId);
  });
});
