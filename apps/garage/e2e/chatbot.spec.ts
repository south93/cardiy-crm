import { expect, test } from '@playwright/test';
import { PHONES, randomPhone, randomPlate } from './helpers';

const tag = `CBUI${Date.now().toString(36).toUpperCase()}`;

test('Web sàn công khai (A1 · /cho/tro-ly-ai): hỏi bảo dưỡng 40.000 km & giá dầu nhớt có che PII -> AI đề xuất khung giờ -> khách bấm Xác nhận mới tạo yêu cầu YC…', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'luồng Web sàn kiểm tra trên máy tính; luồng App chủ xe kiểm tra trên điện thoại ở test dưới');

  await page.goto('/cho');
  await page.getByTestId('market-chatbot-link').click();
  await expect(page).toHaveURL(/\/cho\/tro-ly-ai$/);
  await expect(page.getByTestId('market-chatbot-page')).toBeVisible();

  await page
    .getByTestId('market-ai-input')
    .fill('Tôi số 0916 555 777: xe Mazda CX-5 đi 40.000 km cần bảo dưỡng gì, giá dầu 5W-30 trên sàn bao nhiêu và cho tôi đặt lịch?');
  await page.getByTestId('market-ai-send-btn').click();

  await expect(page.getByTestId('market-ai-maint-card')).toContainText('40.000 km');
  await expect(page.getByTestId('market-ai-offers')).toBeVisible();
  await expect(page.getByTestId('market-ai-proposal-card')).toContainText('Chờ bạn xác nhận');

  // Đối chứng ngữ cảnh gửi AI đã che sạch SĐT
  await page.getByTestId('market-ai-toggle-sanitized').click();
  const sanitized = await page.getByTestId('market-ai-sanitized-json').textContent();
  expect(sanitized).not.toContain('0916 555 777');
  expect(sanitized).toContain('[SĐT_ĐÃ_CHE]');

  // Khách điền thông tin và bấm Xác nhận -> tạo yêu cầu đặt lịch YC… thật và mở trang theo dõi
  await page.getByLabel('Họ tên người đặt *').fill(`Khách AI Sàn ${tag}`);
  await page.getByLabel('Số điện thoại liên hệ *').fill(randomPhone());
  await page.getByLabel('Biển số xe (tuỳ chọn)').fill(randomPlate());
  await page.getByTestId('market-ai-confirm-btn').click();

  await expect(page.getByTestId('market-ai-confirmed-box')).toContainText('Đã tạo yêu cầu YC');
  await page.getByTestId('market-ai-track-link').click();
  await expect(page).toHaveURL(/\/cho\/yeu-cau\//);
  await expect(page.getByText('Chờ garage xác nhận')).toBeVisible();
});

test('App chủ xe trên điện thoại (A2 · /app/tro-ly-ai): tư vấn mốc bảo dưỡng theo xe đang đi -> đề xuất khung giờ -> chủ xe xác nhận mới tạo lịch hẹn LH…', async ({
  page,
  request,
  isMobile,
}) => {
  test.skip(!isMobile, 'chỉ chạy trên cấu hình điện thoại PWA cho chủ xe');

  const api = process.env.API_URL ?? 'http://localhost:4000';
  const salesTok = (await (await request.post(`${api}/api/auth/login`, { data: { phone: PHONES.sales, password: 'Cardiy2026' } })).json())
    .accessToken as string;
  const h = { Authorization: `Bearer ${salesTok}` };

  const cust = await (
    await request.post(`${api}/api/customers`, {
      headers: h,
      data: {
        name: `Chủ Xe AI ${tag}`,
        phone: randomPhone(),
        address: '55 Điện Biên Phủ, Quận 3',
        vehicle: {
          plate: randomPlate(),
          make: 'Hyundai',
          model: 'Tucson',
          year: 2023,
          odometerKm: 19_400,
        },
      },
    })
  ).json();
  const invite = await (await request.post(`${api}/api/customers/${cust.id}/app/invite`, { headers: h })).json();

  await page.goto(new URL(invite.url).pathname);
  await page.getByLabel('Mật khẩu', { exact: true }).fill('Chuxe2026');
  await page.getByLabel('Nhập lại mật khẩu').fill('Chuxe2026');
  await page.getByTestId('activate').click();
  await expect(page).toHaveURL(/\/app$/);

  await page.getByTestId('owner-chatbot-cta').click();
  await expect(page).toHaveURL(/\/app\/tro-ly-ai$/);
  await expect(page.getByTestId('owner-chatbot-page')).toBeVisible();
  await expect(page.getByTestId('owner-ai-vehicle-pill')).toContainText('19.400 km');

  // 1. Bấm câu hỏi gợi ý bảo dưỡng theo xe -> nhận kế hoạch cấp trung 20.000 km
  await page.getByTestId('owner-ai-starter').first().click();
  await expect(page.getByTestId('owner-ai-maint-card')).toContainText('20.000 km');

  // 2. Bấm câu hỏi gợi ý đề xuất khung giờ đặt lịch -> mới ở trạng thái "Chưa đặt"
  await page.getByTestId('owner-ai-starter').nth(2).click();
  await expect(page.getByTestId('owner-ai-proposal-card')).toContainText('Chưa đặt');

  // Chủ xe bấm Xác nhận đặt lịch hẹn -> tạo lịch hẹn LH… thật và chuyển sang xem tại /app/lich-hen
  await page.getByTestId('owner-ai-confirm-booking-btn').click();
  await expect(page.getByTestId('owner-ai-booking-confirmed')).toContainText('Đã tạo lịch hẹn LH');
  await page.getByTestId('owner-ai-booking-confirmed').getByRole('link', { name: 'Xem lịch hẹn' }).click();
  await expect(page).toHaveURL(/\/app\/lich-hen$/);
  await expect(page.getByText(/LH\d{6}/)).toBeVisible();
});
