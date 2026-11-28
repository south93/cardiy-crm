import { expect, test } from '@playwright/test';
import { loginUI, PHONES, randomPhone, randomPlate } from './helpers';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('Hiện trạng tiếp nhận & Hình ảnh 2 đầu lệnh sửa chữa', () => {
  test.skip(({ isMobile }) => isMobile, 'kiểm thử luồng tổng hợp 3 vai trò thực hiện trên máy tính');

  test('CVDV ghi hiện trạng & chụp ảnh lúc tiếp nhận → KTV đối chiếu & chụp ảnh hoàn tất dịch vụ → Chủ xe xem trên App', async ({
    page,
    request,
  }) => {
    const api = process.env.API_URL ?? 'http://localhost:4000';
    const plate = randomPlate();
    const custPhone = randomPhone();

    // 1. Cố vấn dịch vụ (BH) vào Tiếp nhận & Bán hàng -> ghi nhận hiện trạng + tải ảnh tiếp nhận
    await loginUI(page, PHONES.sales);
    await page.getByTestId('sidebar').getByRole('link', { name: 'Tiếp nhận & Bán hàng' }).click();

    await page.getByRole('button', { name: 'Khách mới' }).click();
    const form = page.locator('#customer-form');
    await form.getByLabel('Họ tên / cách gọi').fill('Chị Minh Bạch Ảnh Xe');
    await form.getByLabel('Số điện thoại', { exact: true }).fill(custPhone);
    await form.getByLabel('Biển số').fill(plate);
    await form.getByLabel('Số km hiện tại').fill('32000');
    await form.getByRole('button', { name: 'Thêm khách và chọn' }).click();
    await expect(page.getByTestId('picked-customer')).toContainText('Chị Minh Bạch Ảnh Xe');

    await page.getByLabel('Số km lúc nhận xe').fill('32500');
    await page.getByLabel('Khách yêu cầu / tình trạng xe').fill('Bảo dưỡng cấp trung, kiểm tra phanh');

    // Điền hiện trạng xe ban đầu & tải ảnh lúc nhận xe
    await expect(page.getByTestId('intake-draft-card')).toBeVisible();
    await page.getByRole('button', { name: '1/2 bình', exact: true }).click();
    await page.getByRole('button', { name: 'Check Engine (Cá vàng)', exact: true }).click();
    await page.getByRole('button', { name: 'Đầy đủ', exact: true }).click();
    await page.getByLabel('Hiện trạng ngoại thất ban đầu').fill('Xước nhẹ cản trước bên phụ');
    await page.getByLabel('Tư trang để lại trên xe').fill('Camera hành trình, thẻ ETC');
    await page.getByTestId('intake-draft-file-input').setInputFiles({
      name: 'can-truoc-tiep-nhan.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(page.getByTestId('intake-draft-photo-grid')).toBeVisible();

    await page.getByLabel('Tên hạng mục dòng 1').fill('Bảo dưỡng 30.000 km & vệ sinh phanh');
    await page.getByLabel('Đơn giá dòng 1').fill('850000');
    await page.getByTestId('create-order').click();

    // Mở chi tiết đơn: thấy đầy đủ hiện trạng & ảnh tiếp nhận
    await expect(page.getByTestId('order-code')).toHaveText(/^DH\d{6}$/);
    const orderCode = (await page.getByTestId('order-code').textContent())!.trim();
    const orderId = page.url().split('/don-hang/')[1]!;
    await expect(page.getByTestId('intake-summary')).toContainText('1/2 bình');
    await expect(page.getByTestId('intake-summary')).toContainText('Check Engine (Cá vàng)');
    await expect(page.getByTestId('intake-summary')).toContainText('Xước nhẹ cản trước bên phụ');
    await expect(page.getByTestId('order-intake-photos-item')).toHaveCount(1);

    // Lấy customerId để cuối luồng mời chủ xe xem App
    const salesTok = (
      await (await request.post(`${api}/api/auth/login`, { data: { phone: PHONES.sales, password: 'Cardiy2026' } })).json()
    ).accessToken as string;
    const orderJson = await (
      await request.get(`${api}/api/orders/${orderId}`, { headers: { Authorization: `Bearer ${salesTok}` } })
    ).json();
    const customerId = orderJson.customer.id as string;

    // 2. Kỹ thuật viên (KTV) đăng nhập -> nhận việc -> xem đối chiếu hiện trạng & tải ảnh hoàn tất dịch vụ
    await page.context().clearCookies();
    await loginUI(page, PHONES.tech);
    await page.getByRole('tab', { name: /Chưa có người nhận/ }).click();
    await page.getByLabel('Tìm xe').fill(orderCode);
    const jobCard = page.getByTestId('job-card').filter({ hasText: orderCode });
    await jobCard.getByTestId('claim').click();

    await page.getByRole('tab', { name: /Việc của tôi/ }).click();
    const myCard = page.getByTestId('job-card').filter({ hasText: orderCode });
    await myCard.getByTestId('start').click();
    await myCard.getByTestId('open-inspection').click();

    // KTV thấy rõ hiện trạng & ảnh tiếp nhận ban đầu của CVDV để đối chiếu
    await expect(page.getByTestId('tech-intake-reference')).toContainText('Xước nhẹ cản trước bên phụ');
    await expect(page.getByTestId('tech-intake-photos-item')).toHaveCount(1);

    // KTV tải ảnh kiểm tra phát sinh & ảnh sau khi hoàn tất dịch vụ
    await page.getByTestId('tech-check-file-input').setInputFiles({
      name: 'ma-phanh-mon.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(page.getByTestId('tech-check-photos-item')).toHaveCount(1);

    await page.getByTestId('tech-done-file-input').setInputFiles({
      name: 'hoan-tat-khoang-may.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(page.getByTestId('tech-completion-photos-item')).toHaveCount(1);
    await page.getByTestId('complete-inspection').click();
    await expect(page.getByTestId('inspection-state')).toHaveText(/Đã hoàn tất/);

    await page.goto(`/don-hang/${orderId}`);
    await expect(page.getByTestId('order-completion-photos-item')).toHaveCount(1);
    await page.getByTestId('to-HOAN_THANH').click();
    await expect(page.getByTestId('order-status')).toHaveText('Hoàn thành');

    // 3. Chủ xe mở App (/app/don/[id]) thấy minh bạch cả hiện trạng ban đầu lẫn ảnh hoàn tất của KTV
    const invite = await (
      await request.post(`${api}/api/customers/${customerId}/app/invite`, {
        headers: { Authorization: `Bearer ${salesTok}` },
      })
    ).json();
    await page.context().clearCookies();
    await page.goto(new URL(invite.url).pathname);
    await page.getByLabel('Mật khẩu', { exact: true }).fill('Chuxe2026');
    await page.getByLabel('Nhập lại mật khẩu').fill('Chuxe2026');
    await page.getByTestId('activate').click();
    await expect(page).toHaveURL(/\/app$/);

    await page.goto(`/app/don/${orderId}`);
    await expect(page.getByTestId('owner-order-media')).toContainText('Xước nhẹ cản trước bên phụ');
    await expect(page.getByTestId('owner-photos-tiep_nhan-item')).toHaveCount(1);
    await expect(page.getByTestId('owner-photos-kiem_tra-item')).toHaveCount(1);
    await expect(page.getByTestId('owner-photos-hoan_tat-item')).toHaveCount(1);
  });
});
