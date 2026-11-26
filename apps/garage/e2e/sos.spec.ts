import { expect, request as pwRequest, test } from '@playwright/test';
import { loginUI, PHONES, randomPhone, randomPlate } from './helpers';

const API = `http://localhost:${process.env.API_PORT ?? 4000}/api`;
const tag = `SOSUI${Date.now().toString(36).toUpperCase()}`;
const hours = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '07:00', close: '18:00', closed: false }));

test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  const login = async (phone: string) =>
    (await (await api.post(`${API}/auth/login`, { data: { phone, password: 'Cardiy2026' } })).json()).accessToken as string;
  const h = (t: string) => ({ Authorization: `Bearer ${t}` });

  const plg = await login(PHONES.owner);
  const me = await (await api.get(`${API}/me`, { headers: h(plg) })).json();
  const pf = me.memberships.find((m: { tenantType: string }) => m.tenantType === 'PLATFORM');
  const sa = (await (await api.post(`${API}/auth/switch`, { headers: h(plg), data: { membershipId: pf.membershipId } })).json()).accessToken as string;
  const dt = await login(PHONES.partnerOwner);

  const item = await (
    await api.post(`${API}/platform/catalog/items`, {
      headers: h(sa),
      data: { kind: 'SERVICE', code: `DV-SOS-UI-${tag}`, name: `Cứu hộ giao thông ${tag}` },
    })
  ).json();

  await api.put(`${API}/shop`, {
    headers: h(dt),
    data: { name: 'Minh Phát Auto', phone: '0900000010', address: 'Hà Đông, Hà Nội', province: 'Hà Nội', lat: 20.97, lng: 105.77, openingHours: hours },
  });
  const po = await (
    await api.post(`${API}/shop/offers`, {
      headers: h(dt),
      data: { kind: 'SERVICE', catalogItemId: item.id, price: 250_000, priceFrom: true },
    })
  ).json();
  await api.post(`${API}/shop/offers/${po.id}/submit`, { headers: h(dt) });
  await api.post(`${API}/platform/offers/${po.id}/approve`, { headers: h(sa) });

  await api.put(`${API}/sos/config`, {
    headers: h(dt),
    data: { enabled: true, onDuty: true, hotline: '0900000010', radiusKm: 25, basePrice: 250_000, note: 'Cứu hộ nội thành 24/7' },
  });
  await api.dispose();
});

