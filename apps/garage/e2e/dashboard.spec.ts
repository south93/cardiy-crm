import { expect, test } from '@playwright/test';
import { loginUI, PHONES, randomPhone } from './helpers';

test.describe('Tổng quan', () => {
  test.skip(({ isMobile }) => isMobile, 'làm trên máy tính');

  test('chủ garage thấy số liệu thật: đơn giao hôm nay vào doanh thu và hạng mục bán chạy', async ({ page, request }) => {
    const api = process.env.API_URL ?? 'http://localhost:4000';
    const tok = (await (await request.post(`${api}/api/auth/login`, { data: { phone: PHONES.sales, password: 'Cardiy2026' } })).json()).accessToken as string;
    const h = { Authorization: `Bearer ${tok}` };
    const cn1 = (await (await request.get(`${api}/api/branches`, { headers: h })).json()).find((b: { code: string }) => b.code === 'CN1');
    const c = await (await request.post(`${api}/api/customers`, { headers: h, data: { name: 'Khách Tổng Quan', phone: randomPhone() } })).json();
    const owner = (await (await request.post(`${api}/api/auth/login`, { data: { phone: PHONES.owner, password: 'Cardiy2026' } })).json()).accessToken as string;
    const top = (await (await request.get(`${api}/api/dashboard`, { headers: { Authorization: `Bearer ${owner}` } })).json()).top as { revenue: number }[];
    const price = Math.max(50_000_000_000, (top[0]?.revenue ?? 0) + 1_000_000_000);
    const item = `Gói chăm sóc đặc biệt ${Math.random().toString(36).slice(2, 6)}`;
    const o = await (
      await request.post(`${api}/api/orders`, { headers: h, data: { branchId: cn1.id, customerId: c.id, items: [{ kind: 'DICH_VU', name: item, quantity: 1, unitPrice: price }] } })
    ).json();
    for (const to of ['DANG_SUA', 'HOAN_THANH']) await request.post(`${api}/api/orders/${o.id}/status`, { headers: h, data: { to } });
    await request.post(`${api}/api/orders/${o.id}/status`, { headers: h, data: { to: 'DA_GIAO', allowDebt: true } });

    await loginUI(page, PHONES.owner);
    await expect(page.getByTestId('kpi-month')).toContainText('tỷ');
    await expect(page.getByTestId('kpi-debt')).toContainText('tỷ');
    await expect(page.getByTestId('top-items').locator('li').first()).toContainText(item);
    await expect(page.getByTestId('revenue-chart')).toBeVisible();
    await expect(page.getByTestId('ops-strip')).toContainText('Xe trong xưởng');
  });
});
