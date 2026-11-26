import { expect, test } from '@playwright/test';
import { loginUI, PHONES } from './helpers';

test.describe('Khung giao diện quản trị (Chủ garage)', () => {
  test.beforeEach(async ({ page }) => {
    await loginUI(page, PHONES.owner);
  });

  test('trang Tổng quan hiển thị tiêu đề, KPI và trạng thái hệ thống thật', async ({ page }) => {
    await expect(page.getByTestId('page-title')).toHaveText('Tổng quan');
    await expect(page.getByText('Doanh thu tháng')).toBeVisible();
    const status = page.getByTestId('system-status');
    await expect(status.getByTestId('status-api')).toHaveText('Hoạt động');
    await expect(status.getByTestId('status-database')).toHaveText('Hoạt động');
    await expect(status.getByTestId('status-redis')).toHaveText('Hoạt động');
  });

  test('Trang chủ có lưới chức năng, bấm ô thì sang màn hình tương ứng', async ({ page }) => {
    await page.goto('/trang-chu');
    const grid = page.getByTestId('home-grid');
    await expect(grid.getByText('1. Kinh doanh')).toBeVisible();
    await grid.getByRole('link', { name: 'Đơn đang xử lý' }).click();
    await expect(page).toHaveURL(/\/don-dang-xu-ly$/);
    await expect(page.getByTestId('order-table')).toBeVisible();
    // Màn hình chưa làm hiện trang chờ kèm vòng dự kiến
    await page.goto('/trang-chu');
    await grid.getByRole('link', { name: 'Marketing' }).click();
    await expect(page.getByTestId('placeholder')).toContainText('Dự kiến vòng P5');
  });

  test('đường dẫn không có trong menu trả về 404', async ({ page }) => {
    const res = await page.goto('/khong-co-trang-nay');
    expect(res?.status()).toBe(404);
    await expect(page.getByText('Không tìm thấy trang này.')).toBeVisible();
  });
});

test.describe('Menu trên máy tính', () => {
  test.skip(({ isMobile }) => isMobile, 'chỉ áp dụng màn hình lớn');
  test.beforeEach(async ({ page }) => {
    await loginUI(page, PHONES.owner);
  });

  test('bấm mục menu thì chuyển trang và đánh dấu mục đang chọn', async ({ page }) => {
    const sidebar = page.getByTestId('sidebar');
    await sidebar.getByRole('link', { name: 'Khách hàng' }).click();
    await expect(page.getByTestId('page-title')).toHaveText('Khách hàng');
    await expect(sidebar.getByRole('link', { name: 'Khách hàng' })).toHaveAttribute('aria-current', 'page');
  });

  test('thu gọn menu, tải lại trang vẫn giữ trạng thái thu gọn', async ({ page }) => {
    const sidebar = page.getByTestId('sidebar');
    const wide = (await sidebar.boundingBox())!.width;
    await page.getByTestId('collapse-toggle').click();
    await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThan(wide / 2);
    await page.reload();
    await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true');
    await page.getByTestId('collapse-toggle').click();
    await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'false');
  });
});

test.describe('Menu trên điện thoại', () => {
  test.skip(({ isMobile }) => !isMobile, 'chỉ áp dụng điện thoại');

  test('menu ẩn mặc định, bấm nút ☰ thì mở, chọn mục thì tự đóng', async ({ page }) => {
    await loginUI(page, PHONES.owner);
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar).not.toBeInViewport();
    await page.getByTestId('mobile-menu').click();
    await expect(sidebar).toBeInViewport();
    await sidebar.getByRole('link', { name: 'Xe', exact: true }).click();
    await expect(page.getByTestId('page-title')).toHaveText('Xe');
    await expect(sidebar).not.toBeInViewport();
  });
});
