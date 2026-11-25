import { expect, request as pwRequest, test } from '@playwright/test';
import { PHONES } from './helpers';

const API = `http://localhost:${process.env.API_PORT ?? 4000}/api`;
const tag = `W${Date.now().toString(36).toUpperCase()}`;
const code = `LOP-WEB-${tag}`;
const hours = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '07:00', close: '18:00', closed: false }));

/** Tạo dữ liệu qua API: SKU mới, đối tác (đã duyệt) và PLG cùng bán */
test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  const login = async (phone: string) => (await (await api.post(`${API}/auth/login`, { data: { phone, password: 'Cardiy2026' } })).json()).accessToken as string;
  const h = (t: string) => ({ Authorization: `Bearer ${t}` });
  const plg = await login(PHONES.owner);
  const me = await (await api.get(`${API}/me`, { headers: h(plg) })).json();
  const pf = me.memberships.find((m: { tenantType: string }) => m.tenantType === 'PLATFORM');
  const sa = (await (await api.post(`${API}/auth/switch`, { headers: h(plg), data: { membershipId: pf.membershipId } })).json()).accessToken as string;
  const dt = await login(PHONES.partnerOwner);
  const item = await (
    await api.post(`${API}/platform/catalog/items`, {
      headers: h(sa),
      data: { kind: 'PRODUCT', code, name: `Lốp web ${tag} 185/65R15`, brand: 'Hãng Web', specs: [{ label: 'Kích cỡ', value: '185/65R15' }] },
    })
  ).json();
  await api.put(`${API}/shop`, { headers: h(dt), data: { name: 'Minh Phát Auto', phone: '0900000010', address: 'Hà Đông, Hà Nội', province: 'Hà Nội', lat: 20.97, lng: 105.77, openingHours: hours } });
  await api.put(`${API}/shop`, {
    headers: h(plg),
    data: { name: 'Garage PLG', phone: '0900000001', address: 'Đồng Xoài, Bình Phước', province: 'Bình Phước', lat: 11.53, lng: 106.88, openingHours: hours },
  });
  const po = await (await api.post(`${API}/shop/offers`, { headers: h(dt), data: { kind: 'PRODUCT', catalogItemId: item.id, price: 1_234_000, manualStock: 2, installIncluded: true } })).json();
  await api.post(`${API}/shop/offers/${po.id}/submit`, { headers: h(dt) });
  await api.post(`${API}/platform/offers/${po.id}/approve`, { headers: h(sa) });
  const xo = await (await api.post(`${API}/shop/offers`, { headers: h(plg), data: { kind: 'PRODUCT', catalogItemId: item.id, price: 1_299_000, manualStock: 5 } })).json();
  await api.post(`${API}/shop/offers/${xo.id}/submit`, { headers: h(plg) });
  await api.dispose();
});

test.describe('Vòng 3.3: web sàn công khai /cho', () => {
  test('khách chưa đăng nhập: tìm sản phẩm → so giá các garage → trang garage', async ({ page }) => {
    await page.goto('/cho');
    await expect(page.getByRole('heading', { name: /Tìm garage uy tín/ })).toBeVisible();
    await page.getByLabel('Tìm trên sàn').fill(`185/65r15 ${tag}`);
    await page.getByLabel('Tìm trên sàn').press('Enter');
    await expect(page).toHaveURL(/\/cho\/san-pham\?q=/);
    await page.getByTestId('item-card').filter({ hasText: tag }).click();
    await expect(page.getByTestId('item-name')).toContainText(tag);
    const sellers = page.getByTestId('seller-row');
    await expect(sellers).toHaveCount(2);
    // Giá tốt nhất lên đầu
    await expect(sellers.first()).toContainText('1.234.000');
    await expect(sellers.first()).toContainText('Giá gồm lắp đặt');
    // PLG có nút Đặt lịch qua app chủ xe, đối tác thì không
    await expect(sellers.nth(1).getByTestId('book-button')).toHaveAttribute('href', /\/app\/dat-lich\?dv=/);
    await expect(sellers.first().getByTestId('book-button')).toHaveCount(0);

    await sellers.first().getByRole('link', { name: 'Minh Phát Auto' }).click();
    await expect(page.getByTestId('shop-name')).toHaveText('Minh Phát Auto');
    await expect(page.getByTestId('shop-hours')).toContainText('07:00 – 18:00');
    await expect(page.getByTestId('shop-offer').filter({ hasText: tag })).toBeVisible();
  });

  test('tìm garage theo tỉnh; đặt lịch PLG dẫn sang app chủ xe, giữ dịch vụ đã chọn sau khi đăng nhập', async ({ page }) => {
    await page.goto('/cho/tim-garage');
    await page.getByLabel('Tỉnh / thành').selectOption('Bình Phước');
    await page.getByRole('button', { name: 'Lọc' }).click();
    await expect(page).toHaveURL(/tinh=/);
    const plg = page.getByTestId('shop-card').filter({ hasText: 'Garage PLG' });
    await expect(plg).toBeVisible();
    await expect(page.getByTestId('shop-card').filter({ hasText: 'Minh Phát Auto' })).toHaveCount(0);

    await page.goto(`/cho/san-pham/${code.toLowerCase()}`);
    await page.getByTestId('seller-row').filter({ hasText: 'Garage PLG' }).getByTestId('book-button').click();
    await expect(page).toHaveURL(/\/app\/dang-nhap\?next=.*dv%3D/);
  });

  test('robots.txt chỉ mở /cho; sitemap có trang sản phẩm', async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Allow: /cho');
    expect(robots).toContain('Disallow: /');
    const sm = await (await request.get('/sitemap.xml')).text();
    expect(sm).toContain(`/cho/san-pham/${code.toLowerCase()}`);
  });
});
