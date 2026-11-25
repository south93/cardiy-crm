import { expect, request as pwRequest, test } from '@playwright/test';
import { loginUI, PHONES, randomPhone } from './helpers';

const API = `http://localhost:${process.env.API_PORT ?? 4000}/api`;
const tag = `V35${Date.now().toString(36).toUpperCase()}`;
const code = `LOP-RV-${tag}`;
const hours = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '07:00', close: '18:00', closed: false }));

let partnerToken = '';
let saToken = '';
let offerId = '';

test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  const login = async (phone: string) =>
    (await (await api.post(`${API}/auth/login`, { data: { phone, password: 'Cardiy2026' } })).json()).accessToken as string;
  const h = (t: string) => ({ Authorization: `Bearer ${t}` });

  const plg = await login(PHONES.owner);
  const me = await (await api.get(`${API}/me`, { headers: h(plg) })).json();
  const pf = me.memberships.find((m: { tenantType: string }) => m.tenantType === 'PLATFORM');
  saToken = (await (await api.post(`${API}/auth/switch`, { headers: h(plg), data: { membershipId: pf.membershipId } })).json()).accessToken as string;
  partnerToken = await login(PHONES.partnerOwner);

  const item = await (
    await api.post(`${API}/platform/catalog/items`, {
      headers: h(saToken),
      data: { kind: 'PRODUCT', code, name: `Lốp V35 ${tag}` },
    })
  ).json();

  await api.put(`${API}/shop`, {
    headers: h(partnerToken),
    data: { name: 'Minh Phát Auto', phone: '0900000010', address: 'Hà Đông, Hà Nội', province: 'Hà Nội', lat: 20.97, lng: 105.77, openingHours: hours },
  });

  const po = await (
    await api.post(`${API}/shop/offers`, {
      headers: h(partnerToken),
      data: { kind: 'PRODUCT', catalogItemId: item.id, price: 1_200_000, manualStock: 6, installIncluded: true },
    })
  ).json();
  offerId = po.id;
  await api.post(`${API}/shop/offers/${offerId}/submit`, { headers: h(partnerToken) });
  await api.post(`${API}/platform/offers/${offerId}/approve`, { headers: h(saToken) });
  await api.dispose();
});

