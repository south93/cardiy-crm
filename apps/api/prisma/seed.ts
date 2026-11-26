import { PERMISSIONS, searchKey, SYSTEM_ROLES } from '@cardiy/shared';
import { PrismaClient, TenantStatus, TenantType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** Mật khẩu chung cho tài khoản demo. KHÔNG dùng seed demo trên bản chính thức. */
export const DEMO_PASSWORD = 'Cardiy2026';

async function upsertTenant(taxCode: string, name: string, type: TenantType) {
  return prisma.tenant.upsert({
    where: { taxCode },
    update: { name, type },
    create: { type, name, taxCode, status: TenantStatus.HOAT_DONG },
  });
}

async function upsertBranch(tenantId: string, code: string, name: string, bays: number, address: string) {
  return prisma.branch.upsert({
    where: { tenantId_code: { tenantId, code } },
    update: { name, bays, address },
    create: { tenantId, code, name, bays, address },
  });
}

async function upsertMember(opts: {
  phone: string;
  fullName: string;
  tenantId: string;
  title?: string;
  roles: { code: string; branchId: string | null }[];
  mustChangePassword?: boolean;
}) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const user = await prisma.user.upsert({
    where: { phone: opts.phone },
    update: { fullName: opts.fullName },
    create: { phone: opts.phone, fullName: opts.fullName, passwordHash, mustChangePassword: opts.mustChangePassword ?? false },
  });
  const m = await prisma.membership.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId: opts.tenantId } },
    update: { title: opts.title ?? null },
    create: { userId: user.id, tenantId: opts.tenantId, title: opts.title ?? null },
  });
  await prisma.membershipRole.deleteMany({ where: { membershipId: m.id } });
  for (const r of opts.roles) {
    const role = await prisma.role.findFirstOrThrow({ where: { tenantId: null, code: r.code } });
    await prisma.membershipRole.create({ data: { membershipId: m.id, roleId: role.id, branchId: r.branchId } });
  }
  return m;
}

