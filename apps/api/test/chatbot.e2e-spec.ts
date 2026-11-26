import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, login, PHONES, randomPhone, randomPlate } from './helpers';

describe('Vòng 5.3: Chatbot AI đặt lịch & Tư vấn chủ xe trên Sàn và App chủ xe (M36, D5, A1, A2)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let plgOwner: string;
  let sales: string;
  let cn1Id: string;

  const tag = `CB${Date.now().toString(36).toUpperCase()}`;

  async function createActivatedOwner(name: string, address: string, make: string, model: string, odometerKm: number) {
    const cust = await request(http)
      .post('/api/customers')
      .set(bearer(sales))
      .send({
        name,
        phone: randomPhone(),
        address,
        vehicle: { plate: randomPlate(), make, model, year: 2023, odometerKm },
      })
      .expect(201);

    const detail = await request(http).get(`/api/customers/${cust.body.id}`).set(bearer(sales)).expect(200);
    const inv = await request(http).post(`/api/customers/${cust.body.id}/app/invite`).set(bearer(sales)).expect(201);
    const act = await request(http)
      .post('/api/owner/auth/activate')
      .send({ token: inv.body.url.split('/').pop(), password: 'Chuxe2026' })
      .expect(200);

    return {
      customerId: cust.body.id as string,
      vehicleId: detail.body.vehicles[0].id as string,
      plate: detail.body.vehicles[0].plate as string,
      ownerToken: act.body.accessToken as string,
    };
  }

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();

    plgOwner = (await login(app, PHONES.owner)).token;
    sales = (await login(app, PHONES.sales)).token;

    const branches = (await request(http).get('/api/branches').set(bearer(plgOwner))).body as { id: string; code: string }[];
    cn1Id = branches.find((b) => b.code === 'CN1')!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('cô lập chặt chẽ: không lộ quy trình kỹ thuật nội bộ của Garage ra Chatbot công khai & chặn truy cập trái phép', async () => {
    const privateDocCode = `DOC-SECRET-${tag}`;
    await request(http)
      .post('/api/ai/documents')
      .set(bearer(plgOwner))
      .send({
        code: privateDocCode,
        title: `Quy trình nội bộ tuyệt mật ${tag}`,
        category: 'BAO_DUONG',
        tags: [`matma${tag.toLowerCase()}`],
        content: ` Bí kíp nội bộ riêng của xưởng ${tag} không công bố ra ngoài.`,
        active: true,
      })
      .expect(201);

    const pubRes = await request(http)
      .post('/api/public/chatbot/ask')
      .send({
        message: `Hỏi về matma${tag.toLowerCase()} và bảo dưỡng định kỳ 40.000 km`,
      })
      .expect(200);

    expect(pubRes.body.message.citedDocCodes).toContain('PUB-BD-DINH-KY');
    expect(pubRes.body.message.citedDocCodes).not.toContain(privateDocCode);
    expect(pubRes.body.message.content).not.toContain(`Bí kíp nội bộ riêng của xưởng ${tag}`);

    // Endpoint App chủ xe bắt buộc phải có token chủ xe (token nhân viên CRM hoặc không có token đều 401)
    await request(http).get('/api/owner/chatbot/session').expect(401);
    await request(http).get('/api/owner/chatbot/session').set(bearer(sales)).expect(401);
  });

  it('Web sàn công khai (A1): tư vấn mốc 40.000 km, báo giá sàn, che PII, đề xuất giờ hẹn và CHỈ tạo yêu cầu YC… khi khách xác nhận', async () => {
    const bookingPhone = randomPhone();
    const askRes = await request(http)
      .post('/api/public/chatbot/ask')
      .send({
        message:
          'Gọi tôi số 0917 888 999 (email vankhach@test.vn): xe Mazda CX-5 đi 4 vạn km cần bảo dưỡng gì, giá dầu nhớt 5W-30 trên sàn bao nhiêu và cho tôi đặt lịch?',
      })
      .expect(200);

    const sessionToken = askRes.body.sessionToken as string;
    expect(sessionToken.length).toBeGreaterThanOrEqual(20);
    expect(askRes.body.piiMaskedCount).toBeGreaterThanOrEqual(2);
    expect(askRes.body.message.sanitizedContext).not.toContain('0917 888 999');
    expect(askRes.body.message.sanitizedContext).not.toContain('vankhach@test.vn');
    expect(askRes.body.message.sanitizedContext).toContain('[SĐT_ĐÃ_CHE]');
    expect(askRes.body.message.sanitizedContext).toContain('[EMAIL_ĐÃ_CHE]');

    // Kế hoạch bảo dưỡng cấp lớn 40.000 km + báo giá tin đang bán trên sàn
    expect(askRes.body.message.maintenancePlan.milestoneKm).toBe(40_000);
    expect(askRes.body.message.maintenancePlan.tierCode).toBe('CAP_LON');
    expect(askRes.body.message.matchedOffers.length).toBeGreaterThan(0);

    // Đề xuất khung giờ hẹn ở trạng thái DE_XUAT — CHƯA tạo OrderRequest thật
    const proposal = askRes.body.proposal;
    expect(proposal).toBeTruthy();
    expect(proposal.status).toBe('DE_XUAT');
    expect(proposal.orderRequestId).toBeNull();
    expect(proposal.suggestedSlots.length).toBeGreaterThan(0);

    // Người lạ dùng sessionToken khác cố tình xác nhận proposal này -> 404 Not Found
    await request(http)
      .post(`/api/public/chatbot/proposals/${proposal.id}/confirm-request`)
      .send({
        sessionToken: 'wrong_session_token_9999999999',
        scheduledAt: proposal.suggestedSlots[0],
        name: 'Kẻ Giả Mạo',
        phone: randomPhone(),
      })
      .expect(404);

    // Khách thật bấm Xác nhận -> tạo OrderRequest thật (YC…)
    const confirmed = await request(http)
      .post(`/api/public/chatbot/proposals/${proposal.id}/confirm-request`)
      .send({
        sessionToken,
        scheduledAt: proposal.suggestedSlots[0],
        name: `Khách Đặt Sàn ${tag}`,
        phone: bookingPhone,
        plateNo: randomPlate(),
      })
      .expect(200);

    expect(confirmed.body.status).toBe('DA_XAC_NHAN');
    expect(confirmed.body.code).toMatch(/^YC\d{6}$/);

    // Kiểm tra yêu cầu đặt hàng thật đã tồn tại trên sàn qua API theo dõi
    const tracked = await request(http)
      .get(`/api/public/market/requests/${confirmed.body.orderRequestId}`)
      .query({ t: confirmed.body.token })
      .expect(200);
    expect(tracked.body.code).toBe(confirmed.body.code);
    expect(tracked.body.status).toBe('CHO_XAC_NHAN');

    // Chặn xác nhận trùng lặp lần 2 -> 409 Conflict
    await request(http)
      .post(`/api/public/chatbot/proposals/${proposal.id}/confirm-request`)
      .send({
        sessionToken,
        scheduledAt: proposal.suggestedSlots[0],
        name: `Khách Đặt Sàn ${tag}`,
        phone: bookingPhone,
      })
      .expect(409);
  });

  it('App chủ xe (A2): tự nhận diện xe & số km, che sạch PII chủ xe, cô lập giữa 2 chủ xe và CHỈ tạo Booking LH… khi chủ xe xác nhận', async () => {
    const secretOwnerName = `Trần Chủ Xe Bí Mật ${tag}`;
    const secretAddress = '77 Trần Hưng Đạo, Quận 1';
    const ownerA = await createActivatedOwner(secretOwnerName, secretAddress, 'Toyota', 'Corolla Cross', 19_500);
    const ownerB = await createActivatedOwner(`Chủ Xe Khác ${tag}`, '12 Lê Lợi, Quận 1', 'Honda', 'CR-V', 12_000);

    // ownerA không được phép yêu cầu tư vấn trên vehicleId của ownerB -> 404
    await request(http)
      .post('/api/owner/chatbot/ask')
      .set(bearer(ownerA.ownerToken))
      .send({
        vehicleId: ownerB.vehicleId,
        message: 'Xe này cần bảo dưỡng những gì?',
      })
      .expect(404);

    // ownerA hỏi bảo dưỡng & yêu cầu đề xuất lịch hẹn (kèm vô tình nhắc tên & địa chỉ)
    const askA = await request(http)
      .post('/api/owner/chatbot/ask')
      .set(bearer(ownerA.ownerToken))
      .send({
        vehicleId: ownerA.vehicleId,
        branchId: cn1Id,
        wantBooking: true,
        message: `Xe của ${secretOwnerName} ở ${secretAddress} sắp tới kỳ bảo dưỡng cần làm gì và có giờ nào trống?`,
      })
      .expect(200);

    expect(askA.body.piiMaskedCount).toBeGreaterThanOrEqual(2);
    expect(askA.body.message.sanitizedContext).not.toContain(secretOwnerName);
    expect(askA.body.message.sanitizedContext).not.toContain(secretAddress);
    expect(askA.body.message.sanitizedContext).not.toContain(ownerA.plate);
    expect(askA.body.message.maintenancePlan.milestoneKm).toBe(20_000);
    expect(askA.body.message.maintenancePlan.tierCode).toBe('CAP_TRUNG');

    const propA = askA.body.proposal;
    expect(propA).toBeTruthy();
    expect(propA.status).toBe('DE_XUAT');
    expect(propA.bookingId).toBeNull();

    // Trước khi chủ xe xác nhận: danh sách lịch hẹn của ownerA phải đang trống (0 lịch hẹn)
    const beforeBookings = await request(http).get('/api/owner/bookings').set(bearer(ownerA.ownerToken)).expect(200);
    expect(beforeBookings.body).toHaveLength(0);

    // ownerB cố tình xác nhận proposal của ownerA -> 404 Not Found
    await request(http)
      .post(`/api/owner/chatbot/proposals/${propA.id}/confirm-booking`)
      .set(bearer(ownerB.ownerToken))
      .send({ scheduledAt: propA.suggestedSlots[0] })
      .expect(404);

    // ownerA bấm Xác nhận đặt lịch -> lúc này mới sinh bản ghi Booking LH… thật
    const confirmedBooking = await request(http)
      .post(`/api/owner/chatbot/proposals/${propA.id}/confirm-booking`)
      .set(bearer(ownerA.ownerToken))
      .send({ scheduledAt: propA.suggestedSlots[0] })
      .expect(200);

    expect(confirmedBooking.body.status).toBe('DA_XAC_NHAN');
    expect(confirmedBooking.body.code).toMatch(/^LH\d{6}$/);

    const afterBookings = await request(http).get('/api/owner/bookings').set(bearer(ownerA.ownerToken)).expect(200);
    expect(afterBookings.body).toHaveLength(1);
    expect(afterBookings.body[0].code).toBe(confirmedBooking.body.code);
    expect(afterBookings.body[0].status).toBe('CHO_XAC_NHAN');

    // Xác nhận lần 2 bị từ chối 409 Conflict
    await request(http)
      .post(`/api/owner/chatbot/proposals/${propA.id}/confirm-booking`)
      .set(bearer(ownerA.ownerToken))
      .send({ scheduledAt: propA.suggestedSlots[0] })
      .expect(409);
  });
});
