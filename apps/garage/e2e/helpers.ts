import { expect, type Page } from '@playwright/test';

export const DEMO_PASSWORD = 'Cardiy2026';
export const PHONES = {
  owner: '0900000001',
  managerCn1: '0900000002',
  sales: '0900000003',
  tech: '0900000004',
  storekeeper: '0900000005',
  cskh: '0900000007',
  accountant: '0900000006',
  rescue: '0900000009',
  partnerOwner: '0900000010',
};

/** Đăng nhập qua giao diện và chờ vào được ứng dụng. */
export async function loginUI(page: Page, phone: string, password = DEMO_PASSWORD, next?: string) {
  await page.goto(next ? `/dang-nhap?next=${encodeURIComponent(next)}` : '/dang-nhap');
  const form = page.getByTestId('login-form');
  await form.getByLabel('Số điện thoại').fill(phone);
  await form.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await form.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).not.toHaveURL(/\/dang-nhap/);
}

export function randomPhone(): string {
  return '09' + String(Math.floor(10_000_000 + Math.random() * 89_999_999));
}

const SERIES = 'ABCDEFGHKLMNPSTUVXYZ';
/**
 * Biển số ngẫu nhiên hợp lệ (mã tỉnh 11–99 + seri + 5 số ≈ 160 triệu giá trị).
 * CSDL kiểm thử tích luỹ dữ liệu qua nhiều lần chạy: dải hẹp (VD "61C" + 5 số) sớm muộn sẽ sinh trùng biển đã có.
 */
export function randomPlate(): string {
  const province = 11 + Math.floor(Math.random() * 89);
  return `${province}${SERIES[Math.floor(Math.random() * SERIES.length)]}${10000 + Math.floor(Math.random() * 90000)}`;
}
