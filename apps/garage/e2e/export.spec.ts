import { expect, test } from '@playwright/test';
import { loginUI, PHONES } from './helpers';

test.describe('Xuất dữ liệu bảng (Excel / CSV)', () => {
  test.skip(({ isMobile }) => isMobile, 'kiểm thử xuất file thực hiện trên máy tính');

  test('chủ garage xuất Excel & CSV ở Xe, Khách hàng, Sản phẩm, Đơn hàng, Nhân viên, Thu chi', async ({ page }) => {
    await loginUI(page, PHONES.owner);

    // 1. Xe (/xe): xuất Excel (.xlsx)
    await page.goto('/xe');
    await expect(page.getByTestId('vehicle-table')).toBeVisible();
    const [vehXlsx] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-vehicles').click(),
    ]);
    expect(vehXlsx.suggestedFilename()).toMatch(/^danh-sach-xe-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const vehStream = await vehXlsx.createReadStream();
    const vehChunks: Buffer[] = [];
    for await (const c of vehStream) vehChunks.push(Buffer.from(c));
    const vehBuf = Buffer.concat(vehChunks);
    expect(vehBuf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(vehBuf.toString('utf8')).toContain('Biển số');

    // 2. Khách hàng (/khach-hang): xuất CSV (.csv) qua menu định dạng
    await page.goto('/khach-hang');
    await expect(page.getByTestId('customer-table')).toBeVisible();
    await page.getByTestId('export-customers-menu').click();
    const [custCsv] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-customers-csv').click(),
    ]);
    expect(custCsv.suggestedFilename()).toMatch(/^danh-sach-khach-hang-\d{4}-\d{2}-\d{2}\.csv$/);
    const custStream = await custCsv.createReadStream();
    const custChunks: Buffer[] = [];
    for await (const c of custStream) custChunks.push(Buffer.from(c));
    const custText = Buffer.concat(custChunks).toString('utf8');
    expect(custText.startsWith('\uFEFF')).toBe(true);
    expect(custText).toContain('"Mã KH","Tên khách hàng"');

    // 3. Danh mục sản phẩm (/danh-muc): xuất Excel (.xlsx)
    await page.goto('/danh-muc');
    await expect(page.getByTestId('product-table')).toBeVisible();
    const [prodXlsx] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-products').click(),
    ]);
    expect(prodXlsx.suggestedFilename()).toMatch(/^danh-muc-san-pham-\d{4}-\d{2}-\d{2}\.xlsx$/);

    // 4. Nhân viên (/nhan-vien): xuất Excel (.xlsx)
    await page.goto('/nhan-vien');
    await expect(page.getByTestId('staff-table')).toBeVisible();
    const [staffXlsx] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-staff').click(),
    ]);
    expect(staffXlsx.suggestedFilename()).toMatch(/^danh-sach-nhan-vien-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});
