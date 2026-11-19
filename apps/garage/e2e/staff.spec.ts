import { expect, test } from '@playwright/test';
import { loginUI, PHONES, randomPhone } from './helpers';

test.describe('Nhân viên, cài đặt, bảo mật', () => {
  test.skip(({ isMobile }) => isMobile, 'quản trị nhân viên làm trên máy tính');

  test('Chủ garage thêm KTV → nhân viên mới đăng nhập bằng mật khẩu tạm, bị buộc đổi mật khẩu → vào được hệ thống', async ({ page }) => {
    const phone = randomPhone();
    await loginUI(page, PHONES.owner);
    await page.goto('/nhan-vien');
    await page.getByTestId('add-staff').click();
    const form = page.locator('#staff-form');
    await form.getByLabel('Họ và tên').fill('KTV Thử Nghiệm');
    await form.getByLabel('Số điện thoại (dùng để đăng nhập)').fill(phone);
    await form.getByLabel('Làm việc tại').selectOption({ label: 'CN1 · Cầu Giấy' });
    await form.getByLabel('Kỹ thuật viên').check();
    await form.getByRole('button', { name: 'Thêm nhân viên' }).click();
    const temp = (await page.getByTestId('temp-password-value').textContent())!.trim();
    expect(temp).toMatch(/^[A-Za-z2-9]{10}$/);
    await page.getByRole('button', { name: 'Đã ghi lại' }).click();
    await expect(page.locator(`[data-phone="${phone}"]`)).toContainText('Chờ đổi mật khẩu');

    // Đăng xuất, nhân viên mới đăng nhập
    await page.getByTestId('user-menu').click();
    await page.getByTestId('logout').click();
    await loginUI(page, phone, temp);
    await expect(page).toHaveURL(/\/doi-mat-khau$/);
    const cp = page.getByTestId('change-password-form');
    await cp.getByLabel('Mật khẩu hiện tại').fill(temp);
    await cp.getByLabel('Mật khẩu mới', { exact: true }).fill('KtvMoi2026');
    await cp.getByLabel('Nhập lại mật khẩu mới').fill('KtvMoi2026');
    await cp.getByRole('button', { name: 'Đổi mật khẩu' }).click();
    await expect(page).toHaveURL(/\/trang-chu$/);
    await expect(page.getByTestId('home-grid')).toContainText('KTV Thử Nghiệm');
  });

  test('Quản lý chi nhánh không chọn được vai trò vượt quyền (Kế toán, Chủ garage)', async ({ page }) => {
    await loginUI(page, PHONES.managerCn1);
    await page.goto('/nhan-vien');
    await page.getByTestId('add-staff').click();
    const form = page.locator('#staff-form');
    await expect(form.getByLabel('Kỹ thuật viên')).toBeEnabled();
    await expect(form.getByLabel(/Kế toán garage/)).toBeDisabled();
    await expect(form.getByLabel(/Chủ garage/)).toBeDisabled();
    await expect(form.getByLabel('Làm việc tại').locator('option')).toHaveText(['CN1 · Cầu Giấy']);
  });

  test('Cài đặt: ma trận vai trò & quyền; nhật ký ghi lại thao tác', async ({ page }) => {
    await loginUI(page, PHONES.owner);
    await page.goto('/cai-dat');
    await expect(page.getByTestId('branch-list')).toContainText('CN1 · Cầu Giấy');
    await page.getByRole('tab', { name: 'Vai trò & quyền' }).click();
    const matrix = page.getByTestId('role-matrix');
    await expect(matrix).toContainText('Kỹ thuật viên');
    await expect(matrix).toContainText('staff.manage');
    await page.getByRole('tab', { name: 'Nhật ký thao tác' }).click();
    await expect(page.getByTestId('audit-table')).toContainText('Đăng nhập');
  });

  test('Tài khoản & bảo mật: tải ảnh đại diện, hiện mã QR bật 2FA', async ({ page }) => {
    await loginUI(page, PHONES.managerCn1);
    await page.goto('/bao-mat');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    await page.getByTestId('avatar-input').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByTestId('avatar-img')).toBeVisible();
    await page.getByRole('button', { name: 'Bật xác thực 2 lớp' }).click();
    await expect(page.getByAltText('Mã QR xác thực 2 lớp')).toBeVisible();
    await expect(page.getByTestId('totp-secret')).toHaveText(/^[A-Z2-7]{16,}$/);
  });
});
