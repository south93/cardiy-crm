import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Global,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { formatPlate, normalizePlate, searchKey } from '@cardiy/shared';
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AccessService, type Access } from '../auth/access.service';
import { addMonths, vnDate, vnToday, ymd } from '../care/care-rules';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import {
  computeNextDue,
  DEFAULT_MAINTENANCE_RULES,
  evaluateMaintenanceItem,
  evaluateSerialWarranty,
  matchRuleByItemName,
  normalizeSerialNo,
  positionLabel,
  SERIAL_ACTION_LABEL,
  SERIAL_KIND_LABEL,
  SERIAL_POSITIONS,
  SERIAL_STATUS_LABEL,
} from './fleet-rules';

type Db = PrismaService | Prisma.TransactionClient;

function assertGarageView(a: Access) {
  const ok =
    a.tenantType === 'GARAGE' &&
    a.permissions.some((p) => ['vehicle.view', 'inventory.view', 'ro.view', 'customer.view', 'settings.manage'].includes(p));
  if (!ok) throw new ForbiddenException('Bạn không có quyền xem dữ liệu hồ sơ xe / sê-ri bảo hành của garage');
}

function assertGarageWrite(a: Access) {
  const ok =
    a.tenantType === 'GARAGE' &&
    a.permissions.some((p) => ['vehicle.manage', 'inventory.manage', 'ro.manage', 'ro.task.update'].includes(p));
  if (!ok) throw new ForbiddenException('Bạn không có quyền cập nhật bảo dưỡng / sê-ri bảo hành');
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày dạng YYYY-MM-DD')
  .optional()
  .nullable()
  .or(z.literal('').transform(() => null));

const ruleItemSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .transform((s) => s.toUpperCase().replace(/[^A-Z0-9_]/g, '_')),
  name: z.string().trim().min(2, 'Nhập tên hạng mục bảo dưỡng').max(120),
  intervalKm: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : Number(v)), z.number().int().min(500).max(500_000).nullable()),
  intervalMonths: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : Number(v)), z.number().int().min(1).max(120).nullable()),
  remindBeforeKm: z.coerce.number().int().min(0).max(50_000).default(500),
  remindBeforeDays: z.coerce.number().int().min(1).max(180).default(15),
  keywords: z.array(z.string().trim().max(60)).max(25).default([]),
  active: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(100).default(0),
});

const saveRulesSchema = z.object({
  rules: z.array(ruleItemSchema).min(1).max(30),
});

const createMaintItemSchema = z.object({
  categoryCode: z.string().trim().min(2).max(40).default('DAU_NHOT'),
  itemName: z.string().trim().min(2, 'Nhập tên hạng mục lắp/thay').max(160),
  productId: z.string().uuid().optional().nullable(),
  orderId: z.string().uuid().optional().nullable(),
  installedAt: isoDate,
  installedKm: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : Number(v)), z.number().int().min(0).max(5_000_000).nullable().optional()),
  intervalKm: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : Number(v)), z.number().int().min(500).max(500_000).nullable().optional()),
  intervalMonths: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : Number(v)), z.number().int().min(1).max(120).nullable().optional()),
  remindBeforeKm: z.coerce.number().int().min(0).max(50_000).optional(),
  remindBeforeDays: z.coerce.number().int().min(1).max(180).optional(),
  note: z.string().trim().max(500).optional().nullable(),
});

const SERIAL_KINDS = ['LOP', 'AC_QUY', 'PIN_LITHIUM'] as const;
const SERIAL_STATUSES = ['TRONG_KHO', 'DANG_SU_DUNG', 'DA_THAO', 'BAO_HANH', 'LOAI_BO'] as const;

const createSerialSchema = z.object({
  serialNo: z.string().trim().min(2, 'Nhập số sê-ri / mã nhận dạng').max(80),
  kind: z.enum(SERIAL_KINDS),
  productId: z.string().uuid().optional().nullable(),
  productName: z.string().trim().min(2, 'Nhập tên sản phẩm').max(180),
  brand: z.string().trim().max(80).optional().nullable(),
  dotOrMfg: z.string().trim().max(40).optional().nullable(),
  branchId: z.string().uuid().optional().nullable(),
  vehicleId: z.string().uuid().optional().nullable(),
  position: z.string().trim().max(60).optional().nullable(),
  orderId: z.string().uuid().optional().nullable(),
  installedAt: isoDate,
  installedKm: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : Number(v)), z.number().int().min(0).max(5_000_000).nullable().optional()),
  warrantyMonths: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : Number(v)), z.number().int().min(1).max(120).nullable().optional()),
  warrantyKm: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : Number(v)), z.number().int().min(1000).max(500_000).nullable().optional()),
  note: z.string().trim().max(500).optional().nullable(),
});

const transitionSerialSchema = z.object({
  action: z.enum(['LAP_MOI', 'LAP_LAI', 'DAO_VI_TRI', 'CHUYEN_XE', 'THAO_RA', 'DOI_BAO_HANH', 'LOAI_BO']),
  toVehicleId: z.string().uuid().optional().nullable(),
  toPosition: z.string().trim().max(60).optional().nullable(),
  orderId: z.string().uuid().optional().nullable(),
  odometerKm: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : Number(v)), z.number().int().min(0).max(5_000_000).nullable().optional()),
  replacementSerialNo: z.string().trim().max(80).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

