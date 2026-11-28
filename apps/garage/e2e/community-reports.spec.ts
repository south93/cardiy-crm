import { expect, test } from '@playwright/test';
import { loginUI, PHONES } from './helpers';

const tag = `CDUI${Date.now().toString(36).toUpperCase()}`;

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test('chủ garage xem Báo cáo chuỗi KPI/SLA (A3.80) -> chuyển sang Quản trị sàn xem Dashboard báo cáo (A6.01), xuất bản Sách nói, Banner & bài viết WYSIWYG (ảnh bìa, chèn ảnh, lưu nháp, xem trước, sửa bài giữ link) -> khách xem trên /cho/cong-dong (A1.10)', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'luồng quản trị đa không gian kiểm tra trên máy tính; giao diện điện thoại kiểm tra ở test riêng');

  const audioTitle = `Sách nói: Bí quyết đi cao tốc ban đêm ${tag}`;
  const bannerTitle = `Tuần lễ an toàn giao thông ${tag}`;
  const draftBlogTitle = `Nháp bảo dưỡng phanh ABS ${tag}`;
  const liveBlogTitle = `Cẩm nang bảo dưỡng phanh ABS thực chiến ${tag}`;
  const editedBlogTitle = `${liveBlogTitle} (Đã cập nhật)`;

  // 1. Chủ garage PLG vào Báo cáo (/bao-cao, A3.80): thấy bảng so sánh 3 chi nhánh CN1, CN2, CN3 & các tab năng suất KTV, tồn kho
  await loginUI(page, PHONES.owner, 'Cardiy2026', '/bao-cao');
  await expect(page.getByTestId('garage-reports-page')).toBeVisible();
  await expect(page.getByTestId('garage-report-kpis')).toBeVisible();

  const branchTable = page.getByTestId('branch-kpi-table');
  await expect(branchTable).toContainText('CN1');
  await expect(branchTable).toContainText('CN2');
  await expect(branchTable).toContainText('CN3');

  await page.getByRole('tab', { name: /Năng suất KTV/ }).click();
  await expect(page.getByTestId('tech-kpi-table')).toBeVisible();

  await page.getByRole('tab', { name: /Tồn kho & Vật tư/ }).click();
  await expect(page.getByTestId('low-stock-table')).toBeVisible();

  // 2. Chuyển sang không gian Sàn CARDIY -> mở Dashboard & Báo cáo sàn (/san/bao-cao, A6.01 & A6.80)
  await page.getByTestId('user-menu').click();
  await page.getByRole('menuitem', { name: /Sàn CARDIY/ }).click();
  await expect(page.getByTestId('workspace-name')).toHaveText('Sàn CARDIY');

  await page.getByTestId('sidebar').getByRole('link', { name: 'Dashboard & Báo cáo sàn' }).click();
  await expect(page).toHaveURL(/\/san\/bao-cao$/);
  await expect(page.getByTestId('platform-report-kpis')).toBeVisible();
  await expect(page.getByTestId('platform-domain-cards')).toContainText('Cứu hộ SOS 24/7');
  await expect(page.getByTestId('platform-top-shops-table')).toBeVisible();

  // 3. Mở Cộng đồng & Nội dung (/san/cong-dong, A6.32 & A6.62) -> tạo Banner cộng đồng & xuất bản Sách nói chính thức
  await page.getByTestId('sidebar').getByRole('link', { name: 'Cộng đồng & Nội dung' }).click();
  await expect(page).toHaveURL(/\/san\/cong-dong$/);

  await page.getByTestId('platform-add-banner-btn').click();
  await page.getByLabel('Tiêu đề chiến dịch / banner *').fill(bannerTitle);
  await page.getByLabel('Mô tả phụ').fill('Cẩm nang lái xe đường dài từ kỹ sư CARDIY');
  await page.getByTestId('platform-banner-submit').click();

  await page.getByTestId('platform-publish-editorial-btn').click();
  await page.getByLabel('Tiêu đề xuất bản *').fill(audioTitle);
  await page.getByLabel('Tóm tắt ngắn').fill('Kinh nghiệm chỉnh đèn pha/cos và giữ tỉnh táo ban đêm');
  await page.getByLabel('Nội dung chi tiết / Lời giới thiệu *').fill(
    'Bộ sách nói hướng dẫn chi tiết cách nhận diện chướng ngại vật từ xa và nghỉ ngơi hợp lý khi lái xe đêm.',
  );
  await page.getByTestId('platform-editorial-submit').click();

  const publishedCard = page.getByTestId('platform-community-card').filter({ hasText: audioTitle });
  await expect(publishedCard).toBeVisible();

  // 3b. Soạn bài Blog với Ảnh bìa + WYSIWYG chèn ảnh (nén WebP) -> Xem trước điện thoại -> Lưu nháp -> Xuất bản -> Sửa bài giữ nguyên link
  await page.getByTestId('platform-publish-editorial-btn').click();
  await page.getByLabel('Định dạng nội dung *').selectOption('BLOG');
  await page.getByLabel('Tiêu đề xuất bản *').fill(draftBlogTitle);
  await page.getByLabel('Tóm tắt ngắn').fill('Hướng dẫn kiểm tra má phanh và dầu phanh DOT4');

  await page.getByTestId('platform-editorial-cover-input').setInputFiles({
    name: 'anh-bia.png',
    mimeType: 'image/png',
    buffer: TINY_PNG,
  });
  await expect(page.getByTestId('platform-editorial-cover-preview')).toBeVisible();

  await page.getByLabel('Nội dung chi tiết / Lời giới thiệu *').fill('Kiểm tra độ dày má phanh định kỳ mỗi 10.000 km.');
  await page.getByTestId('platform-editorial-wysiwyg-image-input').setInputFiles({
    name: 'anh-trong-bai.png',
    mimeType: 'image/png',
    buffer: TINY_PNG,
  });
  await expect(page.getByTestId('platform-editorial-wysiwyg-editor').locator('img')).toBeVisible();

  await page.getByTestId('platform-editorial-preview-btn').click();
  await expect(page.getByTestId('community-preview-dialog')).toBeVisible();
  await expect(page.getByTestId('community-preview-frame-mobile')).toContainText(draftBlogTitle);
  await page.getByTestId('community-preview-close').click();

  await page.getByTestId('platform-editorial-draft-btn').click();
  const draftCard = page.getByTestId('platform-community-card').filter({ hasText: draftBlogTitle });
  await expect(draftCard).toBeVisible();

  await draftCard.getByTestId('platform-community-edit').click();
  await page.getByLabel('Tiêu đề xuất bản *').fill(liveBlogTitle);
  await page.getByTestId('platform-editorial-submit').click();

  const liveBlogCard = page.getByTestId('platform-community-card').filter({ hasText: liveBlogTitle });
  await expect(liveBlogCard).toBeVisible();
  const originalHref = await liveBlogCard.getByRole('link').getAttribute('href');
  expect(originalHref).toMatch(/^\/cho\/cong-dong\/[0-9a-f-]{36}$/);

  await liveBlogCard.getByTestId('platform-community-edit').click();
  await expect(page.getByTestId('platform-editorial-permanent-link-banner')).toContainText(originalHref!);
  await page.getByLabel('Tiêu đề xuất bản *').fill(editedBlogTitle);
  await page.getByTestId('platform-editorial-submit').click();
  await expect(page.getByTestId('platform-community-card').filter({ hasText: editedBlogTitle })).toBeVisible();

  await page.getByTestId('user-menu').click();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/dang-nhap/);

  // 4. Khách truy cập công khai /cho/cong-dong (A1.10): thấy Banner, bài Blog có ảnh bìa & giữ nguyên link sau khi sửa, và nghe Sách nói
  await page.goto('/cho/cong-dong');
  await expect(page.getByTestId('community-banners')).toContainText(bannerTitle);

  const pubBlogCard = page.getByTestId('public-community-card').filter({ hasText: editedBlogTitle });
  await expect(pubBlogCard).toBeVisible();
  await expect(pubBlogCard.getByTestId('public-community-card-cover')).toBeVisible();
  await pubBlogCard.click();

  await expect(page).toHaveURL(new RegExp(`${originalHref!.replace(/\//g, '\\/')}$`));
  await expect(page.getByTestId('community-detail-title')).toHaveText(editedBlogTitle);
  await expect(page.getByTestId('community-detail-cover')).toBeVisible();
  await expect(page.getByTestId('community-detail-content').locator('img')).toBeVisible();

  // Kiểm tra hiển thị đẹp trên kích thước màn hình điện thoại (390x844) không tràn ngang
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('community-detail-cover')).toBeVisible();
  await expect(page.getByTestId('community-detail-content').locator('img')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('/cho/cong-dong');
  await page.getByRole('tab', { name: 'Sách nói' }).click();
  const pubAudioCard = page.getByTestId('public-community-card').filter({ hasText: audioTitle });
  await expect(pubAudioCard).toBeVisible();
  await pubAudioCard.click();

  await expect(page.getByTestId('community-detail-title')).toHaveText(audioTitle);
  await expect(page.getByTestId('community-playlist-box')).toContainText('Chương 1');
});

test('điện thoại: khách mở Cộng đồng (/cho/cong-dong), chuyển tab Sách nói và xem danh mục chương', async ({ page }) => {
  await page.goto('/cho/cong-dong');
  await expect(page.getByTestId('public-community-page')).toBeVisible();

  await page.getByRole('tab', { name: 'Sách nói' }).click();
  const firstAudio = page.getByTestId('public-community-card').first();
  await expect(firstAudio).toBeVisible();
  await firstAudio.click();

  await expect(page.getByTestId('community-playlist-box')).toBeVisible();
  await expect(page.getByTestId('public-community-interact-cta')).toBeVisible();
});
