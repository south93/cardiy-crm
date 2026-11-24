import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { formatPlate } from '@cardiy/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { Public } from '../common/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { reserveNumbers } from '../crm/counters';
import { PrismaService } from '../prisma/prisma.service';
import { OwnerGuard, type OwnerRequest } from './owner-auth';

const VN = 7 * 3_600_000;
/** Giờ nhận đặt lịch trên app (giờ VN): 07:30 → 17:00, mỗi 30 phút */
export const BOOKING_HOURS = { open: 7.5, lastSlot: 17, stepMin: 30, minLeadMin: 60, maxDays: 60, maxActive: 3 };
const ACTIVE = ['CHO_XAC_NHAN', 'DA_XAC_NHAN'] as const;
const LABEL: Record<string, string> = {
  CHO_XAC_NHAN: 'Chờ garage xác nhận',
  DA_XAC_NHAN: 'Đã xác nhận',
  DA_DEN: 'Đã tới garage',
  KHONG_DEN: 'Không tới',
  KHACH_HUY: 'Bạn đã huỷ',
  TU_CHOI: 'Garage từ chối',
};

/** Kiểm tra giờ hẹn khách chọn; trả lỗi tiếng Việt hoặc null */
export function bookingTimeError(at: Date, now = new Date()): string | null {
  if (Number.isNaN(at.getTime())) return 'Giờ hẹn không hợp lệ';
  const local = new Date(at.getTime() + VN);
  const h = local.getUTCHours() + local.getUTCMinutes() / 60;
  if (local.getUTCMinutes() % BOOKING_HOURS.stepMin !== 0 || local.getUTCSeconds() !== 0) return 'Chọn giờ chẵn hoặc rưỡi (VD 8:00, 8:30)';
  if (h < BOOKING_HOURS.open || h > BOOKING_HOURS.lastSlot) return 'Garage nhận lịch từ 7:30 đến 17:00';
  if (at.getTime() < now.getTime() + BOOKING_HOURS.minLeadMin * 60_000) return 'Đặt lịch trước ít nhất 1 tiếng';
  if (at.getTime() > now.getTime() + BOOKING_HOURS.maxDays * 86_400_000) return `Chỉ đặt lịch trong vòng ${BOOKING_HOURS.maxDays} ngày tới`;
  return null;
}

