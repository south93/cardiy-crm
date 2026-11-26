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

  // Đội xe cho thuê mẫu (Vòng 4.2)
  await prisma.rentalVehicle.upsert({
    where: { tenantId_code: { tenantId: plg.id, code: 'TX000001' } },
    update: {},
    create: {
      tenantId: plg.id,
      branchId: cn1.id,
      code: 'TX000001',
      title: 'Toyota Veloz Cross 2023 · Tự động · 7 chỗ',
      plateNo: '93A68686',
      make: 'Toyota',
      model: 'Veloz Cross',
      year: 2023,
      seats: 7,
      transmission: 'TU_DONG',
      fuel: 'XANG',
      ownerType: 'GARAGE',
      dailyPrice: 900_000n,
      deposit: 5_000_000n,
      kmLimitPerDay: 300,
      overKmFee: 5_000n,
      province: 'Bình Phước',
      pickupAddress: 'Đường Phú Riềng Đỏ, Đồng Xoài, Bình Phước',
      terms: 'CCCD gắn chip + GPLX hạng B1 trở lên còn hạn',
      status: 'DANG_CHO_THUE',
      searchText: searchKey('TX000001', 'Toyota Veloz Cross 2023', '93A68686', 'Bình Phước'),
    },
  });
  await prisma.tenantCounter.upsert({
    where: { tenantId_key: { tenantId: plg.id, key: 'rental_vehicle' } },
    update: {},
    create: { tenantId: plg.id, key: 'rental_vehicle', value: 1 },
  });

  await prisma.rentalVehicle.upsert({
    where: { tenantId_code: { tenantId: partner.id, code: 'TX000001' } },
    update: {},
    create: {
      tenantId: partner.id,
      code: 'TX000001',
      title: 'Mazda 3 Luxury 2022 · Tự động · 5 chỗ',
      plateNo: '30H88999',
      make: 'Mazda',
      model: 'Mazda 3',
      year: 2022,
      seats: 5,
      transmission: 'TU_DONG',
      fuel: 'XANG',
      ownerType: 'GARAGE',
      dailyPrice: 750_000n,
      deposit: 10_000_000n,
      kmLimitPerDay: 300,
      overKmFee: 5_000n,
      province: 'Hà Nội',
      pickupAddress: 'Hà Đông, Hà Nội',
      terms: 'CCCD gốc đối chiếu + GPLX B1/B2, đặt cọc tiền mặt hoặc chuyển khoản',
      status: 'DANG_CHO_THUE',
      searchText: searchKey('TX000001', 'Mazda 3 Luxury 2022', '30H88999', 'Hà Nội'),
    },
  });
  await prisma.tenantCounter.upsert({
    where: { tenantId_key: { tenantId: partner.id, key: 'rental_vehicle' } },
    update: {},
    create: { tenantId: partner.id, key: 'rental_vehicle', value: 1 },
  });

  // Cấu hình kiểm định xe cũ & tin xe cũ mẫu (Vòng 4.3)
  const kd = await cat('SERVICE', 'Kiểm định xe cũ', 5);
  await prisma.catalogItem.upsert({
    where: { code: 'DV-KIEM-DINH-XE-CU' },
    update: {},
    create: {
      kind: 'SERVICE',
      code: 'DV-KIEM-DINH-XE-CU',
      name: 'Kiểm định xe cũ toàn diện 150 hạng mục',
      categoryId: kd.id,
      specs: [],
      searchText: searchKey('DV-KIEM-DINH-XE-CU', 'Kiểm định xe cũ toàn diện 150 hạng mục'),
    },
  });

  await prisma.appraisalConfig.upsert({
    where: { tenantId: plg.id },
    update: {},
    create: {
      tenantId: plg.id,
      enabled: true,
      fee: 600_000n,
      branchId: cn1.id,
      note: 'Kiểm tra cầu nâng khung gầm, chẩn đoán OBD, đo độ dày sơn & lịch sử bảo dưỡng',
    },
  });
  await prisma.appraisalConfig.upsert({
    where: { tenantId: partner.id },
    update: {},
    create: {
      tenantId: partner.id,
      enabled: true,
      fee: 500_000n,
      note: 'Kiểm định 150 điểm cam kết không đâm đụng khung gầm, không thuỷ kích',
    },
  });

  const pubNow = new Date();
  const exp60 = new Date(pubNow.getTime() + 60 * 86_400_000);
  const demoChecklist = [
    { key: 'BODY_FRAME', group: 'Khung gầm & Thân vỏ', label: 'Sắt-xi, cột kèo, keo chỉ nguyên bản, không biến dạng va chạm', maxPoints: 30, status: 'TOT', note: 'Sơn zin 95%, keo chỉ nguyên bản' },
    { key: 'ENGINE_GEARBOX', group: 'Động cơ & Hộp số', label: 'Máy nổ êm, ốc chân máy nguyên zin, hộp số sang số mượt, không rò dầu', maxPoints: 25, status: 'TOT', note: 'Máy khô ráo, không lỗi' },
    { key: 'SUSPENSION_BRAKE', group: 'Lái, Treo, Phanh & Lốp', label: 'Thước lái, giảm xóc, má phanh và độ sâu gai lốp đạt chuẩn', maxPoints: 15, status: 'LUU_Y', note: 'Hai lốp trước còn 65%, đi thêm ~15.000 km' },
    { key: 'ELECTRICAL_AC', group: 'Điện, Đèn & Điều hoà', label: 'Điều hoà lạnh sâu, ắc quy tốt, quét OBD không có mã lỗi', maxPoints: 15, status: 'TOT', note: 'Không mã lỗi OBD' },
    { key: 'INTERIOR_SAFETY', group: 'Nội thất & Túi khí', label: 'Túi khí, dây đai an toàn, ghế da và màn hình hoạt động đầy đủ', maxPoints: 10, status: 'TOT', note: 'Nội thất giữ kỹ' },
    { key: 'LEGAL_ODO', group: 'Giấy tờ & Lịch sử ODO', label: 'Số khung số máy khớp cà vẹt, ODO chuẩn theo lịch sử bảo dưỡng', maxPoints: 5, status: 'TOT', note: 'Chính chủ từ đầu' },
  ];

  const xc1 = await prisma.usedCarListing.upsert({
    where: { code: 'XC000001' },
    update: {},
    create: {
      code: 'XC000001',
      sellerType: 'GARAGE',
      sellerTenantId: partner.id,
      title: 'Toyota Corolla Cross 1.8V 2022 · 1 chủ từ đầu · Đã kiểm định',
      plateNo: '30H56789',
      make: 'Toyota',
      model: 'Corolla Cross',
      year: 2022,
      mileageKm: 28_500,
      bodyStyle: 'SUV_CUV',
      transmission: 'TU_DONG',
      fuel: 'XANG',
      exteriorColor: 'Trắng ngọc trai',
      seats: 5,
      ownersCount: 1,
      price: 735_000_000n,
      negotiable: true,
      province: 'Hà Nội',
      addressText: 'Hà Đông, Hà Nội',
      contactName: 'Minh Phát Auto',
      contactPhone: '0900000010',
      description: 'Xe gia đình 1 chủ mua mới từ hãng, bảo dưỡng đầy đủ mỗi 5.000 km, gói an toàn Toyota Safety Sense.',
      hasVerifiedBadge: true,
      status: 'DANG_BAN',
      publishedAt: pubNow,
      expiresAt: exp60,
      searchText: searchKey('XC000001', 'Toyota Corolla Cross 1.8V 2022', 'SUV_CUV', 'Hà Nội'),
    },
  });

  const kd1 = await prisma.usedCarAppraisal.upsert({
    where: { tenantId_code: { tenantId: partner.id, code: 'KD000001' } },
    update: {},
    create: {
      code: 'KD000001',
      listingId: xc1.id,
      tenantId: partner.id,
      scheduledAt: pubNow,
      quotedFee: 500_000n,
      finalFee: 500_000n,
      status: 'HOAN_THANH',
      checklist: demoChecklist,
      noMajorAccident: true,
      noFloodDamage: true,
      validDocuments: true,
      inspectedMileageKm: 28_500,
      score: 93,
      grade: 'DAT_CHUAN',
      summary: 'Xe nguyên bản, khung gầm và động cơ xuất sắc, không tai nạn hay ngập nước.',
      completedAt: pubNow,
    },
  });

  if (!xc1.verifiedAppraisalId) {
    await prisma.usedCarListing.update({
      where: { id: xc1.id },
      data: { verifiedAppraisalId: kd1.id, hasVerifiedBadge: true },
    });
  }

  await prisma.usedCarListing.upsert({
    where: { code: 'XC000002' },
    update: {},
    create: {
      code: 'XC000002',
      sellerType: 'GARAGE',
      sellerTenantId: plg.id,
      branchId: cn1.id,
      title: 'Honda City RS 2021 · Số tự động · Xe đẹp nguyên zin',
      plateNo: '93A45678',
      make: 'Honda',
      model: 'City RS',
      year: 2021,
      mileageKm: 39_000,
      bodyStyle: 'SEDAN',
      transmission: 'TU_DONG',
      fuel: 'XANG',
      exteriorColor: 'Đỏ cá tính',
      seats: 5,
      ownersCount: 1,
      price: 465_000_000n,
      negotiable: true,
      province: 'Bình Phước',
      addressText: 'Đồng Xoài, Bình Phước',
      contactName: 'Garage PLG',
      contactPhone: '0900000001',
      description: 'Honda City bản RS cao cấp nhất, lẫy chuyển số vô lăng, bảo dưỡng định kỳ tại Garage PLG.',
      hasVerifiedBadge: false,
      status: 'DANG_BAN',
      publishedAt: pubNow,
      expiresAt: exp60,
      searchText: searchKey('XC000002', 'Honda City RS 2021', 'SEDAN', 'Bình Phước'),
    },
  });

  await prisma.tenantCounter.upsert({
    where: { tenantId_key: { tenantId: platform.id, key: 'used_car' } },
    update: {},
    create: { tenantId: platform.id, key: 'used_car', value: 2 },
  });
  await prisma.tenantCounter.upsert({
    where: { tenantId_key: { tenantId: partner.id, key: 'appraisal' } },
    update: {},
    create: { tenantId: partner.id, key: 'appraisal', value: 1 },
  });

  // Cộng đồng chủ xe & Banner mẫu (Vòng 4.4)
  const demoPosts: {
    code: string;
    type: 'BLOG' | 'AUDIO' | 'PLAYLIST' | 'QA';
    authorKind: 'PLATFORM' | 'GARAGE' | 'OWNER';
    authorName: string;
    authorTenantId?: string;
    title: string;
    summary: string;
    content: string;
    topic: string;
    pinned?: boolean;
    durationMinutes?: number;
    playlistItems?: { title: string; host: string; duration: string }[];
  }[] = [
    {
      code: 'BV000001',
      type: 'BLOG',
      authorKind: 'PLATFORM',
      authorName: 'Ban biên tập CARDIY',
      title: 'Cẩm nang bảo dưỡng ô tô mốc 20.000 km – 40.000 km tiết kiệm và đúng chuẩn',
      summary: 'Những hạng mục cần thay thế thật sự và những hạng mục chỉ cần vệ sinh kiểm tra để không tốn chi phí oan.',
      content:
        'Ở mốc 20.000 km, chủ xe ưu tiên thay dầu động cơ + lọc dầu, vệ sinh lọc gió động cơ và lọc gió điều hoà, đảo lốp 4 bánh và kiểm tra má phanh.\n\nỞ mốc 40.000 km (bảo dưỡng cấp lớn), cần bổ sung thay dầu phanh, nước làm mát (tuỳ khuyến cáo hãng), lọc nhiên liệu và kiểm tra bugi, dầu hộp số.',
      topic: 'BAO_DUONG',
      pinned: true,
    },
    {
      code: 'BV000002',
      type: 'AUDIO',
      authorKind: 'PLATFORM',
      authorName: 'Tủ sách nói CARDIY',
      title: 'Sách nói: Kỹ năng lái xe an toàn đường đèo & cao tốc ban đêm',
      summary: 'Nghe trên hành trình dài: cách dùng số tay/lẫy chuyển số khi đổ đèo, giữ khoảng cách 3 giây và xử lý sương mù.',
      content:
        'Tóm tắt 3 nguyên tắc sống còn khi đổ đèo dài: lên đèo số nào xuống đèo số đó (phanh bằng động cơ), tuyệt đối không rà phanh liên tục gây sôi dầu phanh, và nhường đường cho xe lên dốc tại khúc cua hẹp.',
      topic: 'KINH_NGHIEM',
      durationMinutes: 18,
      playlistItems: [
        { title: 'Chương 1: Chuẩn bị lốp, phanh và đèn trước chuyến đi xa', host: 'Chuyên gia kỹ thuật PLG', duration: '06:15' },
        { title: 'Chương 2: Kỹ thuật phanh động cơ khi đổ đèo Bảo Lộc – Đà Lạt', host: 'Chuyên gia kỹ thuật PLG', duration: '07:10' },
        { title: 'Chương 3: Giữ tỉnh táo và khoảng cách an toàn trên cao tốc đêm', host: 'Chuyên gia kỹ thuật PLG', duration: '04:35' },
      ],
    },
    {
      code: 'BV000003',
      type: 'PLAYLIST',
      authorKind: 'PLATFORM',
      authorName: 'Cộng đồng Chủ xe Việt',
      title: 'Playlist Acoustic & Chill cung đường biển Phan Thiết – Vĩnh Hy',
      summary: 'Tuyển tập giai điệu nhẹ nhàng thư giãn cho cả gia đình trên những cung đường ven biển cuối tuần.',
      content: 'Danh sách các bản nhạc Acoustic không lời và Pop nhẹ giúp tài xế thư giãn, tập trung tay lái mà không gây buồn ngủ.',
      topic: 'HANH_TRINH',
      durationMinutes: 42,
      playlistItems: [
        { title: 'Nắng sớm cung đường biển Mũi Né', host: 'Acoustic Guitar', duration: '04:20' },
        { title: 'Chiều gió lộng Bàu Trắng', host: 'Instrumental Chill', duration: '05:05' },
        { title: 'Đêm bình yên vịnh Vĩnh Hy', host: 'Piano & Strings', duration: '04:48' },
      ],
    },
    {
      code: 'BV000004',
      type: 'QA',
      authorKind: 'GARAGE',
      authorTenantId: plg.id,
      authorName: 'Garage PLG',
      title: 'Hỏi đáp: Điều hoà ô tô lúc đầu mát sâu nhưng đi 30 phút chỉ ra gió thường là bệnh gì?',
      summary: 'Tổng hợp nguyên nhân hay gặp nhất: đóng băng giàn lạnh do hỏng cảm biến nhiệt hoặc rơ-le lốc lạnh chập chờn.',
      content:
        'Nếu xe mới nổ máy điều hoà vẫn lạnh buốt nhưng chạy khoảng 20–30 phút gió yếu hẳn và hết lạnh, khả năng rất cao cảm biến nhiệt độ giàn lạnh (thermistor) bị sai trị số khiến giàn lạnh đóng đá bít kín khe gió, hoặc van đuôi lốc / ly hợp từ lốc lạnh bị ngắt khi nóng.',
      topic: 'HOI_DAP_KY_THUAT',
    },
  ];

  for (const dp of demoPosts) {
    await prisma.communityPost.upsert({
      where: { code: dp.code },
      update: {},
      create: {
        code: dp.code,
        type: dp.type,
        authorKind: dp.authorKind,
        authorTenantId: dp.authorTenantId ?? null,
        authorName: dp.authorName,
        title: dp.title,
        summary: dp.summary,
        content: dp.content,
        topic: dp.topic,
        pinned: dp.pinned ?? false,
        durationMinutes: dp.durationMinutes ?? null,
        playlistItems: dp.playlistItems ?? [],
        status: 'DA_DANG',
        publishedAt: pubNow,
        searchText: searchKey(dp.code, dp.title, dp.summary, dp.topic, dp.authorName),
      },
    });
  }

  await prisma.tenantCounter.upsert({
    where: { tenantId_key: { tenantId: platform.id, key: 'community_post' } },
    update: {},
    create: { tenantId: platform.id, key: 'community_post', value: 4 },
  });

  const bannerCount = await prisma.platformBanner.count();
  if (bannerCount === 0) {
    await prisma.platformBanner.create({
      data: {
        title: 'Cộng đồng Chủ xe CARDIY · Chia sẻ kinh nghiệm chăm xe thực chiến',
        subtitle: 'Đặt câu hỏi kỹ thuật để được các kỹ sư garage giải đáp trực tiếp, nghe Sách nói và Playlist hành trình.',
        linkUrl: '/app/cong-dong',
        ctaLabel: 'Đặt câu hỏi & chia sẻ ngay',
        position: 'COMMUNITY',
        sortOrder: 1,
        active: true,
      },
    });
  }

  // Cấu hình tích điểm, phân khúc mẫu & mẫu thông báo sàn (Vòng 5.1)
  await prisma.loyaltyConfig.upsert({
    where: { tenantId: plg.id },
    update: {},
    create: {
      tenantId: plg.id,
      enabled: true,
      vndPerPoint: 100_000,
      pointValueVnd: 1_000,
      silverPoints: 50,
      goldPoints: 200,
      diamondPoints: 500,
    },
  });

  await prisma.customerSegment.upsert({
    where: { tenantId_code: { tenantId: plg.id, code: 'PK000001' } },
    update: {},
    create: {
      tenantId: plg.id,
      code: 'PK000001',
      name: 'Khách thân thiết hạng Bạc trở lên',
      description: 'Tập khách hàng tích luỹ từ hạng Bạc, Vàng, Kim cương để gửi ưu đãi tri ân định kỳ',
      rules: { tiers: ['BAC', 'VANG', 'KIM_CUONG'] },
    },
  });
  await prisma.customerSegment.upsert({
    where: { tenantId_code: { tenantId: plg.id, code: 'PK000002' } },
    update: {},
    create: {
      tenantId: plg.id,
      code: 'PK000002',
      name: 'Xe sắp đến hạn đăng kiểm / bảo hiểm 30 ngày',
      description: 'Nhắc lịch kiểm tra an toàn trước kỳ đăng kiểm hoặc gia hạn bảo hiểm',
      rules: { expiringWithinDays: 30 },
    },
  });
  await prisma.tenantCounter.upsert({
    where: { tenantId_key: { tenantId: plg.id, key: 'customer_segment' } },
    update: {},
    create: { tenantId: plg.id, key: 'customer_segment', value: 2 },
  });

  const demoTemplates = [
    {
      code: 'TPL_BAO_DUONG_DINH_KY',
      name: 'Nhắc bảo dưỡng & kiểm tra xe định kỳ',
      channel: 'PUSH',
      title: 'Nhắc lịch chăm sóc xe cùng {{ten_garage}}',
      body: 'Chào {{ten_khach}}, xe của bạn sắp tới kỳ kiểm tra định kỳ. Đặt lịch trước trên App CARDIY để không phải chờ đợi!',
    },
    {
      code: 'TPL_UU_DAI_THANH_VIEN',
      name: 'Thông báo ưu đãi hạng thẻ & voucher',
      channel: 'ZNS',
      title: 'Ưu đãi dành riêng cho hội viên {{hang_the}}',
      body: 'Cảm ơn {{ten_khach}} đã đồng hành cùng {{ten_garage}} (hiện có {{diem_thuong}} điểm). Nhập mã {{ma_voucher}} khi đặt lịch lần tới!',
    },
  ];
  for (const tpl of demoTemplates) {
    await prisma.notificationTemplate.upsert({
      where: { code: tpl.code },
      update: {},
      create: tpl,
    });
  }

  // Kho tri thức kỹ thuật chuẩn cho Trợ lý AI Garage (Vòng 5.2 · M36)
  const demoAiDocs = [
    {
      code: 'DOC-BD-DINH-KY',
      title: 'Quy chuẩn bảo dưỡng định kỳ các mốc 5.000 – 10.000 – 20.000 – 40.000 km',
      category: 'BAO_DUONG',
      tags: ['bao duong', 'thay dau', 'loc dau', 'loc gio', '40000km', '20000km'],
      content:
        'Mốc 5.000 km: Thay dầu động cơ, kiểm tra áp suất lốp & nước rửa kính.\nMốc 10.000 km: Thay dầu động cơ + lọc dầu, đảo lốp 4 bánh, vệ sinh lọc gió động cơ & điều hoà.\nMốc 20.000 km: Thay dầu + lọc dầu, thay lọc gió điều hoà, vệ sinh họng ga & bảo dưỡng phanh 4 bánh.\nMốc 40.000 km (cấp lớn): Thay dầu động cơ + lọc dầu, lọc gió động cơ, lọc gió điều hoà, dầu phanh DOT4, nước làm mát, kiểm tra bugi & dầu hộp số.',
    },
    {
      code: 'DOC-CHAN-DOAN-DIEU-HOA',
      title: 'Quy trình chẩn đoán điều hoà ô tô kém mát, có mùi hoặc đóng đá giàn lạnh',
      category: 'CHAN_DOAN',
      tags: ['dieu hoa', 'kem mat', 'loc lanh', 'gas lanh', 'loc gio dieu hoa', 'gian lanh'],
      content:
        '1. Gió yếu kèm mùi ẩm: kiểm tra lọc gió điều hoà bẩn nghẹt, vệ sinh nội soi giàn lạnh.\n2. Lúc đầu mát sau 20–30 phút mất lạnh: kiểm tra cảm biến nhiệt giàn lạnh (thermistor) gây đóng băng hoặc rơ-le ly hợp từ lốc lạnh.\n3. Áp suất thấp thiếu môi chất: kiểm tra rò rỉ phớt lốc, giàn nóng, nạp gas lạnh R134a đúng định lượng và bổ sung dầu lạnh.',
    },
    {
      code: 'DOC-HE-THONG-PHANH-LOP',
      title: 'Chẩn đoán phanh kêu két két, rung vô lăng khi phanh và mòn lốp lệch',
      category: 'LOP_PHANH',
      tags: ['phanh', 'ma phanh', 'dia phanh', 'rung vo lang', 'lop', 'can bang dong', 'dao lop'],
      content:
        '1. Phanh kêu rít kim loại: má phanh mòn tới phe báo mòn (< 3mm), cần thay má phanh và láng đĩa phanh nếu xước gờ.\n2. Rung bàn đạp phanh / vô lăng ở tốc độ cao: kiểm tra độ đảo đĩa phanh, cân bằng động 4 bánh và chỉnh độ chụm thước lái.\n3. Lốp mòn vẹt mép trong/ngoài: kiểm tra rô-tuyn lái, cao su càng A và góc đặt bánh xe.',
    },
    {
      code: 'DOC-AC-QUY-DIEN-OBD',
      title: 'Chẩn đoán đề dai khó nổ, đèn báo ắc quy / Check Engine OBD-II phổ biến',
      category: 'DIEN_OBD',
      tags: ['ac quy', 'kho no', 'de dai', 'may phat', 'check engine', 'obd', 'bugi', 'mobin'],
      content:
        '1. Đề yếu buổi sáng, điện áp tĩnh < 12.2V hoặc sụt dưới 9.6V khi đề: ắc quy chai nội trở cao, cần thay ắc quy đúng dung lượng Ah/CCA.\n2. Đèn báo ắc quy sáng khi đang nổ máy: kiểm tra điện áp nạp máy phát (chuẩn 13.8V – 14.4V) và dây curoa tổng.\n3. Mã lỗi P0300–P0304 (bỏ máy): kiểm tra bugi, mobin đánh lửa và kim phun nhiên liệu.',
    },
  ];
  for (const doc of demoAiDocs) {
    const existing = await prisma.aiDocument.findFirst({ where: { tenantId: plg.id, code: doc.code } });
    if (!existing) {
      await prisma.aiDocument.create({
        data: {
          tenantId: plg.id,
          code: doc.code,
          title: doc.title,
          category: doc.category,
          content: doc.content,
          tags: doc.tags,
          searchText: searchKey(doc.code, doc.title, doc.category, doc.content, ...doc.tags),
        },
      });
    }
  }

  console.log(`Seed xong. Tài khoản demo 0900000001…0900000010, mật khẩu: ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
