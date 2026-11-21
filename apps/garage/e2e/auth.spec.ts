import { expect, test } from '@playwright/test';
import { loginUI, PHONES, randomPhone } from './helpers';

test.describe('Đăng nhập & phân quyền', () => {
  test('chưa đăng nhập: mở trang trong hệ thống bị chuyển về đăng nhập, đăng nhập xong quay lại đúng trang', async ({ page }) => {
    await page.goto('/khach-hang');
    await expect(page).toHaveURL(/\/dang-nhap\?next=%2Fkhach-hang/);
    const form = page.getByTestId('login-form');
    await form.getByLabel('Số điện thoại').fill(PHONES.owner);
    await form.getByLabel('Mật khẩu', { exact: true }).fill('Cardiy2026');
    await form.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page).toHaveURL(/\/khach-hang$/);
  });

  test('sai mật khẩu: báo lỗi, vẫn ở trang đăng nhập', async ({ page }) => {
    await page.goto('/dang-nhap');
    const form = page.getByTestId('login-form');
    await form.getByLabel('Số điện thoại').fill(randomPhone());
    await form.getByLabel('Mật khẩu', { exact: true }).fill('sai-mat-khau-9');
    await form.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByTestId('login-form').getByRole('alert')).toHaveText('Số điện thoại hoặc mật khẩu không đúng');
    await expect(page).toHaveURL(/\/dang-nhap/);
  });

  test('tải lại trang vẫn giữ đăng nhập; đăng xuất thì không vào lại được', async ({ page }) => {
    await loginUI(page, PHONES.owner);
    await page.reload();
    await expect(page.getByTestId('page-title')).toHaveText('Tổng quan');
    await page.getByTestId('user-menu').click();
    await page.getByTestId('logout').click();
    await expect(page).toHaveURL(/\/dang-nhap/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/dang-nhap/);
  });

  test('Kỹ thuật viên: menu tối giản, không có Tổng quan / Nhân viên; vào thẳng Nhân viên bị chặn', async ({ page, isMobile }) => {
    await loginUI(page, PHONES.tech);
    await expect(page).toHaveURL(/\/trang-chu$/);
    if (isMobile) await page.getByTestId('mobile-menu').click();
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar.getByRole('link', { name: 'Đơn đang xử lý' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Tổng quan' })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Nhân viên' })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Thu chi & công nợ' })).toHaveCount(0);
    await page.goto('/nhan-vien');
    await expect(page.getByTestId('forbidden')).toBeVisible();
  });

  test('Chủ hệ thống chuyển sang không gian Sàn: thấy menu quản trị sàn, không thấy menu garage', async ({ page, isMobile }) => {
    test.skip(isMobile, 'luồng giống trên máy tính');
    await loginUI(page, PHONES.owner);
    await page.getByTestId('user-menu').click();
    await page.getByRole('menuitem', { name: /Sàn CARDIY/ }).click();
    await expect(page.getByTestId('workspace-name')).toHaveText('Sàn CARDIY');
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar.getByRole('link', { name: 'Đối tác garage' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Đơn đang xử lý' })).toHaveCount(0);
    // Chuyển lại garage
    await page.getByTestId('user-menu').click();
    await page.getByRole('menuitem', { name: /Garage PLG/ }).click();
    await expect(page.getByTestId('workspace-name')).toHaveText('Garage PLG');
  });

  test('Đối tác: chỉ thấy Cổng đối tác (gian hàng, sản phẩm, dịch vụ, yêu cầu), không có CRM, không quản lý nhân viên', async ({ page, isMobile }) => {
    test.skip(isMobile, 'luồng giống trên máy tính');
    await loginUI(page, PHONES.partnerOwner);
    await expect(page).toHaveURL(/\/trang-chu$/);
    await expect(page.getByTestId('workspace-name')).toHaveText('Minh Phát Auto (đối tác demo)');
    const sidebar = page.getByTestId('sidebar');
    for (const name of ['Hồ sơ gian hàng', 'Sản phẩm', 'Dịch vụ', 'Đặt hàng & đặt lịch', 'Cứu hộ', 'Thuê xe', 'Kiểm định xe cũ', 'Phí & hoá đơn']) {
      await expect(sidebar.getByRole('link', { name, exact: true })).toBeVisible();
    }
    for (const name of ['Tổng quan', 'Đơn đang xử lý', 'Khách hàng', 'Nhân viên', 'Cài đặt', 'Đối tác garage']) {
      await expect(sidebar.getByRole('link', { name, exact: true })).toHaveCount(0);
    }
    await sidebar.getByRole('link', { name: 'Cứu hộ', exact: true }).click();
    await expect(page.getByTestId('placeholder')).toContainText('A7.21');
    await page.goto('/nhan-vien');
    await expect(page.getByTestId('forbidden')).toBeVisible();
    await page.goto('/don-dang-xu-ly');
    await expect(page.getByTestId('forbidden')).toBeVisible();
  });
});
