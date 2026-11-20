import { expect, test } from '@playwright/test';
import { loginUI, PHONES, randomPhone } from './helpers';

const randomPlate = () => `61C${String(Math.floor(10000 + Math.random() * 89999))}`;
const fmt = (p: string) => `${p.slice(0, 3)}-${p.slice(3, 6)}.${p.slice(6)}`;

test.describe('Khách hàng & Xe', () => {
  test.skip(({ isMobile }) => isMobile, 'quản trị khách hàng làm trên máy tính');

  test('thêm khách kèm xe → hồ sơ khách; tìm không dấu; tìm nhanh theo biển số → xe → chủ xe', async ({ page }) => {
    const phone = randomPhone();
    const plate = randomPlate();
    await loginUI(page, PHONES.owner);
    await page.goto('/khach-hang');
    await page.getByTestId('add-customer').click();
    const form = page.locator('#customer-form');
    await form.getByLabel('Họ tên / cách gọi').fill('Anh Đức Giao Diện');
    await form.getByLabel('Số điện thoại', { exact: true }).fill(phone);
    await form.getByLabel('Nguồn khách').selectOption({ label: 'Zalo' });
    await form.getByLabel('Biển số').fill(plate.toLowerCase());
    await form.getByLabel('Hãng xe').fill('Mazda');
    await form.getByLabel('Dòng xe').fill('CX-5');
    await form.getByRole('button', { name: 'Thêm khách hàng' }).click();

    await expect(page.getByTestId('customer-name')).toHaveText('Anh Đức Giao Diện');
    await expect(page.getByTestId('vehicle-list')).toContainText(fmt(plate));
    await expect(page.getByTestId('page-title')).toHaveText('Khách hàng');

    // Tìm không dấu trong danh sách
    await page.goto('/khach-hang');
    await page.getByLabel('Tìm khách hàng').fill('duc giao dien');
    await expect(page.getByTestId('customer-table')).toContainText('Anh Đức Giao Diện');

    // Tìm nhanh theo biển số ở thanh trên cùng
    await page.getByTestId('quick-search').fill(plate.slice(0, 6));
    await expect(page.getByTestId('quick-search-results')).toContainText(fmt(plate));
    await page.getByTestId('quick-search-results').getByText(fmt(plate)).click();
    await expect(page.getByTestId('vehicle-plate')).toHaveText(fmt(plate));
    await expect(page.getByTestId('current-owner')).toContainText('Anh Đức Giao Diện');
  });

  test('ghi số km; số lùi bị chặn; chuyển chủ xe giữ lịch sử', async ({ page }) => {
    const plate = randomPlate();
    await loginUI(page, PHONES.owner);
    // Tạo nhanh 2 khách qua API của trang (đã đăng nhập)
    await page.goto('/khach-hang');
    for (const name of ['Chủ Xe Cũ', 'Chủ Xe Mới']) {
      await page.getByTestId('add-customer').click();
      const form = page.locator('#customer-form');
      await form.getByLabel('Họ tên / cách gọi').fill(name);
      await form.getByLabel('Số điện thoại', { exact: true }).fill(randomPhone());
      if (name === 'Chủ Xe Cũ') {
        await form.getByLabel('Biển số').fill(plate);
        await form.getByLabel('Số km hiện tại').fill('50000');
      } else {
        await form.getByLabel('Thêm xe của khách').uncheck();
      }
      await form.getByRole('button', { name: 'Thêm khách hàng' }).click();
      await expect(page.getByTestId('customer-name')).toHaveText(name);
      await page.goto('/khach-hang');
    }
    await page.getByTestId('quick-search').fill(plate);
    await page.getByTestId('quick-search-results').getByText(fmt(plate)).click();

    await page.getByTestId('add-km').click();
    await page.getByLabel('Số km trên đồng hồ').fill('40000');
    await page.getByTestId('save-km').click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('nhỏ hơn lần ghi trước');
    await page.getByLabel('Số km trên đồng hồ').fill('52000');
    await page.getByTestId('save-km').click();
    await expect(page.getByTestId('odometer-list')).toContainText('52.000 km');

    page.on('dialog', (d) => d.accept());
    await page.getByTestId('transfer-vehicle').click();
    await page.getByLabel('Tìm khách nhận xe').fill('chu xe moi');
    await page.getByTestId('transfer-candidate').first().click();
    await expect(page.getByTestId('current-owner')).toContainText('Chủ Xe Mới');
    await expect(page.getByTestId('past-owner')).toContainText('Chủ Xe Cũ');
  });

  test('nhập dữ liệu AppSheet: xem trước, xác nhận, kết quả', async ({ page }) => {
    const phone = randomPhone();
    const head = '"Tên khách hàng","Điện thoại","Thông tin khách hàng","Ngày tạo","Nguồn khách hàng","Chi nhánh","Chi tiết xe"';
    const csv = '﻿' + [head, `"Anh Nhập Giao Diện","${phone.slice(1)}","x","15/10/2026","1. Zalo","CN1","${randomPlate()} , ${randomPlate()}"`, '"Khách lỗi","0","x","","","",""'].join('\r\n');
    await loginUI(page, PHONES.owner);
    await page.goto('/khach-hang');
    await page.getByRole('link', { name: 'Nhập từ AppSheet' }).click();
    await expect(page.getByTestId('page-title')).toHaveText('Nhập dữ liệu từ AppSheet');
    await page.getByTestId('import-file').setInputFiles({ name: 'khach_hang.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
    await expect(page.getByTestId('import-summary')).toContainText('Khách mới');
    await expect(page.getByTestId('import-issues')).toContainText('bỏ qua');
    await page.getByTestId('import-commit').click();
    await expect(page.getByTestId('import-result')).toContainText('Đã nhập 1 khách, 2 xe');
  });

  test('Kỹ thuật viên: không có menu Khách hàng; vẫn xem được Xe', async ({ page }) => {
    await loginUI(page, PHONES.tech);
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar.getByRole('link', { name: 'Khách hàng' })).toHaveCount(0);
    await sidebar.getByRole('link', { name: 'Xe', exact: true }).click();
    await expect(page.getByTestId('vehicle-table')).toBeVisible();
    await page.goto('/khach-hang');
    await expect(page.getByTestId('forbidden')).toBeVisible();
  });
});
