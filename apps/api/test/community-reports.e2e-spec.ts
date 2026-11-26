import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, login, PHONES, randomPhone, randomPlate } from './helpers';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('Vòng 4.4: Cộng đồng chủ xe & Báo cáo chuỗi KPI/SLA (M34, M30, D5, A1.10, A2.11, A6.32, A6.62, A3.80, A6.01, A6.80)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let plgOwner: string;
  let sa: string;
  let sales: string;
  let tech: string;
  let storekeeper: string;
  let accountant: string;
  let managerCn2: string;
  let partner: string;
  let cn1Id: string;
  let cn2Id: string;

  const tag = `CD${Date.now().toString(36).toUpperCase()}`;

  async function createOwnerAccount(name: string): Promise<string> {
    const cust = await request(http)
      .post('/api/customers')
      .set(bearer(sales))
      .send({ name, phone: randomPhone(), vehicle: { plate: randomPlate(), make: 'Honda', model: 'CR-V', year: 2023 } })
      .expect(201);
    const inv = await request(http).post(`/api/customers/${cust.body.id}/app/invite`).set(bearer(sales)).expect(201);
    const act = await request(http)
      .post('/api/owner/auth/activate')
      .send({ token: inv.body.url.split('/').pop(), password: 'Chuxe2026' })
      .expect(200);
    return act.body.accessToken as string;
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
    managerCn2 = (await login(app, PHONES.managerCn2)).token;
    partner = (await login(app, PHONES.partnerOwner)).token;

    const branches = (await request(http).get('/api/branches').set(bearer(plgOwner))).body as { id: string; code: string }[];
    cn1Id = branches.find((b) => b.code === 'CN1')!.id;
    cn2Id = branches.find((b) => b.code === 'CN2')!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('phân quyền RBAC & cô lập chi nhánh trên Báo cáo chuỗi (M30 · A3.80) và Báo cáo toàn sàn (A6.01 · A6.80)', async () => {
    // KTV, Bán hàng, Thủ kho không có report.view -> 403
    await request(http).get('/api/reports/garage').set(bearer(tech)).expect(403);
    await request(http).get('/api/reports/garage').set(bearer(sales)).expect(403);
    await request(http).get('/api/reports/garage').set(bearer(storekeeper)).expect(403);

    // Quản lý CN2 chỉ được xem báo cáo CN2, cố truy cập CN1 -> 403
    const cn2Rep = await request(http).get('/api/reports/garage').set(bearer(managerCn2)).expect(200);
    expect(cn2Rep.body.branches).toHaveLength(1);
    expect(cn2Rep.body.branches[0].id).toBe(cn2Id);
    expect(cn2Rep.body.branchComparison).toHaveLength(1);
    expect(cn2Rep.body.branchComparison[0].code).toBe('CN2');

    await request(http).get(`/api/reports/garage?branchId=${cn1Id}`).set(bearer(managerCn2)).expect(403);

    // Lập 1 đơn RO giao xe đúng hẹn tại CN1 và thu tiền để đối chiếu số liệu thật
    const beforeRep = await request(http).get(`/api/reports/garage?branchId=${cn1Id}`).set(bearer(plgOwner)).expect(200);
    const prevRev = beforeRep.body.summary.roRevenue as number;
    const prevDelivered = beforeRep.body.summary.ordersDelivered as number;

    const cust = await request(http)
      .post('/api/customers')
      .set(bearer(sales))
      .send({ name: `Khách KPI ${tag}`, phone: randomPhone(), vehicle: { plate: randomPlate(), make: 'Toyota', model: 'Camry', year: 2022 } })
      .expect(201);
    const custDetail = await request(http).get(`/api/customers/${cust.body.id}`).set(bearer(sales)).expect(200);
    const promised = new Date(Date.now() + 4 * 3_600_000).toISOString();

    const ro = await request(http)
      .post('/api/orders')
      .set(bearer(sales))
      .send({
        branchId: cn1Id,
        customerId: cust.body.id,
        vehicleId: custDetail.body.vehicles[0].id,
        promisedAt: promised,
        items: [{ kind: 'DICH_VU', name: 'Bảo dưỡng cấp lớn KPI', quantity: 1, unitPrice: 1_500_000 }],
      })
      .expect(201);

    await request(http).post(`/api/orders/${ro.body.id}/status`).set(bearer(sales)).send({ to: 'DANG_SUA' }).expect(200);
    await request(http).post(`/api/orders/${ro.body.id}/status`).set(bearer(sales)).send({ to: 'HOAN_THANH' }).expect(200);
    await request(http)
      .post(`/api/orders/${ro.body.id}/payments`)
      .set(bearer(sales))
      .send({ amount: 1_500_000, method: 'CHUYEN_KHOAN' })
      .expect(201);
    await request(http).post(`/api/orders/${ro.body.id}/status`).set(bearer(sales)).send({ to: 'DA_GIAO' }).expect(200);

    // Chủ garage (CG) và Kế toán (KT) xem báo cáo toàn chuỗi 3 chi nhánh & lọc riêng CN1
    const fullRep = await request(http).get('/api/reports/garage').set(bearer(accountant)).expect(200);
    expect(fullRep.body.branches.map((b: { code: string }) => b.code)).toEqual(['CN1', 'CN2', 'CN3']);
    expect(fullRep.body.branchComparison).toHaveLength(3);

    const afterCn1 = await request(http).get(`/api/reports/garage?branchId=${cn1Id}`).set(bearer(plgOwner)).expect(200);
    expect(afterCn1.body.summary.ordersDelivered).toBe(prevDelivered + 1);
    expect(afterCn1.body.summary.roRevenue).toBe(prevRev + 1_500_000);
    expect(afterCn1.body.summary.slaOnTimePct).toBeGreaterThan(0);

    // Báo cáo toàn sàn: chặn GARAGE và PARTNER -> 403; SA xem đầy đủ
    await request(http).get('/api/platform/reports/overview').set(bearer(plgOwner)).expect(403);
    await request(http).get('/api/platform/reports/overview').set(bearer(partner)).expect(403);

    const pfOverview = await request(http).get('/api/platform/reports/overview').set(bearer(sa)).expect(200);
    expect(pfOverview.body.kpis).toBeDefined();
    expect(pfOverview.body.dailySeries.length).toBeGreaterThan(0);
    expect(pfOverview.body.topShops.length).toBeGreaterThanOrEqual(2);
  });

  it('luồng Cộng đồng chủ xe (M34): Chủ xe đặt câu hỏi -> Sàn duyệt -> Chuyên gia Garage trả lời & Chủ xe khác bình luận/thích -> Chọn lời giải -> Sàn ẩn bình luận vi phạm -> Xuất bản Sách nói & Banner', async () => {
    // Chỉ Chủ garage (CG) có community.manage trong CRM
    await request(http).get('/api/community/posts').set(bearer(sales)).expect(403);
    await request(http).get('/api/community/posts').set(bearer(partner)).expect(403);
    await request(http).get('/api/platform/community/posts').set(bearer(plgOwner)).expect(403);

    const ownerA = await createOwnerAccount(`Anh Chủ Xe Hỏi ${tag}`);
    const ownerB = await createOwnerAccount(`Chị Chủ Xe Đọc ${tag}`);

    // 1. Chủ xe A tải ảnh minh hoạ & gửi câu hỏi Hỏi đáp -> CHO_DUYET, chưa hiện công khai
    const img = await request(http).post('/api/owner/community/upload').set(bearer(ownerA)).attach('file', TINY_PNG, 'hoi-dap.png').expect(201);
    const qaTitle = `Xe đi cao tốc rung vô lăng ở 100km/h ${tag}?`;
    const createdQa = await request(http)
      .post('/api/owner/community/posts')
      .set(bearer(ownerA))
      .send({
        type: 'QA',
        topic: 'HOI_DAP_KY_THUAT',
        title: qaTitle,
        content: 'Xe mình mới đảo lốp xong đi cao tốc lên 100km/h bị rung nhẹ vô lăng, nhờ các garage tư vấn nguyên nhân.',
        coverFileId: img.body.id,
      })
      .expect(201);
    const qaId = createdQa.body.id as string;
    expect(createdQa.body.status).toBe('CHO_DUYET');

    await request(http).get(`/api/public/community/posts/${qaId}`).expect(404);

    // 2. Admin sàn mở A6.32 duyệt hiển thị
    await request(http).post(`/api/platform/community/posts/${qaId}/approve`).set(bearer(sa)).send({}).expect(200);

    const pubDetail1 = await request(http).get(`/api/public/community/posts/${qaId}`).expect(200);
    expect(pubDetail1.body.status).toBe('DA_DANG');
    expect(pubDetail1.body.viewsCount).toBe(1);

    // 3. Chủ garage PLG gửi tư vấn chuyên gia + Chủ xe B bấm thích & gửi bình luận quảng cáo spam
    const expertComment = await request(http)
      .post(`/api/community/posts/${qaId}/comments`)
      .set(bearer(plgOwner))
      .send({ content: 'Bạn cần cân bằng động lại 4 bánh bằng máy chuyên dụng, khả năng chì dán bị bong.' })
      .expect(201);
    expect(expertComment.body.authorKind).toBe('GARAGE');

    const likeRes = await request(http).post(`/api/owner/community/posts/${qaId}/like`).set(bearer(ownerB)).send({}).expect(200);
    expect(likeRes.body).toEqual({ liked: true, likesCount: 1 });

    const spamComment = await request(http)
      .post(`/api/owner/community/posts/${qaId}/comments`)
      .set(bearer(ownerB))
      .send({ content: 'Liên hệ vay tín chấp lãi thấp 0999999999' })
      .expect(201);

    // 4. Chủ xe B không phải người hỏi nên không được chọn lời giải -> 403; Chủ xe A chọn câu trả lời của Garage -> isSolved: true
    await request(http)
      .post(`/api/owner/community/posts/${qaId}/accept-answer`)
      .set(bearer(ownerB))
      .send({ commentId: expertComment.body.id })
      .expect(403);

    const accepted = await request(http)
      .post(`/api/owner/community/posts/${qaId}/accept-answer`)
      .set(bearer(ownerA))
      .send({ commentId: expertComment.body.id })
      .expect(200);
    expect(accepted.body.isSolved).toBe(true);

    // 5. Admin sàn ẩn bình luận spam -> commentsCount giảm từ 2 về 1 và ẩn khỏi trang công khai
    await request(http)
      .post(`/api/platform/community/comments/${spamComment.body.id}/hide`)
      .set(bearer(sa))
      .send({ hidden: true, reason: 'Spam quảng cáo sai quy định' })
      .expect(200);

    const pubDetail2 = await request(http).get(`/api/public/community/posts/${qaId}`).expect(200);
    expect(pubDetail2.body.isSolved).toBe(true);
    expect(pubDetail2.body.commentsCount).toBe(1);
    expect(pubDetail2.body.comments).toHaveLength(1);
    expect(pubDetail2.body.comments[0].isAccepted).toBe(true);

    // 6. Ban biên tập sàn (A6.62) xuất bản trực tiếp Sách nói ô tô & tạo Banner trang chủ + cộng đồng
    const audioTitle = `Sách nói: Lái xe đường sương mù Tây Bắc ${tag}`;
    const audio = await request(http)
      .post('/api/platform/community/editorial')
      .set(bearer(sa))
      .send({
        type: 'AUDIO',
        topic: 'HANH_TRINH',
        title: audioTitle,
        summary: 'Kinh nghiệm đổ đèo và kiểm tra đèn phá sương',
        content: 'Tuyển tập sách nói thực chiến dành cho chủ xe đi cung Tây Bắc mùa đông.',
        durationMinutes: 38,
        pinned: true,
        playlistItems: [
          { title: 'Chương 1: Chuẩn bị phanh và áp suất lốp', host: 'KS. Trần Hải', duration: '18:00' },
          { title: 'Chương 2: Giữ khoảng cách trong sương mù dày', host: 'KS. Trần Hải', duration: '20:00' },
        ],
      })
      .expect(201);
    expect(audio.body.status).toBe('DA_DANG');
    expect(audio.body.authorKind).toBe('PLATFORM');
    expect(audio.body.playlistItems).toHaveLength(2);

    const banner = await request(http)
      .post('/api/platform/community/banners')
      .set(bearer(sa))
      .send({
        title: `Chiến dịch chăm xe mùa lễ ${tag}`,
        subtitle: ' Nghe sách nói mới & nhận voucher bảo dưỡng trên sàn CARDIY',
        linkUrl: `/cho/cong-dong/${audio.body.id}`,
        ctaLabel: 'Nghe sách nói',
        position: 'HOME',
        sortOrder: 1,
        active: true,
      })
      .expect(201);

    const homeBanners = await request(http).get('/api/public/community/banners?position=HOME').expect(200);
    expect(homeBanners.body.some((b: { id: string }) => b.id === banner.body.id)).toBe(true);

    const audioList = await request(http).get(`/api/public/community/posts?type=AUDIO&q=${tag}`).expect(200);
    expect(audioList.body.items).toHaveLength(1);
    expect(audioList.body.items[0].title).toBe(audioTitle);
  });
});