async function main() {
  // 1. Danh mục quyền + vai trò hệ thống (đồng bộ theo packages/shared)
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({ where: { code: p.code }, update: { group: p.group, label: p.label, scope: p.scope }, create: p });
  }
  for (const r of SYSTEM_ROLES) {
    const existing = await prisma.role.findFirst({ where: { tenantId: null, code: r.code } });
    const role = existing
      ? await prisma.role.update({ where: { id: existing.id }, data: { name: r.name, scope: r.scope, require2fa: r.require2fa, isSystem: true } })
      : await prisma.role.create({ data: { code: r.code, name: r.name, scope: r.scope, require2fa: r.require2fa, isSystem: true } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({ data: r.permissions.map((permissionCode) => ({ roleId: role.id, permissionCode })) });
  }

  // Tenant sàn luôn có (nơi lưu hồ sơ đăng ký đối tác, bộ đếm hoá đơn phí)
  const platform = await upsertTenant('CARDIY-PLATFORM', 'Sàn CARDIY', TenantType.PLATFORM);

  if (process.env.SEED_DEMO === 'false') {
    console.log('Seed xong: chỉ quyền + vai trò hệ thống (SEED_DEMO=false).');
    return;
  }

  // 2. Tenant: sàn, garage PLG, garage đối tác demo
  const plg = await upsertTenant('PLG-DEMO-0001', 'Garage PLG', TenantType.GARAGE);
  // Đối tác: chỉ có cổng đối tác, 1 tài khoản duy nhất
  const partner = await upsertTenant('DOITAC-DEMO-0001', 'Minh Phát Auto (đối tác demo)', TenantType.PARTNER);

  // Chi nhánh thật của PLG (mã trùng với cột "Chi nhánh" trong AppSheet; CN5 cũ gộp vào CN1)
  const cn1 = await upsertBranch(plg.id, 'CN1', 'Đồng Xoài – Bình Phước', 4, 'Đường Phú Riềng Đỏ, Bình Phước, Đồng Nai');
  const cn2 = await upsertBranch(plg.id, 'CN2', 'Bình Phước – Đồng Nai', 4, '310 QL14, Bình Phước, Đồng Nai');
  await upsertBranch(plg.id, 'CN3', 'Mỹ Phước – Tân Vạn', 4, 'Số 1692, đường Mỹ Phước Tân Vạn, Tổ 17, Khu 4, Phường Bình Dương, TP Hồ Chí Minh');
  await upsertBranch(partner.id, 'CN1', 'Minh Phát · Hà Đông', 3, 'Hà Đông, Hà Nội'); // địa điểm hiển thị trên bản đồ sàn

  // 3. Tài khoản demo
  // Chủ hệ thống: 2 "mũ" — Super Admin sàn + Chủ garage PLG
  await upsertMember({ phone: '0900000001', fullName: 'Chủ hệ thống PLG', tenantId: plg.id, title: 'Chủ garage', roles: [{ code: 'CG', branchId: null }] });
  await upsertMember({ phone: '0900000001', fullName: 'Chủ hệ thống PLG', tenantId: platform.id, title: 'Super Admin', roles: [{ code: 'SA', branchId: null }] });
  await upsertMember({ phone: '0900000002', fullName: 'Trần Quản Lý', tenantId: plg.id, title: 'Quản lý CN1', roles: [{ code: 'QL', branchId: cn1.id }] });
  await upsertMember({ phone: '0900000003', fullName: 'Lê Bán Hàng', tenantId: plg.id, title: 'Cố vấn dịch vụ', roles: [{ code: 'BH', branchId: cn1.id }] });
  await upsertMember({ phone: '0900000004', fullName: 'Phạm Kỹ Thuật', tenantId: plg.id, title: 'KTV máy gầm', roles: [{ code: 'KTV', branchId: cn1.id }] });
  await upsertMember({ phone: '0900000005', fullName: 'Vũ Thủ Kho', tenantId: plg.id, roles: [{ code: 'TK', branchId: null }] });
  await upsertMember({ phone: '0900000006', fullName: 'Đỗ Kế Toán', tenantId: plg.id, roles: [{ code: 'KT', branchId: null }] });
  await upsertMember({ phone: '0900000007', fullName: 'Hoàng Chăm Sóc', tenantId: plg.id, roles: [{ code: 'CS', branchId: null }] });
  await upsertMember({ phone: '0900000008', fullName: 'Ngô Quản Lý CN2', tenantId: plg.id, title: 'Quản lý CN2', roles: [{ code: 'QL', branchId: cn2.id }] });
  await upsertMember({ phone: '0900000009', fullName: 'Đặng Cứu Hộ', tenantId: plg.id, title: 'Đội cứu hộ CN1', roles: [{ code: 'CH', branchId: cn1.id }] });
  await upsertMember({ phone: '0900000010', fullName: 'Minh Phát Auto', tenantId: partner.id, title: 'Đối tác', roles: [{ code: 'DT', branchId: null }] });

  // Gói đối tác mẫu (giá sửa được ở Sàn → Gói đối tác)
  const plans = [
    { code: 'CO_BAN', name: 'Cơ bản', monthlyFee: 300_000n, billingMonths: 1, sortOrder: 1, features: ['Gian hàng trên sàn', 'Nhận yêu cầu đặt lịch'] },
    { code: 'QUY', name: 'Gói quý', monthlyFee: 270_000n, billingMonths: 3, sortOrder: 2, features: ['Như gói Cơ bản', 'Tiết kiệm 10% khi trả theo quý'] },
  ];
  for (const p of plans) await prisma.plan.upsert({ where: { code: p.code }, update: {}, create: p });

  // Danh mục chuẩn mẫu của sàn (Sàn → Danh mục chuẩn sửa / thêm được)
  const cat = async (kind: 'PRODUCT' | 'SERVICE', name: string, sortOrder: number) =>
    (await prisma.catalogCategory.findFirst({ where: { kind, name, parentId: null } })) ?? (await prisma.catalogCategory.create({ data: { kind, name, sortOrder } }));
  const lop = await cat('PRODUCT', 'Lốp xe', 1);
  const dau = await cat('PRODUCT', 'Dầu nhớt', 2);
  const acquy = await cat('PRODUCT', 'Ắc quy', 3);
  const bd = await cat('SERVICE', 'Bảo dưỡng', 1);
  const ds = await cat('SERVICE', 'Đồng sơn', 2);
  const sc = await cat('SERVICE', 'Sửa chữa', 3);
  const ch = await cat('SERVICE', 'Cứu hộ', 4);
  const items: { kind: 'PRODUCT' | 'SERVICE'; code: string; name: string; categoryId: string; brand?: string; unit?: string; specs?: { label: string; value: string }[] }[] = [
    { kind: 'PRODUCT', code: 'LOP-MICH-2055516-PS4', name: 'Lốp Michelin Primacy 4 205/55R16', categoryId: lop.id, brand: 'Michelin', unit: 'Lốp', specs: [{ label: 'Kích cỡ', value: '205/55R16' }, { label: 'Chỉ số tải / tốc độ', value: '91V' }] },
    { kind: 'PRODUCT', code: 'LOP-BRID-2156016-T005', name: 'Lốp Bridgestone Turanza T005 215/60R16', categoryId: lop.id, brand: 'Bridgestone', unit: 'Lốp', specs: [{ label: 'Kích cỡ', value: '215/60R16' }] },
    { kind: 'PRODUCT', code: 'DAU-CAST-EDGE-5W30-4L', name: 'Dầu Castrol EDGE 5W-30 (4 lít)', categoryId: dau.id, brand: 'Castrol', unit: 'Can', specs: [{ label: 'Độ nhớt', value: '5W-30' }, { label: 'Dung tích', value: '4 L' }] },
    { kind: 'PRODUCT', code: 'ACQ-GS-NS60', name: 'Ắc quy GS NS60 (45Ah)', categoryId: acquy.id, brand: 'GS', unit: 'Bình', specs: [{ label: 'Dung lượng', value: '45Ah' }] },
    { kind: 'SERVICE', code: 'DV-BD-CAP1', name: 'Bảo dưỡng cấp 1 (5.000 km)', categoryId: bd.id },
    { kind: 'SERVICE', code: 'DV-BD-CAP2', name: 'Bảo dưỡng cấp 2 (10.000 km)', categoryId: bd.id },
    { kind: 'SERVICE', code: 'DV-DS-1MAT', name: 'Sơn 1 mặt (cản / cửa / capo)', categoryId: ds.id },
    { kind: 'SERVICE', code: 'DV-SC-GAM', name: 'Kiểm tra & sửa gầm', categoryId: sc.id },
    { kind: 'SERVICE', code: 'DV-CUU-HO-24H', name: 'Cứu hộ giao thông & kích bình 24/7', categoryId: ch.id },
  ];
  for (const it of items) {
    const searchText = searchKey(it.code, it.name, it.brand, ...(it.specs ?? []).map((x) => x.value));
    await prisma.catalogItem.upsert({ where: { code: it.code }, update: {}, create: { ...it, specs: it.specs ?? [], searchText } });
  }

  // Cấu hình cứu hộ mẫu cho PLG và đối tác demo (giữ cấu hình đang có nếu đã sửa)
  await prisma.sosConfig.upsert({
    where: { tenantId: plg.id },
    update: {},
    create: { tenantId: plg.id, enabled: true, onDuty: true, hotline: '0900000001', radiusKm: 40, basePrice: 300_000n, branchId: cn1.id, note: 'Kích bình, vá lốp lưu động, xe sàn trượt kéo về xưởng' },
  });
  await prisma.sosConfig.upsert({
    where: { tenantId: partner.id },
    update: {},
    create: { tenantId: partner.id, enabled: true, onDuty: true, hotline: '0900000010', radiusKm: 25, basePrice: 250_000n, note: 'Cứu hộ nội thành & vành đai 24/7' },
  });

  console.log(`Seed xong. Tài khoản demo 0900000001…0900000010, mật khẩu: ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
