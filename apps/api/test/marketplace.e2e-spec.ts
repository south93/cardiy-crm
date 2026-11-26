import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, createApp, login, PHONES } from './helpers';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const tag = Date.now().toString(36).toUpperCase();
const hours = [1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '07:30', close: '17:30', closed: false })).concat([{ day: 0, open: '', close: '', closed: true }]);

describe('Vòng 3.2: danh mục chuẩn, gian hàng, tin đăng, kiểm duyệt', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let sa: string;
  let plg: string;
  let partner: string;
  let tech: string;
  let tyreId: string;
  let serviceId: string;
  let offerId: string;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    const o = await login(app, PHONES.owner);
    plg = o.token;
    const me = await request(http).get('/api/me').set(bearer(o.token));
    const pf = me.body.memberships.find((m: { tenantType: string }) => m.tenantType === 'PLATFORM');
    sa = (await request(http).post('/api/auth/switch').set(bearer(o.token)).set('Cookie', o.cookie).send({ membershipId: pf.membershipId }).expect(200)).body.accessToken;
    partner = (await login(app, PHONES.partnerOwner)).token;
    tech = (await login(app, PHONES.tech)).token;
  });
  afterAll(() => app.close());

  it('sàn tạo nhóm + SKU / dịch vụ chuẩn; người bán tra cứu được, người không bán thì không', async () => {
    const cat = await request(http)
      .post('/api/platform/catalog/categories')
      .set(bearer(sa))
      .send({ kind: 'PRODUCT', name: `Lốp test ${tag}` })
      .expect(201);
    await request(http).post('/api/platform/catalog/categories').set(bearer(sa)).send({ kind: 'SERVICE', name: 'Con sai loại', parentId: cat.body.id }).expect(400);
    const it1 = await request(http)
      .post('/api/platform/catalog/items')
      .set(bearer(sa))
      .send({ kind: 'PRODUCT', code: `LOP-${tag}`, name: `Lốp kiểm thử ${tag} 205/55R16`, categoryId: cat.body.id, brand: 'Hãng Test', unit: 'Lốp', specs: [{ label: 'Kích cỡ', value: '205/55R16' }] })
      .expect(201);
    tyreId = it1.body.id;
    await request(http)
      .post('/api/platform/catalog/items')
      .set(bearer(sa))
      .send({ kind: 'PRODUCT', code: `lop-${tag}`, name: 'Trùng mã' })
      .expect(409);
    await request(http)
      .post('/api/platform/catalog/items')
      .set(bearer(sa))
      .send({ kind: 'SERVICE', code: `DV-X-${tag}`, name: 'Sai nhóm', categoryId: cat.body.id })
      .expect(400);
    serviceId = (
      await request(http)
        .post('/api/platform/catalog/items')
        .set(bearer(sa))
        .send({ kind: 'SERVICE', code: `DV-${tag}`, name: `Bảo dưỡng kiểm thử ${tag}` })
        .expect(201)
    ).body.id;
    await request(http)
      .post('/api/platform/catalog/items')
      .set(bearer(partner))
      .send({ kind: 'SERVICE', code: `DV-Y-${tag}`, name: 'Không phải sàn' })
      .expect(403);

    const found = await request(http)
      .get(`/api/catalog/items?kind=PRODUCT&q=${encodeURIComponent('205/55r16 ' + tag)}`)
      .set(bearer(partner))
      .expect(200);
    expect(found.body.map((x: { id: string }) => x.id)).toContain(tyreId);
    await request(http).get('/api/catalog/items?kind=PRODUCT').set(bearer(tech)).expect(403);
  });

  it('đề xuất danh mục: đối tác gửi, sàn gắn vào mục có sẵn hoặc từ chối', async () => {
    const p = await request(http)
      .post('/api/catalog/proposals')
      .set(bearer(partner))
      .send({ kind: 'PRODUCT', name: `Lốp đề xuất ${tag}`, brand: 'Hãng Test' })
      .expect(201);
    const p2 = await request(http)
      .post('/api/catalog/proposals')
      .set(bearer(partner))
      .send({ kind: 'SERVICE', name: `Dịch vụ lạ ${tag}` })
      .expect(201);
    const list = await request(http).get('/api/platform/catalog/proposals?status=CHO_XU_LY').set(bearer(sa)).expect(200);
    expect(list.body.find((x: { id: string }) => x.id === p.body.id).garage).toMatch(/Minh Phát/);
    await request(http).post(`/api/platform/catalog/proposals/${p.body.id}/accept`).set(bearer(sa)).send({ existingItemId: serviceId }).expect(400); // sai loại
    await request(http).post(`/api/platform/catalog/proposals/${p.body.id}/accept`).set(bearer(sa)).send({ existingItemId: tyreId }).expect(200);
    await request(http).post(`/api/platform/catalog/proposals/${p2.body.id}/reject`).set(bearer(sa)).send({ note: 'Chưa hỗ trợ dịch vụ này' }).expect(200);
    await request(http).post(`/api/platform/catalog/proposals/${p.body.id}/reject`).set(bearer(sa)).send({ note: 'Lần hai' }).expect(409);
    const mine = await request(http).get('/api/catalog/proposals').set(bearer(partner)).expect(200);
    expect(mine.body.find((x: { id: string }) => x.id === p.body.id)).toMatchObject({ status: 'DA_TAO', item: { id: tyreId } });
    expect(mine.body.find((x: { id: string }) => x.id === p2.body.id)).toMatchObject({ status: 'TU_CHOI', reviewNote: 'Chưa hỗ trợ dịch vụ này' });
  });

  it('hồ sơ gian hàng: kiểm tra giờ mở cửa, tự tạo đường dẫn, báo còn thiếu gì', async () => {
    const g = await request(http).get('/api/shop').set(bearer(partner)).expect(200);
    expect(g.body.shop.name).toBeTruthy();
    await request(http)
      .put('/api/shop')
      .set(bearer(partner))
      .send({ name: 'Minh Phát Auto', openingHours: [{ day: 1, open: '18:00', close: '08:00', closed: false }] })
      .expect(400);
    await request(http).put('/api/shop').set(bearer(partner)).send({ name: 'Minh Phát Auto', lat: 21.0 }).expect(400);
    const s = await request(http)
      .put('/api/shop')
      .set(bearer(partner))
      .send({ name: 'Minh Phát Auto', phone: '0900000010', address: 'Hà Đông, Hà Nội', lat: 20.97, lng: 105.77, openingHours: hours, warrantyPolicy: 'Bảo hành lắp đặt 3 tháng' })
      .expect(200);
    expect(s.body.shop.slug).toMatch(/^minh-phat-auto/);
    // Đủ thông tin: chỉ còn thiếu tin đang bán (nếu chưa có)
    expect(s.body.missing).toEqual(s.body.liveOffers ? [] : ['Có ít nhất 1 sản phẩm hoặc dịch vụ đang bán']);
    // Đường dẫn đã có gian hàng khác dùng
    const plgShop = await request(http)
      .put('/api/shop')
      .set(bearer(plg))
      .send({ name: 'Garage PLG', phone: '0900000001', address: 'Đồng Xoài', lat: 11.5, lng: 106.9, openingHours: hours })
      .expect(200);
    await request(http).put('/api/shop').set(bearer(partner)).send({ name: 'Minh Phát Auto', slug: plgShop.body.shop.slug }).expect(409);
    await request(http).put('/api/shop').set(bearer(tech)).send({ name: 'Garage KTV' }).expect(403);
  });

  it('tin đăng của đối tác: nháp → chờ duyệt → từ chối → sửa → duyệt; đổi giá giữ trạng thái, đổi ghi chú phải duyệt lại', async () => {
    await request(http).post('/api/shop/offers').set(bearer(partner)).send({ kind: 'PRODUCT', catalogItemId: tyreId, price: 2_000_000 }).expect(400); // thiếu tồn
    await request(http).post('/api/shop/offers').set(bearer(partner)).send({ kind: 'SERVICE', catalogItemId: tyreId, price: 1 }).expect(400); // sai loại
    await request(http).post('/api/shop/offers').set(bearer(partner)).send({ kind: 'PRODUCT', catalogItemId: tyreId, price: 2_000_000, listPrice: 1_900_000, manualStock: 4 }).expect(400);
    const img = await request(http).post('/api/files').set(bearer(partner)).attach('file', PNG, 'lop.png').expect(201);
    const plgImg = await request(http).post('/api/files').set(bearer(plg)).attach('file', PNG, 'plg.png').expect(201);
    await request(http)
      .post('/api/shop/offers')
      .set(bearer(partner))
      .send({ kind: 'PRODUCT', catalogItemId: tyreId, price: 2_000_000, manualStock: 4, imageFileIds: [plgImg.body.id] })
      .expect(404);
    const body = {
      kind: 'PRODUCT',
      catalogItemId: tyreId,
      price: 2_000_000,
      listPrice: 2_300_000,
      manualStock: 4,
      installIncluded: true,
      mfgYear: 2026,
      imageFileIds: [img.body.id],
      note: 'Lốp mới 2026',
    };
    const c = await request(http).post('/api/shop/offers').set(bearer(partner)).send(body).expect(201);
    offerId = c.body.id;
    expect(c.body).toMatchObject({ status: 'NHAP', stock: 4, publicState: 'AN', installIncluded: true });
    expect(c.body.images[0].url).toBeTruthy();

    await request(http).post(`/api/shop/offers/${offerId}/submit`).set(bearer(partner)).expect(200);
    const q = await request(http).get('/api/platform/offers?status=CHO_DUYET').set(bearer(sa)).expect(200);
    expect(q.body.items.find((x: { id: string }) => x.id === offerId)).toMatchObject({ seller: 'Minh Phát Auto', price: 2_000_000 });
    await request(http).post(`/api/platform/offers/${offerId}/reject`).set(bearer(sa)).send({ note: 'Ảnh không rõ sản phẩm' }).expect(200);
    const mine = await request(http).get('/api/shop/offers?kind=PRODUCT').set(bearer(partner)).expect(200);
    expect(mine.body.items.find((x: { id: string }) => x.id === offerId)).toMatchObject({ status: 'BI_TU_CHOI', reviewNote: 'Ảnh không rõ sản phẩm' });

    const ed = await request(http)
      .put(`/api/shop/offers/${offerId}`)
      .set(bearer(partner))
      .send({ ...body, note: 'Lốp mới 2026, ảnh thật' })
      .expect(200);
    expect(ed.body.status).toBe('NHAP');
    await request(http).post(`/api/shop/offers/${offerId}/submit`).set(bearer(partner)).expect(200);
    await request(http).post(`/api/platform/offers/${offerId}/approve`).set(bearer(sa)).expect(200);
    await request(http).post(`/api/platform/offers/${offerId}/approve`).set(bearer(sa)).expect(409);

    const price = await request(http)
      .put(`/api/shop/offers/${offerId}`)
      .set(bearer(partner))
      .send({ ...body, note: 'Lốp mới 2026, ảnh thật', price: 1_950_000, manualStock: 0 })
      .expect(200);
    expect(price.body).toMatchObject({ status: 'DANG_BAN', publicState: 'HET_HANG', price: 1_950_000 });
    const note = await request(http)
      .put(`/api/shop/offers/${offerId}`)
      .set(bearer(partner))
      .send({ ...body, note: 'Đổi mô tả', manualStock: 2 })
      .expect(200);
    expect(note.body.status).toBe('CHO_DUYET');
    await request(http).post(`/api/platform/offers/${offerId}/approve`).set(bearer(sa)).expect(200);

    const g = await request(http).get('/api/shop').set(bearer(partner)).expect(200);
    expect(g.body.liveOffers).toBeGreaterThan(0);
  });

  it('ẩn / hiện, không xoá tin đang bán, sàn gỡ tin thì garage không sửa được', async () => {
    await request(http).post(`/api/shop/offers/${offerId}/hide`).set(bearer(partner)).expect(200);
    await request(http).post(`/api/shop/offers/${offerId}/show`).set(bearer(partner)).expect(200);
    await request(http).post(`/api/shop/offers/${offerId}/delete`).set(bearer(partner)).expect(409);
    await request(http).post(`/api/shop/offers/${offerId}/submit`).set(bearer(plg)).expect(404); // tin của garage khác
    await request(http).post(`/api/platform/offers/${offerId}/takedown`).set(bearer(sa)).send({ note: 'Vi phạm chính sách giá' }).expect(200);
    await request(http).put(`/api/shop/offers/${offerId}`).set(bearer(partner)).send({ kind: 'PRODUCT', catalogItemId: tyreId, price: 1, manualStock: 1 }).expect(409);
    await request(http).post(`/api/shop/offers/${offerId}/show`).set(bearer(partner)).expect(409);
    // Nháp thì xoá được
    const d = await request(http).post('/api/shop/offers').set(bearer(partner)).send({ kind: 'SERVICE', catalogItemId: serviceId, price: 500_000, priceFrom: true, durationMinutes: 90 }).expect(201);
    expect(d.body).toMatchObject({ stock: null, priceFrom: true, durationMinutes: 90 });
    await request(http).post(`/api/shop/offers/${d.body.id}/delete`).set(bearer(partner)).expect(200);
  });

  it('PLG: tin liên kết hàng trong kho, tồn lấy từ chi nhánh bán; gửi là bán ngay', async () => {
    const prisma = app.get(PrismaService);
    const prod = (
      await request(http)
        .post('/api/products')
        .set(bearer(plg))
        .send({ name: `Lốp kho ${tag}`, kind: 'PHU_TUNG', unit: 'cái', salePrice: 2_100_000 })
        .expect(201)
    ).body as { id: string };
    const shop = await request(http).get('/api/shop').set(bearer(plg)).expect(200);
    const [cn1, cn2] = shop.body.branches as { id: string; code: string }[];
    await prisma.stockLevel.createMany({
      data: [
        { productId: prod.id, branchId: cn1!.id, quantity: 3 },
        { productId: prod.id, branchId: cn2!.id, quantity: 5 },
      ],
    });

    await request(http).post('/api/shop/offers').set(bearer(partner)).send({ kind: 'PRODUCT', catalogItemId: tyreId, productId: prod.id, price: 1 }).expect(400); // đối tác không liên kết kho
    const o = await request(http)
      .post('/api/shop/offers')
      .set(bearer(plg))
      .send({ kind: 'PRODUCT', catalogItemId: tyreId, productId: prod.id, branchIds: [cn1!.id], price: 2_100_000 })
      .expect(201);
    expect(o.body).toMatchObject({ stock: 3, product: { id: prod.id } });
    const sub = await request(http).post(`/api/shop/offers/${o.body.id}/submit`).set(bearer(plg)).expect(200);
    expect(sub.body.status).toBe('DANG_BAN');
    const all = await request(http)
      .put(`/api/shop/offers/${o.body.id}`)
      .set(bearer(plg))
      .send({ kind: 'PRODUCT', catalogItemId: tyreId, productId: prod.id, branchIds: [], price: 2_100_000, note: 'Đổi mô tả' })
      .expect(200);
    expect(all.body).toMatchObject({ stock: 8, status: 'DANG_BAN', publicState: 'CON_HANG' });
    // Bán hết ở kho → tin tự báo hết hàng
    await prisma.stockLevel.updateMany({ where: { productId: prod.id }, data: { quantity: 0 } });
    const list = await request(http).get('/api/shop/offers?kind=PRODUCT').set(bearer(plg)).expect(200);
    expect(list.body.items.find((x: { id: string }) => x.id === o.body.id).publicState).toBe('HET_HANG');
  });
});
