import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { normalizeVnPhone } from '@cardiy/shared';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import type { Access } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import { CurrentAuth, Public } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { reserveNumbers } from '../crm/counters';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { availableStock, tenantListable, type OpeningDay } from './offer-rules';
import { canMoveRequest, checkSchedule, HOLDING, REQUEST_TTL_HOURS, voucherDiscount, type RequestStatus, type VoucherLike } from './request-rules';

type Db = PrismaService | Prisma.TransactionClient;
const n = (b: bigint | number | null | undefined) => (b === null || b === undefined ? null : Number(b));
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const requestCode = (x: number) => `YC${String(x).padStart(6, '0')}`;

/** Yêu cầu quá 24 giờ chưa được xác nhận: chuyển Hết hạn (nhả tồn). Gọi trước mỗi lần đọc */
export async function expireStale(db: Db) {
  await db.orderRequest.updateMany({ where: { status: 'CHO_XAC_NHAN', expiresAt: { lt: new Date() } }, data: { status: 'HET_HAN', closedAt: new Date() } });
}

/** Số lượng đang giữ cho các yêu cầu còn hiệu lực, theo tin đăng */
export async function heldQty(db: Db, offerIds: string[]): Promise<Map<string, number>> {
  if (!offerIds.length) return new Map();
  const rows = await db.orderRequestItem.groupBy({
    by: ['offerId'],
    where: { offerId: { in: offerIds }, kind: 'PRODUCT', request: { status: { in: HOLDING }, OR: [{ status: 'DA_XAC_NHAN' }, { expiresAt: { gte: new Date() } }] } },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.offerId, r._sum.quantity ?? 0]));
}

const voucherLike = (v: {
  kind: string;
  value: number;
  minOrder: bigint;
  maxDiscount: bigint | null;
  appliesTo: string;
  startsAt: Date;
  endsAt: Date;
  usageLimit: number | null;
  active: boolean;
}): VoucherLike => ({
  kind: v.kind as 'PERCENT' | 'AMOUNT',
  value: v.value,
  minOrder: Number(v.minOrder),
  maxDiscount: n(v.maxDiscount),
  appliesTo: v.appliesTo,
  startsAt: v.startsAt,
  endsAt: v.endsAt,
  usageLimit: v.usageLimit,
  active: v.active,
});
/** Lượt đã dùng = yêu cầu đang giữ chỗ hoặc đã hoàn tất có voucher này */
const usedCount = (db: Db, voucherId: string) => db.orderRequest.count({ where: { voucherId, status: { in: [...HOLDING, 'HOAN_THANH'] } } });

/** Mô tả ngắn voucher cho khách: "Giảm 10% (tối đa 200.000 đ) · đơn từ 1.000.000 đ" */
export function voucherSummary(v: { kind: string; value: number; maxDiscount: bigint | null; minOrder: bigint; appliesTo: string }) {
  const money = (x: number) => `${x.toLocaleString('vi-VN')} đ`;
  const head = v.kind === 'PERCENT' ? `Giảm ${v.value}%${v.maxDiscount ? ` (tối đa ${money(Number(v.maxDiscount))})` : ''}` : `Giảm ${money(v.value)}`;
  const scope = v.appliesTo === 'PRODUCT' ? ' sản phẩm' : v.appliesTo === 'SERVICE' ? ' dịch vụ' : '';
  return `${head}${scope}${Number(v.minOrder) ? ` · đơn từ ${money(Number(v.minOrder))}` : ''}`;
}

const itemsSchema = z
  .array(z.object({ offerId: z.string().uuid(), quantity: z.coerce.number().int().min(1, 'Số lượng tối thiểu 1').max(20, 'Tối đa 20') }))
  .min(1)
  .max(5);
export const quoteSchema = z.object({
  items: itemsSchema,
  voucherCode: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().toUpperCase().max(30).nullable().optional()),
});
export const requestSchema = quoteSchema.extend({
  scheduledAt: z.coerce.date({ message: 'Chọn ngày giờ hẹn' }),
  name: z.string().trim().min(2, 'Nhập họ tên').max(100),
  phone: z.string().trim().min(9, 'Nhập số điện thoại').max(20),
  plateNo: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().toUpperCase().max(15).nullable().optional()),
  note: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(500).nullable().optional()),
});
type QuoteDto = z.infer<typeof quoteSchema>;
type RequestDto = z.infer<typeof requestSchema>;

