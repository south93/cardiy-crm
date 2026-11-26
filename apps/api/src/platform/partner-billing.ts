import { Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import * as QRCode from 'qrcode';
import { z } from 'zod';
import type { Access } from '../auth/access.service';
import { AccessService } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { reserveNumbers } from '../crm/counters';
import { BANKS, vietQrPayload } from '../orders/vietqr';
import { PrismaService } from '../prisma/prisma.service';
import { invoiceCode, platformTenantId } from './partner-applications';
import { addDays, ISSUE_AHEAD_DAYS, nextPeriod, overdueDays, SUSPEND_AFTER_DAYS, vnDate } from './partner-rules';

const n = (b: bigint | number) => Number(b);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

function assertPlatform(a: Access) {
  if (a.tenantType !== 'PLATFORM') throw new ForbiddenException('Chỉ dành cho nhân sự sàn');
}

const money = z.coerce.number().int('Số tiền không hợp lệ').min(0, 'Số tiền không hợp lệ').max(1_000_000_000);
export const planSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,20}$/, 'Mã gói 2–20 ký tự chữ / số'),
  name: z.string().trim().min(2, 'Nhập tên gói').max(100),
  monthlyFee: money,
  billingMonths: z.coerce.number().int().min(1).max(24),
  description: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(500).nullable().optional()),
  features: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  active: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});
type PlanDto = z.infer<typeof planSchema>;

type InvoiceRow = Prisma.PlatformInvoiceGetPayload<{ include: { subscription: { include: { plan: true } } } }>;
function invoiceView(i: InvoiceRow, today = vnDate()) {
  return {
    id: i.id,
    code: i.code,
    tenantId: i.tenantId,
    plan: i.subscription.plan.name,
    periodFrom: ymd(i.periodFrom),
    periodTo: ymd(addDays(i.periodTo, -1)),
    amount: n(i.amount),
    dueDate: ymd(i.dueDate),
    status: i.status,
    overdueDays: overdueDays(i, today),
    paidAt: i.paidAt,
    paidMethod: i.paidMethod,
    paidNote: i.paidNote,
    createdAt: i.createdAt,
  };
}

