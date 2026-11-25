import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, login, PHONES } from './helpers';

const tag = Date.now().toString(36).toUpperCase();
const hours = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '00:00', close: '23:59', closed: false }));

describe('Vòng 3.3: web sàn công khai', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let sa: string;
  let plg: string;
  let partner: string;
  let partnerTenant: string;
  let partnerSlug: string;
  let plgSlug: string;
  const code = `LOP-PUB-${tag}`;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    const o = await login(app, PHONES.owner);
    plg = o.token;
    const me = await request(http).get('/api/me').set(bearer(o.token));
    const pf = me.body.memberships.find((m: { tenantType: string }) => m.tenantType === 'PLATFORM');
    sa = (await request(http).post('/api/auth/switch').set(bearer(o.token)).set('Cookie', o.cookie).send({ membershipId: pf.membershipId }).expect(200)).body.accessToken;
    const p = await login(app, PHONES.partnerOwner);
    partner = p.token;
    partnerTenant = p.body.workspace?.tenantId ?? (await request(http).get('/api/me').set(bearer(partner))).body.workspace.tenantId;

    // Danh mục + 2 gian hàng cùng bán 1 SKU: đối tác (đã duyệt) và PLG
    const item = await request(http)
      .post('/api/platform/catalog/items')
      .set(bearer(sa))
      .send({ kind: 'PRODUCT', code, name: `Lốp công khai ${tag}`, brand: 'Hãng Test', specs: [{ label: 'Kích cỡ', value: '195/65R15' }] })
      .expect(201);
    const sv = await request(http)
      .post('/api/platform/catalog/items')
      .set(bearer(sa))
      .send({ kind: 'SERVICE', code: `DV-PUB-${tag}`, name: `Rửa xe công khai ${tag}` })
      .expect(201);
    partnerSlug = (
      await request(http)
        .put('/api/shop')
        .set(bearer(partner))
        .send({ name: 'Minh Phát Auto', phone: '0900000010', address: 'Hà Đông, Hà Nội', province: 'Hà Nội', lat: 20.97, lng: 105.77, openingHours: hours })
        .expect(200)
    ).body.shop.slug;
    plgSlug = (
      await request(http)
        .put('/api/shop')
        .set(bearer(plg))
        .send({ name: 'Garage PLG', phone: '0900000001', address: 'Đồng Xoài', province: 'Bình Phước', lat: 11.53, lng: 106.88, openingHours: hours })
        .expect(200)
    ).body.shop.slug;

    const po = await request(http)
      .post('/api/shop/offers')
      .set(bearer(partner))
      .send({ kind: 'PRODUCT', catalogItemId: item.body.id, price: 1_500_000, manualStock: 3, installIncluded: true })
      .expect(201);
    await request(http).post(`/api/shop/offers/${po.body.id}/submit`).set(bearer(partner)).expect(200);
    await request(http).post(`/api/platform/offers/${po.body.id}/approve`).set(bearer(sa)).expect(200);
    const so = await request(http).post('/api/shop/offers').set(bearer(partner)).send({ kind: 'SERVICE', catalogItemId: sv.body.id, price: 100_000, priceFrom: true }).expect(201);
    await request(http).post(`/api/shop/offers/${so.body.id}/submit`).set(bearer(partner)).expect(200); // chờ duyệt: chưa hiện
    const xo = await request(http).post('/api/shop/offers').set(bearer(plg)).send({ kind: 'PRODUCT', catalogItemId: item.body.id, price: 1_400_000, manualStock: 0 }).expect(201);
    await request(http).post(`/api/shop/offers/${xo.body.id}/submit`).set(bearer(plg)).expect(200);
  });
  afterAll(() => app.close());

  it('danh sách sản phẩm: không cần đăng nhập, gộp các garage cùng bán, giá thấp nhất ưu tiên nơi còn hàng', async () => {
    const r = await request(http)
      .get(`/api/public/market/items?q=${encodeURIComponent('195/65r15 ' + tag)}`)
      .expect(200);
    expect(r.body).toHaveLength(1);
    // PLG rẻ hơn nhưng hết hàng → giá thấp nhất lấy nơi còn hàng
    expect(r.body[0]).toMatchObject({ code, sellers: 2, minPrice: 1_500_000, inStock: true });
    const sv = await request(http).get(`/api/public/market/items?kind=SERVICE&q=${tag}`).expect(200);
    expect(sv.body).toHaveLength(0); // dịch vụ còn chờ duyệt
  });

  it('chi tiết sản phẩm: so giá các garage, còn hàng xếp trước, có khoảng cách khi gửi vị trí', async () => {
    const r = await request(http).get(`/api/public/market/items/${code.toLowerCase()}?lat=21.0&lng=105.8`).expect(200);
    expect(r.body.specs[0]).toMatchObject({ value: '195/65R15' });
    expect(r.body.sellers.map((s: { shop: { slug: string } }) => s.shop.slug)).toEqual([partnerSlug, plgSlug]);
    expect(r.body.sellers[0]).toMatchObject({ price: 1_500_000, installIncluded: true, state: 'CON_HANG' });
    expect(r.body.sellers[1].state).toBe('HET_HANG');
    expect(r.body.sellers[0].shop.distanceKm).toBeLessThan(10);
    expect(r.body.sellers[1].shop.bookingUrl).toBe('/app/dat-lich');
    expect(r.body.sellers[0].shop.bookingUrl).toBeNull();
    await request(http).get('/api/public/market/items/KHONG-CO').expect(404);
  });

  it('tìm garage theo tỉnh, từ khoá, gần nhất; trang garage có giờ mở cửa, tin đang bán', async () => {
    const all = await request(http).get('/api/public/market/shops?lat=21.0&lng=105.8&sort=gan').expect(200);
    expect(all.body.provinces).toEqual(expect.arrayContaining(['Hà Nội', 'Bình Phước']));
    expect(all.body.items[0].slug).toBe(partnerSlug);
    const hn = await request(http)
      .get(`/api/public/market/shops?province=${encodeURIComponent('Hà Nội')}&q=minh%20phat`)
      .expect(200);
    expect(hn.body.items.map((s: { slug: string }) => s.slug)).toEqual([partnerSlug]);

    const s = await request(http).get(`/api/public/market/shops/${partnerSlug}`).expect(200);
    expect(s.body).toMatchObject({ name: 'Minh Phát Auto', openNow: true, bookingUrl: null });
    expect(s.body.productOffers.map((o: { item: { code: string } }) => o.item.code)).toContain(code);
    expect(s.body.serviceOffers.map((o: { item: { code: string } }) => o.item.code)).not.toContain(`DV-PUB-${tag}`);
    const p = await request(http).get(`/api/public/market/shops/${plgSlug}`).expect(200);
    expect(p.body.branches.length).toBeGreaterThan(1);
    expect(p.body.reviews.every((r: { name: string }) => !r.name.includes(' '))).toBe(true);
  });

  it('đối tác bị tạm khoá thì gian hàng và tin biến khỏi sàn; mở lại thì hiện lại', async () => {
    await request(http).post(`/api/platform/partners/${partnerTenant}/status`).set(bearer(sa)).send({ status: 'TAM_KHOA' }).expect(200);
    try {
      await request(http).get(`/api/public/market/shops/${partnerSlug}`).expect(404);
      const r = await request(http).get(`/api/public/market/items/${code}`).expect(200);
      expect(r.body.sellers.map((x: { shop: { slug: string } }) => x.shop.slug)).toEqual([plgSlug]);
    } finally {
      await request(http).post(`/api/platform/partners/${partnerTenant}/status`).set(bearer(sa)).send({ status: 'HOAT_DONG' }).expect(200);
    }
    await request(http).get(`/api/public/market/shops/${partnerSlug}`).expect(200);
    const sm = await request(http).get('/api/public/market/sitemap').expect(200);
    expect(sm.body.items.map((i: { code: string }) => i.code)).toContain(code);
  });
});