test('khách gửi SOS trên /cho/cuu-ho -> đối tác nhận ca, xuất phát, cập nhật GPS, xử lý tại chỗ & hoàn thành -> khách đánh giá -> sàn giám sát', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'luồng nhiều vai trò kiểm tra trên máy tính; giao diện điện thoại kiểm tra ở test riêng');

  const phone = randomPhone();
  const plate = randomPlate();

  // 1. Khách mở trang /cho/cuu-ho gửi yêu cầu SOS ở Hà Đông (gần đối tác Minh Phát)
  await page.goto('/cho/cuu-ho');
  await expect(page.getByTestId('public-sos-garages')).toContainText('Minh Phát Auto');

  const form = page.getByTestId('public-sos-form');
  await form.getByLabel('Vĩ độ (Lat)').fill('20.974');
  await form.getByLabel('Kinh độ (Lng)').fill('105.774');
  await form.getByLabel('Địa chỉ / mốc đường dễ nhận biết').fill(`Ngã tư Hà Đông ${tag}`);
  await form.getByLabel('Họ và tên *').fill('Đinh Văn Hùng');
  await form.getByLabel('Số điện thoại liên hệ *').fill(phone);
  await form.getByLabel('Biển số xe').fill(plate);
  await form.getByTestId('sos-submit-btn').click();

  await expect(page).toHaveURL(/\/cho\/cuu-ho\/.+\?t=/);
  const trackUrl = page.url();
  const sosCode = (await page.getByTestId('sos-code').textContent())!.trim();
  await expect(page.getByTestId('sos-status')).toContainText('Đang tìm garage cứu hộ');

  // 2. Đối tác đăng nhập vào Cổng đối tác -> Cứu hộ (A7.21) xử lý trọn luồng
  await loginUI(page, PHONES.partnerOwner, 'Cardiy2026', '/doi-tac/cuu-ho');
  await expect(page.getByTestId('sos-workspace')).toBeVisible();

  const card = page.getByTestId('sos-case-card').filter({ hasText: sosCode });
  await expect(card).toBeVisible();
  await card.getByTestId('sos-accept-btn').click();
  await page.getByTestId('sos-accept-confirm').click();

  // Đang xử lý: Xuất phát -> Cập nhật GPS -> Đã tới hiện trường -> Xử lý tại chỗ -> Hoàn thành
  const activeCard = page.getByTestId('sos-case-card').filter({ hasText: sosCode });
  await expect(activeCard).toContainText('Garage đã nhận ca');

  await activeCard.getByTestId('sos-dispatch-btn').click();
  await page.getByTestId('sos-dispatch-confirm').click();
  await expect(activeCard).toContainText('Đội cứu hộ đang đến');

  await activeCard.getByTestId('sos-track-btn').click();
  await page.getByTestId('sos-track-confirm').click();

  await activeCard.getByTestId('sos-arrive-btn').click();
  await expect(activeCard).toContainText('Đã tới hiện trường');

  await activeCard.getByTestId('sos-onsite-btn').click();
  await expect(activeCard).toContainText('Đang xử lý tại chỗ');

  await activeCard.getByTestId('sos-complete-btn').click();
  await page.getByTestId('sos-complete-confirm').click();

  const doneCard = page.getByTestId('sos-case-card').filter({ hasText: sosCode });
  await expect(doneCard).toContainText('Hoàn thành');

  await page.getByTestId('user-menu').click();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/dang-nhap/);

  // 3. Khách mở lại link theo dõi: thấy đã hoàn thành, vị trí GPS và gửi đánh giá 5 sao
  await page.goto(trackUrl);
  await expect(page.getByTestId('sos-status')).toContainText('Hoàn thành');
  await expect(page.getByTestId('sos-garage-name')).toContainText('Minh Phát Auto');
  await expect(page.getByTestId('sos-live-gps')).toBeVisible();

  await page.getByTestId('sos-star-5').click();
  await page.getByTestId('sos-review-form').getByLabel('Nhận xét').fill(`Cứu hộ tận tâm ${tag}`);
  await page.getByTestId('sos-review-submit').click();
  await expect(page.getByTestId('sos-review-done')).toContainText(`Cứu hộ tận tâm ${tag}`);

  // 4. Admin sàn mở Giám sát cứu hộ (/san/cuu-ho, A6.61) kiểm tra ca và KPI
  await loginUI(page, PHONES.owner);
  await page.getByTestId('user-menu').click();
  await page.getByRole('menuitem', { name: /Sàn CARDIY/ }).click();
  await expect(page.getByTestId('workspace-name')).toHaveText('Sàn CARDIY');
  await page.getByTestId('sidebar').getByRole('link', { name: 'Giám sát cứu hộ' }).click();
  await expect(page).toHaveURL(/\/san\/cuu-ho$/);
  await expect(page.getByTestId('platform-sos-kpis')).toBeVisible();
  await page.getByLabel('Tìm ca cứu hộ').fill(sosCode);
  await expect(page.getByTestId('platform-sos-table')).toContainText(sosCode);
});

test('điện thoại: nhân viên Đội cứu hộ vào thẳng /doi-cuu-ho (A5.01); khách gửi SOS rồi tự huỷ được', async ({ page }) => {
  // 1. Nhân viên Đội cứu hộ đăng nhập -> vào thẳng màn hình Đội cứu hộ
  await loginUI(page, PHONES.rescue);
  await expect(page).toHaveURL(/\/doi-cuu-ho$/);
  await expect(page.getByTestId('sos-workspace')).toBeVisible();

  // 2. Khách gửi yêu cầu SOS trên điện thoại rồi bấm tự huỷ
  await page.goto('/cho/cuu-ho');
  const form = page.getByTestId('public-sos-form');
  await form.getByLabel('Vĩ độ (Lat)').fill('20.972');
  await form.getByLabel('Kinh độ (Lng)').fill('105.772');
  await form.getByLabel('Họ và tên *').fill('Võ Tự Huỷ');
  await form.getByLabel('Số điện thoại liên hệ *').fill(randomPhone());
  await form.getByTestId('sos-submit-btn').click();

  await expect(page).toHaveURL(/\/cho\/cuu-ho\/.+\?t=/);
  await page.getByTestId('sos-cancel-open').click();
  await page.getByTestId('sos-cancel-confirm').click();
  await expect(page.getByTestId('sos-status')).toContainText('Khách đã huỷ');
});
