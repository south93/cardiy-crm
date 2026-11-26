import { devices, expect, test } from '@playwright/test';
import { loginUI, PHONES, randomPhone, randomPlate } from './helpers';

const tag = `MKUI${Date.now().toString(36).toUpperCase()}`;

test('giao xe tích 55 điểm & lên Hạng Bạc -> chủ xe bật đồng ý nhận tin & xuất dữ liệu (A2.13) -> CSKH tạo phân khúc & phát hành chiến dịch (A3.62) -> chủ xe nhận thông báo (A2.12) -> đổi điểm tại quầy', async ({
  page,
  browser,
  request,
  isMobile,
}) => {
  test.skip(isMobile, 'luồng đa vai trò kiểm tra trên máy tính; giao diện điện thoại kiểm tra ở test riêng');

  const api = process.env.API_URL ?? 'http://localhost:4000';
  const salesTok = (await (await request.post(`${api}/api/auth/login`, { data: { phone: PHONES.sales, password: 'Cardiy2026' } })).json())
    .accessToken as string;
  const h = { Authorization: `Bearer ${salesTok}` };
  const cn1 = (await (await request.get(`${api}/api/branches`, { headers: h })).json()).find((b: { code: string }) => b.code === 'CN1');

  const custName = `Anh Hội Viên ${tag}`;
  const cust = await (
    await request.post(`${api}/api/customers`, {
      headers: h,
      data: { name: custName, phone: randomPhone(), vehicle: { plate: randomPlate(), make: 'Toyota', model: 'Fortuner', year: 2023 } },
    })
  ).json();
  const cd = await (await request.get(`${api}/api/customers/${cust.id}`, { headers: h })).json();

  const invite = await (await request.post(`${api}/api/customers/${cust.id}/app/invite`, { headers: h })).json();

  // 1. Chủ xe kích hoạt tài khoản App chủ xe trước khi giao xe để nhận thông báo cộng điểm tức thì
  const mobileCtx = await browser.newContext({ ...devices['iPhone 13'] });
  const m = await mobileCtx.newPage();
  await m.goto(new URL(invite.url).pathname);
  await m.getByLabel('Mật khẩu', { exact: true }).fill('Chuxe2026');
  await m.getByLabel('Nhập lại mật khẩu').fill('Chuxe2026');
  await m.getByTestId('activate').click();
  await expect(m).toHaveURL(/\/app$/);

  // Tạo đơn 5.500.000đ -> thu đủ -> giao xe (DA_GIAO) => tự động cộng +55 điểm & nâng lên Hạng Bạc + đẩy thông báo
  const ro = await (
    await request.post(`${api}/api/orders`, {
      headers: h,
      data: {
        branchId: cn1.id,
        customerId: cust.id,
        vehicleId: cd.vehicles[0].id,
        items: [{ kind: 'DICH_VU', name: 'Bảo dưỡng cấp 40.000km', quantity: 1, unitPrice: 5_500_000 }],
      },
    })
  ).json();
  await request.post(`${api}/api/orders/${ro.id}/status`, { headers: h, data: { to: 'DANG_SUA' } });
  await request.post(`${api}/api/orders/${ro.id}/status`, { headers: h, data: { to: 'HOAN_THANH' } });
  await request.post(`${api}/api/orders/${ro.id}/payments`, { headers: h, data: { amount: 5_500_000, method: 'TIEN_MAT' } });
  await request.post(`${api}/api/orders/${ro.id}/status`, { headers: h, data: { to: 'DA_GIAO' } });

  await m.reload();
  await expect(m.getByTestId('owner-notif-badge')).toBeVisible();

  await m.getByRole('link', { name: 'Tài khoản' }).click();
  await expect(m.getByTestId('owner-loyalty-card')).toContainText('55 điểm');
  await expect(m.getByTestId('owner-loyalty-card')).toContainText('Hạng Bạc');

  await m.getByTestId('owner-consent-toggle').check();
  await expect(m.getByTestId('owner-consent-toggle')).toBeChecked();

  await m.getByTestId('owner-export-data-btn').click();
  await expect(m.getByTestId('owner-export-done')).toBeVisible();

  // 2. CSKH đăng nhập vào Marketing (/marketing, A3.62): tạo phân khúc, xem trước, tạo & phát hành chiến dịch, sau đó đổi 15 điểm tại quầy
  const segName = `Hội viên Bạc ${tag}`;
  const campName = `Ưu đãi thay dầu ${tag}`;

  await loginUI(page, PHONES.cskh, 'Cardiy2026', '/marketing');
  await expect(page.getByTestId('garage-marketing-page')).toBeVisible();

  await page.getByTestId('segment-new-btn').click();
  await page.getByLabel('Tên phân khúc *').fill(segName);
  await page.getByLabel('Chi tiêu tối thiểu (đồng)').fill('5000000');
  await page.getByTestId('segment-preview-btn').click();
  await expect(page.getByTestId('segment-preview-box')).toContainText('đủ điều kiện nhận tin');
  await page.getByTestId('segment-save-btn').click();
  await expect(page.getByTestId('segment-card').filter({ hasText: segName })).toBeVisible();

  await page.getByRole('tab', { name: /Chiến dịch chăm sóc/ }).click();
  await page.getByTestId('campaign-new-btn').click();
  await page.getByLabel('Tên chiến dịch *').fill(campName);
  await page.getByLabel('Phân khúc khách hàng').selectOption({ label: await page.locator('option', { hasText: segName }).textContent() ?? '' });
  await page.getByTestId('campaign-save-btn').click();

  const campCard = page.getByTestId('campaign-card').filter({ hasText: campName });
  await expect(campCard).toBeVisible();
  await campCard.getByTestId('campaign-send-btn').click();
  await expect(page.getByTestId('campaign-delivery-modal')).toContainText(custName);
  await expect(page.getByTestId('campaign-delivery-modal')).toContainText('Đã gửi');
  await page.getByLabel('Đóng').click();

  // Đổi 15 điểm thưởng cho khách tại tab Tích điểm & Hạng thành viên
  await page.getByRole('tab', { name: /Tích điểm & Hạng thành viên/ }).click();
  await page.getByLabel('Tìm khách tích điểm').fill(custName);
  const custRow = page.getByTestId('loyalty-customer-row').filter({ hasText: custName });
  await expect(custRow).toContainText('55 điểm');
  await custRow.getByTestId('loyalty-open-adjust-btn').click();
  await page.getByLabel('Số điểm quy đổi *').fill('15');
  await page.getByLabel('Ghi chú giao dịch *').fill('Đổi 15 điểm tặng nước rửa kính');
  await page.getByTestId('loyalty-adjust-submit').click();
  await expect(custRow).toContainText('40 điểm');

  await page.getByTestId('user-menu').click();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/dang-nhap/);

  // 3. Admin sàn mở Mẫu tin & Chiến dịch (/san/thong-bao, A6.63) thấy mẫu tin chuẩn
  await loginUI(page, PHONES.owner);
  await page.getByTestId('user-menu').click();
  await page.getByRole('menuitem', { name: /Sàn CARDIY/ }).click();
  await page.getByTestId('sidebar').getByRole('link', { name: 'Mẫu tin & Chiến dịch' }).click();
  await expect(page).toHaveURL(/\/san\/thong-bao$/);
  await expect(page.getByTestId('platform-templates-list')).toContainText('TPL_BAO_DUONG_DINH_KY');

  // 4. Chủ xe mở hộp thư /app/thong-bao: thấy cả thông báo chiến dịch & thông báo đổi điểm
  await m.goto('/app/thong-bao');
  await expect(m.getByTestId('owner-notifications-list')).toContainText(custName);
  await expect(m.getByTestId('owner-notifications-list')).toContainText('Đổi 15 điểm ưu đãi');
  await m.getByTestId('owner-mark-read-btn').click();
  await expect(m.getByTestId('owner-mark-read-btn')).toBeHidden();
  await mobileCtx.close();
});

test('điện thoại: nhân viên CSKH mở phân hệ Marketing và tra cứu sổ điểm thưởng khách hàng', async ({ page }) => {
  await loginUI(page, PHONES.cskh, 'Cardiy2026', '/marketing');
  await expect(page.getByTestId('garage-marketing-page')).toBeVisible();
  await page.getByRole('tab', { name: /Tích điểm & Hạng thành viên/ }).click();
  await expect(page.getByTestId('loyalty-customers-table')).toBeVisible();
});
