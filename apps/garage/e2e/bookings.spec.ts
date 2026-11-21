import { expect, test } from '@playwright/test';
import { loginUI, PHONES, randomPhone } from './helpers';

const randomPlate = () => `61K${String(Math.floor(10000 + Math.random() * 89999))}`;
const fmt = (p: string) => `${p.slice(0, 3)}-${p.slice(3, 6)}.${p.slice(6)}`;

test.describe('Lịch hẹn', () => {
  test.skip(({ isMobile }) => isMobile, 'lịch làm trên máy tính');

  test('đặt lịch ngày mai → xác nhận → khách đến nhận xe → mở đơn tiếp nhận', async ({ page, request }) => {
    const api = process.env.API_URL ?? 'http://localhost:4000';
    const token = (await (await request.post(`${api}/api/auth/login`, { data: { phone: PHONES.owner, password: 'Cardiy2026' } })).json()).accessToken as string;
    const plate = randomPlate();
    await request.post(`${api}/api/customers`, { headers: { Authorization: `Bearer ${token}` }, data: { name: 'Khách Đặt Lịch UI', phone: randomPhone(), vehicle: { plate } } });

    await loginUI(page, PHONES.owner);
    await page.getByTestId('branch-select').selectOption({ index: 0 });
    await page.getByTestId('sidebar').getByRole('link', { name: 'Lịch sửa chữa' }).click();
    await expect(page.getByTestId('week-view')).toBeVisible();
    await page.getByRole('tab', { name: 'Ngày' }).click();
    await page.getByRole('button', { name: 'Sau' }).click();

    await page.getByTestId('add-booking').click();
    await page.getByLabel('Tìm khách hoặc xe').fill(plate);
    await page.getByTestId('picker-results').getByText(fmt(plate)).click();
    const t = new Date();
    t.setDate(t.getDate() + 1);
    const ymd = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    await page.getByLabel('Ngày giờ hẹn').fill(`${ymd}T10:00`);
    await page.getByLabel('Thời gian dự kiến').selectOption({ label: '2 giờ' });
    await page.getByLabel('Kênh đặt').selectOption({ label: 'Zalo' });
    await page.getByLabel('Khách cần làm gì').fill('Bảo dưỡng 20.000 km');
    await page.getByTestId('save-booking').click();

    const card = page.getByTestId('day-view').getByTestId('booking-card').filter({ hasText: fmt(plate) });
    await expect(card).toContainText('10:00');
    await expect(card).toContainText('Chờ xác nhận');
    await card.click();
    await page.getByTestId('confirm-booking').click();
    await expect(page.getByTestId('booking-detail')).toContainText('Đã xác nhận');
    await page.getByTestId('checkin').click();
    await page.getByLabel('Số km lúc nhận xe').fill('20500');
    await page.getByTestId('confirm-checkin').click();

    await expect(page.getByTestId('order-code')).toHaveText(/^DH\d{6}$/);
    await expect(page.getByTestId('order-detail')).toContainText('Bảo dưỡng 20.000 km');
    await expect(page.getByTestId('order-detail')).toContainText('20.500 km');
  });
});
