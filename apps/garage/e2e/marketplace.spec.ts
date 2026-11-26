import { expect, test } from '@playwright/test';
import { loginUI, PHONES } from './helpers';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

test.describe('Vòng 3.2: gian hàng & tin đăng', () => {
  test('đối tác lưu hồ sơ gian hàng, đăng sản phẩm từ danh mục chuẩn; sàn duyệt → Đang bán', async ({ page, isMobile }) => {
    test.skip(isMobile, 'luồng quản trị chạy trên máy tính');
    const price = String(1_000_000 + Math.floor(Math.random() * 900_000));
    await loginUI(page, PHONES.partnerOwner);
    await page.goto('/doi-tac/gian-hang');
    await page.getByLabel('Số điện thoại / hotline').fill('0900000010');
    await page.getByLabel('Địa chỉ').fill('Hà Đông, Hà Nội');
    await page.getByLabel('Vị trí trên bản đồ').fill('https://www.google.com/maps/@20.9712,105.7788,17z');
    await page.getByTestId('save-shop').click();
    await expect(page.getByText('Đã lưu hồ sơ gian hàng.')).toBeVisible();
    await expect(page.getByLabel('Vị trí trên bản đồ')).toHaveValue('20.9712, 105.7788');

    await page.goto('/doi-tac/san-pham');
    await page.getByTestId('add-offer').click();
    await page.getByLabel('Tìm trong danh mục chuẩn').fill('michelin 205/55r16');
    await page.getByTestId('catalog-option').first().click();
    await expect(page.getByTestId('picked-item')).toContainText('Michelin');
    await page.getByTestId('offer-price').fill(price);
    await page.getByTestId('offer-stock').fill('6');
    await page.getByTestId('offer-image').setInputFiles({ name: 'lop.png', mimeType: 'image/png', buffer: PNG });
    await page.getByTestId('save-submit-offer').click();
    const row = page.getByTestId('offer-row').filter({ hasText: Number(price).toLocaleString('vi-VN') });
    await expect(row).toContainText('Chờ sàn duyệt');

    // Sàn duyệt
    await page.getByTestId('user-menu').click();
    await page.getByTestId('logout').click();
    await expect(page).toHaveURL(/\/dang-nhap/);
    await loginUI(page, PHONES.owner);
    await page.getByTestId('user-menu').click();
    await page.getByRole('menuitem', { name: /Sàn CARDIY/ }).click();
    await expect(page.getByTestId('workspace-name')).toHaveText('Sàn CARDIY');
    await page.goto('/san/tin-dang');
    const card = page.getByTestId('moderation-card').filter({ hasText: Number(price).toLocaleString('vi-VN') });
    await card.getByTestId('approve-offer').click();
    await expect(card).toHaveCount(0);

    await page.getByTestId('user-menu').click();
    await page.getByTestId('logout').click();
    await expect(page).toHaveURL(/\/dang-nhap/);
    await loginUI(page, PHONES.partnerOwner);
    await page.goto('/doi-tac/san-pham');
    await expect(page.getByTestId('offer-row').filter({ hasText: Number(price).toLocaleString('vi-VN') })).toContainText('Đang bán');
  });

  test('PLG: Kênh người bán có hồ sơ gian hàng và tin đăng sản phẩm liên kết kho', async ({ page }) => {
    await loginUI(page, PHONES.owner);
    await page.goto('/gian-hang');
    await expect(page.getByTestId('shop-readiness')).toBeVisible();
    await page.getByRole('tab', { name: 'Sản phẩm trên sàn' }).click();
    await page.getByTestId('add-offer').click();
    await page.getByLabel('Tìm trong danh mục chuẩn').fill('castrol');
    await page.getByTestId('catalog-option').first().click();
    await expect(page.getByLabel('Liên kết hàng trong kho')).toBeVisible();
  });
});
