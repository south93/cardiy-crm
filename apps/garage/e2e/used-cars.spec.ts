import { expect, test } from '@playwright/test';
import { loginUI, PHONES, randomPhone, randomPlate } from './helpers';

const tag = `XCUI${Date.now().toString(36).toUpperCase()}`;

function localDateTime(daysFromNow: number, hour = 10) {
  const d = new Date(Date.now() + daysFromNow * 86_400_000);
  d.setHours(hour, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

test('đối tác đăng bán xe cũ & chấm kiểm định 100 điểm -> sàn duyệt (A6.31) -> khách lọc xe Đã kiểm định trên /cho/xe-cu, xem báo cáo & hẹn xem xe -> đối tác xác nhận lịch', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'luồng nhiều vai trò kiểm tra trên máy tính; giao diện điện thoại kiểm tra ở test riêng');

  const title = `Mazda CX-5 2.0 Premium ${tag}`;
  const plate = randomPlate();
  const buyerPhone = randomPhone();

  // 1. Đối tác vào Cổng đối tác -> Kiểm định xe cũ (A7.23), đăng tin bán xe cũ, lập phiếu kiểm định và chấm 100/100 điểm
  await loginUI(page, PHONES.partnerOwner, 'Cardiy2026', '/doi-tac/kiem-dinh');
  await expect(page.getByTestId('used-car-workspace')).toBeVisible();

  await page.getByRole('tab', { name: /Tin bán xe của garage/ }).click();
  await page.getByTestId('used-car-add-listing').click();

  await page.getByLabel('Tiêu đề tin đăng *').fill(title);
  await page.getByLabel('Giá bán đề xuất (đồng) *').fill('765000000');
  await page.getByLabel('Hãng xe *').fill('Mazda');
  await page.getByLabel('Dòng xe *').fill('CX-5');
  await page.getByLabel('Năm sản xuất *').fill('2023');
  await page.getByLabel('Số ODO đã đi (km) *').fill('19000');
  await page.getByLabel('Biển số xe').fill(plate);
  await page.getByLabel('Tỉnh / thành phố xem xe *').fill('Hà Nội');
  await page.getByTestId('used-car-save-listing').click();

  const listCard = page.getByTestId('garage-used-car-card').filter({ hasText: title });
  await expect(listCard).toBeVisible();

  // Lập phiếu kiểm định nội bộ & chấm checklist hoàn tất
  await listCard.getByTestId('garage-self-appraisal-btn').click();
  const apCard = page.getByTestId('appraisal-card').filter({ hasText: title });
  await expect(apCard).toBeVisible();
  await apCard.getByTestId('appraisal-grade-btn').click();
  await page.getByTestId('appraisal-complete-btn').click();

  const doneAp = page.getByTestId('appraisal-card').filter({ hasText: title });
  await expect(doneAp).toContainText('100/100 điểm');

  // Quay lại tab Tin bán xe: thấy huy hiệu Đã kiểm định 100/100 -> bấm Gửi sàn duyệt
  await page.getByRole('tab', { name: /Tin bán xe của garage/ }).click();
  const verifiedCard = page.getByTestId('garage-used-car-card').filter({ hasText: title });
  await expect(verifiedCard).toContainText('Đã kiểm định 100/100');
  await verifiedCard.getByTestId('garage-submit-used-car').click();
  await expect(verifiedCard).toContainText('Chờ sàn duyệt');

  await page.getByTestId('user-menu').click();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/dang-nhap/);

  // 2. Admin sàn mở Kiểm duyệt xe cũ (/san/xe-cu, A6.31) duyệt hiển thị 60 ngày
  await loginUI(page, PHONES.owner);
  await page.getByTestId('user-menu').click();
  await page.getByRole('menuitem', { name: /Sàn CARDIY/ }).click();
  await expect(page.getByTestId('workspace-name')).toHaveText('Sàn CARDIY');
  await page.getByTestId('sidebar').getByRole('link', { name: 'Kiểm duyệt xe cũ' }).click();
  await expect(page).toHaveURL(/\/san\/xe-cu$/);

  const modCard = page.getByTestId('platform-used-car-card').filter({ hasText: title });
  await expect(modCard).toContainText('Đã kiểm định 100/100');
  await modCard.getByTestId('platform-used-car-approve').click();
  await expect(modCard).toBeHidden();

  await page.getByTestId('user-menu').click();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/dang-nhap/);

  // 3. Khách mở /cho/xe-cu (A1.07), bật lọc Chỉ hiện xe Đã kiểm định, xem báo cáo 100/100 & gửi lịch hẹn xem xe
  await page.goto('/cho/xe-cu');
  await page.getByTestId('used-car-verified-filter').check();
  await page.getByTestId('used-car-search-bar').getByLabel('Tìm tên xe / hãng').fill(tag);

  const pubCard = page.getByTestId('public-used-car-card').filter({ hasText: title });
  await expect(pubCard).toBeVisible();
  await expect(pubCard.getByTestId('used-car-verified-badge')).toContainText('100/100');
  await pubCard.click();

  await expect(page.getByTestId('used-car-detail-title')).toHaveText(title);
  await expect(page.getByTestId('used-car-appraisal-report')).toBeVisible();
  await expect(page.getByTestId('appraisal-score-box')).toContainText('100/100');

  const form = page.getByTestId('public-used-car-inquiry-form');
  await form.getByLabel('Họ và tên của bạn *').fill('Nguyễn Minh Khôi');
  await form.getByLabel('Số điện thoại liên hệ *').fill(buyerPhone);
  await form.getByLabel('Đề xuất ngày giờ xem xe').fill(localDateTime(3, 10));
  await form.getByLabel('Nội dung nhắn người bán *').fill(`Mình muốn qua xem xe ${tag} sáng mai nhé!`);
  await form.getByTestId('used-car-inquiry-submit').click();

  await expect(page).toHaveURL(/\/cho\/xe-cu\/hoi-mua\/.+\?t=/);
  const threadUrl = page.url();
  await expect(page.getByTestId('used-car-viewing-status')).toContainText('Chờ xác nhận lịch xem xe');

  // 4. Đối tác mở lại /doi-tac/kiem-dinh -> Khách hỏi & hẹn xem -> xác nhận lịch xem xe & trả lời chat
  await loginUI(page, PHONES.partnerOwner, 'Cardiy2026', '/doi-tac/kiem-dinh');
  await page.getByRole('tab', { name: /Khách hỏi & hẹn xem/ }).click();

  const thCard = page.getByTestId('garage-thread-card').filter({ hasText: buyerPhone });
  await expect(thCard).toBeVisible();
  await thCard.getByTestId('garage-open-thread-btn').click();
  await page.getByTestId('garage-confirm-viewing-btn').click();
  await page.getByLabel('Phản hồi khách mua').fill('Mời anh Khôi ghé showroom Hà Đông đúng 10h nhé!');
  await page.getByTestId('garage-send-reply-btn').click();
  await expect(page.getByTestId('garage-thread-messages')).toContainText('ghé showroom Hà Đông');
  await page.getByLabel('Đóng').click();

  await page.getByTestId('user-menu').click();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/dang-nhap/);

  // 5. Khách mở lại phòng chat: thấy Đã xác nhận lịch xem xe và tin nhắn phản hồi
  await page.goto(threadUrl);
  await expect(page.getByTestId('used-car-viewing-status')).toContainText('Đã xác nhận lịch xem xe');
  await expect(page.getByTestId('public-thread-messages')).toContainText('ghé showroom Hà Đông');
});

test('điện thoại: khách lọc xe Đã kiểm định trên /cho/xe-cu, xem báo cáo kỹ thuật và gửi câu hỏi mua xe', async ({ page }) => {
  await page.goto('/cho/xe-cu');
  await page.getByTestId('used-car-verified-filter').check();

  const card = page.getByTestId('public-used-car-card').first();
  await expect(card).toBeVisible();
  await card.click();

  await expect(page.getByTestId('used-car-appraisal-report')).toBeVisible();
  const form = page.getByTestId('public-used-car-inquiry-form');
  await form.getByLabel('Họ và tên của bạn *').fill('Lê Khách Mobile');
  await form.getByLabel('Số điện thoại liên hệ *').fill(randomPhone());
  await form.getByTestId('used-car-inquiry-submit').click();

  await expect(page).toHaveURL(/\/cho\/xe-cu\/hoi-mua\/.+\?t=/);
  await expect(page.getByTestId('public-used-car-thread')).toBeVisible();
});
