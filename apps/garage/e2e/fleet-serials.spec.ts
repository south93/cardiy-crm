import { expect, test } from '@playwright/test';
import { loginUI, PHONES, randomPhone, randomPlate } from './helpers';

test.describe('Nhắc lịch tự động, Bảo dưỡng Km/Thời gian & Sê-ri Bảo hành', () => {
  test.skip(({ isMobile }) => isMobile, 'kiểm thử luồng quản trị trên màn hình máy tính');

  test('cấu hình SMS & định mức bảo dưỡng trong Cài đặt, theo dõi km bảo dưỡng xe, quản lý & tra cứu bảo hành Sê-ri', async ({
    page,
    request,
  }) => {
    const api = process.env.API_URL ?? 'http://localhost:4000';
    const token = (
      await (await request.post(`${api}/api/auth/login`, { data: { phone: PHONES.owner, password: 'Cardiy2026' } })).json()
    ).accessToken as string;

    const tag = Math.random().toString(36).slice(2, 7).toUpperCase();
    const plate = randomPlate();
    const badgeExp = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);

    // Tạo sẵn khách + xe có phù hiệu xe sắp hết hạn
    const custRes = await (
      await request.post(`${api}/api/customers`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          name: `Khách Sê-ri ${tag}`,
          phone: randomPhone(),
          vehicle: {
            plate,
            make: 'Toyota',
            model: 'Fortuner',
            odometerKm: 30000,
            badgeNo: `PH-${tag}`,
            badgeType: 'XE_HOP_DONG',
            badgeExpiry: badgeExp,
          },
        },
      })
    ).json();
    const custDetail = await (
      await request.get(`${api}/api/customers/${custRes.id}`, { headers: { Authorization: `Bearer ${token}` } })
    ).json();
    const vehicleId = custDetail.vehicles[0].id as string;
    const formattedPlate = custDetail.vehicles[0].plate as string;

    await loginUI(page, PHONES.owner);

    // 1. Kiểm tra Cài đặt: Tab Chăm sóc khách (tự động nhắc + định mức) & Tab SMS Brandname
    await page.goto('/cai-dat');
    await page.getByRole('tab', { name: 'Chăm sóc khách' }).click();
    await expect(page.getByTestId('auto-reminder-settings')).toBeVisible();
    await expect(page.getByLabel('Bật Thay dầu nhớt động cơ')).toBeChecked();
    await page.getByTestId('save-maintenance-rules').click();
    await expect(page.getByTestId('maintenance-rules-card')).toContainText('Đã lưu bảng định mức bảo dưỡng');

    await page.getByRole('tab', { name: 'SMS Brandname' }).click();
    await expect(page.getByTestId('sms-settings')).toContainText('Cổng tin nhắn SMS Brandname');
    await page.getByTestId('sms-save').click();
    await expect(page.getByTestId('sms-settings')).toContainText('Đã lưu cấu hình cổng SMS Brandname');

    // 2. Hồ sơ xe (/xe/[id]): thấy Phù hiệu xe, ghi nhận thay dầu nhớt ở 30.000 km -> cập nhật đồng hồ 34.600 km -> thấy Đã chạy 4.600 km
    await page.goto(`/xe/${vehicleId}`);
    await expect(page.getByTestId('vehicle-detail')).toContainText(`PH-${tag}`);
    await page.getByTestId('add-maint-item').click();
    await page.getByTestId('save-maint-item').click();
    await expect(page.getByTestId('vehicle-maintenance-panel')).toContainText('Thay dầu nhớt động cơ');

    await page.getByTestId('add-km').click();
    await page.getByLabel('Số km trên đồng hồ').fill('34600');
    await page.getByTestId('save-km').click();
    await expect(page.getByTestId('maint-km-driven')).toContainText('4.600 km');
    await expect(page.getByTestId('vehicle-maintenance-panel')).toContainText('Sắp đến kỳ nhắc');

    // 3. Đăng ký Sê-ri Lốp trực tiếp trên xe & sang trang /seri-bao-hanh tra cứu bảo hành theo Biển số và Số Sê-ri
    const serialNo = `MICH-${tag}-88`;
    await page.getByTestId('vehicle-add-serial').click();
    await page.getByTestId('serial-no-input').fill(serialNo);
    await page.getByTestId('serial-product-input').fill('Lốp Michelin Primacy SUV+ 265/60R18');
    await page.getByTestId('save-serial-btn').click();
    await expect(page.getByTestId('vehicle-serials-panel')).toContainText(serialNo);
    await expect(page.getByTestId('vehicle-serials-panel')).toContainText('Còn bảo hành');

    await page.getByTestId('sidebar').getByRole('link', { name: 'Sê-ri & Bảo hành' }).click();
    await expect(page).toHaveURL(/\/seri-bao-hanh$/);
    await page.getByTestId('serial-warranty-lookup-input').fill(formattedPlate);
    await page.getByTestId('serial-warranty-lookup-btn').click();
    await expect(page.getByTestId('warranty-lookup-results')).toContainText(serialNo);
    await expect(page.getByTestId('warranty-lookup-results')).toContainText('Lắp mới lên xe');
  });
});
