import { expect, request as pwRequest, test } from '@playwright/test';
import { loginUI, PHONES, randomPhone } from './helpers';

const API = `http://localhost:${process.env.API_PORT ?? 4000}/api`;
const tag = `R${Date.now().toString(36).toUpperCase()}`;
const code = `LOP-RQ-${tag}`;
const hours = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '07:00', close: '18:00', closed: false }));

/** SKU mới, đối tác bán 4 lốp (đã duyệt) */
test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  const login = async (phone: string) => (await (await api.post(`${API}/auth/login`, { data: { phone, password: 'Cardiy2026' } })).json()).accessToken as string;
  const h = (t: string) => ({ Authorization: `Bearer ${t}` });
  const plg = await login(PHONES.owner);
  const me = await (await api.get(`${API}/me`, { headers: h(plg) })).json();
  const pf = me.memberships.find((m: { tenantType: string }) => m.tenantType === 'PLATFORM');
  const sa = (await (await api.post(`${API}/auth/switch`, { headers: h(plg), data: { membershipId: pf.membershipId } })).json()).accessToken as string;
  const dt = await login(PHONES.partnerOwner);
  const item = await (await api.post(`${API}/platform/catalog/items`, { headers: h(sa), data: { kind: 'PRODUCT', code, name: `Lốp đặt hàng ${tag}` } })).json();
  await api.put(`${API}/shop`, { headers: h(dt), data: { name: 'Minh Phát Auto', phone: '0900000010', address: 'Hà Đông, Hà Nội', province: 'Hà Nội', lat: 20.97, lng: 105.77, openingHours: hours } });
  const po = await (await api.post(`${API}/shop/offers`, { headers: h(dt), data: { kind: 'PRODUCT', catalogItemId: item.id, price: 1_000_000, manualStock: 4, installIncluded: true } })).json();
  await api.post(`${API}/shop/offers/${po.id}/submit`, { headers: h(dt) });
  await api.post(`${API}/platform/offers/${po.id}/approve`, { headers: h(sa) });
  await api.dispose();
});

test('đối tác tạo voucher; khách đặt 2 lốp kèm voucher không cần tài khoản; đối tác xác nhận, chốt giá, hoàn tất', async ({ page, isMobile }) => {
  test.skip(isMobile, 'phần quản trị chạy trên máy tính; trang khách kiểm tra ở test riêng');
  const vcode = tag.slice(-8);
  const phone = randomPhone();
  // 1. Đối tác tạo voucher giảm 100.000 đ
  await loginUI(page, PHONES.partnerOwner);
  await page.goto('/doi-tac/khuyen-mai');
  await page.getByTestId('add-voucher').click();
  await page.getByLabel('Mã voucher').fill(vcode);
  await page.getByLabel('Tên chương trình').fill('Giảm thử nghiệm');
  await page.getByLabel('Kiểu giảm').selectOption('AMOUNT');
  await page.getByLabel('Giảm (đồng)').fill('100000');
  await page.getByTestId('save-voucher').click();
  await expect(page.getByTestId('voucher-list')).toContainText(vcode);
  await page.getByTestId('user-menu').click();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/dang-nhap/);

  // 2. Khách: so giá → Đặt hàng → 2 lốp, ngày mai, voucher
  await page.goto(`/cho/san-pham/${code.toLowerCase()}`);
  await page.getByTestId('seller-row').first().getByTestId('request-button').click();
  await expect(page.getByTestId('request-item')).toContainText(tag);
  await page.getByRole('button', { name: 'Thêm' }).click();
  await expect(page.getByTestId('qty')).toHaveText('2');
  await page.getByTestId('day-chips').getByRole('button', { name: 'Ngày mai' }).click();
  await page.getByTestId('time-slots').getByRole('button').first().click();
  await page.getByLabel('Họ tên').fill('Khách Web Thử');
  await page.getByLabel('Số điện thoại').fill(phone);
  await page.getByLabel('Mã voucher').fill(vcode);
  await page.getByTestId('apply-voucher').click();
  await expect(page.getByTestId('request-total')).toHaveText('1.900.000 đ');
  await page.getByTestId('send-request').click();
  await expect(page).toHaveURL(/\/cho\/yeu-cau\/.+t=/);
  await expect(page.getByTestId('request-status')).toHaveText('Chờ garage xác nhận');
  const trackUrl = page.url();

  // 3. Đối tác xác nhận + chốt giá
  await loginUI(page, PHONES.partnerOwner);
  await page.goto('/doi-tac/yeu-cau');
  await page.getByLabel('Tìm yêu cầu').fill(phone);
  const card = page.getByTestId('request-card').filter({ hasText: 'Khách Web Thử' });
  await expect(card).toContainText('1.900.000');
  await card.getByTestId('confirm-request').click();
  await page.getByLabel('Giá chốt').fill('1850000');
  await page.getByTestId('request-note').fill('Mời anh qua lắp lúc hẹn');
  await page.getByTestId('confirm-request-action').click();
  await expect(card).toContainText('Garage đã xác nhận');

  // 4. Khách thấy giá chốt
  await page.goto(trackUrl);
  await expect(page.getByTestId('request-status')).toHaveText('Garage đã xác nhận');
  await expect(page.getByTestId('tracked-total')).toHaveText('1.850.000 đ');

  // 5. Hoàn tất
  await page.goto('/doi-tac/yeu-cau');
  await page.getByLabel('Tìm yêu cầu').fill(phone);
  await card.getByTestId('complete-request').click();
  await page.getByTestId('confirm-request-action').click();
  await expect(card).toHaveCount(0); // rời tab Đang xử lý
});

test('khách trên điện thoại gửi yêu cầu rồi tự huỷ', async ({ page }) => {
  await page.goto(`/cho/san-pham/${code.toLowerCase()}`);
  await page.getByTestId('seller-row').first().getByTestId('request-button').click();
  await page.getByTestId('day-chips').getByRole('button', { name: 'Ngày mai' }).click();
  await page.getByTestId('time-slots').getByRole('button').first().click();
  await page.getByLabel('Họ tên').fill('Khách Điện Thoại');
  await page.getByLabel('Số điện thoại').fill(randomPhone());
  await page.getByTestId('send-request').click();
  await expect(page.getByTestId('request-status')).toHaveText('Chờ garage xác nhận');
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('cancel-request').click();
  await expect(page.getByTestId('request-status')).toHaveText('Đã huỷ');
});
