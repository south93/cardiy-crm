import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { formatPlate, inspectionSummary, type InspectionData } from '@cardiy/shared';
import { z } from 'zod';
import { Public } from '../common/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import * as QRCode from 'qrcode';
import { DEFAULT_CARE } from '../care/care-rules';
import { STATUS_LABEL, paymentState } from '../orders/order-rules';
import { BANKS, vietQrPayload } from '../orders/vietqr';
import { applyQuoteResponse, quoteView, type QuoteLine } from '../orders/quotes';
import { AuditService } from '../audit/audit.service';
import { OwnerBookingController, OwnerBookingService } from './owner-booking';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerAppController, OwnerAuthController, OwnerAuthService, OwnerGuard, maskPhone, type OwnerRequest } from './owner-auth';

const n = (b: bigint | number) => Number(b);
const REVIEW_DAYS = 30;
const REVIEW_EDIT_DAYS = 7;
const addMonths = (d: Date, m: number) => {
  const x = new Date(d);
  x.setMonth(x.getMonth() + m);
  return x;
};
const garageName = (t: { name: string; printSettings: unknown }) => (t.printSettings as { displayName?: string } | null)?.displayName || t.name;

/**
 * Dữ liệu app chủ xe. Chủ xe chỉ thấy:
 *  - xe hiện đang đứng tên các hồ sơ khách đã liên kết với tài khoản;
 *  - đơn của chính hồ sơ khách đó (không thấy đơn của chủ xe trước).
 */