const listSerialQuery = z.object({
  q: z.string().max(100).optional(),
  kind: z.enum(SERIAL_KINDS).optional(),
  status: z.enum(SERIAL_STATUSES).optional(),
  vehicleId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

@Injectable()
export class MaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Khởi tạo bộ định mức bảo dưỡng chuẩn cho garage nếu chưa có */
  async ensureRules(tenantId: string, tx: Db = this.prisma) {
    const existing = await tx.maintenanceRule.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (existing.length > 0) return existing;

    await tx.maintenanceRule.createMany({
      data: DEFAULT_MAINTENANCE_RULES.map((r) => ({
        tenantId,
        code: r.code,
        name: r.name,
        intervalKm: r.intervalKm,
        intervalMonths: r.intervalMonths,
        remindBeforeKm: r.remindBeforeKm,
        remindBeforeDays: r.remindBeforeDays,
        keywords: r.keywords,
        active: true,
        sortOrder: r.sortOrder,
      })),
      skipDuplicates: true,
    });
    return tx.maintenanceRule.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async saveRules(a: Access, dto: z.infer<typeof saveRulesSchema>, ip?: string) {
    if (a.tenantType !== 'GARAGE') throw new ForbiddenException('Chỉ áp dụng cho không gian Garage');
    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < dto.rules.length; i++) {
        const r = dto.rules[i]!;
        if (r.intervalKm === null && r.intervalMonths === null) {
          throw new BadRequestException(`Hạng mục "${r.name}" cần có ít nhất định mức số km hoặc số tháng`);
        }
        await tx.maintenanceRule.upsert({
          where: { tenantId_code: { tenantId: a.tenantId, code: r.code } },
          create: {
            tenantId: a.tenantId,
            code: r.code,
            name: r.name,
            intervalKm: r.intervalKm,
            intervalMonths: r.intervalMonths,
            remindBeforeKm: r.remindBeforeKm,
            remindBeforeDays: r.remindBeforeDays,
            keywords: r.keywords.filter(Boolean),
            active: r.active,
            sortOrder: r.sortOrder || i + 1,
          },
          update: {
            name: r.name,
            intervalKm: r.intervalKm,
            intervalMonths: r.intervalMonths,
            remindBeforeKm: r.remindBeforeKm,
            remindBeforeDays: r.remindBeforeDays,
            keywords: r.keywords.filter(Boolean),
            active: r.active,
            sortOrder: r.sortOrder || i + 1,
          },
        });
      }
      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'maintenance.rules_saved',
          entity: 'maintenance_rule',
          entityId: a.tenantId,
          after: { count: dto.rules.length },
          ip,
        },
        tx,
      );
    });
    return this.ensureRules(a.tenantId);
  }

  formatItemView(
    item: Prisma.VehicleMaintenanceItemGetPayload<object>,
    currentOdometerKm: number | null,
    today = vnToday(),
  ) {
    const ev = evaluateMaintenanceItem(item, currentOdometerKm, today);
    return {
      id: item.id,
      categoryCode: item.categoryCode,
      itemName: item.itemName,
      productId: item.productId,
      orderId: item.orderId,
      installedAt: ymd(vnDate(item.installedAt)),
      installedKm: item.installedKm,
      intervalKm: item.intervalKm,
      intervalMonths: item.intervalMonths,
      remindBeforeKm: item.remindBeforeKm,
      remindBeforeDays: item.remindBeforeDays,
      nextDueKm: item.nextDueKm,
      nextDueDate: item.nextDueDate ? ymd(vnDate(item.nextDueDate)) : null,
      status: item.status,
      note: item.note,
      kmDriven: ev.kmDriven,
      kmRemaining: ev.kmRemaining,
      daysRemaining: ev.daysRemaining,
      alertState: ev.alertState,
      reasonText: ev.reasonText,
    };
  }

  async listForVehicle(a: Access, vehicleId: string) {
    assertGarageView(a);
    const v = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenantId: a.tenantId, deletedAt: null },
      select: { id: true, odometerKm: true },
    });
    if (!v) throw new NotFoundException('Không tìm thấy xe');

    const [items, rules] = await Promise.all([
      this.prisma.vehicleMaintenanceItem.findMany({
        where: { vehicleId, tenantId: a.tenantId },
        orderBy: [{ status: 'desc' }, { installedAt: 'desc' }, { createdAt: 'desc' }],
        take: 60,
      }),
      this.ensureRules(a.tenantId),
    ]);

    const today = vnToday();
    return {
      currentOdometerKm: v.odometerKm,
      rules,
      active: items.filter((i) => i.status === 'DANG_THEO_DOI').map((i) => this.formatItemView(i, v.odometerKm, today)),
      history: items.filter((i) => i.status !== 'DANG_THEO_DOI').map((i) => this.formatItemView(i, v.odometerKm, today)),
    };
  }

  async recordItemInTx(
    tx: Db,
    opts: {
      tenantId: string;
      vehicleId: string;
      categoryCode: string;
      itemName: string;
      productId?: string | null;
      orderId?: string | null;
      installedAt?: Date;
      installedKm?: number | null;
      intervalKm?: number | null;
      intervalMonths?: number | null;
      remindBeforeKm?: number;
      remindBeforeDays?: number;
      note?: string | null;
      actorId?: string | null;
    },
  ) {
    const v = await tx.vehicle.findFirst({ where: { id: opts.vehicleId, tenantId: opts.tenantId, deletedAt: null } });
    if (!v) throw new NotFoundException('Không tìm thấy xe');

    const rules = await this.ensureRules(opts.tenantId, tx);
    const rule = rules.find((r) => r.code === opts.categoryCode);

    const installedAt = opts.installedAt ? vnDate(opts.installedAt) : vnToday();
    const installedKm = opts.installedKm !== undefined ? opts.installedKm : v.odometerKm;
    const intervalKm = opts.intervalKm !== undefined ? opts.intervalKm : (rule?.intervalKm ?? null);
    const intervalMonths = opts.intervalMonths !== undefined ? opts.intervalMonths : (rule?.intervalMonths ?? 6);
    const remindBeforeKm = opts.remindBeforeKm ?? rule?.remindBeforeKm ?? 500;
    const remindBeforeDays = opts.remindBeforeDays ?? rule?.remindBeforeDays ?? 15;

    if (intervalKm === null && intervalMonths === null) {
      throw new BadRequestException('Cần nhập định mức nhắc theo số km hoặc thời gian (tháng)');
    }

    const { nextDueKm, nextDueDate } = computeNextDue({
      installedAt,
      installedKm,
      intervalKm,
      intervalMonths,
    });

    // Chuyển hạng mục cùng nhóm trước đó trên xe sang trạng thái lịch sử DA_THAY_MOI
    await tx.vehicleMaintenanceItem.updateMany({
      where: { tenantId: opts.tenantId, vehicleId: opts.vehicleId, categoryCode: opts.categoryCode, status: 'DANG_THEO_DOI' },
      data: { status: 'DA_THAY_MOI' },
    });

    // Nếu số km lúc thay cao hơn số km đang lưu của xe thì đồng bộ luôn số km mới cho xe
    if (installedKm !== null && (v.odometerKm === null || installedKm > v.odometerKm)) {
      await tx.vehicle.update({ where: { id: v.id }, data: { odometerKm: installedKm } });
      await tx.odometerReading.create({
        data: { vehicleId: v.id, km: installedKm, source: 'RO', recordedBy: opts.actorId ?? null },
      });
    }

    return tx.vehicleMaintenanceItem.create({
      data: {
        tenantId: opts.tenantId,
        vehicleId: opts.vehicleId,
        categoryCode: opts.categoryCode,
        itemName: opts.itemName,
        productId: opts.productId ?? null,
        orderId: opts.orderId ?? null,
        installedAt,
        installedKm,
        intervalKm,
        intervalMonths,
        remindBeforeKm,
        remindBeforeDays,
        nextDueKm,
        nextDueDate,
        status: 'DANG_THEO_DOI',
        note: opts.note ?? null,
        createdBy: opts.actorId ?? null,
      },
    });
  }

  async createForVehicle(a: Access, vehicleId: string, dto: z.infer<typeof createMaintItemSchema>, ip?: string) {
    assertGarageWrite(a);
    const created = await this.prisma.$transaction((tx) =>
      this.recordItemInTx(tx, {
        tenantId: a.tenantId,
        vehicleId,
        categoryCode: dto.categoryCode.toUpperCase(),
        itemName: dto.itemName,
        productId: dto.productId,
        orderId: dto.orderId,
        installedAt: dto.installedAt ? new Date(`${dto.installedAt}T00:00:00Z`) : undefined,
        installedKm: dto.installedKm,
        intervalKm: dto.intervalKm,
        intervalMonths: dto.intervalMonths,
        remindBeforeKm: dto.remindBeforeKm,
        remindBeforeDays: dto.remindBeforeDays,
        note: dto.note,
        actorId: a.userId,
      }),
    );

    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'vehicle.maintenance_recorded',
      entity: 'vehicle_maintenance_item',
      entityId: created.id,
      after: { vehicleId, categoryCode: created.categoryCode, itemName: created.itemName, installedKm: created.installedKm },
      ip,
    });
    const v = await this.prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { odometerKm: true } });
    return this.formatItemView(created, v?.odometerKm ?? null);
  }

  async removeItem(a: Access, vehicleId: string, itemId: string, ip?: string) {
    assertGarageWrite(a);
    const row = await this.prisma.vehicleMaintenanceItem.findFirst({
      where: { id: itemId, vehicleId, tenantId: a.tenantId },
    });
    if (!row) throw new NotFoundException('Không tìm thấy hạng mục theo dõi bảo dưỡng');
    await this.prisma.vehicleMaintenanceItem.delete({ where: { id: itemId } });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'vehicle.maintenance_deleted',
      entity: 'vehicle_maintenance_item',
      entityId: itemId,
      before: { itemName: row.itemName },
      ip,
    });
    return { status: 'ok' };
  }

  /** Tự động ghi nhận các hạng mục bảo dưỡng (Dầu nhớt, Lốp, Ắc quy…) khi Lệnh sửa chữa chuyển sang Đã giao (DA_GIAO) */
  async recordFromDeliveredOrder(
    tx: Prisma.TransactionClient,
    opts: { tenantId: string; orderId: string; vehicleId: string | null; odometerKm: number | null; deliveredAt: Date; actorId: string },
  ) {
    if (!opts.vehicleId) return;
    const [items, rules, v] = await Promise.all([
      tx.orderItem.findMany({ where: { orderId: opts.orderId }, orderBy: { sortOrder: 'asc' } }),
      this.ensureRules(opts.tenantId, tx),
      tx.vehicle.findUnique({ where: { id: opts.vehicleId }, select: { odometerKm: true } }),
    ]);
    const km = opts.odometerKm ?? v?.odometerKm ?? null;
    const seenCategories = new Set<string>();
    for (const it of items) {
      const matched = matchRuleByItemName(it.name, rules);
      if (!matched || seenCategories.has(matched.code)) continue;
      seenCategories.add(matched.code);
      await this.recordItemInTx(tx, {
        tenantId: opts.tenantId,
        vehicleId: opts.vehicleId,
        categoryCode: matched.code,
        itemName: it.name,
        productId: it.productId,
        orderId: opts.orderId,
        installedAt: opts.deliveredAt,
        installedKm: km,
        intervalKm: matched.intervalKm,
        intervalMonths: matched.intervalMonths,
        remindBeforeKm: matched.remindBeforeKm,
        remindBeforeDays: matched.remindBeforeDays,
        actorId: opts.actorId,
      });
    }
  }
}

