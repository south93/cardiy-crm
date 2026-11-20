import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { formatPlate, normalizePlate, searchKey } from '@cardiy/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { AccessService } from '../auth/access.service';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService, customerSearchWhere } from './customers.service';
import { VehiclesService } from './vehicles.service';

const TIERS = ['THUONG', 'BAC', 'VANG', 'KIM_CUONG'] as const;
const SOURCES = ['ZALO', 'FACEBOOK', 'TIKTOK', 'GIOI_THIEU', 'KHACH_CU', 'VANG_LAI', 'WEBSITE', 'CUOC_GOI', 'GARA', 'CHAM_SOC_XE', 'DAI_LY', 'SAN_CARDIY', 'KHAC'] as const;
const opt = (s: z.ZodString) => s.trim().max(300).optional().nullable().transform((v) => (v ? v : v === '' ? null : v));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày dạng YYYY-MM-DD').optional().nullable().or(z.literal('').transform(() => null));

const vehicleFields = {
  plate: z.string().trim().min(2, 'Cần nhập biển số').max(20),
  vin: opt(z.string()),
  make: opt(z.string()),
  model: opt(z.string()),
  year: z.coerce.number().int().min(1950).max(2100).optional().nullable(),
  color: opt(z.string()),
  fuel: opt(z.string()),
  transmission: opt(z.string()),
  tireSize: opt(z.string()),
  registrationExpiry: isoDate,
  insuranceExpiry: isoDate,
  note: opt(z.string()),
};
const vehicleCreate = z.object({ ...vehicleFields, odometerKm: z.coerce.number().int().min(0).max(5_000_000).optional().nullable(), customerId: z.string().uuid().optional().nullable() });
const vehicleUpdate = z.object(vehicleFields).partial();

const customerFields = {
  type: z.enum(['PERSON', 'COMPANY']).optional(),
  name: z.string().trim().min(1, 'Cần nhập tên khách hàng').max(150),
  phone: opt(z.string()),
  phone2: opt(z.string()),
  email: z.string().trim().email('Email không hợp lệ').optional().nullable().or(z.literal('').transform(() => null)),
  address: opt(z.string()),
  taxCode: opt(z.string()),
  representative: opt(z.string()),
  birthday: isoDate,
  tier: z.enum(TIERS).optional(),
  source: z.enum(SOURCES).optional(),
  branchId: z.string().uuid().optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
  marketingConsent: z.boolean().optional(),
};
const customerCreate = z.object({ ...customerFields, vehicle: vehicleCreate.omit({ customerId: true }).optional().nullable() });
const customerUpdate = z.object(customerFields).partial();

const listQuery = z.object({
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @RequirePermissions('customer.view')
  @Get()
  list(@CurrentAuth() auth: RequestAuth, @Query(new ZodPipe(listQuery.extend({ tier: z.enum(TIERS).optional(), source: z.enum(SOURCES).optional() }))) q: z.infer<typeof listQuery> & { tier?: (typeof TIERS)[number]; source?: (typeof SOURCES)[number] }) {
    return this.customers.list(auth.access, q);
  }

  @RequirePermissions('customer.view')
  @Get(':id')
  get(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(auth.access, id);
  }

  @RequirePermissions('customer.manage')
  @Post()
  create(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(customerCreate)) dto: z.infer<typeof customerCreate>, @Req() req: Request) {
    if (dto.vehicle && !AccessService.has(auth.access, 'vehicle.manage')) throw new ForbiddenException('Bạn không có quyền thêm xe');
    return this.customers.create(auth.access, dto, clientIp(req));
  }

  @RequirePermissions('customer.manage')
  @Patch(':id')
  update(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(customerUpdate)) dto: z.infer<typeof customerUpdate>, @Req() req: Request) {
    return this.customers.update(auth.access, id, dto, clientIp(req));
  }

  @RequirePermissions('customer.manage')
  @Delete(':id')
  @HttpCode(200)
  remove(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.customers.remove(auth.access, id, clientIp(req));
  }
}

