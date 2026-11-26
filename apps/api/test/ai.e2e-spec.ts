import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, login, PHONES, randomPhone, randomPlate } from './helpers';

describe('Vòng 5.2: Trợ lý AI nội bộ Garage — Tóm tắt xe, Gợi ý báo giá, Hỏi đáp kỹ thuật & Che PII (M36, D5, A3.63, A3.12, A3.32)', () => {
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
  let rescue: string;
  let partner: string;
  let cn1Id: string;

  const tag = `AI${Date.now().toString(36).toUpperCase()}`;

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
    rescue = (await login(app, PHONES.rescue)).token;
    partner = (await login(app, PHONES.partnerOwner)).token;

    const branches = (await request(http).get('/api/branches').set(bearer(plgOwner))).body as { id: string; code: string }[];
    cn1Id = branches.find((b) => b.code === 'CN1')!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('phân quyền RBAC & cô lập chi nhánh / tenant cho Trợ lý AI nội bộ (A3.63)', async () => {
    // Đội cứu hộ (CH), Đối tác sàn (PARTNER) và Admin sàn (PLATFORM) không được dùng Trợ lý AI Garage -> 403
    for (const tok of [rescue, partner, sa]) {
      await request(http).get('/api/ai/overview').set(bearer(tok)).expect(403);
      await request(http).get('/api/ai/documents').set(bearer(tok)).expect(403);
      await request(http).post('/api/ai/ask-tech').set(bearer(tok)).send({ question: 'Kiểm tra hệ thống phanh kêu' }).expect(403);
    }

    // CG, QL, BH, KTV, TK, KT, CS trong Garage có quyền ai.use -> 200
    for (const tok of [plgOwner, managerCn2, sales, tech, storekeeper, accountant, cskh]) {
      const ov = await request(http).get('/api/ai/overview').set(bearer(tok)).expect(200);
      expect(ov.body.documentsCount).toBeGreaterThanOrEqual(4);
    }

    // Chỉ Chủ garage (CG, có ai.manage) mới được tạo quy trình kỹ thuật; BH/KTV/QL bị chặn 403
    for (const tok of [sales, tech, managerCn2]) {
      await request(http)
        .post('/api/ai/documents')
        .set(bearer(tok))
        .send({
          code: `DOC-BLOCK-${tag}`,
          title: 'Quy trình không đủ quyền',
          category: 'CHAN_DOAN',
          content: 'Nội dung quy trình thử nghiệm kiểm tra phân quyền.',
          tags: ['test'],
          active: true,
        })
        .expect(403);
    }

    // Cô lập chi nhánh: Quản lý CN2 không được yêu cầu AI gợi ý báo giá trên chi nhánh CN1 hoặc đơn của CN1
    const custCn1 = await request(http)
      .post('/api/customers')
      .set(bearer(sales))
      .send({
        name: `Khách CN1 ${tag}`,
        phone: randomPhone(),
        vehicle: { plate: randomPlate(), make: 'Toyota', model: 'Vios', year: 2022 },
      })
      .expect(201);
    const custDetail = await request(http).get(`/api/customers/${custCn1.body.id}`).set(bearer(sales)).expect(200);
    const roCn1 = await request(http)
      .post('/api/orders')
      .set(bearer(sales))
      .send({
        branchId: cn1Id,
        customerId: custCn1.body.id,
        vehicleId: custDetail.body.vehicles[0].id,
        items: [{ kind: 'DICH_VU', name: 'Kiểm tra tổng quát', quantity: 1, unitPrice: 150_000 }],
      })
      .expect(201);

    await request(http)
      .post('/api/ai/suggest-quote')
      .set(bearer(managerCn2))
      .send({ orderId: roCn1.body.id, symptoms: 'Phanh trước kêu rít khi đạp' })
      .expect(403);

    await request(http)
      .post('/api/ai/suggest-quote')
      .set(bearer(managerCn2))
      .send({ branchId: cn1Id, symptoms: 'Phanh trước kêu rít khi đạp' })
      .expect(403);
  });

  it('che sạch PII trước khi đóng gói ngữ cảnh AI, ẩn giá với KTV và đảm bảo AI chỉ đề xuất — người duyệt mới ghi vào đơn', async () => {
    const secretName = `Nguyễn Bảo Mật ${tag}`;
    const secretAddress = '99 Lê Duẩn, Bến Nghé, Quận 1';
    const cust = await request(http)
      .post('/api/customers')
      .set(bearer(sales))
      .send({
        name: secretName,
        phone: randomPhone(),
        email: 'baomat.khach@example.vn',
        address: secretAddress,
        vehicle: {
          plate: randomPlate(),
          make: 'Toyota',
          model: 'Camry',
          year: 2022,
          odometerKm: 39_600,
          note: `Xe chính chủ ${secretName} CCCD 079090888999`,
        },
      })
      .expect(201);

    const cd = await request(http).get(`/api/customers/${cust.body.id}`).set(bearer(sales)).expect(200);
    const vehicleId = cd.body.vehicles[0].id as string;

    const ro = await request(http)
      .post('/api/orders')
      .set(bearer(sales))
      .send({
        branchId: cn1Id,
        customerId: cust.body.id,
        vehicleId,
        odometerKm: 39_600,
        request: `Gọi khách ${secretName} số 0918 765 432 email baomat.khach@example.vn tại ${secretAddress}: điều hoà kém mát và phanh trước kêu két két`,
        items: [{ kind: 'DICH_VU', name: 'Tiếp nhận kiểm tra ban đầu', quantity: 1, unitPrice: 100_000 }],
      })
      .expect(201);
    const orderId = ro.body.id as string;

    // 1. Tóm tắt lịch sử xe (A3.32): kiểm chứng che sạch PII trong sanitizedContext
    const sum = await request(http)
      .post('/api/ai/summarize-vehicle')
      .set(bearer(sales))
      .send({ vehicleId })
      .expect(200);

    expect(sum.body.kind).toBe('VEHICLE_SUMMARY');
    expect(sum.body.piiMaskedCount).toBeGreaterThanOrEqual(5);
    expect(sum.body.sanitizedContext).not.toContain(secretName);
    expect(sum.body.sanitizedContext).not.toContain(secretAddress);
    expect(sum.body.sanitizedContext).not.toContain('0918 765 432');
    expect(sum.body.sanitizedContext).not.toContain('baomat.khach@example.vn');
    expect(sum.body.sanitizedContext).not.toContain('079090888999');
    expect(sum.body.sanitizedContext).toContain('[KHÁCH_HÀNG_ĐÃ_CHE]');
    expect(sum.body.sanitizedContext).toContain('[ĐỊA_CHỈ_ĐÃ_CHE]');
    expect(sum.body.sanitizedContext).toContain('[SĐT_ĐÃ_CHE]');
    expect(sum.body.sanitizedContext).toContain('[EMAIL_ĐÃ_CHE]');
    expect(sum.body.sanitizedContext).toContain('[MÃ_ĐỊNH_DANH_ĐÃ_CHE]');
    expect(sum.body.responseText).toContain('40.000 km');

    // 2. KTV gọi gợi ý chẩn đoán: không lộ đơn giá tiền (unitPrice = null) và không được quyền tự ghi vào đơn
    const techQuote = await request(http)
      .post('/api/ai/suggest-quote')
      .set(bearer(tech))
      .send({ orderId, symptoms: 'Điều hoà kém mát và phanh trước kêu két két' })
      .expect(200);

    expect(techQuote.body.status).toBe('DE_XUAT');
    expect(techQuote.body.suggestedItems.length).toBeGreaterThan(0);
    for (const item of techQuote.body.suggestedItems as { unitPrice: number | null }[]) {
      expect(item.unitPrice).toBeNull();
    }

    await request(http)
      .post(`/api/ai/suggestions/${techQuote.body.id}/apply-to-order`)
      .set(bearer(tech))
      .send({ orderId, selectedIndexes: [0] })
      .expect(403);

    // Chứng minh đơn sửa chữa CHƯA HỀ bị AI tự động ghi đè khi chưa có người có quyền duyệt
    const beforeApprove = await request(http).get(`/api/orders/${orderId}`).set(bearer(sales)).expect(200);
    expect(beforeApprove.body.items).toHaveLength(1);
    expect(beforeApprove.body.total).toBe(100_000);

    // 3. Cố vấn bán hàng (BH, có ro.manage) lấy đề xuất có giá và bấm Duyệt ghi mục đầu tiên vào đơn
    const salesQuote = await request(http)
      .post('/api/ai/suggest-quote')
      .set(bearer(sales))
      .send({
        orderId,
        symptoms: `Báo cho ${secretName} 0918 765 432: điều hoà kém mát và phanh trước kêu két két`,
      })
      .expect(200);

    expect(salesQuote.body.piiMaskedCount).toBeGreaterThanOrEqual(4);
    expect(salesQuote.body.sanitizedContext).not.toContain(secretName);
    expect(salesQuote.body.sanitizedContext).not.toContain('0918 765 432');
    expect(salesQuote.body.suggestedItems[0].unitPrice).toBeGreaterThan(0);
    expect(salesQuote.body.citedDocCodes.length).toBeGreaterThan(0);

    const applied = await request(http)
      .post(`/api/ai/suggestions/${salesQuote.body.id}/apply-to-order`)
      .set(bearer(sales))
      .send({ orderId, selectedIndexes: [0] })
      .expect(200);

    expect(applied.body.status).toBe('DA_AP_DUNG');
    expect(applied.body.addedCount).toBe(1);
    expect(applied.body.total).toBeGreaterThan(100_000);

    const afterApprove = await request(http).get(`/api/orders/${orderId}`).set(bearer(sales)).expect(200);
    expect(afterApprove.body.items).toHaveLength(2);
    expect(afterApprove.body.items[1].section).toBe('Đề xuất AI đã duyệt');

    // Chặn duyệt trùng lần 2 hoặc bỏ qua đề xuất đã áp dụng -> 409 Conflict
    await request(http)
      .post(`/api/ai/suggestions/${salesQuote.body.id}/apply-to-order`)
      .set(bearer(sales))
      .send({ orderId, selectedIndexes: [0] })
      .expect(409);

    await request(http).post(`/api/ai/suggestions/${salesQuote.body.id}/dismiss`).set(bearer(sales)).send({}).expect(409);

    // Bỏ qua đề xuất của KTV trước đó -> chuyển sang BO_QUA
    const dismissed = await request(http).post(`/api/ai/suggestions/${techQuote.body.id}/dismiss`).set(bearer(sales)).send({}).expect(200);
    expect(dismissed.body.status).toBe('BO_QUA');
  });

  it('Chủ garage bổ sung quy trình vào Kho tri thức (ai_documents) và KTV tra cứu hỏi đáp kỹ thuật có trích dẫn mã tài liệu', async () => {
    const docCode = `DOC-CVT-${tag}`;
    const createdDoc = await request(http)
      .post('/api/ai/documents')
      .set(bearer(plgOwner))
      .send({
        code: docCode,
        title: 'Quy trình chẩn đoán hộp số vô cấp CVT rung giật khi tăng tốc',
        category: 'CHAN_DOAN',
        make: 'Honda',
        tags: ['hop so cvt', 'rung giat', 'ns-3'],
        content: '1. Đọc nhiệt độ dầu hộp số CVT đạt 40 độ C.\n2. Kiểm tra áp suất dầu puly thứ cấp và thay dầu chuẩn HCF-2 / NS-3.',
        active: true,
      })
      .expect(201);

    expect(createdDoc.body.code).toBe(docCode);

    const qa = await request(http)
      .post('/api/ai/ask-tech')
      .set(bearer(tech))
      .send({
        vehicleMake: 'Honda',
        question: 'Xe Honda bị rung giật hộp số CVT khi tăng tốc (SĐT chủ xe 0909 222 333) cần kiểm tra gì?',
      })
      .expect(200);

    expect(qa.body.kind).toBe('TECH_QA');
    expect(qa.body.piiMaskedCount).toBe(1);
    expect(qa.body.sanitizedContext).not.toContain('0909 222 333');
    expect(qa.body.citedDocCodes).toContain(docCode);
    expect(qa.body.responseText).toContain('40 độ C');
  });
});
