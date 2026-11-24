import { devices, expect, test } from '@playwright/test';
import { loginUI, PHONES, randomPhone, randomPlate } from './helpers';

test.describe('Vòng 2.3: đánh giá, chuyển khoản, cài đặt Zalo', () => {
  test.skip(({ isMobile }) => isMobile, 'nhân viên trên máy tính; khách dùng ngữ cảnh điện thoại riêng');

  test.beforeEach(({ page }) => page.on('dialog', (d) => void d.accept()));

  test('khách thấy VietQR phần còn nợ, đánh giá 4 sao sau khi nhận xe; garage trả lời; trang Zalo hiện hướng dẫn kết nối', async ({ page, browser, request }) => {
    const api = process.env.API_URL ?? 'http://localhost:4000';
    const auth = async (phone: string) => ({ Authorization: `Bearer ${(await (await request.post(`${api}/api/auth/login`, { data: { phone, password: 'Cardiy2026' } })).json()).accessToken}` });
    const h = await auth(PHONES.sales);
    const oh = await auth(PHONES.owner);
    const cn1 = (await (await request.get(`${api}/api/branches`, { headers: h })).json()).find((b: { code: string }) => b.code === 'CN1');
    // Tài khoản nhận tiền của garage (dữ liệu giả)
    const { banks: _b, tenantName: _n, tenantTaxCode: _t, ...ps } = await (await request.get(`${api}/api/print-settings`, { headers: oh })).json();
    await request.put(`${api}/api/print-settings`, { headers: oh, data: { ...ps, bankBin: '970436', accountNo: '0123456789', accountName: 'GARAGE THU NGHIEM' } });

    const phone = randomPhone();
    const c = await (await request.post(`${api}/api/customers`, { headers: h, data: { name: 'Chị Đánh Giá', phone, vehicle: { plate: randomPlate() } } })).json();
    const cd = await (await request.get(`${api}/api/customers/${c.id}`, { headers: h })).json();
    const inv = await (await request.post(`${api}/api/customers/${c.id}/app/invite`, { headers: h })).json();
    await request.post(`${api}/api/owner/auth/activate`, { data: { token: inv.url.split('/').pop(), password: 'Chuxe2026' } });
    const o = await (
      await request.post(`${api}/api/orders`, {
        headers: h,
        data: { branchId: cn1.id, customerId: c.id, vehicleId: cd.vehicles[0].id, items: [{ kind: 'DICH_VU', name: 'Bảo dưỡng nhanh', quantity: 1, unitPrice: 700000 }] },
      })
    ).json();
    for (const to of ['DANG_SUA', 'HOAN_THANH']) await request.post(`${api}/api/orders/${o.id}/status`, { headers: h, data: { to } });
    await request.post(`${api}/api/orders/${o.id}/status`, { headers: h, data: { to: 'DA_GIAO', allowDebt: true } });

    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const m = await ctx.newPage();
    await m.goto('/app/dang-nhap');
    await m.getByLabel('Số điện thoại').fill(phone);
    await m.getByLabel('Mật khẩu').fill('Chuxe2026');
    await m.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(m.getByTestId('owner-name')).toHaveText('Chị Đánh Giá');
    await m.goto(`/app/don/${o.id}`);
    await expect(m.getByTestId('pay-amount')).toHaveText('700.000 đ');
    await expect(m.getByTestId('pay-card')).toContainText('0123456789');
    await expect(m.getByTestId('pay-card').getByRole('img', { name: 'Mã VietQR chuyển khoản' })).toBeVisible();
    await m.getByRole('radio', { name: '4 sao' }).click();
    await m.getByLabel('Nhận xét').fill('Nhân viên tư vấn kỹ');
    await m.getByTestId('submit-review').click();
    await expect(m.getByTestId('my-review')).toContainText('Nhân viên tư vấn kỹ');

    await loginUI(page, PHONES.sales);
    await page.goto(`/don-hang/${o.id}`);
    await expect(page.getByTestId('review-card')).toContainText('Nhân viên tư vấn kỹ');
    await page.getByLabel('Trả lời đánh giá').fill('Cảm ơn chị đã góp ý!');
    await page.getByTestId('save-reply').click();
    await expect(page.getByTestId('review-card')).toContainText('Garage trả lời: Cảm ơn chị đã góp ý!');
    await m.reload();
    await expect(m.getByTestId('my-review')).toContainText('Cảm ơn chị đã góp ý!');
    await m.getByRole('link', { name: 'Tài khoản' }).click();
    await expect(m.getByTestId('payment-history')).toBeVisible();
    await ctx.close();

    // Cài đặt Zalo (máy chủ test chưa có App ID → hiện hướng dẫn)
    await page.context().clearCookies();
    await loginUI(page, PHONES.owner);
    await page.goto('/cai-dat');
    await page.getByRole('tab', { name: 'Zalo' }).click();
    await expect(page.getByTestId('zalo-app')).toContainText('Chưa có ứng dụng Zalo');
    await page.getByLabel('App ID').fill('1234567890123');
    await page.getByLabel('Secret key').fill('khoa-bi-mat-thu-nghiem');
    await page.getByTestId('zalo-save-app').click();
    await expect(page.getByTestId('zalo-settings')).toContainText('Đã lưu ứng dụng Zalo');
    await expect(page.getByLabel('Secret key')).toHaveValue('');
    await expect(page.getByLabel('Secret key')).toHaveAttribute('placeholder', /Đã lưu/);
    await page.getByRole('button', { name: 'Xoá ứng dụng đã nhập' }).click();
    await expect(page.getByTestId('zalo-settings')).toContainText('Đã xoá ứng dụng Zalo');
    await expect(page.getByTestId('zalo-event-OTP')).toBeVisible();
    await expect(page.getByTestId('zalo-connection')).toContainText(/kết nối/);
  });
});
