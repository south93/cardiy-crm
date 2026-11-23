import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, login, PHONES, randomPhone, randomPlate } from './helpers';

describe('Đơn hàng', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let owner: string;
  let sales: string;
  let tech: string;
  let managerCn1: string;
  let managerCn2: string;
  let cn1: string;
  let cn2: string;

  /** Khách + xe mới cho mỗi bài test (dữ liệu giả) */
  async function customerWithCar(km = 50_000) {
    const res = await request(http)
      .post('/api/customers')
      .set(bearer(owner))
      .send({ name: 'Anh Đơn Hàng', phone: randomPhone(), vehicle: { plate: randomPlate(), make: 'Toyota', model: 'Vios', odometerKm: km } })
      .expect(201);
    const c = await request(http).get(`/api/customers/${res.body.id}`).set(bearer(owner));
    return { customerId: res.body.id as string, vehicleId: c.body.vehicles[0].id as string };
  }

  const items = [
    { kind: 'DICH_VU', name: 'Thay dầu máy', quantity: 1, unitPrice: 150_000 },
    { kind: 'PHU_TUNG', name: 'Dầu máy 5W-30', unit: 'lít', quantity: '4,5', unitPrice: 180_000, discount: 10_000 },
  ];

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    owner = (await login(app, PHONES.owner)).token;
    sales = (await login(app, PHONES.sales)).token;
    tech = (await login(app, PHONES.tech)).token;
    managerCn1 = (await login(app, PHONES.managerCn1)).token;
    managerCn2 = (await login(app, PHONES.managerCn2)).token;
    const branches = await request(http).get('/api/branches').set(bearer(owner));
    cn1 = branches.body.find((b: { code: string }) => b.code === 'CN1').id;
    cn2 = branches.body.find((b: { code: string }) => b.code === 'CN2').id;
  });
  afterAll(() => app.close());

  it('tạo đơn: mã DH, tính tiền, ghi số km; xe đang có đơn mở → 409', async () => {
    const { customerId, vehicleId } = await customerWithCar();
    const res = await request(http).post('/api/orders').set(bearer(sales)).send({ branchId: cn1, customerId, vehicleId, odometerKm: 52_000, request: 'Thay dầu, kiểm tra phanh', items, orderDiscount: 20_000 }).expect(201);
    expect(res.body.code).toMatch(/^DH\d{6}$/);
    const o = await request(http).get(`/api/orders/${res.body.id}`).set(bearer(sales)).expect(200);
    // 150.000 + (4,5 × 180.000 − 10.000 = 800.000) − 20.000
    expect(o.body).toMatchObject({ status: 'TIEP_NHAN', subtotal: 950_000, total: 930_000, paid: 0, due: 930_000, paymentState: 'CHUA_THU', odometerKm: 52_000 });
    expect(o.body.items[1]).toMatchObject({ quantity: '4.5', amount: 800_000 });
    expect(o.body.advisor.name).toBe('Lê Bán Hàng');
    const v = await request(http).get(`/api/vehicles/${vehicleId}`).set(bearer(owner));
    expect(v.body.odometerKm).toBe(52_000);

    const again = await request(http).post('/api/orders').set(bearer(sales)).send({ branchId: cn1, customerId, vehicleId }).expect(409);
    expect(again.body.message).toContain(res.body.code);
  });

  it('số km nhỏ hơn lần trước; giảm giá dòng lớn hơn thành tiền → 400', async () => {
    const { customerId, vehicleId } = await customerWithCar(60_000);
    await request(http).post('/api/orders').set(bearer(sales)).send({ branchId: cn1, customerId, vehicleId, odometerKm: 1000 }).expect(400);
    const bad = await request(http)
      .post('/api/orders')
      .set(bearer(sales))
      .send({ branchId: cn1, customerId, vehicleId, items: [{ kind: 'DICH_VU', name: 'Rửa xe', quantity: 1, unitPrice: 50_000, discount: 60_000 }] })
      .expect(400);
    expect(bad.body.message).toContain('Rửa xe');
  });

  it('luồng đầy đủ: KTV nhận việc → hoàn thành; thu tiền từng phần; giao xe cần thu đủ hoặc ghi nợ', async () => {
    const { customerId, vehicleId } = await customerWithCar();
    const { body } = await request(http).post('/api/orders').set(bearer(sales)).send({ branchId: cn1, customerId, vehicleId, items }).expect(201);
    const id = body.id;

    // KTV: thấy đơn nhưng không thấy tiền, không sửa hạng mục, không thu tiền
    const asTech = await request(http).get(`/api/orders/${id}`).set(bearer(tech)).expect(200);
    expect(asTech.body.total).toBeNull();
    expect(asTech.body.items[0].unitPrice).toBeNull();
    await request(http).put(`/api/orders/${id}/items`).set(bearer(tech)).send({ items }).expect(403);
    await request(http).post(`/api/orders/${id}/payments`).set(bearer(tech)).send({ amount: 1000, method: 'TIEN_MAT' }).expect(403);

    await request(http).post(`/api/orders/${id}/status`).set(bearer(tech)).send({ to: 'DANG_SUA' }).expect(200);
    await request(http).post(`/api/orders/${id}/status`).set(bearer(tech)).send({ to: 'DA_GIAO' }).expect(409); // sai mũi tên
    await request(http).post(`/api/orders/${id}/status`).set(bearer(tech)).send({ to: 'HOAN_THANH' }).expect(200);
    await request(http).post(`/api/orders/${id}/status`).set(bearer(tech)).send({ to: 'DA_GIAO' }).expect(403); // KTV không giao xe

    // Thu tiền: không vượt số còn phải thu
    await request(http).post(`/api/orders/${id}/payments`).set(bearer(sales)).send({ amount: 2_000_000, method: 'TIEN_MAT' }).expect(400);
    const p1 = await request(http).post(`/api/orders/${id}/payments`).set(bearer(sales)).send({ amount: 500_000, method: 'TIEN_MAT' }).expect(201);
    expect(p1.body.due).toBe(450_000);

    // Còn nợ: chưa xác nhận ghi nợ thì không giao được
    const blocked = await request(http).post(`/api/orders/${id}/status`).set(bearer(sales)).send({ to: 'DA_GIAO' }).expect(409);
    expect(blocked.body.message).toContain('450.000');
    // Sửa hạng mục sau khi đã thu: tổng mới < đã thu → 409
    await request(http).put(`/api/orders/${id}/items`).set(bearer(sales)).send({ items: [{ kind: 'DICH_VU', name: 'Kiểm tra', quantity: 1, unitPrice: 100_000 }] }).expect(409);

    await request(http).post(`/api/orders/${id}/payments`).set(bearer(sales)).send({ amount: 450_000, method: 'CHUYEN_KHOAN', note: 'VCB' }).expect(201);
    await request(http).post(`/api/orders/${id}/status`).set(bearer(sales)).send({ to: 'DA_GIAO' }).expect(200);
    const done = await request(http).get(`/api/orders/${id}`).set(bearer(sales));
    expect(done.body).toMatchObject({ status: 'DA_GIAO', paid: 950_000, due: 0, paymentState: 'DA_THU_DU', editable: false });
    expect(done.body.history.map((h: { to: string }) => h.to)).toEqual(['TIEP_NHAN', 'DANG_SUA', 'HOAN_THANH', 'DA_GIAO']);
    await request(http).put(`/api/orders/${id}/items`).set(bearer(sales)).send({ items }).expect(409);

    // Đơn đã giao: bán hàng không huỷ phiếu thu được, quản lý thì được
    const pid = done.body.payments[0].id;
    await request(http).post(`/api/orders/${id}/payments/${pid}/void`).set(bearer(sales)).send({ reason: 'Thu nhầm' }).expect(403);
    await request(http).post(`/api/orders/${id}/payments/${pid}/void`).set(bearer(managerCn1)).send({ reason: 'Thu nhầm' }).expect(200);
    const after = await request(http).get(`/api/orders/${id}`).set(bearer(owner));
    expect(after.body).toMatchObject({ paid: 450_000, due: 500_000 });

    // Công nợ hiện trên hồ sơ khách
    const c = await request(http).get(`/api/customers/${customerId}`).set(bearer(owner));
    expect(c.body).toMatchObject({ orderDebt: 500_000, orderCount: 1 });
  });

  it('giao xe ghi công nợ; huỷ đơn cần quyền duyệt, lý do và chưa thu tiền', async () => {
    const { customerId, vehicleId } = await customerWithCar();
    const { body } = await request(http).post('/api/orders').set(bearer(sales)).send({ branchId: cn1, customerId, vehicleId, items }).expect(201);
    await request(http).post(`/api/orders/${body.id}/status`).set(bearer(sales)).send({ to: 'HUY', reason: 'Khách đổi ý' }).expect(403);
    await request(http).post(`/api/orders/${body.id}/status`).set(bearer(managerCn1)).send({ to: 'HUY' }).expect(400);
    await request(http).post(`/api/orders/${body.id}/payments`).set(bearer(sales)).send({ amount: 100_000, method: 'THE' }).expect(201);
    await request(http).post(`/api/orders/${body.id}/status`).set(bearer(managerCn1)).send({ to: 'HUY', reason: 'Khách đổi ý' }).expect(409);

    const second = await customerWithCar();
    const o2 = await request(http).post('/api/orders').set(bearer(sales)).send({ branchId: cn1, ...second, items }).expect(201);
    for (const to of ['DANG_SUA', 'HOAN_THANH']) await request(http).post(`/api/orders/${o2.body.id}/status`).set(bearer(sales)).send({ to }).expect(200);
    await request(http).post(`/api/orders/${o2.body.id}/status`).set(bearer(sales)).send({ to: 'DA_GIAO', allowDebt: true }).expect(200);
    const g = await request(http).get(`/api/orders/${o2.body.id}`).set(bearer(sales));
    expect(g.body.history.at(-1).note).toContain('Ghi công nợ 950.000');
  });

  it('chi nhánh: quản lý CN2 không thấy / không tạo đơn ở CN1; danh sách lọc theo trạng thái, tìm theo biển số', async () => {
    const { customerId, vehicleId } = await customerWithCar();
    const { body } = await request(http).post('/api/orders').set(bearer(owner)).send({ branchId: cn1, customerId, vehicleId, items }).expect(201);
    await request(http).get(`/api/orders/${body.id}`).set(bearer(managerCn2)).expect(404);
    await request(http).post('/api/orders').set(bearer(managerCn2)).send({ branchId: cn1, customerId }).expect(403);
    await request(http).post('/api/orders').set(bearer(managerCn2)).send({ branchId: cn2, customerId }).expect(201);

    const v = await request(http).get(`/api/vehicles/${vehicleId}`).set(bearer(owner));
    const open = await request(http).get('/api/orders').query({ view: 'open', q: v.body.plate }).set(bearer(owner)).expect(200);
    expect(open.body.items.map((i: { id: string }) => i.id)).toEqual([body.id]);
    expect(open.body.counts.TIEP_NHAN).toBe(1);
    const done = await request(http).get('/api/orders').query({ view: 'done', q: v.body.plate }).set(bearer(owner)).expect(200);
    expect(done.body.total).toBe(0);
    const byVehicle = await request(http).get('/api/orders').query({ vehicleId }).set(bearer(owner)).expect(200);
    expect(byVehicle.body.total).toBe(1);

    // Lọc theo chi nhánh: chủ garage lọc được từng chi nhánh; quản lý CN2 không lọc được CN1
    const onlyCn2 = await request(http).get('/api/orders').query({ branchId: cn2, pageSize: 100 }).set(bearer(owner)).expect(200);
    expect(onlyCn2.body.items.every((i: { branch: { id: string } }) => i.branch.id === cn2)).toBe(true);
    await request(http).get('/api/orders').query({ branchId: cn1 }).set(bearer(managerCn2)).expect(403);
    const mine = await request(http).get('/api/orders').query({ pageSize: 100 }).set(bearer(managerCn2)).expect(200);
    expect(mine.body.items.every((i: { branch: { id: string } }) => i.branch.id === cn2)).toBe(true);
  });

  it('đối tác không truy cập được đơn của PLG', async () => {
    const partner = (await login(app, PHONES.partnerOwner)).token;
    await request(http).get('/api/orders').set(bearer(partner)).expect(403);
  });

  it('in phiếu: cài đặt mẫu in; hoá đơn có VietQR số còn phải thu; KTV chỉ in được phiếu tiếp nhận', async () => {
    const settings = { displayName: 'Garage PLG', hotline: '0900 000 000', bankBin: '970436', accountNo: '0123456789', accountName: 'GARAGE PLG', quoteValidDays: 10, invoiceNote: 'Bảo hành 3 tháng' };
    await request(http).put('/api/print-settings').set(bearer(sales)).send(settings).expect(403);
    await request(http).put('/api/print-settings').set(bearer(owner)).send({ ...settings, bankBin: '' }).expect(400);
    const saved = await request(http).put('/api/print-settings').set(bearer(owner)).send(settings).expect(200);
    expect(saved.body).toMatchObject({ displayName: 'Garage PLG', quoteValidDays: 10, invoiceNote: 'Bảo hành 3 tháng' });
    expect(saved.body.receiveTerms).toBe(''); // trường để trống được lưu là trống

    const { customerId, vehicleId } = await customerWithCar();
    const { body } = await request(http).post('/api/orders').set(bearer(sales)).send({ branchId: cn1, customerId, vehicleId, items }).expect(201);
    await request(http).post(`/api/orders/${body.id}/payments`).set(bearer(sales)).send({ amount: 450_000, method: 'TIEN_MAT' }).expect(201);

    const inv = await request(http).get(`/api/orders/${body.id}/print`).query({ form: 'hoa-don' }).set(bearer(sales)).expect(200);
    expect(inv.body).toMatchObject({ form: 'hoa-don', totalInWords: 'Chín trăm năm mươi nghìn đồng', dueInWords: 'Năm trăm nghìn đồng' });
    expect(inv.body.settings).toMatchObject({ displayName: 'Garage PLG', accountNo: '0123456789' });
    expect(inv.body.qr).toMatchObject({ amount: 500_000, bankName: 'Vietcombank' });
    expect(inv.body.qr.note).toContain(body.code);
    expect(inv.body.qr.dataUrl).toMatch(/^data:image\/png;base64,/);
    const quote = await request(http).get(`/api/orders/${body.id}/print`).query({ form: 'bao-gia' }).set(bearer(sales)).expect(200);
    expect(quote.body.qr).toBeNull();

    await request(http).get(`/api/orders/${body.id}/print`).query({ form: 'bao-gia' }).set(bearer(tech)).expect(403);
    const recv = await request(http).get(`/api/orders/${body.id}/print`).query({ form: 'tiep-nhan' }).set(bearer(tech)).expect(200);
    expect(recv.body.order.total).toBeNull();
    await request(http).get(`/api/orders/${body.id}/print`).query({ form: 'xyz' }).set(bearer(sales)).expect(400);
  });

  it('VAT từng dòng + phần bảo hiểm thanh toán; mẫu phiếu dịch vụ / kiểm tra xe có đủ dữ liệu', async () => {
    const { customerId, vehicleId } = await customerWithCar();
    const vatItems = [
      { kind: 'PHU_TUNG', name: 'Lốp 215/55R17', unit: 'cái', quantity: 4, unitPrice: 2_000_000, discount: 400_000, vatRate: 8, section: 'Phần lốp' },
      { kind: 'DICH_VU', name: 'Cân chỉnh thước lái', quantity: 1, unitPrice: 400_000, vatRate: 8, section: 'Phần gầm' },
    ];
    const { body } = await request(http).post('/api/orders').set(bearer(sales)).send({ branchId: cn1, customerId, vehicleId, items: vatItems }).expect(201);
    const o = await request(http).get(`/api/orders/${body.id}`).set(bearer(sales)).expect(200);
    // 7.600.000 + 400.000 = 8.000.000; VAT 8% = 640.000
    expect(o.body).toMatchObject({ subtotal: 8_000_000, vatTotal: 640_000, total: 8_640_000, insuranceAmount: 0, customerPays: 8_640_000 });
    expect(o.body.items.map((i: { section: string; vatRate: number }) => `${i.section}:${i.vatRate}`)).toEqual(['Phần lốp:8', 'Phần gầm:8']);
    expect(o.body.advisor).toMatchObject({ name: 'Lê Bán Hàng' });

    // Chiết khấu đơn → VAT tính lại theo tỷ lệ
    await request(http).patch(`/api/orders/${body.id}`).set(bearer(sales)).send({ orderDiscount: 800_000 }).expect(200);
    const o2 = await request(http).get(`/api/orders/${body.id}`).set(bearer(sales));
    expect(o2.body).toMatchObject({ vatTotal: 576_000, total: 7_776_000 });

    // Bảo hiểm trả một phần
    await request(http).patch(`/api/orders/${body.id}`).set(bearer(sales)).send({ insuranceAmount: 9_000_000 }).expect(400);
    await request(http).patch(`/api/orders/${body.id}`).set(bearer(sales)).send({ insuranceAmount: 5_000_000 }).expect(200);
    await request(http).post(`/api/orders/${body.id}/payments`).set(bearer(sales)).send({ amount: 5_000_000, method: 'BAO_HIEM' }).expect(201);
    const o3 = await request(http).get(`/api/orders/${body.id}`).set(bearer(sales));
    expect(o3.body).toMatchObject({ customerPays: 2_776_000, due: 2_776_000 });

    const svc = await request(http).get(`/api/orders/${body.id}/print`).query({ form: 'bao-gia' }).set(bearer(sales)).expect(200);
    expect(svc.body.totalInWords).toBe('Hai triệu bảy trăm bảy mươi sáu nghìn đồng');
    expect(svc.body.settings.warrantyTire).toContain('ĐIỀU KHOẢN BẢO HÀNH');
    expect(svc.body.order.customer).toHaveProperty('address');
    const inv = await request(http).get(`/api/orders/${body.id}/print`).query({ form: 'hoa-don' }).set(bearer(sales)).expect(200);
    expect(inv.body.qr.amount).toBe(2_776_000); // QR chỉ phần khách trả
    expect(inv.body).toMatchObject({ customerPaid: 0, customerDue: 2_776_000, insuranceDue: 0 });
    const chk = await request(http).get(`/api/orders/${body.id}/print`).query({ form: 'kiem-tra' }).set(bearer(tech)).expect(200);
    expect(chk.body.form).toBe('kiem-tra');
    expect(chk.body.order.vehicle).toHaveProperty('vin');
    const alias = await request(http).get(`/api/orders/${body.id}/print`).query({ form: 'tiep-nhan' }).set(bearer(tech)).expect(200);
    expect(alias.body.form).toBe('kiem-tra');
  });

  it('cài đặt mẫu in: link QR trợ lý, logo phải là ảnh của garage', async () => {
    const cur = await request(http).get('/api/print-settings').set(bearer(owner)).expect(200);
    const { banks: _b, tenantName: _n, tenantTaxCode: _t, ...base } = cur.body;
    await request(http).put('/api/print-settings').set(bearer(owner)).send({ ...base, qrLink: 'zalo.me/abc' }).expect(400);
    await request(http).put('/api/print-settings').set(bearer(owner)).send({ ...base, logoFileId: '00000000-0000-4000-8000-000000000000' }).expect(404);
    await request(http).put('/api/print-settings').set(bearer(owner)).send({ ...base, qrLink: 'https://zalo.me/0900000000', qrCaption: 'TRỢ LÝ Ô TÔ 24/7' }).expect(200);
    const { customerId, vehicleId } = await customerWithCar();
    const { body } = await request(http).post('/api/orders').set(bearer(sales)).send({ branchId: cn1, customerId, vehicleId, items }).expect(201);
    const p = await request(http).get(`/api/orders/${body.id}/print`).query({ form: 'bao-gia' }).set(bearer(sales)).expect(200);
    expect(p.body.linkQr).toMatch(/^data:image\/png;base64,/);
    expect(p.body.settings.qrCaption).toBe('TRỢ LÝ Ô TÔ 24/7');
  });
});
