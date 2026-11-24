import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { Access } from '../auth/access.service';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { EDITABLE_STATUSES, orderTotals } from './order-rules';

type Tx = Prisma.TransactionClient;
const n = (b: bigint | number) => Number(b);

export interface QuoteLine {
  itemId: string;
  kind: string;
  name: string;
  unit: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  amount: number;
  vatRate: number;
}

export function quoteView(q: {
  id: string;
  status: string;
  items: unknown;
  total: bigint;
  message: string | null;
  sentAt: Date;
  respondedAt: Date | null;
  approvedIds: string[];
  customerNote: string | null;
  applied: boolean;
}) {
  return {
    id: q.id,
    status: q.status,
    items: q.items as QuoteLine[],
    total: n(q.total),
    message: q.message,
    sentAt: q.sentAt,
    respondedAt: q.respondedAt,
    approvedIds: q.approvedIds,
    customerNote: q.customerNote,
    applied: q.applied,
  };
}

/** Báo giá đang chờ duyệt hết hiệu lực khi hạng mục bị sửa, gửi báo giá mới, hoặc đơn giao / huỷ */
export async function expirePendingQuotes(tx: Tx, orderId: string) {
  await tx.orderQuote.updateMany({ where: { orderId, status: 'CHO_DUYET' }, data: { status: 'HET_HIEU_LUC' } });
}

/**
 * Áp dụng câu trả lời của khách: bỏ các dòng bị từ chối khỏi đơn và tính lại tổng.
 * Không bỏ được (tổng mới nhỏ hơn số đã thu / phần bảo hiểm) thì vẫn ghi câu trả lời, để nhân viên xử lý (applied = false).
 */
export async function applyQuoteResponse(tx: Tx, orderId: string, declinedIds: string[]) {
  const o = await tx.repairOrder.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
  if (!declinedIds.length) return true;
  const keep = o.items.filter((i) => !declinedIds.includes(i.id));
  const gross = keep.reduce((s, i) => s + n(i.amount), 0);
  const orderDiscount = Math.min(n(o.orderDiscount), gross);
  const t = orderTotals(
    keep.map((i) => ({ quantity: i.quantity.toString(), unitPrice: n(i.unitPrice), discount: n(i.discount), vatRate: i.vatRate })),
    orderDiscount,
  );
  if (t.total < n(o.paid) || t.total < n(o.insuranceAmount)) return false;
  await tx.orderItem.deleteMany({ where: { orderId, id: { in: declinedIds } } });
  await tx.repairOrder.update({ where: { id: orderId }, data: { subtotal: BigInt(t.subtotal), orderDiscount: BigInt(orderDiscount), vatTotal: BigInt(t.vat), total: BigInt(t.total) } });
  return true;
}

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async order(db: Tx | PrismaService, a: Access, id: string) {
    const o = await db.repairOrder.findFirst({
      where: { id, tenantId: a.tenantId, ...(a.branchIds === 'ALL' ? {} : { branchId: { in: a.branchIds } }) },
      include: { items: { orderBy: { sortOrder: 'asc' } }, customer: { include: { appLink: true } } },
    });
    if (!o) throw new NotFoundException('Không tìm thấy đơn hàng');
    return o;
  }

  async list(a: Access, orderId: string) {
    const o = await this.order(this.prisma, a, orderId);
    const quotes = await this.prisma.orderQuote.findMany({ where: { orderId }, orderBy: { sentAt: 'desc' }, take: 10 });
    return { customerHasApp: !!o.customer.appLink, quotes: quotes.map(quoteView) };
  }

  /** Gửi hạng mục hiện tại cho khách duyệt trên app (báo giá đang chờ trước đó hết hiệu lực) */
  async send(a: Access, orderId: string, message: string | null | undefined, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const o = await this.order(tx, a, orderId);
      if (!EDITABLE_STATUSES.includes(o.status)) throw new ConflictException('Đơn đã giao hoặc đã huỷ, không gửi báo giá được');
      if (!o.items.length) throw new BadRequestException('Đơn chưa có hạng mục nào để báo giá');
      await expirePendingQuotes(tx, orderId);
      const items: QuoteLine[] = o.items.map((i) => ({
        itemId: i.id,
        kind: i.kind,
        name: i.name,
        unit: i.unit,
        quantity: Number(i.quantity),
        unitPrice: n(i.unitPrice),
        discount: n(i.discount),
        amount: n(i.amount),
        vatRate: i.vatRate,
      }));
      const q = await tx.orderQuote.create({
        data: { tenantId: a.tenantId, orderId, items: items as unknown as Prisma.InputJsonValue, total: o.total, message: message?.trim() || null, sentBy: a.userId },
      });
      await this.audit.log(
        { tenantId: a.tenantId, actorId: a.userId, action: 'order.quote_sent', entity: 'order', entityId: orderId, after: { quoteId: q.id, total: n(o.total), lines: items.length }, ip },
        tx,
      );
      return { ...quoteView(q), customerHasApp: !!o.customer.appLink };
    });
  }
}

@Controller('orders')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @RequirePermissions('ro.view')
  @Get(':id/quotes')
  list(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.list(auth.access, id);
  }

  @RequirePermissions('ro.manage')
  @Post(':id/quotes')
  send(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(z.object({ message: z.string().trim().max(500).optional().nullable() }))) dto: { message?: string | null },
    @Req() req: Request,
  ) {
    return this.quotes.send(auth.access, id, dto.message, clientIp(req));
  }
}
