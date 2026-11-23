import { expect, test } from '@playwright/test';
import { loginUI, PHONES, randomPhone, randomPlate } from './helpers';

const tag = () => Math.random().toString(36).slice(2, 7).toUpperCase();

test.describe('Danh mục & kho', () => {
  test.skip(({ isMobile }) => isMobile, 'quản lý kho làm trên máy tính');

  test('thủ kho: thêm sản phẩm theo hãng xe → nhập hàng → tồn tăng; bán hàng chọn từ danh mục → giao xe trừ kho', async ({ page }) => {
    const t = tag();
    const name = `Lốp E2E ${t} 215/55R17`;
    await loginUI(page, PHONES.storekeeper);
    await page.getByTestId('sidebar').getByRole('link', { name: 'Danh mục sản phẩm' }).click();
    await expect(page.getByTestId('category-tree')).toContainText('Phuộc & giảm xóc');
    await page.getByTestId('add-product').click();
    const form = page.locator('#product-form');
    await form.getByLabel('Tên sản phẩm / dịch vụ').fill(name);
    await form.getByLabel('Nhóm').selectOption({ label: 'Lốp du lịch' });
    await form.getByLabel('Thương hiệu').fill('Michelin');
    await form.getByLabel('Đơn vị tính').fill('cái');
    await form.getByLabel('Giá bán').fill('2650000');
    await form.getByLabel('Giá vốn').fill('2000000');
    await form.getByLabel('Tồn tối thiểu').fill('2');
    await form.getByLabel('Tháng sản xuất').selectOption({ label: 'Tháng 9' });
    await form.getByLabel('Năm sản xuất').fill('2026');
    await form.getByRole('button', { name: 'Toyota', exact: true }).click();
    await form.getByLabel('Thêm hãng xe khác').fill('Lexus');
    await form.getByLabel('Thêm hãng xe khác').press('Enter');
    await page.getByTestId('save-product').click();
    await expect(page.getByTestId('product-name')).toHaveText(name);
    await expect(page.getByTestId('product-detail')).toContainText('Lexus');
    await expect(page.getByTestId('product-mfg')).toContainText('09/2026');
    const code = (await page.getByTestId('product-detail').locator('.font-mono').first().innerText()).trim();

    // Nhập hàng vào kho CN1
    await page.goto('/ton-kho');
    await page.getByTestId('new-receipt').click();
    await page.getByLabel('Thêm hàng vào phiếu').fill(t);
    await page.getByTestId('product-results').getByText(name).click();
    // Phiếu nhập có cột mã hàng và nhóm hàng
    await expect(page.getByTestId('doc-line')).toContainText(code);
    await expect(page.getByTestId('doc-line')).toContainText('Lốp xe › Lốp du lịch');
    await expect(page.getByTestId('doc-line')).toContainText('SX 09/2026');
    await page.getByLabel(`Số lượng ${name}`).fill('8');
    await page.getByLabel(`Giá nhập ${name}`).fill('1950000');
    await expect(page.getByTestId('doc-total')).toHaveText('15.600.000 đ');
    await page.getByTestId('save-doc').click();
    await expect(page.getByTestId('doc-code')).toHaveText(/^PN\d{6}$/);
    await expect(page.getByTestId('doc-detail-lines')).toContainText('8 cái');
    await expect(page.getByTestId('doc-detail-lines')).toContainText(code);
    await expect(page.getByTestId('doc-detail-lines')).toContainText('Lốp xe › Lốp du lịch');

    // Tồn kho chi nhánh: cột mã hàng, nhóm hàng; lọc theo nhóm
    await page.goto('/ton-kho');
    await page.getByLabel('Lọc nhóm hàng').selectOption({ label: 'Lốp du lịch' });
    await page.getByLabel('Tìm hàng trong kho').fill(t);
    await expect(page.getByTestId('stock-row')).toHaveCount(1);
    await expect(page.getByTestId('stock-row')).toContainText(code);
    await expect(page.getByTestId('stock-row')).toContainText('Lốp xe › Lốp du lịch');
    await expect(page.getByTestId('stock-row')).toContainText('8 cái');
    await page.getByLabel('Lọc nhóm hàng').selectOption({ label: 'Ắc quy (tất cả)' });
    await expect(page.getByTestId('stock-table')).toContainText('Chưa có hàng hoá');

    // Bán hàng: xe Toyota → gợi ý đúng lốp, giao xe thì trừ kho
    await page.context().clearCookies();
    await loginUI(page, PHONES.owner);
    await page.goto('/ban-hang');
    await page.getByRole('button', { name: 'Khách mới' }).click();
    const cf = page.locator('#customer-form');
    await cf.getByLabel('Họ tên / cách gọi').fill(`Khách Kho ${t}`);
    await cf.getByLabel('Số điện thoại', { exact: true }).fill(randomPhone());
    await cf.getByLabel('Biển số').fill(randomPlate());
    await cf.getByLabel('Hãng xe').fill('Toyota');
    await cf.getByRole('button', { name: 'Thêm khách và chọn' }).click();
    await expect(page.getByTestId('picked-customer')).toContainText(`Khách Kho ${t}`);
    await page.getByLabel('Thêm từ danh mục').fill(t);
    await page.getByTestId('product-results').getByText(name).click();
    await page.getByLabel('Số lượng dòng 1').fill('4');
    await expect(page.getByTestId('draft-total')).toHaveText('10.600.000 đ');
    await page.getByTestId('create-order').click();
    await expect(page.getByTestId('order-total')).toHaveText('10.600.000 đ');
    await page.getByTestId('to-DANG_SUA').click();
    await page.getByTestId('to-HOAN_THANH').click();
    await page.getByTestId('to-DA_GIAO').click();
    await page.getByTestId('confirm-debt').click();
    await expect(page.getByTestId('order-status')).toHaveText('Đã giao xe');

    await page.goto('/danh-muc');
    await page.getByLabel('Tìm sản phẩm').fill(t);
    await page.getByTestId('product-row').first().click();
    await expect(page.getByTestId('movement-table')).toContainText('Xuất bán');
    await expect(page.getByTestId('stock-by-branch')).toContainText('4 cái');
  });
});