test('khách xem tin & đánh giá sau khi mua, gửi phản ánh; đối tác trả lời, giải trình & xem thống kê; sàn xử lý kết luận', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'luồng quản trị nhiều vai trò chạy trên máy tính; giao diện khách trên điện thoại kiểm tra ở test riêng');

  const phone = randomPhone();
  const commentText = `Lắp đặt rất chuẩn ${tag}`;
  const reportDesc = `Phụ phí cân bằng động chưa ghi rõ trên tin ${tag}`;

  // 1. Khách xem trang sản phẩm (ghi nhận lượt xem tin) và đặt hàng
  await page.goto(`/cho/san-pham/${code.toLowerCase()}`);
  await page.getByTestId('seller-row').first().getByTestId('request-button').click();
  await page.getByTestId('day-chips').getByRole('button', { name: 'Ngày mai' }).click();
  await page.getByTestId('time-slots').getByRole('button').first().click();
  await page.getByLabel('Họ tên').fill('Phạm Minh Tuấn');
  await page.getByLabel('Số điện thoại').fill(phone);
  await page.getByTestId('send-request').click();
  await expect(page).toHaveURL(/\/cho\/yeu-cau\/.+t=/);
  const trackUrl = page.url();
  const reqId = trackUrl.match(/\/cho\/yeu-cau\/([^?]+)/)![1]!;

  // Đối tác xác nhận + hoàn tất qua API để chuyển sang bước sau mua
  const api = await pwRequest.newContext();
  await api.post(`${API}/seller/requests/${reqId}/confirm`, {
    headers: { Authorization: `Bearer ${partnerToken}` },
    data: { finalTotal: 1_200_000 },
  });
  await api.post(`${API}/seller/requests/${reqId}/complete`, {
    headers: { Authorization: `Bearer ${partnerToken}` },
    data: {},
  });
  await api.dispose();

  // 2. Khách mở lại link theo dõi: gửi đánh giá 5 sao + gửi phản ánh tới sàn
  await page.goto(trackUrl);
  await expect(page.getByTestId('request-status')).toHaveText('Hoàn tất');
  await page.getByTestId('star-5').click();
  await page.getByTestId('review-comment').fill(commentText);
  await page.getByTestId('submit-review').click();
  await expect(page.getByTestId('customer-review-box')).toContainText('Đã gửi đánh giá');

  await page.getByTestId('open-report-dialog').click();
  await page.getByTestId('report-reason').selectOption('SAI_GIA');
  await page.getByTestId('report-description').fill(reportDesc);
  await page.getByTestId('submit-report').click();
  await expect(page.getByTestId('tracked-reports')).toContainText('Sàn đã tiếp nhận');

  // Khách ghé trang gian hàng: thấy đánh giá mới và ghi nhận lượt xem gian hàng
  await page.goto('/cho/garage/minh-phat-auto');
  await expect(page.getByTestId('shop-reviews')).toContainText(commentText);

  // 3. Admin sàn yêu cầu đối tác giải trình phản ánh (A6.41)
  await loginUI(page, PHONES.owner);
  await page.getByTestId('user-menu').click();
  await page.getByRole('menuitem', { name: /Sàn CARDIY/ }).click();
  await expect(page.getByTestId('workspace-name')).toHaveText('Sàn CARDIY');
  await page.goto('/san/phan-anh');
  await page.getByLabel('Tìm phản ánh').fill(phone);
  await page.getByTestId('platform-report-card').first().click();
  await page.getByTestId('ask-explanation-btn').click();
  await page.getByTestId('ask-explanation-input').fill('Đề nghị đối tác làm rõ khoản phụ phí cân bằng động');
  await page.getByTestId('confirm-ask-explanation').click();
  await expect(page.getByTestId('confirm-ask-explanation')).toHaveCount(0);
  await page.getByTestId('user-menu').click();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/dang-nhap/);

  // 4. Đối tác đăng nhập: trả lời đánh giá (A7.24), gửi giải trình phản ánh, xem thống kê gian hàng (A7.30)
  await loginUI(page, PHONES.partnerOwner);
  await page.goto('/doi-tac/danh-gia');
  const revCard = page.getByTestId('seller-review-card').filter({ hasText: commentText });
  await expect(revCard).toBeVisible();
  await revCard.getByTestId('open-reply-review').click();
  await page.getByTestId('reply-input').fill('Cảm ơn anh Tuấn đã tin tưởng garage!');
  await page.getByTestId('save-review-reply').click();
  await expect(revCard).toContainText('Cảm ơn anh Tuấn đã tin tưởng garage!');

  await page.getByRole('tab', { name: /Phản ánh & vi phạm/ }).click();
  const repCard = page.getByTestId('seller-report-card').filter({ hasText: reportDesc });
  await repCard.getByTestId('open-explain-dialog').click();
  await page.getByTestId('explain-input').fill('Garage đã hoàn lại phí cân bằng động và cập nhật mô tả tin đăng');
  await page.getByTestId('submit-explanation').click();
  await expect(repCard).toContainText('Garage đã giải trình');

  await page.goto('/doi-tac/thong-ke');
  await expect(page.getByTestId('stat-views')).toBeVisible();
  await expect(page.getByTestId('stat-requests')).toBeVisible();
  await expect(page.getByTestId('stat-close-rate')).toBeVisible();
  const offerRow = page.getByTestId('offer-stat-row').filter({ hasText: tag });
  await expect(offerRow).toContainText('100%');

  await page.getByTestId('user-menu').click();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/dang-nhap/);

  // 5. Admin sàn kết luận phản ánh kèm nhắc nhở
  await loginUI(page, PHONES.owner);
  await page.getByTestId('user-menu').click();
  await page.getByRole('menuitem', { name: /Sàn CARDIY/ }).click();
  await expect(page.getByTestId('workspace-name')).toHaveText('Sàn CARDIY');
  await page.goto('/san/phan-anh');
  await page.getByLabel('Tìm phản ánh').fill(phone);
  await page.getByTestId('platform-report-card').first().click();
  await page.getByTestId('resolve-report-btn').click();
  await page.getByTestId('resolve-violation-action').selectOption('NHAC_NHO');
  await page.getByTestId('resolve-note-input').fill('Đối tác đã hoàn phí cho khách, sàn nhắc nhở ghi rõ chi tiết dịch vụ');
  await page.getByTestId('confirm-resolve-report').click();
  await expect(page.getByTestId('confirm-resolve-report')).toHaveCount(0);
  await page.getByTestId('user-menu').click();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/dang-nhap/);

  // 6. Khách mở lại link theo dõi: thấy cả phản hồi đánh giá của garage và kết luận của sàn
  await page.goto(trackUrl);
  await expect(page.getByTestId('seller-reply')).toContainText('Cảm ơn anh Tuấn đã tin tưởng garage!');
  await expect(page.getByTestId('report-resolution')).toContainText('Đối tác đã hoàn phí cho khách');
});

test('khách trên điện thoại đánh giá sau khi mua trên trang theo dõi yêu cầu', async ({ page }) => {
  const api = await pwRequest.newContext();
  const phone = randomPhone();
  const tomorrow = () => {
    const d = new Date(Date.now() + 86_400_000 + 7 * 3_600_000);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 3, 0)).toISOString();
  };
  const created = await (
    await api.post(`${API}/public/market/requests`, {
      data: { name: 'Lê Thu Hà', phone, scheduledAt: tomorrow(), items: [{ offerId, quantity: 1 }] },
    })
  ).json();
  await api.post(`${API}/seller/requests/${created.id}/confirm`, {
    headers: { Authorization: `Bearer ${partnerToken}` },
    data: { finalTotal: 1_200_000 },
  });
  await api.post(`${API}/seller/requests/${created.id}/complete`, {
    headers: { Authorization: `Bearer ${partnerToken}` },
    data: {},
  });
  await api.dispose();

  await page.goto(`/cho/yeu-cau/${created.id}?t=${encodeURIComponent(created.token)}`);
  await expect(page.getByTestId('customer-review-box')).toBeVisible();
  await page.getByTestId('star-4').click();
  await page.getByTestId('review-comment').fill('Phục vụ chu đáo trên điện thoại');
  await page.getByTestId('submit-review').click();
  await expect(page.getByTestId('customer-review-box')).toContainText('Đã gửi đánh giá');
});
