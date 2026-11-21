import { expect, test } from '@playwright/test';
import { loginUI, PHONES, randomPhone } from './helpers';

const randomPlate = () => `61K${String(Math.floor(10000 + Math.random() * 89999))}`;

test.describe('Lịch gọi', () => {
  test.skip(({ isMobile }) => isMobile, 'làm trên máy tính');

  test('CSKH: xe sắp hết đăng kiểm → hẹn gọi lại → sang "Sắp tới" → đặt lịch từ cuộc gọi → "Đã xử lý"; hồ sơ khách có lịch sử', async ({ page, request }) => {
    const api = process.env.API_URL ?? 'http://localhost:4000';
    const token = (await (await request.post(`${api}/api/auth/login`, { data: { phone: PHONES.owner, password: 'Cardiy2026' } })).json()).accessToken as string;
    const name = `Khách Gọi ${Math.random().toString(36).slice(2, 6)}`;
    const exp = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const c = await (await request.post(`${api}/api/customers`, { headers: { Authorization: `Bearer ${token}` }, data: { name, phone: randomPhone(), vehicle: { plate: randomPlate(), registrationExpiry: exp } } })).json();

    await loginUI(page, PHONES.cskh);
    await page.getByTestId('sidebar').getByRole('link', { name: 'Lịch gọi' }).click();
    await page.getByRole('button', { name: 'Làm mới' }).click();
    await page.getByLabel('Tìm khách').fill(name);
    const row = page.getByTestId('care-row').filter({ hasText: name });
    await expect(row).toContainText('Đăng kiểm');
    await row.getByTestId('log-call').click();
    await page.getByRole('radio', { name: /Hẹn gọi lại/ }).click();
    await page.getByLabel('Ghi chú cuộc gọi').fill('Khách đang đi xa');
    await page.getByTestId('save-call').click();
    await expect(page.getByTestId('care-row').filter({ hasText: name })).toHaveCount(0);

    await page.getByRole('tab', { name: /Sắp tới/ }).click();
    const later = page.getByTestId('care-row').filter({ hasText: name });
    await expect(later).toContainText('Khách đang đi xa');
    await later.getByTestId('log-call').click();
    await page.getByRole('radio', { name: /Khách đặt lịch/ }).click();
    await page.getByTestId('save-call').click();
    await expect(page.getByTestId('new-booking')).toContainText(name);
    await page.getByTestId('save-booking').click();
    await expect(page.getByTestId('care-row').filter({ hasText: name })).toHaveCount(0);

    await page.getByRole('tab', { name: 'Đã xử lý' }).click();
    await expect(page.getByTestId('care-row').filter({ hasText: name })).toContainText('Khách đặt lịch');

    await page.goto(`/khach-hang/${c.id}`);
    await expect(page.getByTestId('care-history')).toContainText('Khách đặt lịch');
    await expect(page.getByTestId('care-history')).toContainText('Khách đang đi xa');
  });
});
