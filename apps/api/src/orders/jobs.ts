import { Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { INSPECTION_LEVELS, inspectionSummary, type InspectionData } from '@cardiy/shared';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AccessService, type Access } from '../auth/access.service';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { OPEN_STATUSES } from './order-rules';

const level = z.enum(INSPECTION_LEVELS).nullable().optional();
const short = (max: number) => z.string().trim().max(max).nullable().optional();
const num = (max: number) => z.coerce.number().min(0).max(max).nullable().optional();
const key = z.string().max(80);
const tyre = z.object({ wear: level, brand: short(60), pressure: num(10), valve: level, tread: num(30) }).strict();
const sides = z.object({ L: level, R: level }).strict();

/** Dữ liệu phiếu: giới hạn kích thước để không ghi được JSON tuỳ ý */
export const inspectionSchema = z
  .object({
    requests: z.array(z.string().max(40)).max(10).optional(),
    maintenanceLevel: short(60),
    tyres: z.object({ FL: tyre.optional(), FR: tyre.optional(), RL: tyre.optional(), RR: tyre.optional() }).strict().optional(),
    sparePressure: num(10),
    wiper: z.record(key, z.enum(INSPECTION_LEVELS)).optional(),
    bodyNote: short(500),
    safety: z.record(key, z.enum(INSPECTION_LEVELS)).optional(),
    underFront: z.record(key, sides).optional(),
    underRear: z.record(key, sides).optional(),
    recommendation: short(1000),
    suggestions: short(1000),
    final: z.record(key, z.boolean()).optional(),
    finalOther: short(200),
  })
  .strict()
  .refine((d) => [d.wiper, d.safety, d.underFront, d.underRear, d.final].every((r) => !r || Object.keys(r).length <= 40), 'Quá nhiều hạng mục');

const saveSchema = z.object({ data: inspectionSchema, complete: z.boolean().optional() });

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async order(a: Access, id: string, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    const o = await tx.repairOrder.findFirst({ where: { id, tenantId: a.tenantId, ...(a.branchIds === 'ALL' ? {} : { branchId: { in: a.branchIds } }) } });
    if (!o) throw new NotFoundException('Không tìm thấy đơn hàng');
    return o;
  }

  private canWork(a: Access) {
    return AccessService.has(a, 'ro.manage') || AccessService.has(a, 'ro.task.update');
  }

  /** KTV nhận việc: đơn chưa có KTV → gán cho mình. Người quản lý đơn (ro.manage) nhận lại được đơn đã có người. */
  async claim(a: Access, id: string, ip?: string) {
    if (!this.canWork(a)) throw new ForbiddenException('Bạn không có quyền nhận việc');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_orders WHERE id = ${id}::uuid FOR UPDATE`;
      const o = await this.order(a, id, tx);
      if (!OPEN_STATUSES.includes(o.status)) throw new ConflictException('Đơn đã giao hoặc đã huỷ, không nhận việc được');
      if (o.technicianId === a.membershipId) return { status: 'ok' };
      if (o.technicianId && !AccessService.has(a, 'ro.manage')) throw new ConflictException('Đơn này đã có kỹ thuật viên khác nhận');
      await tx.repairOrder.update({ where: { id }, data: { technicianId: a.membershipId } });
      await this.audit.log(
        { tenantId: a.tenantId, actorId: a.userId, action: 'order.claim', entity: 'order', entityId: id, before: { technicianId: o.technicianId }, after: { technicianId: a.membershipId }, ip },
        tx,
      );
      return { status: 'ok' };
    });
  }

  async getInspection(a: Access, id: string) {
    const o = await this.order(a, id);
    const i = await this.prisma.inspection.findUnique({ where: { orderId: id } });
    const people = await this.prisma.membership.findMany({ where: { id: { in: [i?.inspectorId, i?.updatedBy].filter((x): x is string => !!x) } }, include: { user: { select: { fullName: true } } } });
    const name = (mid?: string | null) => (mid ? (people.find((p) => p.id === mid)?.user.fullName ?? null) : null);
    const data = (i?.data ?? {}) as InspectionData;
    return {
      orderId: id,
      data,
      summary: inspectionSummary(data),
      inspector: name(i?.inspectorId),
      completedAt: i?.completedAt ?? null,
      updatedAt: i?.updatedAt ?? null,
      updatedBy: name(i?.updatedBy),
      editable: OPEN_STATUSES.includes(o.status) && this.canWork(a) && (!o.technicianId || o.technicianId === a.membershipId || AccessService.has(a, 'ro.manage')),
    };
  }

  /** Lưu phiếu (lưu nháp nhiều lần; complete = true thì đánh dấu đã kiểm tra xong). KTV chưa nhận việc thì tự nhận. */
  async saveInspection(a: Access, id: string, dto: z.infer<typeof saveSchema>, ip?: string) {
    if (!this.canWork(a)) throw new ForbiddenException('Bạn không có quyền ghi phiếu kiểm tra');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_orders WHERE id = ${id}::uuid FOR UPDATE`;
      const o = await this.order(a, id, tx);
      if (!OPEN_STATUSES.includes(o.status)) throw new ConflictException('Đơn đã giao hoặc đã huỷ, phiếu kiểm tra đã khoá');
      const manager = AccessService.has(a, 'ro.manage');
      if (o.technicianId && o.technicianId !== a.membershipId && !manager) throw new ForbiddenException('Đơn này do kỹ thuật viên khác phụ trách');
      if (!o.technicianId && !manager) await tx.repairOrder.update({ where: { id }, data: { technicianId: a.membershipId } });
      const prev = await tx.inspection.findUnique({ where: { orderId: id } });
      const data = dto.data as Prisma.InputJsonValue;
      const completedAt = dto.complete ? (prev?.completedAt ?? new Date()) : (prev?.completedAt ?? null);
      await tx.inspection.upsert({
        where: { orderId: id },
        create: { tenantId: a.tenantId, orderId: id, data, inspectorId: a.membershipId, updatedBy: a.membershipId, completedAt },
        update: { data, updatedBy: a.membershipId, completedAt, ...(prev?.inspectorId ? {} : { inspectorId: a.membershipId }) },
      });
      if (dto.complete && !prev?.completedAt) {
        const s = inspectionSummary(dto.data as InspectionData);
        await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'order.inspection', entity: 'order', entityId: id, after: s, ip }, tx);
      }
    });
    return this.getInspection(a, id);
  }
}

@Controller('orders')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @RequirePermissions('ro.view')
  @Post(':id/claim')
  @HttpCode(200)
  claim(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.jobs.claim(auth.access, id, clientIp(req));
  }

  @RequirePermissions('ro.view')
  @Get(':id/inspection')
  get(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.getInspection(auth.access, id);
  }

  @RequirePermissions('ro.view')
  @Put(':id/inspection')
  save(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(saveSchema)) dto: z.infer<typeof saveSchema>, @Req() req: Request) {
    return this.jobs.saveInspection(auth.access, id, dto, clientIp(req));
  }
}