@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @RequirePermissions('vehicle.view')
  @Get()
  list(
    @CurrentAuth() auth: RequestAuth,
    @Query(new ZodPipe(listQuery.extend({ expiringDays: z.coerce.number().int().min(1).max(365).optional(), needsReview: z.enum(['true', 'false']).optional().transform((v) => v === 'true') })))
    q: z.infer<typeof listQuery> & { expiringDays?: number; needsReview?: boolean },
  ) {
    return this.vehicles.list(auth.access, q);
  }

  @RequirePermissions('vehicle.view')
  @Get(':id')
  get(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.vehicles.get(auth.access, id);
  }

  @RequirePermissions('vehicle.manage')
  @Post()
  create(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(vehicleCreate)) dto: z.infer<typeof vehicleCreate>, @Req() req: Request) {
    return this.vehicles.create(auth.access, dto, clientIp(req));
  }

  @RequirePermissions('vehicle.manage')
  @Patch(':id')
  update(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(vehicleUpdate)) dto: z.infer<typeof vehicleUpdate>, @Req() req: Request) {
    return this.vehicles.update(auth.access, id, dto, clientIp(req));
  }

  @RequirePermissions('vehicle.manage', 'customer.view')
  @Post(':id/transfer')
  @HttpCode(200)
  transfer(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ customerId: z.string().uuid() }))) dto: { customerId: string }, @Req() req: Request) {
    return this.vehicles.transfer(auth.access, id, dto.customerId, clientIp(req));
  }

  /** KTV ghi số km khi tiếp nhận / sửa xe: cần vehicle.view + ro.task.update hoặc vehicle.manage. */
  @RequirePermissions('vehicle.view')
  @Post(':id/odometer')
  @HttpCode(200)
  odometer(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ km: z.coerce.number().int().min(0).max(5_000_000), correction: z.boolean().default(false) }))) dto: { km: number; correction: boolean }, @Req() req: Request) {
    if (!AccessService.has(auth.access, 'vehicle.manage') && !AccessService.has(auth.access, 'ro.task.update')) throw new ForbiddenException('Bạn không có quyền ghi số km');
    return this.vehicles.addOdometer(auth.access, id, dto.km, dto.correction, clientIp(req));
  }

  @RequirePermissions('vehicle.manage')
  @Delete(':id')
  @HttpCode(200)
  remove(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.vehicles.remove(auth.access, id, clientIp(req));
  }
}

/** Tìm nhanh ở thanh trên cùng: gõ SĐT, biển số, tên (không dấu) → khách + xe. */
@Controller('lookup')
export class LookupController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async lookup(@CurrentAuth() auth: RequestAuth, @Query(new ZodPipe(z.object({ q: z.string().trim().min(2).max(60) }))) { q }: { q: string }) {
    const a = auth.access;
    const canCustomers = AccessService.has(a, 'customer.view');
    const canVehicles = AccessService.has(a, 'vehicle.view');
    if (!canCustomers && !canVehicles) throw new ForbiddenException('Bạn không có quyền tra cứu khách hàng / xe');
    const plate = normalizePlate(q) ?? q.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const [customers, vehicles] = await Promise.all([
      canCustomers
        ? this.prisma.customer.findMany({
            where: { tenantId: a.tenantId, deletedAt: null, ...customerSearchWhere(q) },
            take: 6,
            orderBy: { updatedAt: 'desc' },
            select: { id: true, code: true, name: true, phone: true },
          })
        : [],
      canVehicles
        ? this.prisma.vehicle.findMany({
            where: {
              tenantId: a.tenantId,
              deletedAt: null,
              OR: [{ plateNo: { contains: plate || '§' } }, { searchText: { contains: searchKey(q) } }],
            },
            take: 6,
            orderBy: { updatedAt: 'desc' },
            select: { id: true, plateNo: true, make: true, model: true, ownerships: { where: { toDate: null }, select: { customer: { select: { id: true, name: true } } } } },
          })
        : [],
    ]);
    return {
      customers,
      vehicles: vehicles.map((v) => ({ id: v.id, plate: formatPlate(v.plateNo), make: v.make, model: v.model, ownerName: v.ownerships[0]?.customer.name ?? null, ownerId: v.ownerships[0]?.customer.id ?? null })),
    };
  }
}
