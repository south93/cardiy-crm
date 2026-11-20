import { expect, test } from '@playwright/test';
import { loginUI, PHONES, randomPhone } from './helpers';

const randomPlate = () => `61K${String(Math.floor(10000 + Math.random() * 89999))}`;
const fmt = (p: string) => `${p.slice(0, 3)}-${p.slice(3, 6)}.${p.slice(6)}`;

test.describe('Đơn hàng', () => {
  test.skip(({ isMobile }) => isMobile, 'tạo / xử lý đơn làm trên máy tính');

  test('bán hàng: khách mới + xe → tạo đơn → thu một phần → sửa → giao xe ghi nợ → hồ sơ khách thấy công nợ', async ({ page }) => {
    const plate = randomPlate();
    await loginUI(page, PHONES.sales);
    await page.getByTestId('sidebar').getByRole('link', { name: 'Bán hàng' }).click();

    await page.getByRole('button', { name: 'Khách mới' }).click();
    const form = page.locator('#customer-form');
    await form.getByLabel('Họ tên / cách gọi').fill('Anh Giao Diện Đơn');
    await form.getByLabel('Số điện thoại', { exact: true }).fill(randomPhone());
    await form.getByLabel('Biển số').fill(plate);
    await form.getByLabel('Số km hiện tại').fill('40000');
    await form.getByRole('button', { name: 'Thêm khách và chọn' }).click();
    await expect(page.getByTestId('picked-customer')).toContainText('Anh Giao Diện Đơn');
    await expect(page.getByRole('radio', { name: new RegExp(fmt(plate).replace('.', '\\.')) })).toHaveAttribute('aria-checked', 'true');

    await page.getByLabel('Số km lúc nhận xe').fill('45000');
    await page.getByLabel('Khách yêu cầu / tình trạng xe').fill('Bảo dưỡng, thay lốp');
    await page.getByLabel('Ghi chú', { exact: true }).fill('Mai khách lấy');
    await page.getByLabel('Tên hạng mục dòng 1').fill('Bảo dưỡng định kỳ');
    await page.getByLabel('Đơn giá dòng 1').fill('450000');
    await page.getByRole('button', { name: 'Thêm phụ tùng' }).click();
    await page.getByLabel('Tên hạng mục dòng 2').fill('Lốp 225/55R19');
    await page.getByLabel('Số lượng dòng 2').fill('2');
    await page.getByLabel('Đơn giá dòng 2').fill('3200000');
    await page.getByLabel('Giảm giá dòng 2').fill('200000');
    await expect(page.getByTestId('draft-total')).toHaveText('6.650.000 đ');
    await page.getByTestId('create-order').click();

    await expect(page.getByTestId('order-code')).toHaveText(/^DH\d{6}$/);
    await expect(page.getByTestId('order-status')).toHaveText('Tiếp nhận');
    await expect(page.getByTestId('order-total')).toHaveText('6.650.000 đ');
    await expect(page.getByTestId('page-title')).toHaveText('Đơn đang xử lý');
    await expect(page.getByLabel('Ghi chú đơn')).toHaveValue('Mai khách lấy');

    // Thu một phần
    await page.getByTestId('collect').click();
    await page.getByLabel('Số tiền').fill('2000000');
    await page.getByLabel('Hình thức').selectOption({ label: 'Chuyển khoản' });
    await page.getByTestId('save-payment').click();
    await expect(page.getByTestId('due')).toHaveText('4.650.000 đ');

    // Sửa hạng mục: thêm công cân bằng động
    await page.getByTestId('edit-items').click();
    await page.getByRole('button', { name: 'Thêm dịch vụ' }).click();
    await page.getByLabel('Tên hạng mục dòng 3').fill('Cân bằng động');
    await page.getByLabel('Đơn giá dòng 3').fill('100000');
    await page.getByTestId('save-items').click();
    await expect(page.getByTestId('order-total')).toHaveText('6.750.000 đ');

    await page.getByTestId('to-DANG_SUA').click();
    await expect(page.getByTestId('order-status')).toHaveText('Đang sửa');
    await page.getByTestId('to-HOAN_THANH').click();
    await expect(page.getByTestId('order-status')).toHaveText('Hoàn thành');
    await page.getByTestId('to-DA_GIAO').click();
    await page.getByTestId('confirm-debt').click();
    await expect(page.getByTestId('order-status')).toHaveText('Đã giao xe');
    await expect(page.getByTestId('order-history')).toContainText('Ghi công nợ 4.750.000 đ');
    await expect(page.getByTestId('edit-items')).toHaveCount(0);

    // Hồ sơ khách: công nợ + lịch sử sửa chữa
    await page.getByRole('link', { name: /Anh Giao Diện Đơn/ }).click();
    await expect(page.getByTestId('customer-debt')).toContainText('4.750.000 đ');
    await page.getByRole('tab', { name: /Lịch sử sửa chữa/ }).click();
    await expect(page.getByTestId('order-history-list')).toContainText('Đã giao xe');

    // Đơn đã giao nằm ở "Đơn hoàn thành", tìm theo biển số
    await page.goto('/don-hoan-thanh');
    await page.getByLabel('Tìm đơn').fill(plate);
    await expect(page.getByTestId('order-row')).toHaveCount(1);
  });

  test('Kỹ thuật viên: thấy đơn nhưng không thấy tiền; nhận việc được, không tạo đơn', async ({ page, request }) => {
    // Chuẩn bị đơn qua API bằng tài khoản bán hàng
    const api = process.env.API_URL ?? 'http://localhost:4000';
    const token = (await (await request.post(`${api}/api/auth/login`, { data: { phone: PHONES.sales, password: 'Cardiy2026' } })).json()).accessToken as string;
    const h = { Authorization: `Bearer ${token}` };
    const branches = await (await request.get(`${api}/api/branches`, { headers: h })).json();
    const cn1 = branches.find((b: { code: string }) => b.code === 'CN1').id;
    const c = await (await request.post(`${api}/api/customers`, { headers: h, data: { name: 'Khách Của KTV', phone: randomPhone(), vehicle: { plate: randomPlate() } } })).json();
    const cd = await (await request.get(`${api}/api/customers/${c.id}`, { headers: h })).json();
    const o = await (await request.post(`${api}/api/orders`, { headers: h, data: { branchId: cn1, customerId: c.id, vehicleId: cd.vehicles[0].id, items: [{ kind: 'DICH_VU', name: 'Thay dầu', quantity: 1, unitPrice: 150000 }] } })).json();

    await loginUI(page, PHONES.tech);
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar.getByRole('link', { name: 'Bán hàng' })).toHaveCount(0);
    await sidebar.getByRole('link', { name: 'Đơn đang xử lý' }).click();
    await expect(page.getByTestId('order-table')).toBeVisible();
    await page.goto(`/don-hang/${o.id}`);
    await expect(page.getByTestId('order-code')).toHaveText(o.code);
    await expect(page.getByTestId('payment-card')).toHaveCount(0);
    await expect(page.getByTestId('item-table')).not.toContainText('150.000');
    await expect(page.getByTestId('edit-items')).toHaveCount(0);
    await page.getByTestId('to-DANG_SUA').click();
    await expect(page.getByTestId('order-status')).toHaveText('Đang sửa');
    await expect(page.getByTestId('to-DA_GIAO')).toHaveCount(0);
  });

  test('danh sách đơn lọc theo chi nhánh đang làm việc; chọn "Tất cả chi nhánh" thì thấy hết', async ({ page, request }) => {
    const api = process.env.API_URL ?? 'http://localhost:4000';
    const token = (await (await request.post(`${api}/api/auth/login`, { data: { phone: PHONES.owner, password: 'Cardiy2026' } })).json()).accessToken as string;
    const h = { Authorization: `Bearer ${token}` };
    const branches = await (await request.get(`${api}/api/branches`, { headers: h })).json();
    const cn2 = branches.find((b: { code: string }) => b.code === 'CN2');
    const plate = randomPlate();
    const c = await (await request.post(`${api}/api/customers`, { headers: h, data: { name: 'Khách Chi Nhánh Hai', phone: randomPhone(), vehicle: { plate } } })).json();
    const cd = await (await request.get(`${api}/api/customers/${c.id}`, { headers: h })).json();
    await request.post(`${api}/api/orders`, { headers: h, data: { branchId: cn2.id, customerId: c.id, vehicleId: cd.vehicles[0].id } });

    await loginUI(page, PHONES.owner);
    await page.getByTestId('branch-select').selectOption({ label: branches.find((b: { code: string }) => b.code === 'CN1').name });
    await page.goto('/don-dang-xu-ly');
    await page.getByLabel('Tìm đơn').fill(plate);
    await expect(page.getByTestId('order-table')).toContainText('Không có đơn khớp');
    await page.getByLabel('Lọc chi nhánh').selectOption({ label: 'Tất cả chi nhánh' });
    await expect(page.getByTestId('order-row')).toHaveCount(1);
    await page.getByLabel('Lọc chi nhánh').selectOption({ label: cn2.name });
    await expect(page.getByTestId('order-row')).toHaveCount(1);
  });

  test('in phiếu: cài tài khoản nhận tiền → hoá đơn có VietQR, số tiền bằng chữ; KTV chỉ in phiếu tiếp nhận', async ({ page, request }) => {
    await loginUI(page, PHONES.owner);
    await page.goto('/cai-dat');
    await page.getByRole('tab', { name: 'Mẫu in & thanh toán' }).click();
    await page.getByLabel('Ngân hàng').selectOption({ label: 'Vietcombank' });
    await page.getByLabel('Số tài khoản').fill('0123456789');
    await page.getByLabel('Chủ tài khoản').fill('GARAGE DEMO');
    await page.getByTestId('save-print-settings').click();
    await expect(page.getByText('Đã lưu')).toBeVisible();

    const api = process.env.API_URL ?? 'http://localhost:4000';
    const token = (await (await request.post(`${api}/api/auth/login`, { data: { phone: PHONES.sales, password: 'Cardiy2026' } })).json()).accessToken as string;
    const h = { Authorization: `Bearer ${token}` };
    const branches = await (await request.get(`${api}/api/branches`, { headers: h })).json();
    const cn1 = branches.find((b: { code: string }) => b.code === 'CN1').id;
    const c = await (await request.post(`${api}/api/customers`, { headers: h, data: { name: 'Khách In Phiếu', phone: randomPhone(), vehicle: { plate: randomPlate() } } })).json();
    const cd = await (await request.get(`${api}/api/customers/${c.id}`, { headers: h })).json();
    const o = await (await request.post(`${api}/api/orders`, { headers: h, data: { branchId: cn1, customerId: c.id, vehicleId: cd.vehicles[0].id, items: [{ kind: 'PHU_TUNG', name: 'Ắc quy GS 60Ah', quantity: 1, unitPrice: 1850000 }] } })).json();

    await page.goto(`/don-hang/${o.id}`);
    await expect(page.getByTestId('print-hoa-don')).toHaveAttribute('href', `/in/hoa-don/${o.id}`);
    await page.goto(`/in/hoa-don/${o.id}`);
    await expect(page.getByTestId('print-title')).toHaveText('HOÁ ĐƠN BÁN HÀNG');
    await expect(page.getByTestId('print-code')).toHaveText(o.code);
    await expect(page.getByTestId('print-words')).toContainText('Một triệu tám trăm năm mươi nghìn đồng');
    await expect(page.getByTestId('print-qr')).toContainText('Vietcombank');
    await expect(page.getByTestId('print-qr')).toContainText('1.850.000 đ');
    await page.getByRole('link', { name: 'Báo giá' }).click();
    await expect(page.getByTestId('print-title')).toHaveText('BẢNG BÁO GIÁ SỬA CHỮA');
    await expect(page.getByTestId('print-code')).toHaveText(`BG-${o.code}`);
    await expect(page.getByTestId('print-qr')).toHaveCount(0);

    // KTV: chỉ phiếu tiếp nhận, không có giá
    await page.context().clearCookies();
    await loginUI(page, PHONES.tech);
    await page.goto(`/in/tiep-nhan/${o.id}`);
    await expect(page.getByTestId('print-title')).toHaveText('PHIẾU TIẾP NHẬN XE');
    await expect(page.getByTestId('print-items')).toContainText('Ắc quy GS 60Ah');
    await expect(page.getByTestId('print-items')).not.toContainText('1.850.000');
    await expect(page.getByRole('link', { name: 'Hoá đơn' })).toHaveCount(0);
  });
});