export const voucherSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,20}$/, 'Mã 3–20 ký tự chữ, số'),
    title: z.string().trim().min(2, 'Nhập tên chương trình').max(150),
    kind: z.enum(['PERCENT', 'AMOUNT']),
    value: z.coerce.number().int().min(1),
    minOrder: z.coerce.number().int().min(0).default(0),
    maxDiscount: z.coerce.number().int().min(1).nullable().optional(),
    appliesTo: z.enum(['ALL', 'PRODUCT', 'SERVICE']).default('ALL'),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    usageLimit: z.coerce.number().int().min(1).nullable().optional(),
    active: z.boolean().default(true),
  })
  .refine((v) => v.kind !== 'PERCENT' || v.value <= 100, { message: 'Phần trăm giảm tối đa 100', path: ['value'] })
  .refine((v) => v.endsAt > v.startsAt, { message: 'Ngày kết thúc phải sau ngày bắt đầu', path: ['endsAt'] });
type VoucherDto = z.infer<typeof voucherSchema>;

function assertHandler(a: Access) {
  const ok = a.tenantType === 'PARTNER' ? a.permissions.includes('partner.request.manage') : a.tenantType === 'GARAGE' && a.permissions.includes('order_request.manage');
  if (!ok) throw new ForbiddenException('Bạn không có quyền xử lý yêu cầu từ sàn');
}
function assertPromoter(a: Access) {
  const ok = a.tenantType === 'PARTNER' ? a.permissions.includes('partner.promotion.manage') : a.tenantType === 'GARAGE' && a.permissions.includes('promotion.manage');
  if (!ok) throw new ForbiddenException('Bạn không có quyền quản lý voucher');
}

type ReqRow = Prisma.OrderRequestGetPayload<{ include: { items: true } }>;
const view = (r: ReqRow) => ({
  id: r.id,
  code: r.code,
  status: r.status as RequestStatus,
  customerName: r.customerName,
  phone: r.phone,
  plateNo: r.plateNo,
  note: r.note,
  scheduledAt: r.scheduledAt,
  voucherCode: r.voucherCode,
  subtotal: n(r.subtotal)!,
  discount: n(r.discount)!,
  estimatedTotal: n(r.estimatedTotal)!,
  finalTotal: n(r.finalTotal),
  sellerNote: r.sellerNote,
  expiresAt: r.expiresAt,
  confirmedAt: r.confirmedAt,
  closedAt: r.closedAt,
  createdAt: r.createdAt,
  items: r.items.map((i) => ({
    offerId: i.offerId,
    kind: i.kind,
    name: i.name,
    quantity: i.quantity,
    unitPrice: n(i.unitPrice)!,
    amount: n(i.unitPrice)! * i.quantity,
    installIncluded: i.installIncluded,
    mfgYear: i.mfgYear,
  })),
});