@Injectable()
export class PartnerBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  // ---------- Gói ----------
  async plans(a: Access) {
    assertPlatform(a);
    const rows = await this.prisma.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { monthlyFee: 'asc' }], include: { _count: { select: { subscriptions: { where: { endedAt: null } } } } } });
    return rows.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      monthlyFee: n(p.monthlyFee),
      billingMonths: p.billingMonths,
      description: p.description,
      features: p.features,
      active: p.active,
      sortOrder: p.sortOrder,
      partners: p._count.subscriptions,
    }));
  }

  async savePlan(a: Access, id: string | null, dto: PlanDto, ip?: string) {
    assertPlatform(a);
    const dup = await this.prisma.plan.findUnique({ where: { code: dto.code } });
    if (dup && dup.id !== id) throw new ConflictException('Mã gói đã tồn tại');
    const data = { ...dto, monthlyFee: BigInt(dto.monthlyFee), description: dto.description ?? null };
    const before = id ? await this.prisma.plan.findUnique({ where: { id } }) : null;
    if (id && !before) throw new NotFoundException('Không tìm thấy gói');
    // Đổi giá gói chỉ áp dụng cho đối tác đăng ký mới; đối tác đang dùng giữ giá đã chụp ở gói của họ
    const p = id ? await this.prisma.plan.update({ where: { id }, data }) : await this.prisma.plan.create({ data });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: id ? 'plan.updated' : 'plan.created',
      entity: 'plan',
      entityId: p.id,
      before: before ? { monthlyFee: n(before.monthlyFee), billingMonths: before.billingMonths, active: before.active } : undefined,
      after: { ...dto },
      ip,
    });
    return { id: p.id };
  }

  // ---------- Tài khoản nhận phí của sàn (lưu chung chỗ tài khoản ngân hàng của tenant sàn) ----------
  async feeBank(a: Access) {
    assertPlatform(a);
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
    const s = (t.printSettings ?? {}) as { bankBin?: string; accountNo?: string; accountName?: string };
    return { bankBin: s.bankBin ?? '', accountNo: s.accountNo ?? '', accountName: s.accountName ?? '', banks: BANKS };
  }

  async saveFeeBank(a: Access, dto: z.infer<typeof bankSchema>, ip?: string) {
    assertPlatform(a);
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
    const next = { ...((t.printSettings ?? {}) as Record<string, unknown>), bankBin: dto.bankBin || undefined, accountNo: dto.accountNo || undefined, accountName: dto.accountName || undefined };
    await this.prisma.tenant.update({ where: { id: a.tenantId }, data: { printSettings: next as Prisma.InputJsonValue } });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'platform.fee_bank_updated', entity: 'tenant', entityId: a.tenantId, after: dto, ip });
    return this.feeBank(a);
  }

  // ---------- Hoá đơn phí ----------
  async invoices(a: Access, q: { status?: string; tenantId?: string; overdue?: string }) {
    assertPlatform(a);
    const today = vnDate();
    const where: Prisma.PlatformInvoiceWhereInput = {};
    if (q.tenantId) where.tenantId = q.tenantId;
    if (q.overdue === '1') Object.assign(where, { status: 'DA_PHAT_HANH', dueDate: { lt: today } });
    else if (q.status) where.status = q.status as 'DA_PHAT_HANH';
    const rows = await this.prisma.platformInvoice.findMany({ where, include: { subscription: { include: { plan: true } } }, orderBy: [{ periodFrom: 'desc' }, { code: 'desc' }], take: 300 });
    const tenants = await this.prisma.tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } }, select: { id: true, name: true, status: true } });
    const unpaid = await this.prisma.platformInvoice.findMany({ where: { status: 'DA_PHAT_HANH' }, select: { amount: true, dueDate: true, status: true } });
    return {
      summary: {
        unpaid: unpaid.reduce((s, i) => s + n(i.amount), 0),
        overdue: unpaid.filter((i) => overdueDays(i, today) > 0).reduce((s, i) => s + n(i.amount), 0),
        overdueCount: unpaid.filter((i) => overdueDays(i, today) > 0).length,
        suspendAfterDays: SUSPEND_AFTER_DAYS,
      },
      items: rows.map((r) => {
        const t = tenants.find((x) => x.id === r.tenantId);
        return { ...invoiceView(r, today), partner: t?.name ?? '', partnerStatus: t?.status ?? null };
      }),
    };
  }

  /** Ghi nhận đối tác đã nộp phí. Kỳ đầu của đối tác đang thiết lập được trả → chuyển Hoạt động */
  async pay(a: Access, id: string, dto: { method: string; note?: string | null; paidAt?: string | null }, ip?: string) {
    assertPlatform(a);
    const r = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM platform_invoices WHERE id = ${id}::uuid FOR UPDATE`;
      const inv = await tx.platformInvoice.findUnique({ where: { id } });
      if (!inv) throw new NotFoundException('Không tìm thấy hoá đơn');
      if (inv.status !== 'DA_PHAT_HANH') throw new ConflictException('Hoá đơn đã thanh toán hoặc đã huỷ');
      const paidAt = dto.paidAt ? new Date(`${dto.paidAt}T05:00:00Z`) : new Date();
      await tx.platformInvoice.update({ where: { id }, data: { status: 'DA_THANH_TOAN', paidAt, paidMethod: dto.method, paidNote: dto.note?.trim() || null, recordedBy: a.userId } });
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: inv.tenantId } });
      const activated = t.status === 'DANG_THIET_LAP';
      if (activated) await tx.tenant.update({ where: { id: t.id }, data: { status: 'HOAT_DONG' } });
      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'platform_invoice.paid',
          entity: 'platform_invoice',
          entityId: id,
          after: { code: inv.code, amount: n(inv.amount), method: dto.method, activated },
          ip,
        },
        tx,
      );
      return { activated, tenantId: t.id };
    });
    if (r.activated) await this.invalidateTenant(r.tenantId);
    return { status: 'DA_THANH_TOAN', activated: r.activated };
  }

  async void(a: Access, id: string, note: string, ip?: string) {
    assertPlatform(a);
    const inv = await this.prisma.platformInvoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException('Không tìm thấy hoá đơn');
    if (inv.status !== 'DA_PHAT_HANH') throw new ConflictException('Chỉ huỷ được hoá đơn chưa thanh toán');
    await this.prisma.platformInvoice.update({ where: { id }, data: { status: 'HUY', paidNote: note } });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'platform_invoice.voided', entity: 'platform_invoice', entityId: id, after: { code: inv.code, note }, ip });
    return { status: 'HUY' };
  }

  /**
   * Phát hành hoá đơn kỳ tiếp theo cho các gói sắp hết kỳ đã lập hoá đơn (còn ≤ 7 ngày).
   * Chạy lại nhiều lần không tạo trùng (mỗi kỳ dời mốc paidThrough).
   */
  async issueDue(a: Access, ip?: string) {
    assertPlatform(a);
    const horizon = addDays(vnDate(), ISSUE_AHEAD_DAYS);
    const subs = await this.prisma.subscription.findMany({ where: { endedAt: null, paidThrough: { lte: horizon } } });
    const issued: string[] = [];
    for (const s of subs) {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${s.id}::uuid FOR UPDATE`;
        let cur = await tx.subscription.findUniqueOrThrow({ where: { id: s.id } });
        // Bù tối đa 12 kỳ nếu lâu chưa chạy
        for (let k = 0; k < 12 && !cur.endedAt && cur.paidThrough <= horizon; k++) {
          const p = nextPeriod(cur.paidThrough, cur.billingMonths, n(cur.monthlyFee));
          const inv = await tx.platformInvoice.create({
            data: {
              code: invoiceCode(await reserveNumbers(tx, a.tenantId, 'platform_invoice')),
              tenantId: cur.tenantId,
              subscriptionId: cur.id,
              periodFrom: p.periodFrom,
              periodTo: p.periodTo,
              amount: BigInt(p.amount),
              dueDate: p.dueDate,
            },
          });
          issued.push(inv.code);
          cur = await tx.subscription.update({ where: { id: cur.id }, data: { paidThrough: p.periodTo } });
        }
      });
    }
    if (issued.length) await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'platform_invoice.issued', entity: 'platform_invoice', after: { codes: issued }, ip });
    return { issued: issued.length, codes: issued };
  }

  private async invalidateTenant(tenantId: string) {
    const ms = await this.prisma.membership.findMany({ where: { tenantId }, select: { id: true } });
    await this.access.invalidate(...ms.map((m) => m.id));
  }

  // ---------- Cổng đối tác: phí của tôi ----------
  async mine(a: Access) {
    if (a.tenantType !== 'PARTNER') throw new ForbiddenException('Chỉ dành cho đối tác');
    const today = vnDate();
    const [tenant, sub, rows] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: a.tenantId } }),
      this.prisma.subscription.findFirst({ where: { tenantId: a.tenantId }, orderBy: { createdAt: 'desc' }, include: { plan: true } }),
      this.prisma.platformInvoice.findMany({ where: { tenantId: a.tenantId }, include: { subscription: { include: { plan: true } } }, orderBy: { periodFrom: 'desc' }, take: 60 }),
    ]);
    const invoices = rows.map((r) => invoiceView(r, today));
    const due = invoices.filter((i) => i.status === 'DA_PHAT_HANH');
    const dueTotal = due.reduce((s, i) => s + i.amount, 0);
    return {
      status: tenant.status,
      plan: sub
        ? {
            name: sub.plan.name,
            monthlyFee: n(sub.monthlyFee),
            billingMonths: sub.billingMonths,
            startAt: ymd(sub.startAt),
            paidThrough: ymd(addDays(sub.paidThrough, -1)),
            features: sub.plan.features,
            ended: !!sub.endedAt,
          }
        : null,
      dueTotal,
      invoices,
      payInfo: dueTotal > 0 ? await this.payInfo(dueTotal, due.length === 1 ? due[0]!.code : `PHI ${tenant.name}`) : null,
    };
  }

  /** Tài khoản nhận phí của sàn: lấy từ Cài đặt in phiếu của tenant sàn */
  private async payInfo(amount: number, note: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: await platformTenantId(this.prisma) } });
    const s = (t.printSettings ?? {}) as { bankBin?: string; accountNo?: string; accountName?: string };
    if (!s.bankBin || !s.accountNo) return { amount, note, bank: null, qr: null };
    const bank = BANKS.find((b) => b.bin === s.bankBin);
    return {
      amount,
      note,
      bank: { name: bank?.name ?? s.bankBin, accountNo: s.accountNo, accountName: s.accountName ?? '' },
      qr: await QRCode.toDataURL(vietQrPayload({ bin: s.bankBin, accountNo: s.accountNo, amount, note }), { margin: 1, width: 260, errorCorrectionLevel: 'M' }),
    };
  }
}

