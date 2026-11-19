import { PrismaClient, TenantStatus, TenantType } from '@prisma/client';

const prisma = new PrismaClient();

/** Dữ liệu mẫu: tenant sàn CARDIY và garage PLG với 2 chi nhánh. Chạy nhiều lần không bị trùng. */
async function main() {
  await prisma.tenant.upsert({
    where: { taxCode: 'CARDIY-PLATFORM' },
    update: {},
    create: { type: TenantType.PLATFORM, name: 'Sàn CARDIY', taxCode: 'CARDIY-PLATFORM', status: TenantStatus.HOAT_DONG },
  });

  const plg = await prisma.tenant.upsert({
    where: { taxCode: 'PLG-DEMO-0001' },
    update: {},
    create: { type: TenantType.GARAGE, name: 'Garage PLG', taxCode: 'PLG-DEMO-0001', status: TenantStatus.HOAT_DONG },
  });

  const branches = [
    { code: 'CN1', name: 'CN1 · Cầu Giấy', bays: 6 },
    { code: 'CN2', name: 'CN2 · Long Biên', bays: 4 },
  ];
  for (const b of branches) {
    await prisma.branch.upsert({
      where: { tenantId_code: { tenantId: plg.id, code: b.code } },
      update: { name: b.name, bays: b.bays },
      create: { ...b, tenantId: plg.id },
    });
  }
  console.log('Seed xong: 2 tenant, 2 chi nhánh.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
