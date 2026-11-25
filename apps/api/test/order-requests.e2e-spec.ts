import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { bearer, createApp, login, PHONES, randomPhone } from './helpers';

const tag = Date.now().toString(36).toUpperCase();
const hours = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '00:00', close: '23:59', closed: false }));
/** Giờ hẹn hợp lệ: ngày mai, 10:00 giờ VN */
const tomorrow = () => {
  const d = new Date(Date.now() + 86_400_000 + 7 * 3_600_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 3, 0)).toISOString();
};

describe('Vòng 3.4: yêu cầu đặt hàng từ sàn, giữ tồn, voucher', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let sa: string;
  let plg: string;
  let partner: string;
  let tech: string;
  let tyreOffer: string;
  let plgService: string;
  let reqId: string;
  let reqToken: string;
  const code = `LOP-YC-${tag}`;
  const phone = randomPhone();

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    const redis = app.get(RedisService);
    const keys = await redis.client.keys('market-req:*');
    if (keys.length) await redis.client.del(...keys);
    const o = await login(app, PHONES.owner);
    plg = o.token;
    const me = await request(http).get('/api/me').set(bearer(o.token));
    const pf = me.body.memberships.find((m: { tenantType: string }) => m.tenantType === 'PLATFORM');
    sa = (await request(http).post('/api/auth/switch').set(bearer(o.token)).set('Cookie', o.cookie).send({ membershipId: pf.membershipId }).expect(200)).body.accessToken;
    partner = (await login(app, PHONES.partnerOwner)).token;
    tech = (await login(app, PHONES.tech)).token;

    const item = await request(http)
      .post('/api/platform/catalog/items')
      .set(bearer(sa))
      .send({ kind: 'PRODUCT', code, name: `Lốp yêu cầu ${tag}` })
      .expect(201);
    const sv = await request(http)
      .post('/api/platform/catalog/items')
      .set(bearer(sa))
      .send({ kind: 'SERVICE', code: `DV-YC-${tag}`, name: `Thay dầu ${tag}` })
      .expect(201);
    await request(http)
      .put('/api/shop')
      .set(bearer(partner))
      .send({ name: 'Minh Phát Auto', phone: '0900000010', address: 'Hà Đông, Hà Nội', province: 'Hà Nội', lat: 20.97, lng: 105.77, openingHours: hours })
      .expect(200);
    await request(http)
      .put('/api/shop')
      .set(bearer(plg))
      .send({ name: 'Garage PLG', phone: '0900000001', address: 'Đồng Xoài', province: 'Bình Phước', lat: 11.53, lng: 106.88, openingHours: hours })
      .expect(200);
    const po = await request(http)
      .post('/api/shop/offers')
      .set(bearer(partner))
      .send({ kind: 'PRODUCT', catalogItemId: item.body.id, price: 1_000_000, manualStock: 2, installIncluded: true })
      .expect(201);
    tyreOffer = po.body.id;
    await request(http).post(`/api/shop/offers/${tyreOffer}/submit`).set(bearer(partner)).expect(200);
    await request(http).post(`/api/platform/offers/${tyreOffer}/approve`).set(bearer(sa)).expect(200);
    const so = await request(http).post('/api/shop/offers').set(bearer(plg)).send({ kind: 'SERVICE', catalogItemId: sv.body.id, price: 300_000, priceFrom: true }).expect(201);
    plgService = so.body.id;
    await request(http).post(`/api/shop/offers/${plgService}/submit`).set(bearer(plg)).expect(200);
  });
  afterAll(() => app.close());

  it('voucher của garage: tạo, kiểm tra hợp lệ; tính tạm có giảm giá', async () => {
    await request(http)
      .post('/api/seller/vouchers')
      .set(bearer(partner))
      .send({ code: `GIAM${tag}`.slice(0, 20), title: 'Giảm 10%', kind: 'PERCENT', value: 150, startsAt: '2026-01-01', endsAt: '2030-01-01' })
      .expect(400);
    await request(http)
      .post('/api/seller/vouchers')
      .set(bearer(partner))
      .send({ code: `GIAM${tag}`.slice(0, 20), title: 'Giảm 10%', kind: 'PERCENT', value: 10, maxDiscount: 150_000, startsAt: '2026-01-01', endsAt: '2030-01-01' })
      .expect(201);
    await request(http).post('/api/seller/vouchers').set(bearer(tech)).send({ code: 'X123', title: 'Voucher KTV', kind: 'AMOUNT', value: 1, startsAt: '2026-01-01', endsAt: '2030-01-01' }).expect(403);

    const q = await request(http)
      .post('/api/public/market/requests/quote')
      .send({ items: [{ offerId: tyreOffer, quantity: 2 }], voucherCode: `giam${tag}`.slice(0, 20) })
      .expect(200);
    expect(q.body).toMatchObject({ subtotal: 2_000_000, discount: 150_000, total: 1_850_000, voucherError: null });
    const bad = await request(http)
      .post('/api/public/market/requests/quote')
      .send({ items: [{ offerId: tyreOffer, quantity: 1 }], voucherCode: 'KHONGCO' })
      .expect(200);
    expect(bad.body.voucherError).toMatch(/không đúng/);
    // Hai garage trong một yêu cầu
    await request(http)
      .post('/api/public/market/requests/quote')
      .send({
        items: [
          { offerId: tyreOffer, quantity: 1 },
          { offerId: plgService, quantity: 1 },
        ],
      })
      .expect(400);
    // Voucher hiện trên gian hàng
    const shop = await request(http).get('/api/public/market/shops?q=minh%20phat').expect(200);
    expect(shop.body.items[0].vouchers.map((v: { title: string }) => v.title)).toContain('Giảm 10%');
  });

  it('khách gửi yêu cầu không cần tài khoản; giữ tồn: khách sau không đặt quá số còn lại', async () => {
    const base = { name: 'Khách Thử', phone, plateNo: '30a12345', scheduledAt: tomorrow(), voucherCode: `GIAM${tag}`.slice(0, 20) };
    await request(http)
      .post('/api/public/market/requests')
      .send({ ...base, phone: '123', items: [{ offerId: tyreOffer, quantity: 1 }] })
      .expect(400);
    await request(http)
      .post('/api/public/market/requests')
      .send({ ...base, scheduledAt: new Date(Date.now() - 3_600_000).toISOString(), items: [{ offerId: tyreOffer, quantity: 1 }] })
      .expect(400);
    await request(http)
      .post('/api/public/market/requests')
      .send({ ...base, items: [{ offerId: tyreOffer, quantity: 3 }] })
      .expect(409);
    const r = await request(http)
      .post('/api/public/market/requests')
      .send({ ...base, items: [{ offerId: tyreOffer, quantity: 2 }] })
      .expect(201);
    expect(r.body.code).toMatch(/^YC\d{6}$/);
    reqId = r.body.id;
    reqToken = r.body.token;
    // Đã giữ hết 2 lốp → trên sàn hiện hết hàng, khách khác không đặt được
    const item = await request(http).get(`/api/public/market/items/${code}`).expect(200);
    expect(item.body.sellers[0]).toMatchObject({ state: 'HET_HANG', available: 0 });
    await request(http)
      .post('/api/public/market/requests')
      .send({ ...base, phone: randomPhone(), voucherCode: null, items: [{ offerId: tyreOffer, quantity: 1 }] })
      .expect(409);
    const mine = await request(http).get('/api/shop/offers?kind=PRODUCT').set(bearer(partner)).expect(200);
    expect(mine.body.items.find((x: { id: string }) => x.id === tyreOffer)).toMatchObject({ stock: 0, held: 2, manualStock: 2 });

    await request(http).get(`/api/public/market/requests/${reqId}?t=sai`).expect(404);
    const t = await request(http).get(`/api/public/market/requests/${reqId}?t=${reqToken}`).expect(200);
    expect(t.body).toMatchObject({ status: 'CHO_XAC_NHAN', estimatedTotal: 1_850_000, discount: 150_000, plateNo: '30A12345', shop: { name: 'Minh Phát Auto' } });
    expect(t.body.phone).toContain('****');
  });

  it('garage xử lý: chỉ thấy yêu cầu của mình; từ chối phải có lý do; xác nhận chốt giá → hoàn tất trừ tồn', async () => {
    await request(http).get('/api/seller/requests').set(bearer(tech)).expect(403);
    const plgList = await request(http).get('/api/seller/requests').set(bearer(plg)).expect(200);
    expect(plgList.body.items.find((x: { id: string }) => x.id === reqId)).toBeUndefined();
    const list = await request(http).get(`/api/seller/requests?status=DANG_XU_LY&q=${phone}`).set(bearer(partner)).expect(200);
    expect(list.body.items[0]).toMatchObject({ id: reqId, phone, customerName: 'Khách Thử' });

    await request(http).post(`/api/seller/requests/${reqId}/complete`).set(bearer(partner)).send({}).expect(409); // chưa xác nhận
    await request(http).post(`/api/seller/requests/${reqId}/reject`).set(bearer(partner)).send({}).expect(400);
    const c = await request(http).post(`/api/seller/requests/${reqId}/confirm`).set(bearer(partner)).send({ finalTotal: 1_800_000, note: 'Mời anh qua lắp lúc 10h' }).expect(200);
    expect(c.body).toMatchObject({ status: 'DA_XAC_NHAN', finalTotal: 1_800_000, sellerNote: 'Mời anh qua lắp lúc 10h' });
    const t = await request(http).get(`/api/public/market/requests/${reqId}?t=${reqToken}`).expect(200);
    expect(t.body).toMatchObject({ status: 'DA_XAC_NHAN', finalTotal: 1_800_000 });

    await request(http).post(`/api/seller/requests/${reqId}/complete`).set(bearer(partner)).send({}).expect(200);
    const mine = await request(http).get('/api/shop/offers?kind=PRODUCT').set(bearer(partner)).expect(200);
    expect(mine.body.items.find((x: { id: string }) => x.id === tyreOffer)).toMatchObject({ manualStock: 0, held: 0 });
    const v = await request(http).get('/api/seller/vouchers').set(bearer(partner)).expect(200);
    expect(v.body.find((x: { code: string }) => x.code === `GIAM${tag}`.slice(0, 20)).used).toBe(1);
    await request(http).post(`/api/public/market/requests/${reqId}/cancel?t=${reqToken}`).expect(409);
  });

  it('khách tự huỷ; quá 24 giờ chưa xác nhận thì hết hạn và nhả tồn', async () => {
    const a = await request(http)
      .post('/api/public/market/requests')
      .send({ name: 'Khách Huỷ', phone: randomPhone(), scheduledAt: tomorrow(), items: [{ offerId: plgService, quantity: 1 }] })
      .expect(201);
    await request(http).post(`/api/public/market/requests/${a.body.id}/cancel?t=${a.body.token}`).expect(200);
    await request(http).post(`/api/seller/requests/${a.body.id}/confirm`).set(bearer(plg)).send({}).expect(409);

    // Bổ sung tồn cho đối tác rồi giữ 1, cho quá hạn
    const offer = await prisma.offer.update({ where: { id: tyreOffer }, data: { manualStock: 1 } });
    const b = await request(http)
      .post('/api/public/market/requests')
      .send({ name: 'Khách Chậm', phone: randomPhone(), scheduledAt: tomorrow(), items: [{ offerId: offer.id, quantity: 1 }] })
      .expect(201);
    expect((await request(http).get(`/api/public/market/items/${code}`).expect(200)).body.sellers[0].available).toBe(0);
    await prisma.orderRequest.update({ where: { id: b.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(http).get(`/api/public/market/items/${code}`).expect(200)).body.sellers[0].available).toBe(1);
    const t = await request(http).get(`/api/public/market/requests/${b.body.id}?t=${b.body.token}`).expect(200);
    expect(t.body.status).toBe('HET_HAN');
    await request(http).post(`/api/seller/requests/${b.body.id}/confirm`).set(bearer(partner)).send({}).expect(409);
  });

  it('chống spam: mỗi SĐT tối đa 3 yêu cầu đang chờ ở một garage', async () => {
    const p = randomPhone();
    for (let i = 0; i < 3; i++)
      await request(http)
        .post('/api/public/market/requests')
        .send({ name: 'Khách Nhiều', phone: p, scheduledAt: tomorrow(), items: [{ offerId: plgService, quantity: 1 }] })
        .expect(201);
    await request(http)
      .post('/api/public/market/requests')
      .send({ name: 'Khách Nhiều', phone: p, scheduledAt: tomorrow(), items: [{ offerId: plgService, quantity: 1 }] })
      .expect(409);
  });
});
