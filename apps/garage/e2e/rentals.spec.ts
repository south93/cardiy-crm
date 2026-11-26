import { expect, test } from '@playwright/test';
import { loginUI, PHONES, randomPhone, randomPlate } from './helpers';

const tag = `TXUI${Date.now().toString(36).toUpperCase()}`;

function localDateTime(daysFromNow: number, hour = 9) {
  const d = new Date(Date.now() + daysFromNow * 86_400_000);
  d.setHours(hour, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

test('đối tác đăng xe cho thuê -> sàn duyệt -> khách đặt trên /cho/thue-xe -> đối tác xử lý trọn S8 (xác minh, cọc, bàn giao, nhận xe, quyết toán)', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'luồng nhiều vai trò kiểm tra trên máy tính; giao diện điện thoại kiểm tra ở test riêng');

  const plate = randomPlate();
  const title = `Mitsubishi Xpander Cross ${tag}`;
  const custPhone = randomPhone();

  // 1. Đối tác đăng nhập vào Cổng đối tác -> Thuê xe (A7.22), thêm xe và gửi sàn duyệt
  await loginUI(page, PHONES.partnerOwner, 'Cardiy2026', '/doi-tac/thue-xe');
  await expect(page.getByTestId('rental-workspace')).toBeVisible();

  await page.getByRole('tab', { name: /Đội xe cho thuê/ }).click();
  await page.getByTestId('rental-add-vehicle').click();

  await page.getByLabel('Tiêu đề hiển thị *').fill(title);
  await page.getByLabel('Biển số xe *').fill(plate);
  await page.getByLabel('Hãng xe *').fill('Mitsubishi');
  await page.getByLabel('Dòng xe *').fill('Xpander');
  await page.getByLabel('Giá thuê / ngày (đ) *').fill('850000');
  await page.getByLabel('Tiền cọc (đ) *').fill('5000000');
  await page.getByLabel('Tỉnh / thành phố').fill('Hà Nội');
  await page.getByLabel('Địa điểm nhận xe').fill('Hà Đông, Hà Nội');
  await page.getByTestId('rental-save-vehicle').click();

  const fleetCard = page.getByTestId('rental-fleet-card').filter({ hasText: title });
  await expect(fleetCard).toBeVisible();
  await fleetCard.getByTestId('rental-submit-vehicle').click();
  await expect(fleetCard).toContainText('Chờ sàn duyệt');

  await page.getByTestId('user-menu').click();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/dang-nhap/);

  // 2. Admin sàn mở Kiểm duyệt xe thuê (/san/thue-xe) duyệt xe lên sàn
  await loginUI(page, PHONES.owner);
  await page.getByTestId('user-menu').click();
  await page.getByRole('menuitem', { name: /Sàn CARDIY/ }).click();
  await expect(page.getByTestId('workspace-name')).toHaveText('Sàn CARDIY');
  await page.getByTestId('sidebar').getByRole('link', { name: 'Kiểm duyệt xe thuê' }).click();
  await expect(page).toHaveURL(/\/san\/thue-xe$/);

  const modCard = page.getByTestId('platform-rental-vehicle-card').filter({ hasText: title });
  await expect(modCard).toBeVisible();
  await modCard.getByTestId('platform-rental-approve').click();
  await expect(modCard).toBeHidden();

  await page.getByTestId('user-menu').click();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/dang-nhap/);

  // 3. Khách mở /cho/thue-xe tìm xe và gửi yêu cầu đặt thuê
  await page.goto('/cho/thue-xe');
  await page.getByTestId('rental-search-bar').getByLabel('Sắp xếp / tìm tên xe').fill(tag);
  const pubCard = page.getByTestId('public-rental-card').filter({ hasText: title });
  await expect(pubCard).toBeVisible();
  await pubCard.click();

  await expect(page.getByTestId('rental-vehicle-title')).toHaveText(title);
  const form = page.getByTestId('public-rental-book-form');
  await form.getByLabel('Nhận xe *').fill(localDateTime(4, 9));
  await form.getByLabel('Trả xe *').fill(localDateTime(6, 9));
  await form.getByLabel('Họ và tên người thuê *').fill('Vũ Quang Hải');
  await form.getByLabel('Số điện thoại *').fill(custPhone);
  await form.getByLabel('Số CCCD').fill('001094008888');
  await form.getByLabel('Số GPLX').fill('010998877 (B2)');
  await form.getByTestId('rental-book-submit').click();

  await expect(page).toHaveURL(/\/cho\/thue-xe\/hop-dong\/.+\?t=/);
  const trackUrl = page.url();
  const contractCode = (await page.getByTestId('rental-contract-code').textContent())!.trim();
  await expect(page.getByTestId('rental-contract-status')).toContainText('Đặt trước');

  // 4. Đối tác đăng nhập xử lý hợp đồng theo S8: Xác minh -> Ký HĐ & nhận cọc -> Bàn giao -> Nhận trả -> Quyết toán
  await loginUI(page, PHONES.partnerOwner, 'Cardiy2026', '/doi-tac/thue-xe');
  const contractCard = page.getByTestId('rental-contract-card').filter({ hasText: contractCode });
  await expect(contractCard).toBeVisible();

  await contractCard.getByTestId('rental-verify-btn').click();
  await page.getByTestId('rental-verify-confirm').click();
  await expect(contractCard).toContainText('Đã xác minh giấy tờ');

  await contractCard.getByTestId('rental-deposit-btn').click();
  await page.getByTestId('rental-deposit-confirm').click();
  await expect(contractCard).toContainText('Đã ký HĐ & đặt cọc');

  await contractCard.getByTestId('rental-handover-btn').click();
  await page.getByTestId('rental-handover-confirm').click();
  await expect(contractCard).toContainText('Đang thuê xe');

  await contractCard.getByTestId('rental-return-btn').click();
  await page.getByTestId('rental-return-confirm').click();
  await expect(contractCard).toContainText('Đã trả xe');

  await contractCard.getByTestId('rental-settle-btn').click();
  await page.getByTestId('rental-settle-confirm').click();

  const settledCard = page.getByTestId('rental-contract-card').filter({ hasText: contractCode });
  await expect(settledCard).toContainText('Đã quyết toán');

  await page.getByTestId('user-menu').click();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/dang-nhap/);

  // 5. Khách tải lại link theo dõi hợp đồng: thấy Đã quyết toán, biên bản giao/trả và tiền hoàn cọc
  await page.goto(trackUrl);
  await expect(page.getByTestId('rental-contract-status')).toContainText('Đã quyết toán');
  await expect(page.getByTestId('rental-handover-card')).toBeVisible();
  await expect(page.getByTestId('rental-return-card')).toBeVisible();
  await expect(page.getByTestId('rental-deposit-refund')).toContainText('Hoàn cọc');
});

