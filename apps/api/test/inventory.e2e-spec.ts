import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, login, PHONES, randomPhone } from './helpers';

const uniq = () => Math.random().toString(36).slice(2, 7).toUpperCase();
const randomPlate = () => `61C${String(Math.floor(10000 + Math.random() * 89999))}`;

describe('Danh mục sản phẩm & kho', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let owner: string;
  let sales: string;
  let tech: string;
  let tk: string;
  let managerCn1: string;
  let managerCn2: string;
  let cn1: string;
  let cn2: string;

  const stockAt = async (productId: string, branchId: string) => {
    const p = await request(http).get(`/api/products/${productId}`).set(bearer(owner)).expect(200);
    return p.body.stock.find((s: { branch: { id: string } }) => s.branch.id === branchId).quantity as number;
  };
  const newProduct = async (extra: Record<string, unknown> = {}) =>
    (await request(http).post('/api/products').set(bearer(tk)).send({ name: `Lốp thử ${uniq()}`, kind: 'PHU_TUNG', unit: 'cái', salePrice: 2_000_000, costPrice: 1_500_000, ...extra }).expect(201)).body as { id: string; code: string };

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    owner = (await login(app, PHONES.owner)).token;
    sales = (await login(app, PHONES.sales)).token;
    tech = (await login(app, PHONES.tech)).token;
    tk = (await login(app, PHONES.storekeeper)).token;
    managerCn1 = (await login(app, PHONES.managerCn1)).token;
    managerCn2 = (await login(app, PHONES.managerCn2)).token;
    const branches = await request(http).get('/api/branches').set(bearer(owner));
    cn1 = branches.body.find((b: { code: string }) => b.code === 'CN1').id;
    cn2 = branches.body.find((b: { code: string }) => b.code === 'CN2').id;
  });
  afterAll(() => app.close());

  it('nhóm sản phẩm mẫu 2 cấp được tạo sẵn; thêm nhóm con; không cho cấp 3', async () => {
    const cats = await request(http).get('/api/product-categories').set(bearer(sales)).expect(200);
    const names = cats.body.map((c: { name: string }) => c.name);
    for (const n of ['Nội thất', 'Ngoại thất', 'Lốp xe', 'Mâm xe', 'Ắc quy', 'Phuộc & giảm xóc', 'Phụ kiện & chăm sóc']) expect(names).toContain(n);
    const lop = cats.body.find((c: { name: string }) => c.name === 'Lốp xe');
    expect(lop.children.length).toBeGreaterThan(0);
    const sub = await request(http).post('/api/product-categories').set(bearer(tk)).send({ name: `Lốp xe máy ${uniq()}`, parentId: lop.id }).expect(201);
    await request(http).post('/api/product-categories').set(bearer(tk)).send({ name: 'Cấp 3', parentId: sub.body.id }).expect(400);
    await request(http).post('/api/product-categories').set(bearer(sales)).send({ name: 'Không được' }).expect(403);
  });

  it('sản phẩm: mã tự sinh / nhập tay, trùng mã 409; theo hãng xe; bán hàng không thấy giá vốn; KTV không vào danh mục', async () => {
    const cats = await request(http).get('/api/product-categories').set(bearer(tk));
    const lop = cats.body.find((c: { name: string }) => c.name === 'Lốp xe');
    const tag = uniq();
    const toyota = await newProduct({ name: `Lốp Toyota ${tag}`, categoryId: lop.children[0].id, vehicleMakes: ['Toyota', ' Toyota ', 'Lexus'], brand: 'Michelin' });
    expect(toyota.code).toMatch(/^SP\d{6}$/);
    const all = await newProduct({ name: `Lốp đa năng ${tag}`, code: `lop-${tag}` });
    expect(all.code).toBe(`LOP-${tag}`);
    await request(http).post('/api/products').set(bearer(tk)).send({ name: 'Trùng', kind: 'PHU_TUNG', salePrice: 1, code: `LOP-${tag}` }).expect(409);
    const svc = await request(http).post('/api/products').set(bearer(owner)).send({ name: `Cân bằng động ${tag}`, kind: 'DICH_VU', salePrice: 100_000 }).expect(201);
    expect(svc.body.code).toMatch(/^DV\d{6}$/);

    const forToyota = await request(http).get('/api/products').query({ q: tag, make: 'Toyota' }).set(bearer(sales)).expect(200);
    expect(forToyota.body.items.map((i: { code: string }) => i.code).sort()).toEqual([toyota.code, `LOP-${tag}`, svc.body.code].sort());
    const forKia = await request(http).get('/api/products').query({ q: tag, make: 'Kia' }).set(bearer(sales)).expect(200);
    expect(forKia.body.items.map((i: { code: string }) => i.code)).not.toContain(toyota.code);
    const byCat = await request(http).get('/api/products').query({ q: tag, categoryId: lop.id }).set(bearer(sales)).expect(200);
    expect(byCat.body.items.map((i: { code: string }) => i.code)).toEqual([toyota.code]);
    expect(byCat.body.items[0]).toMatchObject({ vehicleMakes: ['Toyota', 'Lexus'], brand: 'Michelin', costPrice: null, salePrice: 2_000_000 });
    expect(byCat.body.items[0].category.name).toContain('Lốp xe ›');
    const asTk = await request(http).get('/api/products').query({ q: tag, categoryId: lop.id }).set(bearer(tk)).expect(200);
    expect(asTk.body.items[0].costPrice).toBe(1_500_000);
    await request(http).get('/api/products').set(bearer(tech)).expect(403);

    // Tháng / năm sản xuất
    const dated = await newProduct({ name: `Ắc quy ${tag}`, mfgMonth: 9, mfgYear: 2026 });
    const dd = await request(http).get(`/api/products/${dated.id}`).set(bearer(sales)).expect(200);
    expect(dd.body).toMatchObject({ mfgMonth: 9, mfgYear: 2026 });
    await request(http).post('/api/products').set(bearer(tk)).send({ name: 'x', kind: 'PHU_TUNG', salePrice: 1, mfgMonth: 5 }).expect(400);
    await request(http).post('/api/products').set(bearer(tk)).send({ name: 'x', kind: 'PHU_TUNG', salePrice: 1, mfgYear: 1800 }).expect(400);
    await request(http).post('/api/products').set(bearer(tk)).send({ name: 'x', kind: 'PHU_TUNG', salePrice: 1, mfgMonth: 13, mfgYear: 2025 }).expect(400);
    await request(http).patch(`/api/products/${dated.id}`).set(bearer(tk)).send({ mfgYear: null }).expect(400); // còn tháng mà bỏ năm
    await request(http).patch(`/api/products/${dated.id}`).set(bearer(tk)).send({ mfgMonth: null, mfgYear: 2025 }).expect(200);
    const listed = await request(http).get('/api/products').query({ q: dated.code }).set(bearer(sales));
    expect(listed.body.items[0]).toMatchObject({ mfgMonth: null, mfgYear: 2025 });
    await request(http).post('/api/products').set(bearer(sales)).send({ name: 'x', kind: 'PHU_TUNG', salePrice: 1 }).expect(403);
  });

  it('nhập hàng (NCC) → chuyển kho → kiểm kê; giá vốn theo lần nhập; sổ kho ghi tồn sau mỗi lần', async () => {
    const p = await newProduct({ minStock: 3 });
    const sup = await request(http).post('/api/suppliers').set(bearer(tk)).send({ name: `NCC Lốp ${uniq()}`, phone: '0283 999 888' }).expect(201);
    expect(sup.body.code).toMatch(/^NCC\d{4}$/);

    const pn = await request(http).post('/api/stock-documents').set(bearer(tk)).send({ type: 'NHAP', branchId: cn1, supplierId: sup.body.id, refNo: 'HD-001', lines: [{ productId: p.id, quantity: '10', unitCost: 1_400_000 }] }).expect(201);
    expect(pn.body.code).toMatch(/^PN\d{6}$/);
    const pnDoc = await request(http).get(`/api/stock-documents/${pn.body.id}`).set(bearer(tk)).expect(200);
    expect(pnDoc.body.lines[0].product).toMatchObject({ code: p.code, category: null });
    expect(await stockAt(p.id, cn1)).toBe(10);
    const after = await request(http).get(`/api/products/${p.id}`).set(bearer(tk));
    expect(after.body.costPrice).toBe(1_400_000);

    await request(http).post('/api/stock-documents').set(bearer(tk)).send({ type: 'CHUYEN', branchId: cn1, toBranchId: cn1, lines: [{ productId: p.id, quantity: 1 }] }).expect(400);
    await request(http).post('/api/stock-documents').set(bearer(tk)).send({ type: 'CHUYEN', branchId: cn1, toBranchId: cn2, lines: [{ productId: p.id, quantity: 4 }] }).expect(201);
    expect(await stockAt(p.id, cn1)).toBe(6);
    expect(await stockAt(p.id, cn2)).toBe(4);

    // Kiểm kê: thủ kho không tự điều chỉnh được; quản lý CN2 không điều chỉnh CN1; quản lý CN1 được
    await request(http).post('/api/stock-documents').set(bearer(tk)).send({ type: 'DIEU_CHINH', branchId: cn1, lines: [{ productId: p.id, countedQty: 5 }] }).expect(403);
    await request(http).post('/api/stock-documents').set(bearer(managerCn2)).send({ type: 'DIEU_CHINH', branchId: cn1, lines: [{ productId: p.id, countedQty: 5 }] }).expect(403);
    await request(http).post('/api/stock-documents').set(bearer(managerCn1)).send({ type: 'DIEU_CHINH', branchId: cn1, lines: [{ productId: p.id, countedQty: 6 }] }).expect(400); // khớp sổ
    const pk = await request(http).post('/api/stock-documents').set(bearer(managerCn1)).send({ type: 'DIEU_CHINH', branchId: cn1, lines: [{ productId: p.id, countedQty: 5 }] }).expect(201);
    expect(await stockAt(p.id, cn1)).toBe(5);
    const doc = await request(http).get(`/api/stock-documents/${pk.body.id}`).set(bearer(managerCn1)).expect(200);
    expect(doc.body.lines[0]).toMatchObject({ delta: -1, balance: 5 });

    const detail = await request(http).get(`/api/products/${p.id}`).set(bearer(owner));
    expect(detail.body.movements.map((m: { kind: string; balance: number }) => `${m.kind}:${m.balance}`)).toEqual(['DIEU_CHINH:5', 'CHUYEN_DEN:4', 'CHUYEN_DI:6', 'NHAP_HANG:10']);

    const sups = await request(http).get('/api/suppliers').query({ q: '0283999888' }).set(bearer(tk)).expect(200);
    expect(sups.body[0]).toMatchObject({ purchased: 14_000_000, receipts: 1 });
    const docs = await request(http).get('/api/stock-documents').query({ type: 'NHAP' }).set(bearer(tk)).expect(200);
    expect(docs.body.items.some((d: { code: string }) => d.code === pn.body.code)).toBe(true);

    // Tồn thấp: CN2 có 4 > min 3; CN1 = 5. Không phải hàng tồn thấp
    const low = await request(http).get('/api/products').query({ lowStock: 'true', branchId: cn1, q: p.code }).set(bearer(tk)).expect(200);
    expect(low.body.total).toBe(0);
    await request(http).delete(`/api/products/${p.id}`).set(bearer(tk)).expect(409); // còn tồn
  });

  it('đơn hàng chọn sản phẩm trong danh mục → giao xe thì trừ kho chi nhánh, sổ kho ghi mã đơn', async () => {
    const p = await newProduct();
    await request(http).post('/api/stock-documents').set(bearer(tk)).send({ type: 'NHAP', branchId: cn1, lines: [{ productId: p.id, quantity: 2, unitCost: 1_000_000 }] }).expect(201);
    const c = await request(http).post('/api/customers').set(bearer(owner)).send({ name: 'Khách Mua Lốp', phone: randomPhone(), vehicle: { plate: randomPlate() } }).expect(201);
    const cd = await request(http).get(`/api/customers/${c.body.id}`).set(bearer(owner));
    const bad = { kind: 'PHU_TUNG', name: 'x', quantity: 1, unitPrice: 1, productId: '00000000-0000-4000-8000-000000000000' };
    await request(http).post('/api/orders').set(bearer(sales)).send({ branchId: cn1, customerId: c.body.id, items: [bad] }).expect(400);
    const o = await request(http)
      .post('/api/orders')
      .set(bearer(sales))
      .send({ branchId: cn1, customerId: c.body.id, vehicleId: cd.body.vehicles[0].id, items: [{ kind: 'PHU_TUNG', name: 'Lốp', quantity: 4, unitPrice: 2_000_000, productId: p.id }, { kind: 'DICH_VU', name: 'Công lắp', quantity: 1, unitPrice: 200_000 }] })
      .expect(201);
    for (const to of ['DANG_SUA', 'HOAN_THANH']) await request(http).post(`/api/orders/${o.body.id}/status`).set(bearer(sales)).send({ to }).expect(200);
    expect(await stockAt(p.id, cn1)).toBe(2); // chưa giao chưa trừ
    await request(http).post(`/api/orders/${o.body.id}/status`).set(bearer(sales)).send({ to: 'DA_GIAO', allowDebt: true }).expect(200);
    expect(await stockAt(p.id, cn1)).toBe(-2); // cho phép âm: bán trước, nhập bù sau
    const d = await request(http).get(`/api/products/${p.id}`).set(bearer(owner));
    expect(d.body.movements[0]).toMatchObject({ kind: 'XUAT_BAN', quantity: -4, balance: -2, order: { code: o.body.code } });
    const low = await request(http).get('/api/products').query({ q: p.code, branchId: cn1 }).set(bearer(sales)).expect(200);
    expect(low.body.items[0].stock).toBe(-2);
  });
});