@Injectable()
export class OwnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async links(userId: string) {
    return this.prisma.customerLink.findMany({ where: { userId, customer: { deletedAt: null } }, include: { customer: { select: { id: true, name: true, tenantId: true } } } });
  }

  private async customerIds(userId: string) {
    return (await this.links(userId)).map((l) => l.customerId);
  }

  async me(userId: string) {
    const [u, links] = await Promise.all([this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true, phone: true } }), this.links(userId)]);
    const tenants = await this.prisma.tenant.findMany({ where: { id: { in: links.map((l) => l.tenantId) } }, select: { id: true, name: true, printSettings: true } });
    return {
      name: u.fullName,
      phone: maskPhone(u.phone),
      garages: links.map((l) => ({ garage: garageName(tenants.find((t) => t.id === l.tenantId)!), customerName: l.customer.name })),
    };
  }

  async vehicles(userId: string) {
    const ids = await this.customerIds(userId);
    if (!ids.length) return [];
    const own = await this.prisma.vehicleOwnership.findMany({
      where: { customerId: { in: ids }, toDate: null, vehicle: { deletedAt: null } },
      include: { vehicle: true },
      orderBy: { fromDate: 'asc' },
    });
    const tenants = await this.prisma.tenant.findMany({ where: { id: { in: [...new Set(own.map((o) => o.vehicle.tenantId))] } }, select: { id: true, name: true, printSettings: true, careSettings: true } });
    const months = new Map(tenants.map((t) => [t.id, (t.careSettings as { maintenanceMonths?: number } | null)?.maintenanceMonths ?? DEFAULT_CARE.maintenanceMonths]));
    const vids = own.map((o) => o.vehicleId);
    const orders = await this.prisma.repairOrder.findMany({
      where: { vehicleId: { in: vids }, customerId: { in: ids }, status: { not: 'HUY' } },
      orderBy: { receivedAt: 'desc' },
      select: { id: true, code: true, status: true, vehicleId: true, receivedAt: true, deliveredAt: true, promisedAt: true, odometerKm: true },
    });
    const pending = new Set((await this.prisma.orderQuote.findMany({ where: { orderId: { in: orders.map((o) => o.id) }, status: 'CHO_DUYET' }, select: { orderId: true } })).map((q) => q.orderId));
    return own.map(({ vehicle: v }) => {
      const mine = orders.filter((o) => o.vehicleId === v.id);
      const open = mine.find((o) => ['TIEP_NHAN', 'DANG_SUA', 'HOAN_THANH'].includes(o.status));
      const last = mine.find((o) => o.status === 'DA_GIAO');
      return {
        id: v.id,
        plate: formatPlate(v.plateNo),
        make: v.make,
        model: v.model,
        year: v.year,
        color: v.color,
        odometerKm: v.odometerKm,
        registrationExpiry: v.registrationExpiry,
        insuranceExpiry: v.insuranceExpiry,
        garage: garageName(tenants.find((t) => t.id === v.tenantId)!),
        visits: mine.filter((o) => o.status === 'DA_GIAO').length,
        lastVisit: last ? { date: last.deliveredAt, km: last.odometerKm } : null,
        /** Bảo dưỡng tiếp theo (ước tính): lần nhận xe gần nhất + chu kỳ bảo dưỡng của garage */
        nextMaintenance: last?.deliveredAt ? addMonths(last.deliveredAt, months.get(v.tenantId) ?? DEFAULT_CARE.maintenanceMonths) : null,
        openOrder: open ? { id: open.id, code: open.code, status: open.status, statusLabel: STATUS_LABEL[open.status], promisedAt: open.promisedAt, pendingQuote: pending.has(open.id) } : null,
      };
    });
  }

  private async ownedVehicle(userId: string, vehicleId: string) {
    const ids = await this.customerIds(userId);
    const own = await this.prisma.vehicleOwnership.findFirst({ where: { vehicleId, customerId: { in: ids }, toDate: null, vehicle: { deletedAt: null } }, include: { vehicle: true } });
    if (!own) throw new NotFoundException('Không tìm thấy xe');
    return { vehicle: own.vehicle, customerIds: ids };
  }

  async vehicle(userId: string, vehicleId: string) {
    const { vehicle: v, customerIds } = await this.ownedVehicle(userId, vehicleId);
    const [orders, odo] = await Promise.all([
      this.prisma.repairOrder.findMany({
        where: { vehicleId, customerId: { in: customerIds }, status: { not: 'HUY' } },
        orderBy: { receivedAt: 'desc' },
        include: { branch: { select: { name: true } }, items: { orderBy: { sortOrder: 'asc' }, select: { name: true } } },
      }),
      this.prisma.odometerReading.findMany({ where: { vehicleId }, orderBy: { createdAt: 'desc' }, take: 10, select: { km: true, source: true, createdAt: true } }),
    ]);
    return {
      id: v.id,
      plate: formatPlate(v.plateNo),
      make: v.make,
      model: v.model,
      year: v.year,
      color: v.color,
      vin: v.vin,
      fuel: v.fuel,
      transmission: v.transmission,
      tireSize: v.tireSize,
      odometerKm: v.odometerKm,
      registrationExpiry: v.registrationExpiry,
      insuranceExpiry: v.insuranceExpiry,
      odometers: odo,
      orders: orders.map((o) => ({
        id: o.id,
        code: o.code,
        status: o.status,
        statusLabel: STATUS_LABEL[o.status],
        branch: o.branch.name,
        receivedAt: o.receivedAt,
        deliveredAt: o.deliveredAt,
        odometerKm: o.odometerKm,
        total: n(o.total),
        items: o.items.map((i) => i.name),
      })),
    };
  }

  /** Chủ xe tự cập nhật số km (không được nhỏ hơn số đang có) */
  async addOdometer(userId: string, vehicleId: string, km: number) {
    const { vehicle: v } = await this.ownedVehicle(userId, vehicleId);
    if (v.odometerKm !== null && km < v.odometerKm) throw new BadRequestException(`Số km không được nhỏ hơn ${v.odometerKm.toLocaleString('vi-VN')} km đang lưu`);
    await this.prisma.$transaction([
      this.prisma.odometerReading.create({ data: { vehicleId, km, source: 'OWNER', recordedBy: userId } }),
      this.prisma.vehicle.update({ where: { id: vehicleId }, data: { odometerKm: km } }),
    ]);
    return { odometerKm: km };
  }

  async order(userId: string, orderId: string) {
    const ids = await this.customerIds(userId);
    const o = await this.prisma.repairOrder.findFirst({
      where: { id: orderId, customerId: { in: ids } },
      include: {
        branch: { select: { name: true, address: true, phone: true } },
        vehicle: { select: { id: true, plateNo: true, make: true, model: true } },
        items: { orderBy: { sortOrder: 'asc' } },
        payments: { where: { voidedAt: null }, orderBy: { paidAt: 'asc' } },
        history: { orderBy: { createdAt: 'asc' }, select: { toStatus: true, createdAt: true } },
        inspection: { select: { data: true, completedAt: true } },
        quotes: { orderBy: { sentAt: 'desc' }, take: 1 },
        review: true,
      },
    });
    if (!o) throw new NotFoundException('Không tìm thấy đơn');
    const q = o.quotes[0];
    const due = Math.max(0, n(o.total) - n(o.paid));
    const payInfo = o.status !== 'HUY' && due > 0 ? await this.payInfo(o.tenantId, due, o.code, o.vehicle?.plateNo) : null;
    const reviewOpen = o.status === 'DA_GIAO' && !!o.deliveredAt && Date.now() - o.deliveredAt.getTime() <= REVIEW_DAYS * 86_400_000;
    const d = (o.inspection?.data ?? null) as InspectionData | null;
    const total = n(o.total);
    const paid = n(o.paid);
    return {
      id: o.id,
      code: o.code,
      status: o.status,
      statusLabel: STATUS_LABEL[o.status],
      branch: o.branch,
      vehicle: o.vehicle ? { id: o.vehicle.id, plate: formatPlate(o.vehicle.plateNo), make: o.vehicle.make, model: o.vehicle.model } : null,
      request: o.request,
      odometerKm: o.odometerKm,
      receivedAt: o.receivedAt,
      promisedAt: o.promisedAt,
      completedAt: o.completedAt,
      deliveredAt: o.deliveredAt,
      items: o.items.map((i) => ({
        kind: i.kind,
        name: i.name,
        unit: i.unit,
        quantity: Number(i.quantity),
        unitPrice: n(i.unitPrice),
        discount: n(i.discount),
        amount: n(i.amount),
        vatRate: i.vatRate,
      })),
      subtotal: n(o.subtotal),
      orderDiscount: n(o.orderDiscount),
      vatTotal: n(o.vatTotal),
      total,
      paid,
      due: Math.max(0, total - paid),
      paymentState: paymentState(total, paid),
      payments: o.payments.map((p) => ({ amount: n(p.amount), method: p.method, paidAt: p.paidAt })),
      history: o.history.map((h) => ({ status: h.toStatus, label: STATUS_LABEL[h.toStatus], at: h.createdAt })),
      payInfo,
      review: o.review ? { rating: o.review.rating, comment: o.review.comment, reply: o.review.reply, repliedAt: o.review.repliedAt, createdAt: o.review.createdAt } : null,
      canReview: reviewOpen && (!o.review || Date.now() - o.review.createdAt.getTime() <= REVIEW_EDIT_DAYS * 86_400_000),
      /** Báo giá mới nhất (đang chờ duyệt hoặc đã trả lời); hết hiệu lực thì không hiện */
      quote: q && q.status !== 'HET_HIEU_LUC' ? quoteView(q) : null,
      inspection:
        o.inspection?.completedAt && d ? { completedAt: o.inspection.completedAt, ...inspectionSummary(d), recommendation: d.recommendation ?? null, suggestions: d.suggestions ?? null } : null,
    };
  }
  /** Thông tin chuyển khoản của garage cho phần khách còn phải trả (VietQR theo ngân hàng cài trong Mẫu in & thanh toán) */
  private async payInfo(tenantId: string, amount: number, code: string, plateNo?: string | null) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { printSettings: true } });
    const s = (t.printSettings ?? {}) as { bankBin?: string; accountNo?: string; accountName?: string };
    if (!s.bankBin || !s.accountNo) return { amount, bank: null };
    const note = `${code} ${plateNo ?? ''}`.trim();
    const bank = BANKS.find((b) => b.bin === s.bankBin);
    return {
      amount,
      bank: { name: bank?.name ?? s.bankBin, accountNo: s.accountNo, accountName: s.accountName ?? '' },
      note,
      qr: await QRCode.toDataURL(vietQrPayload({ bin: s.bankBin, accountNo: s.accountNo, amount, note }), { margin: 1, width: 260, errorCorrectionLevel: 'M' }),
    };
  }

  /** Khách đánh giá đơn đã giao (trong 30 ngày; sửa được trong 7 ngày đầu) */
  async review(userId: string, orderId: string, rating: number, comment?: string | null) {
    const ids = await this.customerIds(userId);
    const o = await this.prisma.repairOrder.findFirst({ where: { id: orderId, customerId: { in: ids } }, include: { review: true } });
    if (!o) throw new NotFoundException('Không tìm thấy đơn');
    if (o.status !== 'DA_GIAO' || !o.deliveredAt) throw new ConflictException('Đánh giá được sau khi nhận xe');
    if (Date.now() - o.deliveredAt.getTime() > REVIEW_DAYS * 86_400_000) throw new ConflictException(`Chỉ đánh giá trong ${REVIEW_DAYS} ngày sau khi nhận xe`);
    if (o.review && Date.now() - o.review.createdAt.getTime() > REVIEW_EDIT_DAYS * 86_400_000) throw new ConflictException('Đánh giá đã gửi quá 7 ngày, không sửa được nữa');
    const data = { rating, comment: comment?.trim() || null };
    const r = await this.prisma.orderReview.upsert({ where: { orderId }, create: { tenantId: o.tenantId, orderId, customerId: o.customerId, userId, ...data }, update: data });
    await this.audit.log({ tenantId: o.tenantId, actorId: userId, action: 'order.reviewed', entity: 'order', entityId: orderId, after: data });
    return { rating: r.rating, comment: r.comment };
  }

  /** Lịch sử thanh toán tại các garage */
  async payments(userId: string) {
    const ids = await this.customerIds(userId);
    const rows = await this.prisma.payment.findMany({
      where: { voidedAt: null, order: { customerId: { in: ids } } },
      orderBy: { paidAt: 'desc' },
      take: 50,
      include: { order: { select: { id: true, code: true, branch: { select: { name: true } }, vehicle: { select: { plateNo: true } } } } },
    });
    return rows.map((p) => ({ id: p.id, amount: n(p.amount), method: p.method, paidAt: p.paidAt, order: { id: p.order.id, code: p.order.code, branch: p.order.branch.name, plate: p.order.vehicle ? formatPlate(p.order.vehicle.plateNo) : null } }));
  }

  /** Khách duyệt báo giá: đồng ý một phần / tất cả / từ chối tất cả. Dòng bị từ chối được bỏ khỏi đơn. */
  async respondQuote(userId: string, orderId: string, quoteId: string, approvedIds: string[], note?: string | null) {
    const ids = await this.customerIds(userId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const o = await tx.repairOrder.findFirst({ where: { id: orderId, customerId: { in: ids } }, include: { items: { select: { id: true } } } });
      if (!o) throw new NotFoundException('Không tìm thấy đơn');
      const q = await tx.orderQuote.findFirst({ where: { id: quoteId, orderId } });
      if (!q) throw new NotFoundException('Không tìm thấy báo giá');
      if (q.status !== 'CHO_DUYET') throw new ConflictException(q.status === 'HET_HIEU_LUC' ? 'Garage vừa cập nhật báo giá, vui lòng xem lại bản mới' : 'Báo giá này đã được trả lời');
      const lines = (q.items as unknown as QuoteLine[]).map((l) => l.itemId);
      // An toàn: hạng mục trong đơn phải đúng như lúc gửi (nếu lệch, coi như báo giá đã cũ)
      const current = new Set(o.items.map((i) => i.id));
      if (lines.length !== current.size || lines.some((id) => !current.has(id))) {
        await tx.orderQuote.update({ where: { id: quoteId }, data: { status: 'HET_HIEU_LUC' } });
        throw new ConflictException('Garage vừa cập nhật báo giá, vui lòng xem lại bản mới');
      }
      if (approvedIds.some((id) => !lines.includes(id))) throw new BadRequestException('Hạng mục không thuộc báo giá này');
      const approved = [...new Set(approvedIds)];
      const declined = lines.filter((id) => !approved.includes(id));
      const status = !approved.length ? 'TU_CHOI' : declined.length ? 'DUYET_MOT_PHAN' : 'DA_DUYET';
      const applied = await applyQuoteResponse(tx, orderId, declined);
      const updated = await tx.orderQuote.update({ where: { id: quoteId }, data: { status, approvedIds: approved, customerNote: note?.trim() || null, respondedAt: new Date(), applied } });
      await this.audit.log({ tenantId: o.tenantId, actorId: userId, action: 'order.quote_answered', entity: 'order', entityId: orderId, after: { quoteId, status, approved: approved.length, declined: declined.length, applied } }, tx);
      return quoteView(updated);
    });
  }
}

