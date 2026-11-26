import { devices, expect, test } from '@playwright/test';
import { loginUI, PHONES, randomPhone, randomPlate } from './helpers';

const ymd = (d: Date) => d.toISOString().slice(0, 10);

test.describe('App chủ xe', () => {
  test.skip(({ isMobile }) => isMobile, 'nhân viên làm trên máy tính; phần chủ xe mở bằng ngữ cảnh điện thoại riêng');

  test('nhân viên mời → khách kích hoạt trên điện thoại → xem xe, nhắc hạn, lịch sử, đơn đang sửa → đăng xuất / đăng nhập lại', async ({ page, browser, request }) => {
    const api = process.env.API_URL ?? 'http://localhost:4000';
    const tok = (await (await request.post(`${api}/api/auth/login`, { data: { phone: PHONES.sales, password: 'Cardiy2026' } })).json()).accessToken as string;
    const h = { Authorization: `Bearer ${tok}` };
    const cn1 = (await (await request.get(`${api}/api/branches`, { headers: h })).json()).find((b: { code: string }) => b.code === 'CN1');
    const phone = randomPhone();
    const plate = randomPlate();
    const reg = new Date(Date.now() + 20 * 86_400_000);
    const c = await (
      await request.post(`${api}/api/customers`, { headers: h, data: { name: 'Chị Chủ Xe', phone, vehicle: { plate, make: 'Mazda', model: 'CX-5', registrationExpiry: ymd(reg) } } })
    ).json();
    const cd = await (await request.get(`${api}/api/customers/${c.id}`, { headers: h })).json();
    const vehicleId = cd.vehicles[0].id;
    const mk = async (name: string, price: number) =>
      (await (
        await request.post(`${api}/api/orders`, { headers: h, data: { branchId: cn1.id, customerId: c.id, vehicleId, items: [{ kind: 'DICH_VU', name, quantity: 1, unitPrice: price }] } })
      ).json()) as { id: string; code: string };
    const done = await mk('Thay dầu máy', 650000);
    for (const to of ['DANG_SUA', 'HOAN_THANH']) await request.post(`${api}/api/orders/${done.id}/status`, { headers: h, data: { to } });
    await request.post(`${api}/api/orders/${done.id}/status`, { headers: h, data: { to: 'DA_GIAO', allowDebt: true } });
    const open = await mk('Kiểm tra điều hoà', 300000);
    await request.post(`${api}/api/orders/${open.id}/status`, { headers: h, data: { to: 'DANG_SUA' } });

    // Nhân viên tạo link mời trên hồ sơ khách
    await loginUI(page, PHONES.sales);
    await page.goto(`/khach-hang/${c.id}`);
    await page.getByTestId('app-invite').click();
    const url = (await page.getByTestId('invite-url').textContent())!;
    expect(url).toMatch(/\/app\/kich-hoat\//);

    // Khách mở link trên điện thoại
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const m = await ctx.newPage();
    await m.goto(new URL(url).pathname);
    await expect(m.getByTestId('invite-name')).toHaveText('Chị Chủ Xe');
    await m.getByLabel('Mật khẩu', { exact: true }).fill('Chuxe2026');
    await m.getByLabel('Nhập lại mật khẩu').fill('Chuxe2026');
    await m.getByTestId('activate').click();
    await expect(m).toHaveURL(/\/app$/);
    await expect(m.getByTestId('owner-name')).toHaveText('Chị Chủ Xe');
    const card = m.getByTestId('owner-vehicles').locator('li').filter({ hasText: 'Mazda' });
    await expect(card.getByTestId('open-order')).toContainText('Đang sửa');
    await expect(card.getByTestId('reminders')).toContainText('Đăng kiểm hết hạn');

    await card.getByTestId('vehicle-card').click();
    await expect(m.getByTestId('service-history')).toContainText(done.code);
    await m.getByLabel('Số km mới').fill('25000');
    await m.getByRole('button', { name: 'Cập nhật' }).click();
    await expect(m.getByTestId('vehicle-km')).toHaveText('25.000 km');
    await m.getByTestId('service-history').getByText(done.code, { exact: false }).click();
    await expect(m.getByTestId('order-status')).toHaveText('Đã giao xe');
    await expect(m.getByTestId('order-total')).toHaveText('650.000 đ');

    await m.getByRole('link', { name: 'Tài khoản' }).click();
    await m.getByTestId('owner-logout').click();
    await expect(m).toHaveURL(/\/app\/dang-nhap/);
    await m.goto('/app');
    await expect(m).toHaveURL(/\/app\/dang-nhap/);
    await m.getByLabel('Số điện thoại').fill(phone);
    await m.getByLabel('Mật khẩu').fill('Chuxe2026');
    await m.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(m.getByTestId('owner-name')).toHaveText('Chị Chủ Xe');
    await ctx.close();

    // Nhân viên thấy khách đã kích hoạt
    await page.reload();
    await expect(page.getByTestId('customer-app')).toContainText('Đã kích hoạt');
  });
});
