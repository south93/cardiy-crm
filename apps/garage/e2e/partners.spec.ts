import { expect, test } from '@playwright/test';
import { loginUI, PHONES, randomPhone } from './helpers';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

test.describe('Vòng 3.1: đăng ký đối tác', () => {
  test('đăng ký công khai → bổ sung giấy tờ → sàn duyệt, thu phí → đối tác thấy Hoạt động', async ({ page, isMobile }) => {
    const phone = randomPhone();
    const name = `Garage E2E ${phone.slice(-4)}`;
    // 1. Trang đăng ký công khai, không cần đăng nhập
    await page.goto('/dang-ky-doi-tac');
    const form = page.getByTestId('partner-signup');
    await form.getByLabel('Tên garage *').fill(name);
    await form.getByLabel('Địa chỉ garage *').fill('99 Đường Thử, Phường 2');
    await form.getByLabel('Người đại diện *').fill('Lê Thử Nghiệm');
    await form.getByLabel('Số điện thoại *').fill(phone);
    if (await page.getByTestId('plan-option').count()) await page.getByTestId('plan-option').first().click();
    await page.getByTestId('submit-application').click();
    await expect(page).toHaveURL(/\/dang-ky-doi-tac\/ho-so\?ma=HS\d{6}/);
    await expect(page.getByTestId('application-status')).toHaveText('Chờ duyệt');
    await page.getByTestId('doc-upload').setInputFiles({ name: 'gpkd.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByTestId('documents')).toContainText('gpkd.png');
    const code = new URL(page.url()).searchParams.get('ma')!;
    if (isMobile) return; // phần quản trị chạy trên máy tính

    // 2. Sàn duyệt
    await page.context().clearCookies();
    await loginUI(page, PHONES.owner);
    await page.getByTestId('user-menu').click();
    await page.getByRole('menuitem', { name: /Sàn CARDIY/ }).click();
    await expect(page.getByTestId('workspace-name')).toHaveText('Sàn CARDIY');
    await page.goto('/san/doi-tac');
    await page.getByLabel('Tìm hồ sơ').fill(code);
    await page.getByTestId('application-row').filter({ hasText: code }).click();
    await expect(page.getByTestId('review-documents')).toContainText('gpkd.png');
    await page.getByTestId('approve').click();
    await page.getByTestId('approve-plan').selectOption({ index: 1 });
    await page.getByTestId('confirm-action').click();
    const temp = (await page.getByTestId('temp-password').textContent())!.trim();
    expect(temp).toHaveLength(10);
    await page.getByRole('button', { name: 'Xong' }).click();

    // 3. Kế toán sàn ghi nhận phí kỳ đầu → đối tác hoạt động
    await page.goto('/san/phi-doi-tac');
    const row = page.getByTestId('invoice-row').filter({ hasText: name });
    await row.getByTestId('pay-invoice').click();
    await page.getByTestId('confirm-pay').click();
    await expect(page.getByText(`${name} chuyển sang Hoạt động`)).toBeVisible();

    // 4. Đối tác đăng nhập lần đầu, đổi mật khẩu, xem phí
    await page.getByTestId('user-menu').click();
    await page.getByTestId('logout').click();
    await expect(page).toHaveURL(/\/dang-nhap/);
    await loginUI(page, phone, temp);
    await expect(page).toHaveURL(/\/doi-mat-khau$/);
    const cp = page.getByTestId('change-password-form');
    await cp.getByLabel('Mật khẩu hiện tại').fill(temp);
    await cp.getByLabel('Mật khẩu mới', { exact: true }).fill('DoiTac2026x');
    await cp.getByLabel('Nhập lại mật khẩu mới').fill('DoiTac2026x');
    await cp.getByRole('button', { name: 'Đổi mật khẩu' }).click();
    await expect(page).not.toHaveURL(/\/doi-mat-khau$/);
    await page.goto('/doi-tac/phi');
    await expect(page.getByTestId('partner-status')).toHaveText('Hoạt động');
    await expect(page.getByTestId('due-total')).toHaveText('Đã thanh toán đủ');
  });
});
