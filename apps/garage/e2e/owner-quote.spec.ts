import { devices, expect, test } from '@playwright/test';
import { loginUI, PHONES, randomPhone, randomPlate } from './helpers';

test.describe('App chủ xe 2.2', () => {
  test.skip(({ isMobile }) => isMobile, 'nhân viên trên máy tính; khách dùng ngữ cảnh điện thoại riêng');

  test('khách đặt lịch trên app → garage xác nhận; garage gửi báo giá → khách bỏ bớt hạng mục, đồng ý → đơn tự cập nhật', async ({ page, browser, request }) => {
    const api = process.env.API_URL ?? 'http://localhost:4000';
    const tok = (await (await request.post(`${api}/api/auth/login`, { data: { phone: PHONES.sales, password: 'Cardiy2026' } })).json()).accessToken as string;
    const h = { Authorization: `Bearer ${tok}` };
    const cn1 = (await (await request.get(`${api}/api/branches`, { headers: h })).json()).find((b: { code: string }) => b.code === 'CN1');
    const phone = randomPhone();
    const c = await (await request.post(`${api}/api/customers`, { headers: h, data: { name: 'Anh Đặt Lịch', phone, vehicle: { plate: randomPlate(), make: 'Ford', model: 'Ranger' } } })).json();
    const cd = await (await request.get(`${api}/api/customers/${c.id}`, { headers: h })).json();
    const inv = await (await request.post(`${api}/api/customers/${c.id}/app/invite`, { headers: h })).json();
    await request.post(`${api}/api/owner/auth/activate`, { data: { token: inv.url.split('/').pop(), password: 'Chuxe2026' } });

    // Khách đặt lịch ngày mai 9:00
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const m = await ctx.newPage();
    await m.goto('/app/dang-nhap');
    await m.getByLabel('Số điện thoại').fill(phone);
    await m.getByLabel('Mật khẩu').fill('Chuxe2026');
    await m.getByRole('button', { name: 'Đăng nhập' }).click();
    await m.getByTestId('book-cta').click();
    await m.getByRole('radio', { name: new RegExp(cn1.name) }).click();
    await m.getByRole('radio', { name: /Ngày mai/ }).click();
    await m.getByRole('radiogroup', { name: 'Chọn giờ' }).getByRole('radio', { name: '9:00', exact: true }).click();
    await m.getByRole('button', { name: 'Kiểm tra phanh' }).click();
    await m.getByTestId('submit-booking').click();
    await expect(m.getByTestId('booking-done')).toContainText('Đã gửi lịch hẹn LH');
    await m.getByRole('link', { name: 'Xem lịch hẹn của tôi' }).click();
    const card = m.getByTestId('booking-card').first();
    await expect(card.getByTestId('booking-status')).toHaveText('Chờ garage xác nhận');

    // Garage xác nhận lịch (kênh App)
    const bk = (
      await (
        await request.get(`${api}/api/owner/bookings`, {
          headers: { Authorization: `Bearer ${(await (await request.post(`${api}/api/owner/auth/login`, { data: { phone, password: 'Chuxe2026' } })).json()).accessToken}` },
        })
      ).json()
    )[0];
    await request.post(`${api}/api/bookings/${bk.id}/status`, { headers: h, data: { to: 'DA_XAC_NHAN' } });
    await m.reload();
    await expect(m.getByTestId('booking-card').first().getByTestId('booking-status')).toHaveText('Đã xác nhận');

    // Garage lập đơn và gửi báo giá trên CRM
    const o = await (
      await request.post(`${api}/api/orders`, {
        headers: h,
        data: {
          branchId: cn1.id,
          customerId: c.id,
          vehicleId: cd.vehicles[0].id,
          items: [
            { kind: 'PHU_TUNG', name: 'Má phanh trước', quantity: 1, unitPrice: 950000 },
            { kind: 'DICH_VU', name: 'Láng đĩa phanh', quantity: 1, unitPrice: 400000 },
          ],
        },
      })
    ).json();
    await loginUI(page, PHONES.sales);
    await page.goto(`/don-hang/${o.id}`);
    await page.getByLabel('Lời nhắn báo giá').fill('Má phanh mòn, đĩa có vết xước nhẹ');
    await page.getByTestId('send-quote').click();
    await expect(page.getByTestId('quote-status')).toHaveText('Chờ khách duyệt');

    // Khách duyệt: bỏ láng đĩa
    await m.goto('/app');
    await expect(m.getByTestId('open-order')).toContainText('báo giá');
    await m.getByTestId('open-order').click();
    const qa = m.getByTestId('quote-approval');
    await expect(qa).toContainText('Má phanh mòn, đĩa có vết xước nhẹ');
    await expect(m.getByTestId('quote-sum')).toHaveText('1.350.000 đ');
    await qa.getByLabel('Láng đĩa phanh').uncheck();
    await expect(m.getByTestId('quote-sum')).toHaveText('950.000 đ');
    await m.getByTestId('quote-approve').click();
    await expect(m.getByTestId('quote-answered')).toContainText('Bạn đã đồng ý 1/2 hạng mục');
    await expect(m.getByTestId('order-total')).toHaveText('950.000 đ');
    await ctx.close();

    // CRM thấy câu trả lời, đơn đã bỏ dòng bị từ chối
    await page.reload();
    await expect(page.getByTestId('quote-status')).toHaveText('Khách đồng ý một phần');
    await expect(page.getByTestId('order-total')).toHaveText('950.000 đ');
    await expect(page.getByTestId('quote-lines')).toContainText('Láng đĩa phanh');
  });
});