@Injectable()
export class SerialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly maintenance: MaintenanceService,
  ) {}

  private buildSearchText(p: {
    serialNo: string;
    productName: string;
    brand?: string | null;
    plateNo?: string | null;
  }): string {
    return searchKey(p.serialNo, p.productName, p.brand, p.plateNo, p.plateNo ? formatPlate(p.plateNo) : null);
  }

  formatSerialSummary(
    s: Prisma.SerialItemGetPayload<{
      include: {
        currentVehicle: {
          include: {
            ownerships: { where: { toDate: null }; include: { customer: { select: { id: true; name: true; phone: true } } } };
          };
        };
      };
    }>,
    today = vnToday(),
  ) {
    const veh = s.currentVehicle;
    const owner = veh?.ownerships[0]?.customer ?? null;
    const warranty = evaluateSerialWarranty(s, veh?.odometerKm ?? null, today);
    return {
      id: s.id,
      serialNo: s.serialNo,
      kind: s.kind,
      kindLabel: SERIAL_KIND_LABEL[s.kind],
      status: s.status,
      statusLabel: SERIAL_STATUS_LABEL[s.status],
      branchId: s.branchId,
      productId: s.productId,
      productName: s.productName,
      brand: s.brand,
      dotOrMfg: s.dotOrMfg,
      position: s.position,
      positionLabel: positionLabel(s.position),
      installedAt: s.installedAt ? ymd(vnDate(s.installedAt)) : null,
      installedKm: s.installedKm,
      warrantyMonths: s.warrantyMonths,
      warrantyKm: s.warrantyKm,
      warrantyExpiresAt: s.warrantyExpiresAt ? ymd(vnDate(s.warrantyExpiresAt)) : null,
      warrantyMaxKm: s.warrantyMaxKm,
      warrantyState: warranty.warrantyState,
      warrantySummary: warranty.summaryText,
      daysLeft: warranty.daysLeft,
      kmLeft: warranty.kmLeft,
      kmUsedSinceInstall: warranty.kmUsedSinceInstall,
      note: s.note,
      vehicle: veh
        ? {
            id: veh.id,
            plate: formatPlate(veh.plateNo),
            make: veh.make,
            model: veh.model,
            odometerKm: veh.odometerKm,
            owner,
          }
        : null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  async list(a: Access, q: z.infer<typeof listSerialQuery>) {
    assertGarageView(a);
    if (q.branchId && !AccessService.canAccessBranch(a, q.branchId)) {
      throw new ForbiddenException('Bạn không có quyền truy cập chi nhánh này');
    }

    const where: Prisma.SerialItemWhereInput = { tenantId: a.tenantId };
    if (q.kind) where.kind = q.kind;
    if (q.status) where.status = q.status;
    if (q.vehicleId) where.currentVehicleId = q.vehicleId;
    if (q.branchId) where.branchId = q.branchId;
    if (q.q?.trim()) {
      const text = q.q.trim();
      const serialNorm = normalizeSerialNo(text);
      const plateNorm = normalizePlate(text) ?? text.toUpperCase().replace(/[^A-Z0-9]/g, '');
      where.OR = [
        { serialNo: { contains: serialNorm, mode: 'insensitive' } },
        { searchText: { contains: searchKey(text) } },
        ...(plateNorm.length >= 2 ? [{ currentVehicle: { plateNo: { contains: plateNorm } } }] : []),
      ];
    }

    const [total, rows] = await Promise.all([
      this.prisma.serialItem.count({ where }),
      this.prisma.serialItem.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          currentVehicle: {
            include: {
              ownerships: {
                where: { toDate: null },
                include: { customer: { select: { id: true, name: true, phone: true } } },
              },
            },
          },
        },
      }),
    ]);

    const today = vnToday();
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      positions: SERIAL_POSITIONS,
      items: rows.map((r) => this.formatSerialSummary(r, today)),
    };
  }

  private async enrichEvents(events: Prisma.SerialEventGetPayload<{ include: { fromVehicle: true; toVehicle: true } }>[]) {
    const actorIds = [...new Set(events.map((e) => e.actorId).filter((x): x is string => !!x))];
    const orderIds = [...new Set(events.map((e) => e.orderId).filter((x): x is string => !!x))];
    const [actors, orders] = await Promise.all([
      actorIds.length ? this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } }) : [],
      orderIds.length ? this.prisma.repairOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, code: true } }) : [],
    ]);
    const actorMap = new Map(actors.map((u) => [u.id, u.fullName]));
    const orderMap = new Map(orders.map((o) => [o.id, o.code]));

    return events.map((ev) => ({
      id: ev.id,
      action: ev.action,
      actionLabel: SERIAL_ACTION_LABEL[ev.action],
      fromVehicle: ev.fromVehicle ? { id: ev.fromVehicle.id, plate: formatPlate(ev.fromVehicle.plateNo) } : null,
      toVehicle: ev.toVehicle ? { id: ev.toVehicle.id, plate: formatPlate(ev.toVehicle.plateNo) } : null,
      fromPosition: ev.fromPosition,
      fromPositionLabel: positionLabel(ev.fromPosition),
      toPosition: ev.toPosition,
      toPositionLabel: positionLabel(ev.toPosition),
      orderId: ev.orderId,
      orderCode: ev.orderId ? (orderMap.get(ev.orderId) ?? null) : null,
      odometerKm: ev.odometerKm,
      performedAt: ev.performedAt,
      note: ev.note,
      actorName: ev.actorId ? (actorMap.get(ev.actorId) ?? null) : null,
    }));
  }

  async get(a: Access, id: string) {
    assertGarageView(a);
    const row = await this.prisma.serialItem.findFirst({
      where: { id, tenantId: a.tenantId },
      include: {
        currentVehicle: {
          include: {
            ownerships: { where: { toDate: null }, include: { customer: { select: { id: true, name: true, phone: true } } } },
          },
        },
        events: {
          include: { fromVehicle: true, toVehicle: true },
          orderBy: { performedAt: 'desc' },
        },
      },
    });
    if (!row) throw new NotFoundException('Không tìm thấy số sê-ri');
    return {
      ...this.formatSerialSummary(row),
      events: await this.enrichEvents(row.events),
    };
  }

  /** Tra cứu bảo hành tức thì theo Biển số xe HOẶC Số Sê-ri (trả cả lịch sử lắp, tháo, đảo, chuyển sang xe khác) */
  async lookupWarranty(a: Access, rawQuery: string) {
    assertGarageView(a);
    const q = rawQuery.trim();
    if (q.length < 2) throw new BadRequestException('Nhập tối thiểu 2 ký tự biển số hoặc số sê-ri để tra cứu');

    const serialNorm = normalizeSerialNo(q);
    const plateNorm = normalizePlate(q) ?? q.toUpperCase().replace(/[^A-Z0-9]/g, '');

    const matchedVehicles =
      plateNorm.length >= 3
        ? await this.prisma.vehicle.findMany({
            where: { tenantId: a.tenantId, deletedAt: null, plateNo: { contains: plateNorm } },
            take: 10,
            include: {
              ownerships: { where: { toDate: null }, include: { customer: { select: { id: true, name: true, phone: true } } } },
            },
          })
        : [];
    const vehicleIds = matchedVehicles.map((v) => v.id);

    const rows = await this.prisma.serialItem.findMany({
      where: {
        tenantId: a.tenantId,
        OR: [
          { serialNo: { contains: serialNorm, mode: 'insensitive' } },
          { searchText: { contains: searchKey(q) } },
          ...(vehicleIds.length
            ? [
                { currentVehicleId: { in: vehicleIds } },
                { events: { some: { OR: [{ fromVehicleId: { in: vehicleIds } }, { toVehicleId: { in: vehicleIds } }] } } },
              ]
            : []),
        ],
      },
      take: 30,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      include: {
        currentVehicle: {
          include: {
            ownerships: { where: { toDate: null }, include: { customer: { select: { id: true, name: true, phone: true } } } },
          },
        },
        events: {
          include: { fromVehicle: true, toVehicle: true },
          orderBy: { performedAt: 'desc' },
        },
      },
    });

    const today = vnToday();
    const items = await Promise.all(
      rows.map(async (r) => ({
        ...this.formatSerialSummary(r, today),
        events: await this.enrichEvents(r.events),
      })),
    );

    return {
      query: q,
      vehicles: matchedVehicles.map((v) => ({
        id: v.id,
        plate: formatPlate(v.plateNo),
        make: v.make,
        model: v.model,
        odometerKm: v.odometerKm,
        owner: v.ownerships[0]?.customer ?? null,
      })),
      items,
    };
  }

  async create(a: Access, dto: z.infer<typeof createSerialSchema>, ip?: string) {
    assertGarageWrite(a);
    if (dto.branchId && !AccessService.canAccessBranch(a, dto.branchId)) {
      throw new ForbiddenException('Bạn không có quyền thao tác trên chi nhánh này');
    }

    const serialNo = normalizeSerialNo(dto.serialNo);
    const existing = await this.prisma.serialItem.findUnique({
      where: { tenantId_serialNo: { tenantId: a.tenantId, serialNo } },
    });
    if (existing) throw new ConflictException(`Số sê-ri "${serialNo}" đã tồn tại trong hệ thống`);

    let vehicle: { id: string; plateNo: string; odometerKm: number | null } | null = null;
    if (dto.vehicleId) {
      vehicle = await this.prisma.vehicle.findFirst({
        where: { id: dto.vehicleId, tenantId: a.tenantId, deletedAt: null },
        select: { id: true, plateNo: true, odometerKm: true },
      });
      if (!vehicle) throw new BadRequestException('Xe gắn sê-ri không tồn tại');
    }

    if (dto.productId) {
      const prod = await this.prisma.product.findFirst({ where: { id: dto.productId, tenantId: a.tenantId, deletedAt: null } });
      if (!prod) throw new BadRequestException('Sản phẩm danh mục không hợp lệ');
    }

    const isMounted = Boolean(vehicle);
    const installDate = isMounted ? (dto.installedAt ? vnDate(new Date(`${dto.installedAt}T00:00:00Z`)) : vnToday()) : null;
    const installKm = isMounted ? (dto.installedKm ?? vehicle?.odometerKm ?? null) : null;
    const warrantyExpiresAt =
      installDate && dto.warrantyMonths ? addMonths(installDate, dto.warrantyMonths) : null;
    const warrantyMaxKm =
      installKm !== null && dto.warrantyKm ? installKm + dto.warrantyKm : null;

    const createdId = await this.prisma.$transaction(async (tx) => {
      const s = await tx.serialItem.create({
        data: {
          tenantId: a.tenantId,
          branchId: dto.branchId ?? (a.branchIds !== 'ALL' ? (a.branchIds[0] ?? null) : null),
          serialNo,
          kind: dto.kind,
          productId: dto.productId ?? null,
          productName: dto.productName,
          brand: dto.brand?.trim() || null,
          dotOrMfg: dto.dotOrMfg?.trim() || null,
          status: isMounted ? 'DANG_SU_DUNG' : 'TRONG_KHO',
          currentVehicleId: vehicle?.id ?? null,
          position: isMounted ? (dto.position?.trim() || null) : null,
          installedAt: installDate,
          installedKm: installKm,
          warrantyMonths: dto.warrantyMonths ?? null,
          warrantyKm: dto.warrantyKm ?? null,
          warrantyExpiresAt,
          warrantyMaxKm,
          note: dto.note?.trim() || null,
          createdBy: a.userId,
          searchText: this.buildSearchText({
            serialNo,
            productName: dto.productName,
            brand: dto.brand,
            plateNo: vehicle?.plateNo,
          }),
        },
      });

      await tx.serialEvent.create({
        data: {
          tenantId: a.tenantId,
          serialId: s.id,
          action: isMounted ? 'LAP_MOI' : 'NHAP_KHO',
          toVehicleId: vehicle?.id ?? null,
          toPosition: isMounted ? (dto.position?.trim() || null) : null,
          orderId: dto.orderId ?? null,
          odometerKm: installKm,
          note: dto.note?.trim() || null,
          actorId: a.userId,
        },
      });

      // Nếu lắp trực tiếp lên xe: đồng bộ luôn hạng mục Theo dõi bảo dưỡng cho xe đó
      if (vehicle && installDate) {
        const catCode = dto.kind === 'LOP' ? 'LOP_THAY' : dto.kind === 'AC_QUY' ? 'AC_QUY' : 'PIN_LITHIUM';
        await this.maintenance.recordItemInTx(tx, {
          tenantId: a.tenantId,
          vehicleId: vehicle.id,
          categoryCode: catCode,
          itemName: `${dto.productName} (Sê-ri: ${serialNo})`,
          productId: dto.productId,
          orderId: dto.orderId,
          installedAt: installDate,
          installedKm: installKm,
          actorId: a.userId,
        });
      }

      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: isMounted ? 'serial.installed' : 'serial.created',
          entity: 'serial_item',
          entityId: s.id,
          after: { serialNo, kind: dto.kind, vehicleId: vehicle?.id ?? null, position: dto.position ?? null },
          ip,
        },
        tx,
      );
      return s.id;
    });

    return this.get(a, createdId);
  }

  /** Xử lý mọi thao tác vòng đời của Sê-ri: Lắp mới/lại, Đảo vị trí, Tháo rời, Chuyển sang xe khác, Đổi bảo hành, Loại bỏ */
  async transition(a: Access, id: string, dto: z.infer<typeof transitionSerialSchema>, ip?: string) {
    assertGarageWrite(a);
    const cur = await this.prisma.serialItem.findFirst({
      where: { id, tenantId: a.tenantId },
      include: { currentVehicle: true },
    });
    if (!cur) throw new NotFoundException('Không tìm thấy số sê-ri');
    if (cur.status === 'LOAI_BO') throw new ConflictException('Sản phẩm sê-ri này đã thanh lý / ngừng sử dụng');

    const today = vnToday();

    await this.prisma.$transaction(async (tx) => {
      if (dto.action === 'LAP_MOI' || dto.action === 'LAP_LAI') {
        if (cur.status === 'DANG_SU_DUNG') {
          throw new ConflictException('Sê-ri đang gắn trên xe. Hãy chọn "Đảo vị trí" hoặc "Chuyển sang xe khác".');
        }
        if (!dto.toVehicleId) throw new BadRequestException('Chọn xe cần lắp sê-ri');
        const targetVeh = await tx.vehicle.findFirst({ where: { id: dto.toVehicleId, tenantId: a.tenantId, deletedAt: null } });
        if (!targetVeh) throw new BadRequestException('Xe nhận sê-ri không tồn tại');

        const km = dto.odometerKm ?? targetVeh.odometerKm ?? null;
        const firstInstall = !cur.installedAt;
        const installedAt = cur.installedAt ?? today;
        const installedKm = cur.installedKm ?? km;
        const warrantyExpiresAt =
          cur.warrantyExpiresAt ?? (cur.warrantyMonths ? addMonths(installedAt, cur.warrantyMonths) : null);
        const warrantyMaxKm =
          cur.warrantyMaxKm ?? (installedKm !== null && cur.warrantyKm ? installedKm + cur.warrantyKm : null);

        await tx.serialItem.update({
          where: { id },
          data: {
            status: 'DANG_SU_DUNG',
            currentVehicleId: targetVeh.id,
            position: dto.toPosition?.trim() || null,
            installedAt,
            installedKm,
            warrantyExpiresAt,
            warrantyMaxKm,
            searchText: this.buildSearchText({
              serialNo: cur.serialNo,
              productName: cur.productName,
              brand: cur.brand,
              plateNo: targetVeh.plateNo,
            }),
          },
        });

        await tx.serialEvent.create({
          data: {
            tenantId: a.tenantId,
            serialId: id,
            action: firstInstall ? 'LAP_MOI' : 'LAP_LAI',
            toVehicleId: targetVeh.id,
            toPosition: dto.toPosition?.trim() || null,
            orderId: dto.orderId ?? null,
            odometerKm: km,
            note: dto.note?.trim() || null,
            actorId: a.userId,
          },
        });

        if (km !== null && (targetVeh.odometerKm === null || km > targetVeh.odometerKm)) {
          await tx.vehicle.update({ where: { id: targetVeh.id }, data: { odometerKm: km } });
        }
      } else if (dto.action === 'DAO_VI_TRI') {
        if (!cur.currentVehicleId || cur.status !== 'DANG_SU_DUNG') {
          throw new ConflictException('Chỉ đảo vị trí được khi sản phẩm đang lắp trên xe');
        }
        if (!dto.toPosition?.trim()) throw new BadRequestException('Chọn vị trí mới trên xe');
        const km = dto.odometerKm ?? cur.currentVehicle?.odometerKm ?? null;

        await tx.serialItem.update({
          where: { id },
          data: { position: dto.toPosition.trim() },
        });
        await tx.serialEvent.create({
          data: {
            tenantId: a.tenantId,
            serialId: id,
            action: 'DAO_VI_TRI',
            fromVehicleId: cur.currentVehicleId,
            toVehicleId: cur.currentVehicleId,
            fromPosition: cur.position,
            toPosition: dto.toPosition.trim(),
            orderId: dto.orderId ?? null,
            odometerKm: km,
            note: dto.note?.trim() || null,
            actorId: a.userId,
          },
        });
      } else if (dto.action === 'CHUYEN_XE') {
        if (!cur.currentVehicleId) throw new ConflictException('Sê-ri hiện chưa gắn trên xe nào để chuyển');
        if (!dto.toVehicleId) throw new BadRequestException('Chọn xe nhận chuyển sang');
        if (dto.toVehicleId === cur.currentVehicleId) {
          throw new BadRequestException('Xe nhận trùng với xe hiện tại — hãy dùng chức năng Đảo vị trí');
        }
        const targetVeh = await tx.vehicle.findFirst({ where: { id: dto.toVehicleId, tenantId: a.tenantId, deletedAt: null } });
        if (!targetVeh) throw new BadRequestException('Xe nhận không tồn tại');

        const km = dto.odometerKm ?? targetVeh.odometerKm ?? null;
        await tx.serialItem.update({
          where: { id },
          data: {
            status: 'DANG_SU_DUNG',
            currentVehicleId: targetVeh.id,
            position: dto.toPosition?.trim() ?? cur.position,
            searchText: this.buildSearchText({
              serialNo: cur.serialNo,
              productName: cur.productName,
              brand: cur.brand,
              plateNo: `${cur.currentVehicle?.plateNo ?? ''} ${targetVeh.plateNo}`,
            }),
          },
        });
        await tx.serialEvent.create({
          data: {
            tenantId: a.tenantId,
            serialId: id,
            action: 'CHUYEN_XE',
            fromVehicleId: cur.currentVehicleId,
            toVehicleId: targetVeh.id,
            fromPosition: cur.position,
            toPosition: dto.toPosition?.trim() ?? cur.position,
            orderId: dto.orderId ?? null,
            odometerKm: km,
            note: dto.note?.trim() || null,
            actorId: a.userId,
          },
        });
      } else if (dto.action === 'THAO_RA') {
        if (!cur.currentVehicleId) throw new ConflictException('Sê-ri hiện không gắn trên xe nào');
        const km = dto.odometerKm ?? cur.currentVehicle?.odometerKm ?? null;
        await tx.serialItem.update({
          where: { id },
          data: { status: 'DA_THAO', currentVehicleId: null, position: null },
        });
        await tx.serialEvent.create({
          data: {
            tenantId: a.tenantId,
            serialId: id,
            action: 'THAO_RA',
            fromVehicleId: cur.currentVehicleId,
            fromPosition: cur.position,
            orderId: dto.orderId ?? null,
            odometerKm: km,
            note: dto.note?.trim() || null,
            actorId: a.userId,
          },
        });
      } else if (dto.action === 'DOI_BAO_HANH') {
        const km = dto.odometerKm ?? cur.currentVehicle?.odometerKm ?? null;
        const prevVehicleId = cur.currentVehicleId;
        const prevPos = cur.position;

        await tx.serialItem.update({
          where: { id },
          data: { status: 'BAO_HANH', currentVehicleId: null, position: null },
        });

        let noteSuffix = '';
        if (dto.replacementSerialNo?.trim()) {
          const repSerial = normalizeSerialNo(dto.replacementSerialNo);
          const dup = await tx.serialItem.findUnique({
            where: { tenantId_serialNo: { tenantId: a.tenantId, serialNo: repSerial } },
          });
          if (dup) throw new ConflictException(`Số sê-ri thay thế "${repSerial}" đã tồn tại`);

          const newItem = await tx.serialItem.create({
            data: {
              tenantId: a.tenantId,
              branchId: cur.branchId,
              serialNo: repSerial,
              kind: cur.kind,
              productId: cur.productId,
              productName: cur.productName,
              brand: cur.brand,
              status: prevVehicleId ? 'DANG_SU_DUNG' : 'TRONG_KHO',
              currentVehicleId: prevVehicleId,
              position: prevPos,
              installedAt: prevVehicleId ? today : null,
              installedKm: prevVehicleId ? km : null,
              warrantyMonths: cur.warrantyMonths,
              warrantyKm: cur.warrantyKm,
              warrantyExpiresAt: cur.warrantyExpiresAt ?? (cur.warrantyMonths ? addMonths(today, cur.warrantyMonths) : null),
              warrantyMaxKm: km !== null && cur.warrantyKm ? km + cur.warrantyKm : cur.warrantyMaxKm,
              note: `Đổi bảo hành thay cho sê-ri ${cur.serialNo}`,
              createdBy: a.userId,
              searchText: this.buildSearchText({
                serialNo: repSerial,
                productName: cur.productName,
                brand: cur.brand,
                plateNo: cur.currentVehicle?.plateNo,
              }),
            },
          });

          await tx.serialEvent.create({
            data: {
              tenantId: a.tenantId,
              serialId: newItem.id,
              action: 'LAP_MOI',
              toVehicleId: prevVehicleId,
              toPosition: prevPos,
              orderId: dto.orderId ?? null,
              odometerKm: km,
              note: `Lắp bảo hành thay cho ${cur.serialNo}`,
              actorId: a.userId,
            },
          });
          noteSuffix = ` (Đổi sang sê-ri mới: ${repSerial})`;
        }

        await tx.serialEvent.create({
          data: {
            tenantId: a.tenantId,
            serialId: id,
            action: 'DOI_BAO_HANH',
            fromVehicleId: prevVehicleId,
            fromPosition: prevPos,
            orderId: dto.orderId ?? null,
            odometerKm: km,
            note: `${dto.note?.trim() || 'Thu hồi xử lý bảo hành'}${noteSuffix}`,
            actorId: a.userId,
          },
        });
      } else if (dto.action === 'LOAI_BO') {
        await tx.serialItem.update({
          where: { id },
          data: { status: 'LOAI_BO', currentVehicleId: null, position: null },
        });
        await tx.serialEvent.create({
          data: {
            tenantId: a.tenantId,
            serialId: id,
            action: 'LOAI_BO',
            fromVehicleId: cur.currentVehicleId,
            fromPosition: cur.position,
            orderId: dto.orderId ?? null,
            odometerKm: dto.odometerKm ?? cur.currentVehicle?.odometerKm ?? null,
            note: dto.note?.trim() || null,
            actorId: a.userId,
          },
        });
      }

      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: `serial.${dto.action.toLowerCase()}`,
          entity: 'serial_item',
          entityId: id,
          after: { action: dto.action, toVehicleId: dto.toVehicleId ?? null, toPosition: dto.toPosition ?? null },
          ip,
        },
        tx,
      );
    });

    return this.get(a, id);
  }
}