const bankSchema = z
  .object({
    bankBin: z.string().trim().max(10).default(''),
    accountNo: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z]{0,30}$/, 'Số tài khoản chỉ gồm chữ và số')
      .default(''),
    accountName: z.string().trim().toUpperCase().max(100).default(''),
  })
  .refine((v) => !v.bankBin || BANKS.some((b) => b.bin === v.bankBin), { message: 'Ngân hàng không hợp lệ', path: ['bankBin'] })
  .refine((v) => !v.accountNo || v.bankBin, { message: 'Chọn ngân hàng', path: ['bankBin'] });

const paySchema = z.object({
  method: z.enum(['CK', 'TM']),
  note: z.string().trim().max(300).nullable().optional(),
  paidAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});
const voidSchema = z.object({ note: z.string().trim().min(3, 'Ghi lý do huỷ').max(300) });

@Controller()
export class PartnerBillingController {
  constructor(private readonly billing: PartnerBillingService) {}

  @RequirePermissions('platform.fee.manage')
  @Get('platform/plans')
  plans(@CurrentAuth() auth: RequestAuth) {
    return this.billing.plans(auth.access);
  }

  @RequirePermissions('platform.fee.manage')
  @Post('platform/plans')
  create(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(planSchema)) dto: PlanDto, @Req() req: Request) {
    return this.billing.savePlan(auth.access, null, dto, clientIp(req));
  }

  @RequirePermissions('platform.fee.manage')
  @Put('platform/plans/:id')
  update(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(planSchema)) dto: PlanDto, @Req() req: Request) {
    return this.billing.savePlan(auth.access, id, dto, clientIp(req));
  }

  @RequirePermissions('platform.fee.manage')
  @Get('platform/fee-bank')
  feeBank(@CurrentAuth() auth: RequestAuth) {
    return this.billing.feeBank(auth.access);
  }

  @RequirePermissions('platform.fee.manage')
  @Put('platform/fee-bank')
  saveFeeBank(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(bankSchema)) dto: z.infer<typeof bankSchema>, @Req() req: Request) {
    return this.billing.saveFeeBank(auth.access, dto, clientIp(req));
  }

  @RequirePermissions('platform.fee.manage')
  @Get('platform/invoices')
  invoices(@CurrentAuth() auth: RequestAuth, @Query('status') status?: string, @Query('tenantId') tenantId?: string, @Query('overdue') overdue?: string) {
    return this.billing.invoices(auth.access, { status, tenantId, overdue });
  }

  @RequirePermissions('platform.fee.manage')
  @Post('platform/invoices/issue-due')
  @HttpCode(200)
  issueDue(@CurrentAuth() auth: RequestAuth, @Req() req: Request) {
    return this.billing.issueDue(auth.access, clientIp(req));
  }

  @RequirePermissions('platform.fee.manage')
  @Post('platform/invoices/:id/pay')
  @HttpCode(200)
  pay(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(paySchema)) dto: z.infer<typeof paySchema>, @Req() req: Request) {
    return this.billing.pay(auth.access, id, dto, clientIp(req));
  }

  @RequirePermissions('platform.fee.manage')
  @Post('platform/invoices/:id/void')
  @HttpCode(200)
  void(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(voidSchema)) dto: { note: string }, @Req() req: Request) {
    return this.billing.void(auth.access, id, dto.note, clientIp(req));
  }

  @RequirePermissions('partner.billing.view')
  @Get('partner/billing')
  mine(@CurrentAuth() auth: RequestAuth) {
    return this.billing.mine(auth.access);
  }
}
