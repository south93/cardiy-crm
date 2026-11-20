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
});