@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly svc: MaintenanceService) {}

  @Get('rules')
  rules(@CurrentAuth() auth: RequestAuth) {
    assertGarageView(auth.access);
    return this.svc.ensureRules(auth.tenantId);
  }

  @RequirePermissions('settings.manage')
  @Put('rules')
  saveRules(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(saveRulesSchema)) dto: z.infer<typeof saveRulesSchema>, @Req() req: Request) {
    return this.svc.saveRules(auth.access, dto, clientIp(req));
  }

  @Get('vehicles/:vehicleId')
  vehicleItems(@CurrentAuth() auth: RequestAuth, @Param('vehicleId', ParseUUIDPipe) vehicleId: string) {
    return this.svc.listForVehicle(auth.access, vehicleId);
  }

  @Post('vehicles/:vehicleId')
  recordItem(
    @CurrentAuth() auth: RequestAuth,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body(new ZodPipe(createMaintItemSchema)) dto: z.infer<typeof createMaintItemSchema>,
    @Req() req: Request,
  ) {
    return this.svc.createForVehicle(auth.access, vehicleId, dto, clientIp(req));
  }

  @Delete('vehicles/:vehicleId/:itemId')
  @HttpCode(200)
  removeItem(
    @CurrentAuth() auth: RequestAuth,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Req() req: Request,
  ) {
    return this.svc.removeItem(auth.access, vehicleId, itemId, clientIp(req));
  }
}

