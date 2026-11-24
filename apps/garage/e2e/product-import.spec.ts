import path from 'node:path';
import { expect, test } from '@playwright/test';
import { loginUI, PHONES } from './helpers';

test.describe('Nhập sản phẩm từ Excel AppSheet', () => {
  test.skip(({ isMobile }) => isMobile, 'làm trên máy tính');

  test('chủ garage: chọn file → xem trước (tồn theo chi nhánh, vấn đề) → xác nhận → sản phẩm có giá BP / BD', async ({ page }) => {
    await loginUI(page, PHONES.owner);
    await page.goto('/danh-muc');
    await page.getByTestId('open-product-import').click();
    await page.getByTestId('product-import-file').setInputFiles(path.join(__dirname, 'fixtures', 'kho-mau.xlsx'));
    await expect(page.getByTestId('product-import-summary')).toContainText('Sản phẩm nhập được');
    await expect(page.getByTestId('product-import-stock')).toContainText('CN1');
    await expect(page.getByTestId('product-import-issues')).toContainText('Tồn âm ở CN2');
    await page.getByTestId('product-import-commit').click();
    await expect(page.getByTestId('product-import-result')).toContainText('sản phẩm');

    await page.goto('/danh-muc');
    await page.getByLabel('Tìm sản phẩm').fill('MAU-LOP-01');
    await page.getByText('Lốp mẫu 185/65R15 (dữ liệu giả)').first().click();
    await expect(page.getByTestId('product-price')).toHaveText('1.250.000 đ');
    await expect(page.getByTestId('product-price-bd')).toContainText('1.200.000 đ');
  });
});
