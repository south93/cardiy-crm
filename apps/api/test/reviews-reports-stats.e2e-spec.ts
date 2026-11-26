import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { RedisService } from '../src/redis/redis.service';
import { bearer, createApp, login, PHONES, randomPhone } from './helpers';

const tag = Date.now().toString(36).toUpperCase();
const hours = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '00:00', close: '23:59', closed: false }));
const tomorrow = () => {
  const d = new Date(Date.now() + 86_400_000 + 7 * 3_600_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 3, 0)).toISOString();
};

describe('Vòng 3.5: đánh giá từ sàn, phản ánh & xử lý vi phạm, thống kê gian hàng', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let sa: string;
  let plg: string;
  let partner: string;
  let partnerB: string;
  let partnerBTenantId: string;
  let partnerBSlug: string;
  let partnerBOfferId: string;
  let tech: string;
  let partnerOfferId: string;
  let reqId: string;
  let reqToken: string;
  let reviewId: string;
  const skuCode = `LOP-V35-${tag}`;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    const redis = app.get(RedisService);
    const keys = [
      ...(await redis.client.keys('market-req:*')),
      ...(await redis.client.keys('market-report:*')),
      ...(await redis.client.keys('market-view:*')),
    ];
    if (keys.length) await redis.client.del(...keys);

    const o = await login(app, PHONES.owner);
    plg = o.token;
    const me = await request(http).get('/api/me').set(bearer(o.token)).expect(200);
    const pf = me.body.memberships.find((m: { tenantType: string }) => m.tenantType === 'PLATFORM');
    sa = (
      await request(http)
        .post('/api/auth/switch')
        .set(bearer(o.token))
        .set('Cookie', o.cookie)
        .send({ membershipId: pf.membershipId })
        .expect(200)
    ).body.accessToken;

    partner = (await login(app, PHONES.partnerOwner)).token;
    tech = (await login(app, PHONES.tech)).token;

    // Tạo SKU mới trên danh mục chuẩn
    const item = await request(http)
      .post('/api/platform/catalog/items')
      .set(bearer(sa))
      .send({ kind: 'PRODUCT', code: skuCode, name: `Lốp đánh giá ${tag}` })
      .expect(201);

    // Thiết lập gian hàng đối tác A (Minh Phát Auto) + tin đăng
    await request(http)
      .put('/api/shop')
      .set(bearer(partner))
      .send({ name: 'Minh Phát Auto', phone: '0900000010', address: 'Hà Đông, Hà Nội', province: 'Hà Nội', lat: 20.97, lng: 105.77, openingHours: hours })
      .expect(200);
    const po = await request(http)
      .post('/api/shop/offers')
      .set(bearer(partner))
      .send({ kind: 'PRODUCT', catalogItemId: item.body.id, price: 1_500_000, manualStock: 10, installIncluded: true })
      .expect(201);
    partnerOfferId = po.body.id;
    await request(http).post(`/api/shop/offers/${partnerOfferId}/submit`).set(bearer(partner)).expect(200);
    await request(http).post(`/api/platform/offers/${partnerOfferId}/approve`).set(bearer(sa)).expect(200);

    // Tạo Đối tác B riêng biệt để kiểm tra cô lập dữ liệu đa tenant và chế tài TAM_KHOA / GO_TIN
    const plans = await request(http).get('/api/public/plans').expect(200);
    const phoneB = randomPhone();
    const submitted = await request(http)
      .post('/api/public/partner-applications')
      .send({
        garageName: `Garage Đối Tác B ${tag}`,
        address: 'Số 10 Nguyễn Văn Linh, Đà Nẵng',
        province: 'Đà Nẵng',
        representative: 'Lê Đối Tác B',
        phone: phoneB,
        planId: plans.body[0].id,
      })
      .expect(201);
    const appList = await request(http).get(`/api/platform/applications?q=${submitted.body.code}`).set(bearer(sa)).expect(200);
    const approved = await request(http)
      .post(`/api/platform/applications/${appList.body.items[0].id}/approve`)
      .set(bearer(sa))
      .send({ planId: plans.body[0].id })
      .expect(200);
    partnerBTenantId = approved.body.tenantId;
    await request(http)
      .post(`/api/platform/partners/${partnerBTenantId}/status`)
      .set(bearer(sa))
      .send({ status: 'HOAT_DONG', note: 'Kích hoạt chạy test 3.5' })
      .expect(200);
    const loginB = await login(app, phoneB, approved.body.tempPassword);
    const changedB = await request(http)
      .post('/api/auth/change-password')
      .set(bearer(loginB.token))
      .send({ currentPassword: approved.body.tempPassword, newPassword: 'DoiTac2026x' })
      .expect(200);
    partnerB = changedB.body.accessToken;

    partnerBSlug = `doi-tac-b-${tag.toLowerCase()}`;
    await request(http)
      .put('/api/shop')
      .set(bearer(partnerB))
      .send({
        name: `Garage Đối Tác B ${tag}`,
        slug: partnerBSlug,
        phone: phoneB,
        address: 'Số 10 Nguyễn Văn Linh, Đà Nẵng',
        province: 'Đà Nẵng',
        lat: 16.06,
        lng: 108.21,
        openingHours: hours,
      })
      .expect(200);
    const bo = await request(http)
      .post('/api/shop/offers')
      .set(bearer(partnerB))
      .send({ kind: 'PRODUCT', catalogItemId: item.body.id, price: 1_450_000, manualStock: 5, installIncluded: true })
      .expect(201);
    partnerBOfferId = bo.body.id;
    await request(http).post(`/api/shop/offers/${partnerBOfferId}/submit`).set(bearer(partnerB)).expect(200);
    await request(http).post(`/api/platform/offers/${partnerBOfferId}/approve`).set(bearer(sa)).expect(200);
  });

  afterAll(() => app.close());

  it('đánh giá từ sàn: chặn khi chưa hoàn tất / sai token; hoàn tất → đánh giá → hiện trên gian hàng → đối tác trả lời → báo cáo & sàn ẩn', async () => {
    const created = await request(http)
      .post('/api/public/market/requests')
      .send({
        name: 'Nguyễn Văn Hùng',
        phone: randomPhone(),
        scheduledAt: tomorrow(),
        items: [{ offerId: partnerOfferId, quantity: 2 }],
      })
      .expect(201);
    reqId = created.body.id;
    reqToken = created.body.token;

    // Chưa hoàn tất: chặn đánh giá
    await request(http)
      .post(`/api/public/market/requests/${reqId}/review?t=${reqToken}`)
      .send({ rating: 5, comment: 'Rất tốt' })
      .expect(409);

    // Xác nhận rồi hoàn tất yêu cầu
    await request(http).post(`/api/seller/requests/${reqId}/confirm`).set(bearer(partner)).send({ finalTotal: 2_900_000 }).expect(200);
    await request(http).post(`/api/seller/requests/${reqId}/complete`).set(bearer(partner)).send({}).expect(200);

    // Sai token hoặc sao ngoài 1..5 bị chặn
    await request(http).post(`/api/public/market/requests/${reqId}/review?t=sai-token`).send({ rating: 5 }).expect(404);
    await request(http).post(`/api/public/market/requests/${reqId}/review?t=${reqToken}`).send({ rating: 6 }).expect(400);

    // Khách gửi đánh giá 5 sao
    const commentText = `Lắp lốp nhanh, đúng giá chốt ${tag}`;
    const rev = await request(http)
      .post(`/api/public/market/requests/${reqId}/review?t=${reqToken}`)
      .send({ rating: 5, comment: commentText })
      .expect(200);
    reviewId = rev.body.id;
    expect(rev.body).toMatchObject({ rating: 5, comment: commentText, status: 'HIEN' });

    // Hiện trên trang gian hàng công khai với tên rút gọn ("Hùng")
    const shopRes = await request(http).get('/api/public/market/shops/minh-phat-auto').expect(200);
    expect(shopRes.body.rating.count).toBeGreaterThanOrEqual(1);
    expect(shopRes.body.reviews.find((r: { comment: string }) => r.comment === commentText)).toMatchObject({
      name: 'Hùng',
      rating: 5,
    });

    // Phân quyền & cô lập tenant: KTV bị chặn 403; Đối tác B không thấy và không trả lời được đánh giá của Đối tác A
    await request(http).get('/api/seller/reviews').set(bearer(tech)).expect(403);
    const listB = await request(http).get('/api/seller/reviews').set(bearer(partnerB)).expect(200);
    expect(listB.body.items.find((x: { id: string }) => x.id === reviewId)).toBeUndefined();
    await request(http).post(`/api/seller/reviews/${reviewId}/reply`).set(bearer(partnerB)).send({ reply: 'Giả mạo' }).expect(404);

    // Đối tác A trả lời → khách thấy trên link theo dõi & khách không tự sửa sao được nữa
    await request(http)
      .post(`/api/seller/reviews/${reviewId}/reply`)
      .set(bearer(partner))
      .send({ reply: 'Cảm ơn anh Hùng đã ủng hộ Minh Phát!' })
      .expect(200);
    const tracked = await request(http).get(`/api/public/market/requests/${reqId}?t=${reqToken}`).expect(200);
    expect(tracked.body.review).toMatchObject({
      rating: 5,
      reply: 'Cảm ơn anh Hùng đã ủng hộ Minh Phát!',
    });
    await request(http)
      .post(`/api/public/market/requests/${reqId}/review?t=${reqToken}`)
      .send({ rating: 1, comment: 'Đổi ý' })
      .expect(409);

    // Đối tác báo cáo đánh giá xấu → Admin sàn duyệt ẩn → không còn hiện công khai
    await request(http)
      .post(`/api/seller/reviews/${reviewId}/report`)
      .set(bearer(partner))
      .send({ reason: 'Kiểm thử báo cáo đánh giá có nội dung spam' })
      .expect(200);
    await request(http).get('/api/platform/reviews/reported').set(bearer(partner)).expect(403);
    const reportedQueue = await request(http).get('/api/platform/reviews/reported?filter=PENDING').set(bearer(sa)).expect(200);
    expect(reportedQueue.body.items.some((x: { id: string }) => x.id === reviewId)).toBe(true);

    await request(http)
      .post(`/api/platform/reviews/${reviewId}/moderate`)
      .set(bearer(sa))
      .send({ action: 'HIDE', note: 'Xác nhận ẩn' })
      .expect(200);
    const shopAfterHide = await request(http).get('/api/public/market/shops/minh-phat-auto').expect(200);
    expect(shopAfterHide.body.reviews.find((r: { comment: string }) => r.comment === commentText)).toBeUndefined();

    // Hiện lại đánh giá để giữ dữ liệu điểm sao cho phần thống kê
    await request(http)
      .post(`/api/platform/reviews/${reviewId}/moderate`)
      .set(bearer(sa))
      .send({ action: 'KEEP', note: 'Khôi phục hiển thị' })
      .expect(200);
  });

  it('phản ánh & xử lý vi phạm: gửi phản ánh không đổi trạng thái yêu cầu → giải trình → kết luận kèm gỡ tin & tạm khoá đối tác', async () => {
    // Khách đặt yêu cầu ở Đối tác B
    const reqB = await request(http)
      .post('/api/public/market/requests')
      .send({
        name: 'Trần Minh Khách',
        phone: randomPhone(),
        scheduledAt: tomorrow(),
        items: [{ offerId: partnerBOfferId, quantity: 1 }],
      })
      .expect(201);

    // Khách gửi phản ánh từ link theo dõi khi yêu cầu vẫn đang CHO_XAC_NHAN
    const rep = await request(http)
      .post(`/api/public/market/requests/${reqB.body.id}/reports?t=${reqB.body.token}`)
      .send({
        reason: 'SAI_GIA',
        description: 'Garage gọi điện báo giá cao hơn 500.000 đ so với giá niêm yết trên sàn',
      })
      .expect(201);
    expect(rep.body.code).toMatch(/^PA\d{6}$/);

    // Không gửi trùng phản ánh đang mở trên cùng yêu cầu; trạng thái yêu cầu giữ nguyên CHO_XAC_NHAN (S3)
    await request(http)
      .post(`/api/public/market/requests/${reqB.body.id}/reports?t=${reqB.body.token}`)
      .send({ reason: 'KHAC', description: 'Gửi trùng khi phản ánh trước chưa xử lý' })
      .expect(409);
    const trackedB = await request(http).get(`/api/public/market/requests/${reqB.body.id}?t=${reqB.body.token}`).expect(200);
    expect(trackedB.body.status).toBe('CHO_XAC_NHAN');
    expect(trackedB.body.reports[0]).toMatchObject({ code: rep.body.code, status: 'MOI' });

    // Đối tác B chưa thể tự gửi giải trình khi sàn chưa chuyển CHO_GIAI_TRINH
    await request(http)
      .post(`/api/seller/reports/${rep.body.id}/explain`)
      .set(bearer(partnerB))
      .send({ explanation: 'Giải trình sớm' })
      .expect(409);

    // Sàn yêu cầu Đối tác B giải trình
    await request(http)
      .post(`/api/platform/reports/${rep.body.id}/request-explanation`)
      .set(bearer(sa))
      .send({ note: 'Đề nghị giải trình chênh lệch giá báo cho khách' })
      .expect(200);

    // Đối tác A không thấy phản ánh của Đối tác B
    const reportsA = await request(http).get('/api/seller/reports').set(bearer(partner)).expect(200);
    expect(reportsA.body.items.find((x: { id: string }) => x.id === rep.body.id)).toBeUndefined();

    // Đối tác B thấy yêu cầu và gửi giải trình
    const reportsB = await request(http).get('/api/seller/reports').set(bearer(partnerB)).expect(200);
    expect(reportsB.body.counts.CHO_GIAI_TRINH).toBe(1);
    await request(http)
      .post(`/api/seller/reports/${rep.body.id}/explain`)
      .set(bearer(partnerB))
      .send({ explanation: 'Nhân viên báo nhầm dòng lốp khác, xin nhận lỗi với khách' })
      .expect(200);

    // Sàn kết luận xử lý kèm gỡ tin đăng vi phạm (GO_TIN)
    const resolved = await request(http)
      .post(`/api/platform/reports/${rep.body.id}/resolve`)
      .set(bearer(sa))
      .send({
        decision: 'DA_XU_LY',
        resolution: 'Xác nhận báo sai giá niêm yết, gỡ tin đăng vi phạm',
        violationAction: 'GO_TIN',
        offerId: partnerBOfferId,
      })
      .expect(200);
    expect(resolved.body.violationCode).toMatch(/^VP\d{6}$/);

    // Khách mở lại link theo dõi thấy kết luận của sàn; tin đăng của Đối tác B chuyển sang BI_GO
    const trackedAfter = await request(http).get(`/api/public/market/requests/${reqB.body.id}?t=${reqB.body.token}`).expect(200);
    expect(trackedAfter.body.reports[0]).toMatchObject({
      status: 'DA_XU_LY',
      resolution: 'Xác nhận báo sai giá niêm yết, gỡ tin đăng vi phạm',
    });
    const offersB = await request(http).get('/api/shop/offers').set(bearer(partnerB)).expect(200);
    expect(offersB.body.items.find((x: { id: string }) => x.id === partnerBOfferId)?.status).toBe('BI_GO');

    // Sàn lập thêm biên bản TAM_KHOA trực tiếp (A6.42) → Đối tác B bị khoá phiên ngay và biến khỏi sàn công khai
    await request(http)
      .post('/api/platform/violations')
      .set(bearer(sa))
      .send({
        tenantId: partnerBTenantId,
        action: 'TAM_KHOA',
        reason: 'Tái phạm quy chế giá niêm yết trên sàn',
      })
      .expect(201);
    await request(http).get(`/api/public/market/shops/${partnerBSlug}`).expect(404);
    await request(http).get('/api/seller/requests').set(bearer(partnerB)).expect(401);

    // Chặn tạm khoá tài khoản PLG chủ sàn
    const mePlg = await request(http).get('/api/me').set(bearer(plg)).expect(200);
    await request(http)
      .post('/api/platform/violations')
      .set(bearer(sa))
      .send({ tenantId: mePlg.body.workspace.tenantId, action: 'TAM_KHOA', reason: 'Không được khoá PLG' })
      .expect(400);
  });

  it('thống kê gian hàng: đếm lượt xem có chống trùng F5, tính đúng số yêu cầu, tỉ lệ chốt và cô lập theo tenant', async () => {
    const partnerShop = await request(http).get('/api/public/market/shops/minh-phat-auto').expect(200);
    const partnerTenantId = partnerShop.body.tenantId;

    const before = await request(http).get('/api/seller/stats?days=30').set(bearer(partner)).expect(200);

    // Cùng 1 người xem (IP + User-Agent) gọi 2 lần liên tiếp chỉ được tính 1 lượt xem
    const v1 = await request(http)
      .post('/api/public/market/views')
      .set('User-Agent', `ViewerA/${tag}`)
      .send({ tenantId: partnerTenantId, offerIds: [partnerOfferId] })
      .expect(200);
    expect(v1.body.counted).toBe(2); // 1 lượt trang garage + 1 lượt tin đăng

    const vDup = await request(http)
      .post('/api/public/market/views')
      .set('User-Agent', `ViewerA/${tag}`)
      .send({ tenantId: partnerTenantId, offerIds: [partnerOfferId] })
      .expect(200);
    expect(vDup.body.counted).toBe(0);

    // Người xem thứ 2 (User-Agent khác) xem trang garage → tính thêm 1 lượt
    const v2 = await request(http)
      .post('/api/public/market/views')
      .set('User-Agent', `ViewerB/${tag}`)
      .send({ tenantId: partnerTenantId })
      .expect(200);
    expect(v2.body.counted).toBe(1);

    // Gửi thêm 1 yêu cầu rồi khách tự huỷ để kiểm tra tỉ lệ chốt < 100%
    const cancelledReq = await request(http)
      .post('/api/public/market/requests')
      .send({
        name: 'Khách Đổi Ý',
        phone: randomPhone(),
        scheduledAt: tomorrow(),
        items: [{ offerId: partnerOfferId, quantity: 1 }],
      })
      .expect(201);
    await request(http).post(`/api/public/market/requests/${cancelledReq.body.id}/cancel?t=${cancelledReq.body.token}`).expect(200);

    // KTV không có quyền xem thống kê gian hàng
    await request(http).get('/api/seller/stats').set(bearer(tech)).expect(403);

    const after = await request(http).get('/api/seller/stats?days=30').set(bearer(partner)).expect(200);
    expect(after.body.views.shop).toBe(before.body.views.shop + 2);
    expect(after.body.views.offers).toBe(before.body.views.offers + 1);
    expect(after.body.views.total).toBe(before.body.views.total + 3);
    expect(after.body.requests.total).toBeGreaterThanOrEqual(2);
    expect(after.body.requests.completed).toBeGreaterThanOrEqual(1);
    expect(after.body.rates.closeRate).toBe(Math.round((after.body.requests.completed / after.body.requests.total) * 1000) / 10);

    const offerRow = after.body.offers.find((o: { offerId: string }) => o.offerId === partnerOfferId);
    expect(offerRow).toMatchObject({
      views: 1,
      requests: 2,
      completed: 1,
      closeRate: 50,
    });

    // PLG xem thống kê của riêng PLG, không lẫn số liệu của Minh Phát Auto
    const plgStats = await request(http).get('/api/seller/stats?days=30').set(bearer(plg)).expect(200);
    expect(plgStats.body.offers.find((o: { offerId: string }) => o.offerId === partnerOfferId)).toBeUndefined();
  });
});
