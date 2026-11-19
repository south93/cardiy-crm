import { PERMISSIONS, SYSTEM_ROLES } from '@cardiy/shared';
import { PrismaClient, TenantStatus, TenantType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** Mật khẩu chung cho tài khoản demo. KHÔNG dùng seed demo trên bản chính thức. */
export const DEMO_PASSWORD = 'Cardiy2026';

async function upsertTenant(taxCode: string, name: string, type: TenantType) {
  return prisma.tenant.upsert({
    where: { taxCode },
    update: { name },
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

  if (process.env.SEED_DEMO === 'false') {
    console.log('Seed xong: chỉ quyền + vai trò hệ thống (SEED_DEMO=false).');
    return;
  }

  // 2. Tenant: sàn, garage PLG, garage đối tác demo
  const platform = await upsertTenant('CARDIY-PLATFORM', 'Sàn CARDIY', TenantType.PLATFORM);
  const plg = await upsertTenant('PLG-DEMO-0001', 'Garage PLG', TenantType.GARAGE);
  const partner = await upsertTenant('DOITAC-DEMO-0001', 'Garage Minh Phát (đối tác demo)', TenantType.GARAGE);

  const cn1 = await upsertBranch(plg.id, 'CN1', 'CN1 · Cầu Giấy', 6, 'Cầu Giấy, Hà Nội');
  const cn2 = await upsertBranch(plg.id, 'CN2', 'CN2 · Long Biên', 4, 'Long Biên, Hà Nội');
  await upsertBranch(partner.id, 'CN1', 'Minh Phát · Hà Đông', 3, 'Hà Đông, Hà Nội');

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
  await upsertMember({ phone: '0900000010', fullName: 'Chủ Garage Minh Phát', tenantId: partner.id, title: 'Chủ garage', roles: [{ code: 'CG', branchId: null }] });

  console.log(`Seed xong. Tài khoản demo 0900000001…0900000010, mật khẩu: ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