@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  /** Tính tạm: kiểm tra tin còn bán, cùng một garage, còn đủ hàng; áp voucher */
  async quote(db: Db, dto: QuoteDto) {
    await expireStale(db);
    const offers = await db.offer.findMany({ where: { id: { in: dto.items.map((i) => i.offerId) } }, include: { catalogItem: true } });
    if (offers.length !== new Set(dto.items.map((i) => i.offerId)).size) throw new BadRequestException('Sản phẩm / dịch vụ không còn trên sàn');
    const tenantId = offers[0]!.tenantId;
    if (offers.some((o) => o.tenantId !== tenantId)) throw new BadRequestException('Mỗi yêu cầu chỉ gửi tới một garage');
    if (offers.some((o) => o.status !== 'DANG_BAN')) throw new BadRequestException('Có mục đã ngừng bán, vui lòng tải lại trang');
    const [tenant, shop] = await Promise.all([db.tenant.findUniqueOrThrow({ where: { id: tenantId } }), db.shop.findUnique({ where: { tenantId } })]);
    if (!shop || !tenantListable(tenant)) throw new BadRequestException('Garage tạm ngừng nhận yêu cầu trên sàn');

    // Tồn khả dụng = tồn (kho PLG hoặc nhập tay) − đang giữ cho yêu cầu khác
    const productIds = offers.map((o) => o.productId).filter((x): x is string => !!x);
    const [levels, held] = await Promise.all([
      productIds.length ? db.stockLevel.findMany({ where: { productId: { in: productIds } } }) : Promise.resolve([]),
      heldQty(
        db,
        offers.map((o) => o.id),
      ),
    ]);
    const lines = dto.items.map((i) => {
      const o = offers.find((x) => x.id === i.offerId)!;
      if (o.kind === 'PRODUCT') {
        const stock = availableStock(
          o,
          levels.filter((l) => l.productId === o.productId).map((l) => ({ branchId: l.branchId, quantity: Number(l.quantity) })),
        )!;
        const free = Math.max(0, stock - (held.get(o.id) ?? 0));
        if (i.quantity > free) throw new ConflictException(free ? `${o.catalogItem.name}: garage chỉ còn ${free}` : `${o.catalogItem.name} vừa hết hàng ở garage này`);
      }
      return { offer: o, kind: o.kind, name: o.catalogItem.name, quantity: o.kind === 'SERVICE' ? 1 : i.quantity, unitPrice: Number(o.price) };
    });
    const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
    let discount = 0;
    let voucher: { id: string; code: string; title: string } | null = null;
    let voucherError: string | null = null;
    if (dto.voucherCode) {
      const v = await db.voucher.findUnique({ where: { tenantId_code: { tenantId, code: dto.voucherCode } } });
      if (!v) voucherError = 'Mã voucher không đúng với garage này';
      else {
        const r = voucherDiscount(
          voucherLike(v),
          lines.map((l) => ({ kind: l.kind, amount: l.unitPrice * l.quantity })),
          await usedCount(db, v.id),
        );
        if ('error' in r) voucherError = r.error;
        else {
          discount = r.discount;
          voucher = { id: v.id, code: v.code, title: v.title };
        }
      }
    }
    return { tenantId, shop, lines, subtotal, discount, total: subtotal - discount, voucher, voucherError };
  }

  async publicQuote(dto: QuoteDto) {
    const q = await this.quote(this.prisma, dto);
    return {
      shop: { name: q.shop.name, slug: q.shop.slug },
      lines: q.lines.map((l) => ({
        offerId: l.offer.id,
        kind: l.kind,
        name: l.name,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        amount: l.unitPrice * l.quantity,
        installIncluded: l.offer.installIncluded,
        mfgYear: l.offer.mfgYear,
      })),
      subtotal: q.subtotal,
      discount: q.discount,
      total: q.total,
      voucher: q.voucher ? { code: q.voucher.code, title: q.voucher.title } : null,
      voucherError: q.voucherError,
      openingHours: q.shop.openingHours as unknown as OpeningDay[],
    };
  }

  /** Khách gửi yêu cầu (không cần tài khoản). Giữ tồn 24 giờ chờ garage xác nhận */
  async submit(dto: RequestDto, ip?: string) {
    const phone = normalizeVnPhone(dto.phone);
    if (!phone) throw new BadRequestException('Số điện thoại không hợp lệ');
    // Chống spam: tối đa 20 yêu cầu gửi thành công / giờ / IP (lần gửi lỗi không tính)
    const ipKey = `market-req:ip:${ip ?? 'na'}`;
    if (Number((await this.redis.client.get(ipKey)) ?? 0) >= 20) throw new HttpException('Bạn gửi quá nhiều yêu cầu, vui lòng thử lại sau 1 giờ', HttpStatus.TOO_MANY_REQUESTS);
    const token = randomBytes(24).toString('base64url');
    const r = await this.prisma.$transaction(
      async (tx) => {
        // Khoá theo tin đăng để 2 khách không cùng giữ món hàng cuối
        for (const id of [...new Set(dto.items.map((i) => i.offerId))].sort()) await tx.$queryRaw`SELECT id FROM offers WHERE id = ${id}::uuid FOR UPDATE`;
        const q = await this.quote(tx, dto);
        if (dto.voucherCode && q.voucherError) throw new BadRequestException(q.voucherError);
        const err = checkSchedule(dto.scheduledAt, q.shop.openingHours as unknown as OpeningDay[]);
        if (err) throw new BadRequestException(err);
        const active = await tx.orderRequest.count({ where: { phone, tenantId: q.tenantId, status: { in: HOLDING } } });
        if (active >= 3) throw new ConflictException('Bạn đang có 3 yêu cầu chờ garage này xử lý. Vui lòng đợi garage phản hồi.');
        const code = requestCode(await reserveNumbers(tx, q.tenantId, 'order_request'));
        return tx.orderRequest.create({
          data: {
            code,
            tenantId: q.tenantId,
            customerName: dto.name,
            phone,
            plateNo: dto.plateNo ?? null,
            note: dto.note ?? null,
            scheduledAt: dto.scheduledAt,
            voucherId: q.voucher?.id ?? null,
            voucherCode: q.voucher?.code ?? null,
            subtotal: BigInt(q.subtotal),
            discount: BigInt(q.discount),
            estimatedTotal: BigInt(q.total),
            accessHash: sha256(token),
            expiresAt: new Date(Date.now() + REQUEST_TTL_HOURS * 3_600_000),
            ip: ip ?? null,
            items: {
              create: q.lines.map((l) => ({
                offerId: l.offer.id,
                kind: l.kind,
                name: l.name,
                quantity: l.quantity,
                unitPrice: BigInt(l.unitPrice),
                installIncluded: l.offer.installIncluded,
                mfgYear: l.offer.mfgYear,
              })),
            },
          },
        });
      },
      { isolationLevel: 'ReadCommitted' },
    );
    const used = await this.redis.client.incr(ipKey);
    if (used === 1) await this.redis.client.expire(ipKey, 3600);
    await this.audit.log({
      tenantId: r.tenantId,
      actorId: null,
      action: 'order_request.created',
      entity: 'order_request',
      entityId: r.id,
      after: { code: r.code, total: Number(r.estimatedTotal) },
      ip,
    });
    return { id: r.id, code: r.code, token };
  }

  private async byToken(id: string, token: string | undefined) {
    await expireStale(this.prisma);
    const r = await this.prisma.orderRequest.findUnique({ where: { id }, include: { items: true } });
    const ok = r && token && timingSafeEqual(Buffer.from(sha256(token)), Buffer.from(r.accessHash));
    if (!ok) throw new NotFoundException('Không tìm thấy yêu cầu. Kiểm tra lại link theo dõi.');
    return r;
  }

  async track(id: string, token?: string) {
    const r = await this.byToken(id, token);
    const shop = await this.prisma.shop.findUnique({ where: { tenantId: r.tenantId } });
    const { phone: _p, ...v } = view(r);
    return {
      ...v,
      phone: r.phone.replace(/^(\d{3})\d+(\d{3})$/, '$1****$2'),
      shop: shop ? { name: shop.name, slug: shop.slug, phone: shop.phone, address: shop.address, lat: shop.lat, lng: shop.lng } : null,
    };
  }

  async customerCancel(id: string, token: string | undefined, ip?: string) {
    const r = await this.byToken(id, token);
    if (!canMoveRequest(r.status as RequestStatus, 'KHACH_HUY')) throw new ConflictException('Yêu cầu không huỷ được ở trạng thái này');
    await this.prisma.orderRequest.update({ where: { id }, data: { status: 'KHACH_HUY', closedAt: new Date() } });
    await this.audit.log({ tenantId: r.tenantId, actorId: null, action: 'order_request.customer_cancelled', entity: 'order_request', entityId: id, ip });
    return { status: 'KHACH_HUY' };
  }

  // ---------------- Garage / đối tác xử lý (A7.20, CRM) ----------------

  async list(a: Access, q: { status?: string; q?: string }) {
    assertHandler(a);
    await expireStale(this.prisma);
    const where: Prisma.OrderRequestWhereInput = { tenantId: a.tenantId };
    if (q.status === 'DANG_XU_LY') where.status = { in: HOLDING };
    else if (q.status) where.status = q.status as RequestStatus;
    if (q.q?.trim()) {
      const s = q.q.trim();
      where.OR = [
        { code: { contains: s.toUpperCase() } },
        { customerName: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s.replace(/\D/g, '') || '§' } },
        { plateNo: { contains: s.toUpperCase() } },
      ];
    }
    const [rows, counts] = await Promise.all([
      this.prisma.orderRequest.findMany({ where, include: { items: true }, orderBy: [{ createdAt: 'desc' }], take: 200 }),
      this.prisma.orderRequest.groupBy({ by: ['status'], where: { tenantId: a.tenantId }, _count: true }),
    ]);
    return { counts: Object.fromEntries(counts.map((c) => [c.status, c._count])), items: rows.map(view) };
  }

  private async own(db: Db, a: Access, id: string) {
    const r = await db.orderRequest.findFirst({ where: { id, tenantId: a.tenantId }, include: { items: true } });
    if (!r) throw new NotFoundException('Không tìm thấy yêu cầu');
    return r;
  }

  async act(a: Access, id: string, to: RequestStatus, dto: { finalTotal?: number | null; scheduledAt?: Date | null; note?: string | null }, ip?: string) {
    assertHandler(a);
    await expireStale(this.prisma);
    const r = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM order_requests WHERE id = ${id}::uuid FOR UPDATE`;
      const cur = await this.own(tx, a, id);
      if (!canMoveRequest(cur.status as RequestStatus, to))
        throw new ConflictException(cur.status === 'HET_HAN' ? 'Yêu cầu đã quá 24 giờ chờ xác nhận' : 'Trạng thái yêu cầu không cho phép thao tác này');
      if (to === 'TU_CHOI' && !dto.note?.trim()) throw new BadRequestException('Ghi lý do từ chối để khách biết');
      const data: Prisma.OrderRequestUpdateInput = { status: to, handledBy: a.userId };
      if (dto.note?.trim()) data.sellerNote = dto.note.trim();
      if (dto.finalTotal != null) data.finalTotal = BigInt(dto.finalTotal);
      if (to === 'DA_XAC_NHAN') {
        data.confirmedAt = new Date();
        if (dto.finalTotal == null) data.finalTotal = cur.estimatedTotal;
        if (dto.scheduledAt) data.scheduledAt = dto.scheduledAt;
      } else data.closedAt = new Date();
      // Hoàn tất: tin của đối tác (tồn nhập tay) trừ số đã bán. Hàng PLG trừ kho khi lập đơn trong CRM
      if (to === 'HOAN_THANH') {
        for (const it of cur.items.filter((i) => i.kind === 'PRODUCT')) {
          await tx.$executeRaw`UPDATE offers SET manual_stock = GREATEST(0, manual_stock - ${it.quantity}) WHERE id = ${it.offerId}::uuid AND product_id IS NULL AND manual_stock IS NOT NULL`;
        }
      }
      const row = await tx.orderRequest.update({ where: { id }, data, include: { items: true } });
      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: `order_request.${to.toLowerCase()}`,
          entity: 'order_request',
          entityId: id,
          before: { status: cur.status },
          after: { status: to, finalTotal: dto.finalTotal ?? null, note: dto.note ?? null },
          ip,
        },
        tx,
      );
      return row;
    });
    return view(r);
  }

  // ---------------- Voucher của garage (A7.13 / CRM) ----------------

  async vouchers(a: Access) {
    assertPromoter(a);
    const rows = await this.prisma.voucher.findMany({ where: { tenantId: a.tenantId }, orderBy: [{ active: 'desc' }, { endsAt: 'desc' }] });
    const used = await this.prisma.orderRequest.groupBy({
      by: ['voucherId'],
      where: { tenantId: a.tenantId, voucherId: { in: rows.map((r) => r.id) }, status: { in: [...HOLDING, 'HOAN_THANH'] } },
      _count: true,
    });
    return rows.map((v) => ({
      id: v.id,
      code: v.code,
      title: v.title,
      kind: v.kind,
      value: v.value,
      minOrder: n(v.minOrder)!,
      maxDiscount: n(v.maxDiscount),
      appliesTo: v.appliesTo,
      startsAt: v.startsAt,
      endsAt: v.endsAt,
      usageLimit: v.usageLimit,
      active: v.active,
      used: used.find((u) => u.voucherId === v.id)?._count ?? 0,
      summary: voucherSummary(v),
    }));
  }

  async saveVoucher(a: Access, id: string | null, dto: VoucherDto, ip?: string) {
    assertPromoter(a);
    const dup = await this.prisma.voucher.findUnique({ where: { tenantId_code: { tenantId: a.tenantId, code: dto.code } } });
    if (dup && dup.id !== id) throw new ConflictException('Mã voucher đã có');
    if (id && !(await this.prisma.voucher.findFirst({ where: { id, tenantId: a.tenantId } }))) throw new NotFoundException('Không tìm thấy voucher');
    const data = { ...dto, minOrder: BigInt(dto.minOrder), maxDiscount: dto.kind === 'PERCENT' && dto.maxDiscount ? BigInt(dto.maxDiscount) : null, usageLimit: dto.usageLimit ?? null };
    const v = id ? await this.prisma.voucher.update({ where: { id }, data }) : await this.prisma.voucher.create({ data: { ...data, tenantId: a.tenantId, createdBy: a.userId } });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: id ? 'voucher.updated' : 'voucher.created',
      entity: 'voucher',
      entityId: v.id,
      after: { code: dto.code, kind: dto.kind, value: dto.value, active: dto.active },
      ip,
    });
    return { id: v.id };
  }
}

const actSchema = z.object({
  finalTotal: z.coerce.number().int().min(0).max(10_000_000_000).nullable().optional(),
  scheduledAt: z.coerce.date().nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
type ActDto = z.infer<typeof actSchema>;

@Controller()
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  // ---- Công khai: khách trên sàn ----
  @Public()
  @Post('public/market/requests/quote')
  @HttpCode(200)
  quote(@Body(new ZodPipe(quoteSchema)) dto: QuoteDto) {
    return this.requests.publicQuote(dto);
  }

  @Public()
  @Post('public/market/requests')
  submit(@Body(new ZodPipe(requestSchema)) dto: RequestDto, @Req() req: Request) {
    return this.requests.submit(dto, clientIp(req));
  }

  @Public()
  @Get('public/market/requests/:id')
  track(@Param('id', ParseUUIDPipe) id: string, @Query('t') t?: string) {
    return this.requests.track(id, t);
  }

  @Public()
  @Post('public/market/requests/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Query('t') t: string | undefined, @Req() req: Request) {
    return this.requests.customerCancel(id, t, clientIp(req));
  }

  // ---- Garage / đối tác ----
  @Get('seller/requests')
  list(@CurrentAuth() auth: RequestAuth, @Query('status') status?: string, @Query('q') q?: string) {
    return this.requests.list(auth.access, { status, q });
  }

  @Post('seller/requests/:id/confirm')
  @HttpCode(200)
  confirm(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(actSchema)) dto: ActDto, @Req() req: Request) {
    return this.requests.act(auth.access, id, 'DA_XAC_NHAN', dto, clientIp(req));
  }

  @Post('seller/requests/:id/reject')
  @HttpCode(200)
  reject(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(actSchema)) dto: ActDto, @Req() req: Request) {
    return this.requests.act(auth.access, id, 'TU_CHOI', dto, clientIp(req));
  }

  @Post('seller/requests/:id/complete')
  @HttpCode(200)
  complete(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(actSchema)) dto: ActDto, @Req() req: Request) {
    return this.requests.act(auth.access, id, 'HOAN_THANH', dto, clientIp(req));
  }

  @Post('seller/requests/:id/no-show')
  @HttpCode(200)
  noShow(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(actSchema)) dto: ActDto, @Req() req: Request) {
    return this.requests.act(auth.access, id, 'KHONG_DEN', dto, clientIp(req));
  }

  @Get('seller/vouchers')
  vouchers(@CurrentAuth() auth: RequestAuth) {
    return this.requests.vouchers(auth.access);
  }

  @Post('seller/vouchers')
  createVoucher(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(voucherSchema)) dto: VoucherDto, @Req() req: Request) {
    return this.requests.saveVoucher(auth.access, null, dto, clientIp(req));
  }

  @Put('seller/vouchers/:id')
  updateVoucher(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(voucherSchema)) dto: VoucherDto, @Req() req: Request) {
    return this.requests.saveVoucher(auth.access, id, dto, clientIp(req));
  }
}
