import { expect, test } from '@playwright/test';
import { loginUI, PHONES } from './helpers';

test.describe('Quỹ đầu kỳ & công nợ nhà cung cấp', () => {
  test.skip(({ isMobile }) => isMobile, 'làm trên máy tính');

  test('kế toán: nhập quỹ đầu kỳ chi nhánh; NCC có nợ đầu kỳ + phiếu nhập → trả một phần → còn nợ đúng', async ({ page, request }) => {
    const api = process.env.API_URL ?? 'http://localhost:4000';
    const auth = async (phone: string) => ({ Authorization: `Bearer ${(await (await request.post(`${api}/api/auth/login`, { data: { phone, password: 'Cardiy2026' } })).json()).accessToken}` });
    const kt = await auth(PHONES.accountant);
    const tk = await auth(PHONES.storekeeper);
    const branches = await (await request.get(`${api}/api/branches`, { headers: kt })).json();
    const cn2 = branches.find((b: { code: string }) => b.code === 'CN2');
    // Bắt đầu từ trạng thái chưa có quỹ đầu kỳ ở CN2
    const cur = await (await request.get(`${api}/api/finance/opening-fund?branchId=${cn2.id}`, { headers: kt })).json();
    if (cur.fund) await request.post(`${api}/api/finance/entries/${cur.fund.id}/void`, { headers: kt, data: { reason: 'Chạy lại test' } });

    const name = `NCC Phụ Tùng ${Math.random().toString(36).slice(2, 7)}`;
    const sup = await (await request.post(`${api}/api/suppliers`, { headers: tk, data: { name, openingPayable: 3_000_000 } })).json();
    const p = await (await request.post(`${api}/api/products`, { headers: tk, data: { name: `Má phanh ${name}`, kind: 'PHU_TUNG', unit: 'bộ', salePrice: 1_500_000, costPrice: 1_000_000 } })).json();
    await request.post(`${api}/api/stock-documents`, { headers: tk, data: { type: 'NHAP', branchId: cn2.id, supplierId: sup.id, lines: [{ productId: p.id, quantity: '2', unitCost: 1_000_000 }] } });

    await loginUI(page, PHONES.accountant);
    await page.goto('/thu-chi');
    await page.getByLabel('Chi nhánh', { exact: true }).selectOption({ label: cn2.name });
    await page.getByTestId('set-opening-fund').click();
    await page.getByLabel('Số tiền quỹ').fill('18000000');
    await page.getByTestId('save-opening-fund').click();
    await expect(page.getByTestId('opening-fund')).toContainText('18.000.000 đ');
    await expect(page.getByTestId('opening-fund-missing')).toHaveCount(0);

    await page.getByRole('tab', { name: 'Công nợ NCC' }).click();
    await page.getByLabel('Tìm nhà cung cấp').fill(name);
    const row = page.getByTestId('payable-row').filter({ hasText: name });
    await expect(row).toContainText('5.000.000 đ');
    await row.getByTestId('open-payable').click();
    const dlg = page.getByTestId('payable-dialog');
    await dlg.getByLabel('Số tiền trả').fill('2000000');
    await dlg.getByTestId('save-pay').click();
    await expect(page.getByTestId('payable-row').filter({ hasText: name })).toContainText('3.000.000 đ');
  });
});
