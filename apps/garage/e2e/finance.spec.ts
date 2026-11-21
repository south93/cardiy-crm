import { expect, test } from '@playwright/test';
import { loginUI, PHONES, randomPhone } from './helpers';

test.describe('Thu chi & công nợ', () => {
  test.skip(({ isMobile }) => isMobile, 'làm trên máy tính');

  test('kế toán: lập phiếu chi → sổ quỹ; khách nợ đơn → thu nợ → hết nợ', async ({ page, request }) => {
    const api = process.env.API_URL ?? 'http://localhost:4000';
    const tok = (await (await request.post(`${api}/api/auth/login`, { data: { phone: PHONES.sales, password: 'Cardiy2026' } })).json()).accessToken as string;
    const h = { Authorization: `Bearer ${tok}` };
    const branches = await (await request.get(`${api}/api/branches`, { headers: h })).json();
    const cn1 = branches.find((b: { code: string }) => b.code === 'CN1');
    const name = `Khách Nợ ${Math.random().toString(36).slice(2, 6)}`;
    const c = await (await request.post(`${api}/api/customers`, { headers: h, data: { name, phone: randomPhone() } })).json();
    const o = await (await request.post(`${api}/api/orders`, { headers: h, data: { branchId: cn1.id, customerId: c.id, items: [{ kind: 'PHU_TUNG', name: 'Ắc quy', quantity: 1, unitPrice: 1_850_000 }] } })).json();
    for (const to of ['DANG_SUA', 'HOAN_THANH']) await request.post(`${api}/api/orders/${o.id}/status`, { headers: h, data: { to } });
    await request.post(`${api}/api/orders/${o.id}/status`, { headers: h, data: { to: 'DA_GIAO', allowDebt: true } });

    await loginUI(page, PHONES.accountant);
    await page.getByTestId('sidebar').getByRole('link', { name: 'Thu chi & công nợ' }).click();
    await page.getByLabel('Chi nhánh', { exact: true }).selectOption({ label: cn1.name });
    await expect(page.getByTestId('cash-summary')).toBeVisible();
    await page.getByTestId('new-payment').click();
    const f = page.getByTestId('entry-form');
    await f.getByLabel('Khoản mục').selectOption({ label: 'Điện, nước, internet' });
    await f.getByLabel('Số tiền').fill('150000');
    const payee = `Điện lực ${Math.random().toString(36).slice(2, 7)}`;
    await f.getByLabel('Người nhận').fill(payee);
    await page.getByTestId('save-entry').click();
    await expect(page.getByTestId('cash-row').filter({ hasText: payee })).toContainText('150.000 đ');

    await page.getByRole('tab', { name: 'Công nợ khách' }).click();
    await page.getByLabel('Tìm khách nợ').fill(name);
    const row = page.getByTestId('debt-row').filter({ hasText: name });
    await expect(row).toContainText('1.850.000 đ');
    await row.getByTestId('collect').click();
    await expect(page.getByTestId('collect-dialog')).toContainText(o.code);
    await page.getByTestId('save-collect').click();
    await expect(page.getByTestId('debt-row').filter({ hasText: name })).toHaveCount(0);

    await page.goto(`/don-hang/${o.id}`);
    await expect(page.getByTestId('due')).toHaveText('0 đ');
  });
});
