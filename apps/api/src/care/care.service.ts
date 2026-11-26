import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { formatPlate, searchKey } from '@cardiy/shared';
import type { CallOutcome, CareKind, Prisma } from '@prisma/client';
import type { Access } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { addDays, addMonths, applyOutcome, DEFAULT_CARE, dueBefore, KIND_LABEL, vnDate, vnToday, ymd, type CareSettings } from './care-rules';

type View = 'hom-nay' | 'sap-toi' | 'da-xu-ly';
const LOOKAHEAD_DAYS = 7;
/** Đã hết hạn quá lâu thì thôi không gọi nữa */
const STALE_DAYS = 30;

@Injectable()
export class CareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  async settings(tenantId: string): Promise<CareSettings> {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { careSettings: true } });
    return { ...DEFAULT_CARE, ...((t.careSettings ?? {}) as Partial<CareSettings>) };
  }

  async saveSettings(a: Access, dto: CareSettings, ip?: string) {
    await this.prisma.tenant.update({ where: { id: a.tenantId }, data: { careSettings: dto as unknown as Prisma.InputJsonValue } });
    await this.redis.client.del(`care:gen:${a.tenantId}`).catch(() => 0);
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'care.settings', entity: 'tenant', entityId: a.tenantId, after: { ...dto }, ip });
    return this.settings(a.tenantId);
  }

  /**
   * Quét dữ liệu, tạo việc gọi còn thiếu (không trùng nhờ refKey). Chạy khi mở Lịch gọi,
   * tối đa 5 phút một lần mỗi garage (hoặc khi bấm "Làm mới").
   */
  async generate(tenantId: string, force = false) {
    const lock = `care:gen:${tenantId}`;
    if (!force) {
      const ok = await this.redis.client.set(lock, '1', 'EX', 300, 'NX').catch(() => 'OK');
      if (ok !== 'OK') return 0;
    }
    const s = await this.settings(tenantId);
    const today = vnToday();
    const horizon = addDays(today, LOOKAHEAD_DAYS);
    const rows: Prisma.CareTaskCreateManyInput[] = [];

    // 1-2. Hạn đăng kiểm / bảo hiểm của xe đang có chủ
    for (const [kind, field, days] of [
      ['DANG_KIEM', 'registrationExpiry', s.registrationDays],
      ['BAO_HIEM', 'insuranceExpiry', s.insuranceDays],
    ] as const) {
      const vs = await this.prisma.vehicle.findMany({
        where: { tenantId, deletedAt: null, [field]: { gte: addDays(today, -STALE_DAYS), lte: addDays(horizon, days) } },
        select: { id: true, plateNo: true, registrationExpiry: true, insuranceExpiry: true, ownerships: { where: { toDate: null }, select: { customer: { select: { id: true, branchId: true, deletedAt: true } } } } },
      });
      for (const v of vs) {
        const owner = v.ownerships[0]?.customer;
        const exp = v[field];
        if (!owner || owner.deletedAt || !exp) continue;
        const expDay = vnDate(exp);
        rows.push({
          tenantId,
          branchId: owner.branchId,
          customerId: owner.id,
          vehicleId: v.id,
          kind,
          refKey: `${kind}:${v.id}:${ymd(expDay)}`,
          title: `${KIND_LABEL[kind]} ${formatPlate(v.plateNo)}: ${expDay.toLocaleDateString('vi-VN', { timeZone: 'UTC' })}`,
          dueDate: dueBefore(expDay, days, today),
          eventDate: expDay,
        });
      }
    }

    // 3. Hỏi thăm sau khi giao xe
    const delivered = await this.prisma.repairOrder.findMany({
      where: { tenantId, status: 'DA_GIAO', deliveredAt: { gte: addDays(today, -STALE_DAYS - s.followUpDays), lte: addDays(horizon, -s.followUpDays + 1) } },
      select: { id: true, code: true, branchId: true, customerId: true, vehicleId: true, deliveredAt: true },
    });
    for (const o of delivered) {
      const day = vnDate(o.deliveredAt!);
      rows.push({
        tenantId,
        branchId: o.branchId,
        customerId: o.customerId,
        vehicleId: o.vehicleId,
        orderId: o.id,
        kind: 'HOI_THAM',
        refKey: `HOI_THAM:${o.id}`,
        title: `Hỏi thăm sau sửa · đơn ${o.code}`,
        dueDate: addDays(day, s.followUpDays),
        eventDate: day,
      });
    }

    // 4. Đến kỳ bảo dưỡng: lần giao xe gần nhất của mỗi xe + N tháng, xe chưa có đơn / lịch mới
    const from = addMonths(addDays(today, -STALE_DAYS), -s.maintenanceMonths);
    const to = addMonths(horizon, -s.maintenanceMonths);
    const last = await this.prisma.$queryRaw<{ id: string; code: string; branch_id: string; customer_id: string; vehicle_id: string; delivered_at: Date }[]>`
      SELECT DISTINCT ON (o.vehicle_id) o.id, o.code, o.branch_id, o.customer_id, o.vehicle_id, o.delivered_at
      FROM repair_orders o
      WHERE o.tenant_id = ${tenantId}::uuid AND o.vehicle_id IS NOT NULL AND o.status = 'DA_GIAO'
      ORDER BY o.vehicle_id, o.delivered_at DESC`;
    const candidates = last.filter((o) => o.delivered_at >= from && o.delivered_at <= addDays(to, 1));
    if (candidates.length) {
      const busy = new Set([
        ...(await this.prisma.repairOrder.findMany({ where: { tenantId, vehicleId: { in: candidates.map((c) => c.vehicle_id) }, status: { in: ['TIEP_NHAN', 'DANG_SUA', 'HOAN_THANH'] } }, select: { vehicleId: true } })).map((x) => x.vehicleId),
        ...(await this.prisma.booking.findMany({ where: { tenantId, vehicleId: { in: candidates.map((c) => c.vehicle_id) }, status: { in: ['CHO_XAC_NHAN', 'DA_XAC_NHAN'] } }, select: { vehicleId: true } })).map((x) => x.vehicleId),
      ]);
      for (const o of candidates) {
        if (busy.has(o.vehicle_id)) continue;
        const due = addMonths(vnDate(o.delivered_at), s.maintenanceMonths);
        rows.push({
          tenantId,
          branchId: o.branch_id,
          customerId: o.customer_id,
          vehicleId: o.vehicle_id,
          orderId: o.id,
          kind: 'BAO_DUONG',
          refKey: `BAO_DUONG:${o.vehicle_id}:${o.id}`,
          title: `Đến kỳ bảo dưỡng (${s.maintenanceMonths} tháng sau đơn ${o.code})`,
          dueDate: due < today ? today : due,
          eventDate: vnDate(o.delivered_at),
        });
      }
    }

    if (!rows.length) return 0;
    const r = await this.prisma.careTask.createMany({ data: rows, skipDuplicates: true });
    return r.count;
  }

  private branchWhere(a: Access): Prisma.CareTaskWhereInput {
    // Việc của khách chưa gắn chi nhánh: ai làm CSKH cũng thấy
    return a.branchIds === 'ALL' ? {} : { OR: [{ branchId: null }, { branchId: { in: a.branchIds } }] };
  }

  async list(a: Access, q: { view: View; kind?: CareKind; q?: string; page: number; pageSize: number; refresh?: boolean }) {
    await this.generate(a.tenantId, q.refresh);
    const today = vnToday();
    const viewWhere: Prisma.CareTaskWhereInput =
      q.view === 'hom-nay'
        ? { status: { in: ['CAN_GOI', 'GOI_LAI'] }, dueDate: { lte: today } }
        : q.view === 'sap-toi'
          ? { status: { in: ['CAN_GOI', 'GOI_LAI'] }, dueDate: { gt: today, lte: addDays(today, LOOKAHEAD_DAYS) } }
          : { status: { in: ['XONG', 'BO_QUA'] } };
    const text = q.q?.trim();
    const where: Prisma.CareTaskWhereInput = {
      tenantId: a.tenantId,
      AND: [this.branchWhere(a), viewWhere],
      ...(q.kind ? { kind: q.kind } : {}),
      ...(text ? { customer: { OR: [{ searchText: { contains: searchKey(text) } }, { phone: { contains: text.replace(/\D/g, '').length >= 3 ? text.replace(/\D/g, '') : '§' } }] } } : {}),
    };
    const [total, rows, counts] = await Promise.all([
      this.prisma.careTask.count({ where }),
      this.prisma.careTask.findMany({
        where,
        orderBy: q.view === 'da-xu-ly' ? [{ doneAt: 'desc' }] : [{ dueDate: 'asc' }, { createdAt: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { customer: { select: { id: true, name: true, phone: true } }, calls: { orderBy: { createdAt: 'desc' }, take: 1 } },
      }),
      Promise.all(
        (['hom-nay', 'sap-toi'] as const).map((v) =>
          this.prisma.careTask.count({
            where: {
              tenantId: a.tenantId,
              AND: [this.branchWhere(a), v === 'hom-nay' ? { status: { in: ['CAN_GOI', 'GOI_LAI'] }, dueDate: { lte: today } } : { status: { in: ['CAN_GOI', 'GOI_LAI'] }, dueDate: { gt: today, lte: addDays(today, LOOKAHEAD_DAYS) } }],
            },
          }),
        ),
      ),
    ]);
    const vehicles = new Map((await this.prisma.vehicle.findMany({ where: { id: { in: rows.map((r) => r.vehicleId).filter((x): x is string => !!x) } }, select: { id: true, plateNo: true, make: true, model: true } })).map((v) => [v.id, v]));
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      counts: { 'hom-nay': counts[0], 'sap-toi': counts[1] },
      items: rows.map((r) => {
        const v = r.vehicleId ? vehicles.get(r.vehicleId) : null;
        return {
          id: r.id,
          kind: r.kind,
          kindLabel: KIND_LABEL[r.kind],
          title: r.title,
          status: r.status,
          dueDate: ymd(r.dueDate),
          overdueDays: Math.max(0, Math.round((today.getTime() - r.dueDate.getTime()) / 86_400_000)),
          eventDate: r.eventDate ? ymd(r.eventDate) : null,
          attempts: r.attempts,
          lastOutcome: r.lastOutcome,
          lastNote: r.calls[0]?.note ?? null,
          customer: r.customer,
          vehicle: v ? { id: v.id, plate: formatPlate(v.plateNo), make: v.make, model: v.model } : null,
          orderId: r.orderId,
          branchId: r.branchId,
        };
      }),
    };
  }

  /** Lịch sử chăm sóc của một khách (hồ sơ khách) */
  async history(a: Access, customerId: string) {
    const tasks = await this.prisma.careTask.findMany({
      where: { tenantId: a.tenantId, customerId, AND: [this.branchWhere(a)] },
      orderBy: { dueDate: 'desc' },
      take: 50,
      include: { calls: { orderBy: { createdAt: 'desc' } } },
    });
    const actors = new Map((await this.prisma.user.findMany({ where: { id: { in: tasks.flatMap((t) => t.calls.map((c) => c.actorId)).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    return tasks.map((t) => ({
      id: t.id,
      kind: t.kind,
      title: t.title,
      status: t.status,
      dueDate: ymd(t.dueDate),
      calls: t.calls.map((c) => ({ outcome: c.outcome, note: c.note, at: c.createdAt, by: c.actorId ? (actors.get(c.actorId) ?? null) : null, nextAt: c.nextAt ? ymd(c.nextAt) : null })),
    }));
  }

  async logCall(a: Access, id: string, dto: { outcome: CallOutcome; note?: string | null; nextAt?: string | null; bookingId?: string | null }, ip?: string) {
    const t = await this.prisma.careTask.findFirst({ where: { id, tenantId: a.tenantId, AND: [this.branchWhere(a)] } });
    if (!t) throw new NotFoundException('Không tìm thấy việc gọi');
    if (t.status === 'XONG' || t.status === 'BO_QUA') throw new ConflictException('Việc gọi này đã xử lý xong');
    if (dto.bookingId && !(await this.prisma.booking.findFirst({ where: { id: dto.bookingId, tenantId: a.tenantId, customerId: t.customerId } }))) throw new BadRequestException('Lịch hẹn không hợp lệ');
    const s = await this.settings(a.tenantId);
    const today = vnToday();
    let next: ReturnType<typeof applyOutcome>;
    try {
      next = applyOutcome(dto.outcome, t.attempts, today, dto.nextAt ? new Date(`${dto.nextAt.slice(0, 10)}T00:00:00Z`) : null, s.maxAttempts);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const done = next.status === 'XONG' || next.status === 'BO_QUA';
    await this.prisma.$transaction([
      this.prisma.callLog.create({ data: { taskId: id, outcome: dto.outcome, note: dto.note?.trim() || null, nextAt: next.dueDate ?? null, bookingId: dto.bookingId ?? null, actorId: a.userId } }),
      this.prisma.careTask.update({ where: { id }, data: { status: next.status, attempts: next.attempts, lastOutcome: dto.outcome, ...(next.dueDate ? { dueDate: next.dueDate } : {}), doneAt: done ? new Date() : null } }),
    ]);
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'care.call', entity: 'care_task', entityId: id, after: { outcome: dto.outcome, status: next.status }, ip });
    return { status: next.status, dueDate: next.dueDate ? ymd(next.dueDate) : null };
  }

  /** Tạo việc gọi tay (VD: khách hẹn tháng sau gọi lại báo giá lốp) */
  async create(a: Access, dto: { customerId: string; vehicleId?: string | null; title: string; dueDate: string }, ip?: string) {
    const c = await this.prisma.customer.findFirst({ where: { id: dto.customerId, tenantId: a.tenantId, deletedAt: null } });
    if (!c) throw new BadRequestException('Khách hàng không hợp lệ');
    const due = new Date(`${dto.dueDate.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(due.getTime())) throw new BadRequestException('Ngày gọi không hợp lệ');
    const t = await this.prisma.careTask.create({
      data: { tenantId: a.tenantId, branchId: c.branchId, customerId: c.id, vehicleId: dto.vehicleId ?? null, kind: 'KHAC', refKey: `KHAC:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, title: dto.title.trim(), dueDate: due, createdBy: a.userId },
    });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'care.created', entity: 'care_task', entityId: t.id, after: { title: t.title, due: dto.dueDate }, ip });
    return { id: t.id };
  }
}