@Injectable()
export class OwnerBookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private links(userId: string) {
    return this.prisma.customerLink.findMany({ where: { userId, customer: { deletedAt: null } }, select: { tenantId: true, customerId: true } });
  }

  /** Chi nhánh + xe khách đặt lịch được, theo từng garage khách đã liên kết */
  async options(userId: string) {
    const links = await this.links(userId);
    const garages = await Promise.all(
      links.map(async (l) => {
        const [t, branches, own] = await Promise.all([
          this.prisma.tenant.findUniqueOrThrow({ where: { id: l.tenantId }, select: { name: true, printSettings: true } }),
          this.prisma.branch.findMany({ where: { tenantId: l.tenantId, deletedAt: null }, orderBy: { code: 'asc' }, select: { id: true, name: true, address: true, phone: true } }),
          this.prisma.vehicleOwnership.findMany({
            where: { customerId: l.customerId, toDate: null, vehicle: { deletedAt: null } },
            include: { vehicle: { select: { id: true, plateNo: true, make: true, model: true } } },
          }),
        ]);
        return {
          garage: (t.printSettings as { displayName?: string } | null)?.displayName || t.name,
          branches,
          vehicles: own.map((o) => ({ id: o.vehicle.id, plate: formatPlate(o.vehicle.plateNo), make: o.vehicle.make, model: o.vehicle.model })),
        };
      }),
    );
    return { garages, hours: BOOKING_HOURS };
  }

  async list(userId: string) {
    const ids = (await this.links(userId)).map((l) => l.customerId);
    const rows = await this.prisma.booking.findMany({
      where: { customerId: { in: ids }, scheduledAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      orderBy: { scheduledAt: 'desc' },
      take: 30,
      include: { branch: { select: { name: true, address: true, phone: true } }, vehicle: { select: { plateNo: true } } },
    });
    return rows.map((b) => ({
      id: b.id,
      code: b.code,
      status: b.status,
      statusLabel: LABEL[b.status] ?? b.status,
      scheduledAt: b.scheduledAt,
      service: b.service,
      note: b.note,
      reason: b.reason,
      channel: b.channel,
      branch: b.branch,
      plate: b.vehicle ? formatPlate(b.vehicle.plateNo) : null,
      orderId: b.orderId,
      cancellable: (ACTIVE as readonly string[]).includes(b.status) && b.scheduledAt.getTime() > Date.now(),
    }));
  }

  async create(userId: string, dto: { branchId: string; vehicleId: string; scheduledAt: string; service: string; note?: string | null }) {
    const at = new Date(dto.scheduledAt);
    const err = bookingTimeError(at);
    if (err) throw new BadRequestException(err);
    const branch = await this.prisma.branch.findFirst({ where: { id: dto.branchId, deletedAt: null } });
    const link = branch ? (await this.links(userId)).find((l) => l.tenantId === branch.tenantId) : null;
    if (!branch || !link) throw new NotFoundException('Không tìm thấy chi nhánh');
    const own = await this.prisma.vehicleOwnership.findFirst({ where: { vehicleId: dto.vehicleId, customerId: link.customerId, toDate: null, vehicle: { deletedAt: null } } });
    if (!own) throw new NotFoundException('Không tìm thấy xe');

    return this.prisma.$transaction(async (tx) => {
      // Khoá theo khách: bấm đặt nhiều lần cùng lúc không vượt giới hạn
      await tx.$queryRaw`SELECT id FROM customers WHERE id = ${link.customerId}::uuid FOR UPDATE`;
      const active = await tx.booking.count({ where: { customerId: link.customerId, channel: 'APP', status: { in: [...ACTIVE] }, scheduledAt: { gt: new Date() } } });
      if (active >= BOOKING_HOURS.maxActive) throw new ConflictException(`Bạn đang có ${active} lịch hẹn chưa tới. Huỷ bớt hoặc gọi garage để đặt thêm.`);
      const dup = await tx.booking.findFirst({
        where: { vehicleId: dto.vehicleId, status: { in: [...ACTIVE] }, scheduledAt: { gte: new Date(at.getTime() - 3 * 3_600_000), lte: new Date(at.getTime() + 3 * 3_600_000) } },
      });
      if (dup) throw new ConflictException(`Xe này đã có lịch hẹn ${dup.code} gần giờ đó`);
      const code = `LH${String(await reserveNumbers(tx, branch.tenantId, 'booking')).padStart(6, '0')}`;
      const b = await tx.booking.create({
        data: {
          tenantId: branch.tenantId,
          branchId: branch.id,
          code,
          customerId: link.customerId,
          vehicleId: dto.vehicleId,
          scheduledAt: at,
          durationMin: 60,
          service: dto.service.trim(),
          note: dto.note?.trim() || null,
          channel: 'APP',
          createdBy: userId,
        },
      });
      await this.audit.log({ tenantId: branch.tenantId, actorId: userId, action: 'booking.created_by_owner', entity: 'booking', entityId: b.id, after: { code, at: at.toISOString() } }, tx);
      return { id: b.id, code, status: b.status };
    });
  }

  async cancel(userId: string, id: string, reason?: string | null) {
    const ids = (await this.links(userId)).map((l) => l.customerId);
    const b = await this.prisma.booking.findFirst({ where: { id, customerId: { in: ids } } });
    if (!b) throw new NotFoundException('Không tìm thấy lịch hẹn');
    if (!(ACTIVE as readonly string[]).includes(b.status) || b.scheduledAt.getTime() <= Date.now()) throw new ConflictException('Lịch hẹn này không huỷ được nữa. Vui lòng gọi garage.');
    await this.prisma.booking.update({ where: { id }, data: { status: 'KHACH_HUY', reason: reason?.trim() || 'Khách huỷ trên app' } });
    await this.audit.log({ tenantId: b.tenantId, actorId: userId, action: 'booking.cancelled_by_owner', entity: 'booking', entityId: id, before: { status: b.status } });
    return { status: 'ok' };
  }
}

const createSchema = z.object({
  branchId: z.string().uuid(),
  vehicleId: z.string().uuid(),
  scheduledAt: z.string().max(40),
  service: z.string().trim().min(2, 'Ghi bạn cần làm gì cho xe').max(200),
  note: z.string().trim().max(500).optional().nullable(),
});

@Public()
@UseGuards(OwnerGuard)
@Controller('owner/bookings')
export class OwnerBookingController {
  constructor(private readonly svc: OwnerBookingService) {}

  @Get('options')
  options(@Req() req: OwnerRequest) {
    return this.svc.options(req.owner!.userId);
  }

  @Get()
  list(@Req() req: OwnerRequest) {
    return this.svc.list(req.owner!.userId);
  }

  @Post()
  create(@Req() req: OwnerRequest, @Body(new ZodPipe(createSchema)) dto: z.infer<typeof createSchema>) {
    return this.svc.create(req.owner!.userId, dto);
  }

  @Post(':id/cancel')
  cancel(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().max(300).optional().nullable() }))) dto: { reason?: string | null }) {
    return this.svc.cancel(req.owner!.userId, id, dto.reason);
  }
}