@Controller('serials')
export class SerialsController {
  constructor(private readonly svc: SerialsService) {}

  @Get()
  list(@CurrentAuth() auth: RequestAuth, @Query(new ZodPipe(listSerialQuery)) q: z.infer<typeof listSerialQuery>) {
    return this.svc.list(auth.access, q);
  }

  @Get('lookup')
  lookup(@CurrentAuth() auth: RequestAuth, @Query(new ZodPipe(z.object({ q: z.string().trim().min(2).max(100) }))) { q }: { q: string }) {
    return this.svc.lookupWarranty(auth.access, q);
  }

  @Get(':id')
  get(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(auth.access, id);
  }

  @Post()
  create(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(createSerialSchema)) dto: z.infer<typeof createSerialSchema>, @Req() req: Request) {
    return this.svc.create(auth.access, dto, clientIp(req));
  }

  @Post(':id/transition')
  @HttpCode(200)
  transition(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(transitionSerialSchema)) dto: z.infer<typeof transitionSerialSchema>,
    @Req() req: Request,
  ) {
    return this.svc.transition(auth.access, id, dto, clientIp(req));
  }
}

@Global()
@Module({
  controllers: [MaintenanceController, SerialsController],
  providers: [MaintenanceService, SerialsService],
  exports: [MaintenanceService, SerialsService],
})
export class SerialsModule {}
