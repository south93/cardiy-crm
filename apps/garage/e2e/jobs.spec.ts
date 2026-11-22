import { expect, test } from '@playwright/test';
import { loginUI, PHONES, randomPhone } from './helpers';

const randomPlate = () => `61E${String(Math.floor(10000 + Math.random() * 89999))}`;

test.describe('App kỹ thuật viên', () => {
  test('KTV: nhận việc → bắt đầu sửa → nhập phiếu kiểm tra trên điện thoại → hoàn tất → bản in có kết quả', async ({ page, request }) => {
    const api = process.env.API_URL ?? 'http://localhost:4000';
    const tok = (await (await request.post(`${api}/api/auth/login`, { data: { phone: PHONES.sales, password: 'Cardiy2026' } })).json()).accessToken as string;
    const h = { Authorization: `Bearer ${tok}` };
    const cn1 = (await (await request.get(`${api}/api/branches`, { headers: h })).json()).find((b: { code: string }) => b.code === 'CN1');
    const plate = randomPlate();
    const c = await (await request.post(`${api}/api/customers`, { headers: h, data: { name: 'Khách Xe KTV', phone: randomPhone(), vehicle: { plate } } })).json();
    const cd = await (await request.get(`${api}/api/customers/${c.id}`, { headers: h })).json();
    const o = await (
      await request.post(`${api}/api/orders`, {
        headers: h,
        data: { branchId: cn1.id, customerId: c.id, vehicleId: cd.vehicles[0].id, request: 'Xe kêu gầm bên phải', items: [{ kind: 'DICH_VU', name: 'Kiểm tra gầm', quantity: 1, unitPrice: 200000 }] },
      })
    ).json();

    await loginUI(page, PHONES.tech);
    await expect(page).toHaveURL(/\/viec-cua-toi$/);
    await page.getByRole('tab', { name: /Chưa có người nhận/ }).click();
    await page.getByLabel('Tìm xe').fill(o.code);
    const card = page.getByTestId('job-card').filter({ hasText: o.code });
    await expect(card).toContainText('Xe kêu gầm bên phải');
    await card.getByTestId('claim').click();
    await expect(card).toHaveCount(0);

    await page.getByRole('tab', { name: /Việc của tôi/ }).click();
    const mine = page.getByTestId('job-card').filter({ hasText: o.code });
    await expect(mine.getByTestId('job-inspection')).toHaveText(/Chưa kiểm tra/);
    await mine.getByTestId('start').click();
    await expect(mine).toContainText('Đang sửa');
    await mine.getByTestId('open-inspection').click();

    await expect(page.getByTestId('inspection-state')).toHaveText(/Chưa kiểm tra/);
    await page.getByRole('button', { name: 'Má phanh: Chú ý', exact: true }).click();
    await page.getByTestId('safety').getByRole('button', { name: 'Còn lại đều tốt', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Dầu động cơ: Tốt', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Má phanh: Chú ý', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Gầm trước Rotuyn lái ngoài phải: Thay thế', exact: true }).click();
    await page.getByLabel('Áp suất lốp Trước trái').fill('2,3');
    await page.getByLabel('Khuyến nghị').fill('Thay rotuyn lái ngoài bên phải');
    await expect(page.getByTestId('inspection-summary')).toContainText('1 chú ý');
    await expect(page.getByTestId('inspection-summary')).toContainText('1 cần thay');
    await page.getByTestId('complete-inspection').click();
    await expect(page.getByTestId('inspection-state')).toHaveText(/Đã hoàn tất/);

    await page.goto('/viec-cua-toi');
    await page.getByLabel('Tìm xe').fill(o.code);
    await expect(page.getByTestId('job-card').filter({ hasText: o.code }).getByTestId('job-inspection')).toHaveText(/Đã kiểm tra.*1 chú ý.*1 cần thay/);

    await page.goto(`/in/kiem-tra/${o.id}`);
    await expect(page.getByTestId('print-recommendation')).toHaveText('Thay rotuyn lái ngoài bên phải');
    // 13 hạng mục an toàn đã tick + 1 ô gầm + ô áp suất không phải ô tick
    await expect(page.getByTestId('print-sheet').locator('[data-on="1"]')).toHaveCount(14);
  });
});