test('điện thoại: khách đặt thuê xe sẵn có trên /cho/thue-xe rồi tự huỷ đơn đặt trước', async ({ page }) => {
  await page.goto('/cho/thue-xe');
  const firstCard = page.getByTestId('public-rental-card').first();
  await expect(firstCard).toBeVisible();
  await firstCard.click();

  const form = page.getByTestId('public-rental-book-form');
  // Chọn mốc ngày xa để không trùng giữa desktop và mobile chạy song song
  const offset = 20 + Math.floor(Math.random() * 40);
  await form.getByLabel('Nhận xe *').fill(localDateTime(offset, 8));
  await form.getByLabel('Trả xe *').fill(localDateTime(offset + 1, 20));
  await form.getByLabel('Họ và tên người thuê *').fill('Nguyễn Khách Huỷ');
  await form.getByLabel('Số điện thoại *').fill(randomPhone());
  await form.getByTestId('rental-book-submit').click();

  await expect(page).toHaveURL(/\/cho\/thue-xe\/hop-dong\/.+\?t=/);
  await expect(page.getByTestId('rental-contract-status')).toContainText('Đặt trước');

  await page.getByTestId('rental-cancel-open').click();
  await page.getByTestId('rental-cancel-confirm').click();
  await expect(page.getByTestId('rental-contract-status')).toContainText('Đã huỷ');
});