const reviewSchema = z.object({ rating: z.coerce.number().int().min(1, 'Chọn từ 1 đến 5 sao').max(5), comment: z.string().trim().max(1000).optional().nullable() });
const respondSchema = z.object({ approvedIds: z.array(z.string().uuid()).max(200), note: z.string().trim().max(500).optional().nullable() });

const odoSchema = z.object({ km: z.coerce.number().int('Số km là số nguyên').min(0).max(5_000_000) });

@Public()
@UseGuards(OwnerGuard)
@Controller('owner')
export class OwnerController {
  constructor(private readonly svc: OwnerService) {}

  @Get('me')
  me(@Req() req: OwnerRequest) {
    return this.svc.me(req.owner!.userId);
  }

  @Get('vehicles')
  vehicles(@Req() req: OwnerRequest) {
    return this.svc.vehicles(req.owner!.userId);
  }

  @Get('vehicles/:id')
  vehicle(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.vehicle(req.owner!.userId, id);
  }

  @Post('vehicles/:id/odometer')
  odometer(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(odoSchema)) dto: z.infer<typeof odoSchema>) {
    return this.svc.addOdometer(req.owner!.userId, id, dto.km);
  }

  @Get('orders/:id')
  order(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.order(req.owner!.userId, id);
  }

  @Post('orders/:id/review')
  @HttpCode(200)
  postReview(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reviewSchema)) dto: z.infer<typeof reviewSchema>) {
    return this.svc.review(req.owner!.userId, id, dto.rating, dto.comment);
  }

  @Get('payments')
  payments(@Req() req: OwnerRequest) {
    return this.svc.payments(req.owner!.userId);
  }

  @Post('orders/:id/quotes/:quoteId/respond')
  @HttpCode(200)
  respond(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string, @Param('quoteId', ParseUUIDPipe) quoteId: string, @Body(new ZodPipe(respondSchema)) dto: z.infer<typeof respondSchema>) {
    return this.svc.respondQuote(req.owner!.userId, id, quoteId, dto.approvedIds, dto.note);
  }
}

@Module({
  controllers: [OwnerAuthController, OwnerController, OwnerBookingController, CustomerAppController],
  providers: [OwnerAuthService, OwnerService, OwnerBookingService, OwnerGuard],
  exports: [OwnerGuard],
})
export class OwnerModule {}
