import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { formatPlate } from '@cardiy/shared';
import { Prisma, type BookingChannel } from '@prisma/client';
import { AccessService, type Access } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import { reserveNumbers } from '../crm/counters';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVE, BOOKING_LABEL, bookingTransitionError, isLate, NEED_REASON, overlaps, type BookingStatus } from './booking-rules';
import { ZaloService } from '../zalo/zalo';

export interface BookingInput {
  branchId: string;
  customerId: string;
  vehicleId?: string | null;
  scheduledAt: string;
  durationMin?: number;
  service: string;
  note?: string | null;
  channel?: BookingChannel;
  technicianId?: string | null;
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orders: OrdersService,
    private readonly zalo: ZaloService,
  ) {}

  private branchWhere(a: Access): Prisma.BookingWhereInput {
    return a.branchIds === 'ALL' ? {} : { branchId: { in: a.branchIds } };
  }

  private async load(a: Access, id: string) {
    const b = await this.prisma.booking.findFirst({ where: { id, tenantId: a.tenantId, ...this.branchWhere(a) } });
    if (!b) throw new NotFoundException('Không tìm thấy lịch hẹn');
    return b;
  }

  private view(b: Prisma.BookingGetPayload<{ include: { customer: { select: { id: true; name: true; phone: true } }; vehicle: { select: { id: true; plateNo: true; make: true; model: true } }; branch: { select: { id: true; code: true; name: true } }; order: { select: { id: true; code: true; status: true } } } }>, techs: Map<string, string>) {
    return {
      id: b.id,
      code: b.code,
      status: b.status,
      statusLabel: BOOKING_LABEL[b.status],
      late: isLate(b.status, b.scheduledAt),
      scheduledAt: b.scheduledAt,
      durationMin: b.durationMin,
      service: b.service,
      note: b.note,
      channel: b.channel,
      reason: b.reason,
      branch: b.branch,
      customer: b.customer,
      vehicle: b.vehicle ? { id: b.vehicle.id, plate: formatPlate(b.vehicle.plateNo), make: b.vehicle.make, model: b.vehicle.model } : null,
      technician: b.technicianId ? { id: b.technicianId, name: techs.get(b.technicianId) ?? '' } : null,
      order: b.order,
      createdAt: b.createdAt,
    };
  }

  private readonly include = {
    customer: { select: { id: true, name: true, phone: true } },
    vehicle: { select: { id: true, plateNo: true, make: true, model: true } },
    branch: { select: { id: true, code: true, name: true } },
    order: { select: { id: true, code: true, status: true } },
  } as const;

  private async techNames(ids: (string | null)[]) {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    if (!list.length) return new Map<string, string>();
    const ms = await this.prisma.membership.findMany({ where: { id: { in: list } }, include: { user: { select: { fullName: true } } } });
    return new Map(ms.map((m) => [m.id, m.user.fullName]));
  }

  async list(a: Access, q: { from: string; to: string; branchId?: string; status?: BookingStatus; customerId?: string; vehicleId?: string }) {
    if (q.branchId && !AccessService.canAccessBranch(a, q.branchId)) throw new ForbiddenException('Bạn không làm việc ở chi nhánh này');
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw new BadRequestException('Khoảng thời gian không hợp lệ');
    if (to.getTime() - from.getTime() > 62 * 86_400_000) throw new BadRequestException('Chỉ xem tối đa 2 tháng một lần');
    const rows = await this.prisma.booking.findMany({
      where: {
        tenantId: a.tenantId,
        ...(q.branchId ? { branchId: q.branchId } : this.branchWhere(a)),
        scheduledAt: { gte: from, lt: to },
        ...(q.status ? { status: q.status } : {}),
        ...(q.customerId ? { customerId: q.customerId } : {}),
        ...(q.vehicleId ? { vehicleId: q.vehicleId } : {}),
      },
      orderBy: { scheduledAt: 'asc' },
      take: 500,
      include: this.include,
    });
    const techs = await this.techNames(rows.map((r) => r.technicianId));
    return rows.map((r) => this.view(r, techs));
  }

  async get(a: Access, id: string) {
    const b = await this.prisma.booking.findFirst({ where: { id, tenantId: a.tenantId, ...this.branchWhere(a) }, include: this.include });
    if (!b) throw new NotFoundException('Không tìm thấy lịch hẹn');
    return this.view(b, await this.techNames([b.technicianId]));
  }

  /** Cảnh báo (không chặn): xe đã có lịch còn hiệu lực trùng giờ; số lịch cùng giờ vượt số khoang */
  private async warnings(tx: Prisma.TransactionClient, tenantId: string, d: { id?: string; branchId: string; vehicleId?: string | null; scheduledAt: Date; durationMin: number }) {
    const dayStart = new Date(d.scheduledAt.getTime() - 12 * 3_600_000);
    const dayEnd = new Date(d.scheduledAt.getTime() + 12 * 3_600_000);
    const near = await tx.booking.findMany({ where: { tenantId, branchId: d.branchId, status: { in: ACTIVE }, scheduledAt: { gte: dayStart, lt: dayEnd }, ...(d.id ? { NOT: { id: d.id } } : {}) } });
    const clash = near.filter((x) => overlaps(x.scheduledAt, x.durationMin, d.scheduledAt, d.durationMin));
    const out: string[] = [];
    if (d.vehicleId && clash.some((x) => x.vehicleId === d.vehicleId)) out.push('Xe này đã có lịch hẹn khác trùng giờ');
    const branch = await tx.branch.findUnique({ where: { id: d.branchId }, select: { bays: true } });
    if (branch?.bays && clash.length + 1 > branch.bays) out.push(`Khung giờ này đã có ${clash.length} lịch, chi nhánh có ${branch.bays} khoang sửa`);
    return out;
  }

  async create(a: Access, dto: BookingInput, ip?: string) {
    if (!AccessService.canAccessBranch(a, dto.branchId)) throw new ForbiddenException('Bạn không làm việc ở chi nhánh này');
    const at = new Date(dto.scheduledAt);
    if (Number.isNaN(at.getTime())) throw new BadRequestException('Giờ hẹn không hợp lệ');
    if (at.getTime() < Date.now() - 24 * 3_600_000) throw new BadRequestException('Giờ hẹn đã qua');
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: dto.customerId, tenantId: a.tenantId, deletedAt: null } });
      if (!customer) throw new BadRequestException('Khách hàng không hợp lệ');
      if (dto.vehicleId && !(await tx.vehicle.findFirst({ where: { id: dto.vehicleId, tenantId: a.tenantId, deletedAt: null } }))) throw new BadRequestException('Xe không hợp lệ');
      if (!(await tx.branch.findFirst({ where: { id: dto.branchId, tenantId: a.tenantId, deletedAt: null } }))) throw new BadRequestException('Chi nhánh không hợp lệ');
      if (dto.technicianId && !(await tx.membership.findFirst({ where: { id: dto.technicianId, tenantId: a.tenantId, status: 'ACTIVE' } }))) throw new BadRequestException('Kỹ thuật viên không hợp lệ');
      const durationMin = dto.durationMin ?? 60;
      const warnings = await this.warnings(tx, a.tenantId, { branchId: dto.branchId, vehicleId: dto.vehicleId, scheduledAt: at, durationMin });
      const code = `LH${String(await reserveNumbers(tx, a.tenantId, 'booking')).padStart(6, '0')}`;
      const b = await tx.booking.create({
        data: {
          tenantId: a.tenantId,
          branchId: dto.branchId,
          code,
          customerId: dto.customerId,
          vehicleId: dto.vehicleId ?? null,
          scheduledAt: at,
          durationMin,
          service: dto.service.trim(),
          note: dto.note?.trim() || null,
          channel: dto.channel ?? 'GOI_DIEN',
          technicianId: dto.technicianId ?? null,
          createdBy: a.userId,
        },
      });
      await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'booking.created', entity: 'booking', entityId: b.id, after: { code, customer: customer.name, at: at.toISOString() }, ip }, tx);
      return { id: b.id, code, warnings };
    });
  }

  async update(a: Access, id: string, dto: Partial<Omit<BookingInput, 'customerId' | 'branchId'>>, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const b = await this.load(a, id);
      if (!ACTIVE.includes(b.status)) throw new ConflictException(`Lịch hẹn "${BOOKING_LABEL[b.status]}" không sửa được nữa`);
      const at = dto.scheduledAt ? new Date(dto.scheduledAt) : b.scheduledAt;
      if (Number.isNaN(at.getTime())) throw new BadRequestException('Giờ hẹn không hợp lệ');
      if (dto.vehicleId && !(await tx.vehicle.findFirst({ where: { id: dto.vehicleId, tenantId: a.tenantId, deletedAt: null } }))) throw new BadRequestException('Xe không hợp lệ');
      if (dto.technicianId && !(await tx.membership.findFirst({ where: { id: dto.technicianId, tenantId: a.tenantId, status: 'ACTIVE' } }))) throw new BadRequestException('Kỹ thuật viên không hợp lệ');
      const durationMin = dto.durationMin ?? b.durationMin;
      const vehicleId = dto.vehicleId === undefined ? b.vehicleId : dto.vehicleId;
      await tx.booking.update({
        where: { id },
        data: {
          scheduledAt: at,
          durationMin,
          vehicleId,
          ...(dto.service !== undefined ? { service: dto.service.trim() } : {}),
          ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
          ...(dto.channel ? { channel: dto.channel } : {}),
          ...(dto.technicianId !== undefined ? { technicianId: dto.technicianId } : {}),
        },
      });
      const warnings = await this.warnings(tx, a.tenantId, { id, branchId: b.branchId, vehicleId, scheduledAt: at, durationMin });
      await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'booking.updated', entity: 'booking', entityId: id, before: { at: b.scheduledAt.toISOString() }, after: dto as Prisma.InputJsonValue, ip }, tx);
      return { status: 'ok', warnings };
    });
  }

  async changeStatus(a: Access, id: string, dto: { to: BookingStatus; reason?: string | null }, ip?: string) {
    if (dto.to === 'DA_DEN') throw new BadRequestException('Dùng "Nhận xe" để ghi khách đã đến (tạo đơn)');
    const b = await this.load(a, id);
    const err = bookingTransitionError(b.status, dto.to);
    if (err) throw new ConflictException(err);
    if (NEED_REASON.includes(dto.to) && !dto.reason?.trim()) throw new BadRequestException('Cần nhập lý do');
    await this.prisma.booking.update({ where: { id }, data: { status: dto.to, reason: dto.reason?.trim() || null } });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'booking.status', entity: 'booking', entityId: id, before: { status: b.status }, after: { status: dto.to, reason: dto.reason ?? null }, ip });
    // Báo khách qua Zalo khi garage xác nhận lịch (nếu garage bật mẫu tin này)
    if (dto.to === 'DA_XAC_NHAN') this.zalo.notify(a.tenantId, 'BOOKING_CONFIRMED', () => this.zalo.bookingContext(id));
    return { status: 'ok' };
  }

  /** Khách đến: tạo đơn tiếp nhận từ lịch hẹn, lịch chuyển "Đã đến" */
  async checkIn(
    a: Access,
    id: string,
    dto: { odometerKm?: number | null; intake?: Parameters<OrdersService['create']>[1]['intake']; intakePhotos?: Parameters<OrdersService['create']>[1]['intakePhotos'] },
    ip?: string,
  ) {
    const b = await this.load(a, id);
    const err = bookingTransitionError(b.status, 'DA_DEN');
    if (err) throw new ConflictException(err);
    const order = await this.orders.create(
      a,
      {
        branchId: b.branchId,
        customerId: b.customerId,
        vehicleId: b.vehicleId,
        odometerKm: dto.odometerKm ?? null,
        request: b.service,
        note: b.note,
        technicianId: b.technicianId,
        intake: dto.intake,
        intakePhotos: dto.intakePhotos,
      },
      ip,
    );
    // Đơn đã tạo; nếu có người bấm nhận xe cùng lúc thì lần sau bị chặn bởi điều kiện trạng thái
    const upd = await this.prisma.booking.updateMany({ where: { id, status: { in: ACTIVE } }, data: { status: 'DA_DEN', orderId: order.id } });
    if (!upd.count) throw new ConflictException('Lịch hẹn vừa được người khác xử lý');
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'booking.checkin', entity: 'booking', entityId: id, after: { order: order.code }, ip });
    return order;
  }
}
