import { expect, test } from '@playwright/test';
import { loginUI, PHONES, randomPhone, randomPlate } from './helpers';

const tag = `AIUI${Date.now().toString(36).toUpperCase()}`;

test('tóm tắt lịch sử xe có che PII (/xe/[id] · A3.32) -> AI gợi ý báo giá & người duyệt mới ghi vào đơn (/don-hang/[id] · A3.12) -> thêm quy trình & hỏi đáp kho tri thức (/tro-ly-ai · A3.63)', async ({
  page,
  request,
  isMobile,
}) => {
  test.skip(isMobile, 'luồng tổng hợp kiểm tra trên máy tính; giao diện điện thoại kiểm tra ở test riêng');

  const api = process.env.API_URL ?? 'http://localhost:4000';
  const salesTok = (await (await request.post(`${api}/api/auth/login`, { data: { phone: PHONES.sales, password: 'Cardiy2026' } })).json())
    .accessToken as string;
  const h = { Authorization: `Bearer ${salesTok}` };
  const cn1 = (await (await request.get(`${api}/api/branches`, { headers: h })).json()).find((b: { code: string }) => b.code === 'CN1');

  const secretName = `Anh Minh Bảo Mật ${tag}`;
  const cust = await (
    await request.post(`${api}/api/customers`, {
      headers: h,
      data: {
        name: secretName,
        phone: randomPhone(),
        address: '188 Nguyễn Huệ, Quận 1',
        vehicle: {
          plate: randomPlate(),
          make: 'Mazda',
          model: 'CX-5',
          year: 2022,
          odometerKm: 39_500,
        },
      },
    })
  ).json();
  const cd = await (await request.get(`${api}/api/customers/${cust.id}`, { headers: h })).json();
  const vehicleId = cd.vehicles[0].id as string;

  const ro = await (
    await request.post(`${api}/api/orders`, {
      headers: h,
      data: {
        branchId: cn1.id,
        customerId: cust.id,
        vehicleId,
        odometerKm: 39_500,
        request: `Gọi ${secretName} số 0913 222 333: điều hoà kém mát và phanh trước kêu két két`,
        items: [{ kind: 'DICH_VU', name: 'Tiếp nhận kiểm tra cầu nâng', quantity: 1, unitPrice: 100_000 }],
      },
    })
  ).json();

  // 1. Hồ sơ xe (/xe/[id] · A3.32): Tóm tắt bằng AI & đối chứng che PII
  await loginUI(page, PHONES.owner, 'Cardiy2026', `/xe/${vehicleId}`);
  await expect(page.getByTestId('vehicle-ai-card')).toBeVisible();
  await page.getByTestId('vehicle-ai-summarize-btn').click();
  await expect(page.getByTestId('vehicle-ai-summary-text')).toContainText('HỒ SƠ KỸ THUẬT XE');
  await expect(page.getByTestId('vehicle-ai-summary-text')).toContainText('40.000 km');

  await page.getByTestId('vehicle-ai-toggle-sanitized').click();
  const sanitizedVehicleJson = await page.getByTestId('vehicle-ai-sanitized-json').textContent();
  expect(sanitizedVehicleJson).not.toContain(secretName);
  expect(sanitizedVehicleJson).not.toContain('0913 222 333');
  expect(sanitizedVehicleJson).toContain('[KHÁCH_HÀNG_ĐÃ_CHE]');
  expect(sanitizedVehicleJson).toContain('[SĐT_ĐÃ_CHE]');

  // 2. Chi tiết Lệnh sửa chữa (/don-hang/[id] · A3.12): AI chỉ đề xuất, bấm Duyệt mới ghi vào bảng hạng mục
  await page.goto(`/don-hang/${ro.id}`);
  await expect(page.getByTestId('order-ai-card')).toBeVisible();
  await page.getByTestId('order-ai-suggest-btn').click();
  await expect(page.getByTestId('order-ai-items-table')).toBeVisible();

  // Trước khi duyệt: bảng hạng mục của đơn CHƯA có mục AI
  await expect(page.getByTestId('item-table')).not.toContainText('Đề xuất AI đã duyệt');

  // Nhân viên bấm Duyệt -> ghi vào đơn sửa chữa
  await page.getByTestId('order-ai-apply-btn').click();
  await expect(page.getByTestId('order-ai-result')).toContainText('Đã duyệt ghi');
  await expect(page.getByTestId('item-table')).toContainText('Đề xuất AI đã duyệt');

  // 3. Không gian Trợ lý AI (/tro-ly-ai · A3.63): Thêm quy trình kỹ thuật & hỏi đáp trích dẫn tài liệu
  const docCode = `DOC-CVT-${tag}`;
  await page.goto('/tro-ly-ai');
  await expect(page.getByTestId('ai-assistant-page')).toBeVisible();

  await page.getByRole('tab', { name: /Kho tri thức & Nhật ký/ }).click();
  await expect(page.getByTestId('ai-history-table')).toBeVisible();
  await page.getByTestId('ai-add-doc-btn').click();
  await page.getByLabel('Mã tài liệu (IN-HOA) *').fill(docCode);
  await page.getByLabel('Tiêu đề quy trình *').fill(`Chẩn đoán hộp số CVT giật cục ${tag}`);
  await page.getByLabel('Từ khoá chẩn đoán (cách nhau bởi dấu phẩy)').fill('hop so cvt, giat cuc');
  await page
    .getByLabel('Nội dung quy trình & thông số kỹ thuật *')
    .fill('Đo nhiệt độ dầu CVT ở ngưỡng 40 độ C và kiểm tra van điều áp tuyến tính.');
  await page.getByTestId('ai-save-doc-btn').click();

  await expect(page.getByTestId('ai-docs-list')).toContainText(docCode);

  await page.getByRole('tab', { name: /Hỏi đáp kỹ thuật xưởng/ }).click();
  await page.getByLabel('Câu hỏi kỹ thuật / Mã lỗi OBD *').fill('Xe bị giật cục hộp số CVT khi đạp ga cần kiểm tra thông số nào?');
  await page.getByTestId('ai-ask-tech-btn').click();
  await expect(page.getByTestId('ai-tech-output')).toContainText(`Trích dẫn: ${docCode}`);
  await expect(page.getByTestId('ai-tech-output')).toContainText('40 độ C');
});

test('giao diện điện thoại: Kỹ thuật viên tra cứu hỏi đáp mã lỗi OBD trên Trợ lý AI (/tro-ly-ai)', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'chỉ chạy trên cấu hình điện thoại');

  await loginUI(page, PHONES.tech, 'Cardiy2026', '/tro-ly-ai');
  await expect(page.getByTestId('ai-assistant-page')).toBeVisible();

  await page.getByRole('tab', { name: /Hỏi đáp kỹ thuật xưởng/ }).click();
  await page.getByLabel('Câu hỏi kỹ thuật / Mã lỗi OBD *').fill('Xe báo mã lỗi P0300 bỏ máy động cơ và ắc quy đề yếu');
  await page.getByTestId('ai-ask-tech-btn').click();
  await expect(page.getByTestId('ai-tech-output')).toContainText('DOC-AC-QUY-DIEN-OBD');
});
