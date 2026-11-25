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
  Query,
  Req,
} from '@nestjs/common';
import { normalizeVnPhone } from '@cardiy/shared';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AccessService, type Access } from '../auth/access.service';
import { CurrentAuth, Public, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { reserveNumbers } from '../crm/counters';
import { platformTenantId } from '../platform/partner-applications';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { canMoveOffer, reviewerName, tenantListable, type OfferStatus } from './offer-rules';
import { RequestsService } from './requests';
import {
  canEditReview,
  canMoveReport,
  canReviewRequest,
  checkViolationAction,
  combineRating,
  REPORT_REASONS,
  type MarketReportReason,
  type MarketReportStatus,
  type MarketReviewStatus,
  type ViolationAction,
} from './review-report-rules';

type Tx = Prisma.TransactionClient;
const n = (b: bigint | number | null | undefined) => (b === null || b === undefined ? null : Number(b));
const optText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());

export const reportCode = (x: number) => `PA${String(x).padStart(6, '0')}`;
export const violationCode = (x: number) => `VP${String(x).padStart(6, '0')}`;

const OPEN_REPORT_STATUSES: MarketReportStatus[] = ['MOI', 'CHO_GIAI_TRINH', 'DA_GIAI_TRINH'];
const maskPhone = (p: string) => p.replace(/^(\d{3})\d+(\d{3})$/, '$1****$2');

function assertReviewHandler(a: Access) {
  const ok =
    a.tenantType === 'PARTNER'
      ? a.permissions.includes('partner.review.reply')
      : a.tenantType === 'GARAGE' && (a.permissions.includes('order_request.manage') || a.permissions.includes('shop.manage'));
  if (!ok) throw new ForbiddenException('Bạn không có quyền quản lý đánh giá từ sàn');
}

function assertReportExplainer(a: Access) {
  const ok =
    a.tenantType === 'PARTNER'
      ? a.permissions.includes('partner.request.manage') ||
        a.permissions.includes('partner.shop.manage') ||
        a.permissions.includes('partner.review.reply')
      : a.tenantType === 'GARAGE' && (a.permissions.includes('order_request.manage') || a.permissions.includes('shop.manage'));
  if (!ok) throw new ForbiddenException('Bạn không có quyền xem phản ánh từ sàn');
}

function assertPlatformReportHandler(a: Access) {
  if (a.tenantType !== 'PLATFORM' || !a.permissions.includes('platform.report.handle')) {
    throw new ForbiddenException('Chỉ dành cho bộ phận giám sát chất lượng sàn');
  }
}

export const submitReviewSchema = z.object({
  rating: z.coerce.number().int().min(1, 'Chọn từ 1 đến 5 sao').max(5, 'Chọn từ 1 đến 5 sao'),
  comment: optText(1000),
});
type SubmitReviewDto = z.infer<typeof submitReviewSchema>;

const reasonEnum = z.enum(REPORT_REASONS as unknown as [MarketReportReason, ...MarketReportReason[]]);

export const requestReportSchema = z.object({
  reason: reasonEnum,
  description: z.string().trim().min(10, 'Mô tả cụ thể sự việc (tối thiểu 10 ký tự)').max(2000),
});
type RequestReportDto = z.infer<typeof requestReportSchema>;

export const shopReportSchema = requestReportSchema.extend({
  name: z.string().trim().min(2, 'Nhập họ tên').max(100),
  phone: z.string().trim().min(9, 'Nhập số điện thoại').max(20),
  offerId: z.string().uuid().nullable().optional(),
});
type ShopReportDto = z.infer<typeof shopReportSchema>;

const replySchema = z.object({
  reply: z.string().trim().min(2, 'Nhập nội dung trả lời').max(1000),
});
const reportReviewSchema = z.object({
  reason: z.string().trim().min(5, 'Ghi rõ lý do báo cáo đánh giá').max(500),
});
const explainSchema = z.object({
  explanation: z.string().trim().min(5, 'Nhập nội dung giải trình').max(2000),
});
const askExplainSchema = z.object({
  note: z.string().trim().min(3, 'Ghi rõ nội dung cần garage giải trình').max(1000),
});
const violationActionEnum = z.enum(['NHAC_NHO', 'GO_TIN', 'TAM_KHOA', 'CHAM_DUT']);
const resolveReportSchema = z.object({
  decision: z.enum(['DA_XU_LY', 'TU_CHOI']),
  resolution: z.string().trim().min(3, 'Ghi kết luận xử lý').max(1500),
  violationAction: violationActionEnum.nullable().optional(),
  offerId: z.string().uuid().nullable().optional(),
});
type ResolveReportDto = z.infer<typeof resolveReportSchema>;

const createViolationSchema = z.object({
  tenantId: z.string().uuid('Chọn garage / đối tác'),
  action: violationActionEnum,
  offerId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().min(5, 'Ghi rõ lý do xử lý vi phạm').max(1500),
});
type CreateViolationDto = z.infer<typeof createViolationSchema>;

const moderateReviewSchema = z.object({
  action: z.enum(['HIDE', 'KEEP']),
  note: optText(500),
});
type ModerateReviewDto = z.infer<typeof moderateReviewSchema>;

@Injectable()
export class ReviewsReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    private readonly access: AccessService,
    private readonly requests: RequestsService,
  ) {}

  private async checkReportIpLimit(ip?: string) {
    const key = `market-report:ip:${ip ?? 'na'}`;
    if (Number((await this.redis.client.get(key)) ?? 0) >= 5) {
      throw new HttpException('Bạn gửi quá nhiều phản ánh, vui lòng thử lại sau 1 giờ', HttpStatus.TOO_MANY_REQUESTS);
    }
    return key;
  }

  private async bumpIpLimit(key: string) {
    const c = await this.redis.client.incr(key);
    if (c === 1) await this.redis.client.expire(key, 3600);
  }

  // ---------------- Khách trên sàn: đánh giá & gửi phản ánh ----------------

  async submitReview(requestId: string, token: string | undefined, dto: SubmitReviewDto, ip?: string) {
    const req = await this.requests.verifyByToken(requestId, token);
    if (!canReviewRequest(req.status)) {
      throw new ConflictException('Chỉ đánh giá được khi yêu cầu đã hoàn tất');
    }
    const existing = await this.prisma.marketReview.findUnique({ where: { requestId: req.id } });
    if (existing && !canEditReview({ status: existing.status as MarketReviewStatus, reply: existing.reply })) {
      throw new ConflictException(
        existing.status === 'AN' ? 'Đánh giá này đã bị ẩn do vi phạm quy định' : 'Garage đã phản hồi đánh giá, không sửa được',
      );
    }
    const row = existing
      ? await this.prisma.marketReview.update({
          where: { id: existing.id },
          data: { rating: dto.rating, comment: dto.comment ?? null },
        })
      : await this.prisma.marketReview.create({
          data: {
            tenantId: req.tenantId,
            requestId: req.id,
            customerName: req.customerName,
            rating: dto.rating,
            comment: dto.comment ?? null,
          },
        });
    await this.audit.log({
      tenantId: req.tenantId,
      actorId: null,
      action: existing ? 'market_review.updated' : 'market_review.created',
      entity: 'market_review',
      entityId: row.id,
      after: { requestCode: req.code, rating: dto.rating },
      ip,
    });
    return {
      id: row.id,
      rating: row.rating,
      comment: row.comment,
      reply: row.reply,
      repliedAt: row.repliedAt,
      status: row.status,
      createdAt: row.createdAt,
    };
  }

  async submitRequestReport(requestId: string, token: string | undefined, dto: RequestReportDto, ip?: string) {
    const ipKey = await this.checkReportIpLimit(ip);
    const req = await this.requests.verifyByToken(requestId, token);
    const openOnReq = await this.prisma.marketReport.count({
      where: { requestId: req.id, status: { in: OPEN_REPORT_STATUSES } },
    });
    if (openOnReq >= 1) {
      throw new ConflictException('Yêu cầu này đang có phản ánh chờ sàn xử lý');
    }
    const pid = await platformTenantId(this.prisma);
    const row = await this.prisma.$transaction(async (tx) => {
      const code = reportCode(await reserveNumbers(tx, pid, 'market_report'));
      return tx.marketReport.create({
        data: {
          code,
          tenantId: req.tenantId,
          requestId: req.id,
          offerId: req.items[0]?.offerId ?? null,
          reporterName: req.customerName,
          reporterPhone: req.phone,
          reason: dto.reason,
          description: dto.description,
          ip: ip ?? null,
        },
      });
    });
    await this.bumpIpLimit(ipKey);
    await this.audit.log({
      tenantId: pid,
      actorId: null,
      action: 'market_report.created',
      entity: 'market_report',
      entityId: row.id,
      after: { code: row.code, tenantId: req.tenantId, requestCode: req.code, reason: dto.reason },
      ip,
    });
    return { id: row.id, code: row.code, status: row.status, reason: row.reason, description: row.description, createdAt: row.createdAt };
  }

  async submitShopReport(slug: string, dto: ShopReportDto, ip?: string) {
    const phone = normalizeVnPhone(dto.phone);
    if (!phone) throw new BadRequestException('Số điện thoại không hợp lệ');
    const ipKey = await this.checkReportIpLimit(ip);
    const shop = await this.prisma.shop.findUnique({ where: { slug } });
    if (!shop) throw new NotFoundException('Không tìm thấy gian hàng');
    const tenant = await this.prisma.tenant.findUnique({ where: { id: shop.tenantId } });
    if (!tenant || !tenantListable(tenant)) throw new NotFoundException('Không tìm thấy gian hàng');
    if (dto.offerId) {
      const offer = await this.prisma.offer.findFirst({ where: { id: dto.offerId, tenantId: shop.tenantId } });
      if (!offer) throw new BadRequestException('Tin đăng không thuộc gian hàng này');
    }
    const open = await this.prisma.marketReport.count({
      where: { reporterPhone: phone, tenantId: shop.tenantId, status: { in: OPEN_REPORT_STATUSES } },
    });
    if (open >= 2) {
      throw new ConflictException('Bạn đang có phản ánh chờ sàn xử lý với gian hàng này');
    }
    const pid = await platformTenantId(this.prisma);
    const row = await this.prisma.$transaction(async (tx) => {
      const code = reportCode(await reserveNumbers(tx, pid, 'market_report'));
      return tx.marketReport.create({
        data: {
          code,
          tenantId: shop.tenantId,
          offerId: dto.offerId ?? null,
          reporterName: dto.name,
          reporterPhone: phone,
          reason: dto.reason,
          description: dto.description,
          ip: ip ?? null,
        },
      });
    });
    await this.bumpIpLimit(ipKey);
    await this.audit.log({
      tenantId: pid,
      actorId: null,
      action: 'market_report.created',
      entity: 'market_report',
      entityId: row.id,
      after: { code: row.code, tenantId: shop.tenantId, slug, reason: dto.reason },
      ip,
    });
    return { id: row.id, code: row.code, status: row.status };
  }

  // ---------------- Garage / Đối tác: xem & trả lời đánh giá, giải trình phản ánh ----------------

  async sellerReviews(a: Access, filter?: string) {
    assertReviewHandler(a);
    const [marketRows, orderRows] = await Promise.all([
      this.prisma.marketReview.findMany({
        where: { tenantId: a.tenantId },
        include: { request: { select: { code: true, items: { select: { name: true, kind: true, quantity: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      a.tenantType === 'GARAGE'
        ? this.prisma.orderReview.findMany({
            where: { tenantId: a.tenantId },
            include: { order: { select: { code: true, customer: { select: { name: true } } } } },
            orderBy: { createdAt: 'desc' },
            take: 200,
          })
        : Promise.resolve([]),
    ]);

    const stars: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let visibleMarketSum = 0;
    let visibleMarketCount = 0;
    for (const r of marketRows) {
      if (r.status === 'HIEN') {
        stars[r.rating] = (stars[r.rating] ?? 0) + 1;
        visibleMarketSum += r.rating;
        visibleMarketCount += 1;
      }
    }
    let orderSum = 0;
    for (const r of orderRows) {
      stars[r.rating] = (stars[r.rating] ?? 0) + 1;
      orderSum += r.rating;
    }
    const combined = combineRating([
      { sum: visibleMarketSum, count: visibleMarketCount },
      { sum: orderSum, count: orderRows.length },
    ]);

    const merged = [
      ...marketRows.map((r) => ({
        id: r.id,
        source: 'MARKET' as const,
        refCode: r.request.code,
        customerName: r.customerName,
        publicName: reviewerName(r.customerName),
        items: r.request.items.map((i) => (i.kind === 'PRODUCT' && i.quantity > 1 ? `${i.name} × ${i.quantity}` : i.name)),
        rating: r.rating,
        comment: r.comment,
        reply: r.reply,
        repliedAt: r.repliedAt,
        status: r.status as MarketReviewStatus,
        reportedReason: r.reportedReason,
        reportedAt: r.reportedAt,
        moderationNote: r.moderationNote,
        moderatedAt: r.moderatedAt,
        createdAt: r.createdAt,
      })),
      ...orderRows.map((r) => ({
        id: r.id,
        source: 'CRM' as const,
        refCode: r.order.code,
        customerName: r.order.customer?.name ?? 'Khách',
        publicName: reviewerName(r.order.customer?.name),
        items: [] as string[],
        rating: r.rating,
        comment: r.comment,
        reply: r.reply,
        repliedAt: r.repliedAt,
        status: 'HIEN' as MarketReviewStatus,
        reportedReason: null as string | null,
        reportedAt: null as Date | null,
        moderationNote: null as string | null,
        moderatedAt: null as Date | null,
        createdAt: r.createdAt,
      })),
    ].sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());

    const unreplied = merged.filter((x) => x.status === 'HIEN' && !x.reply).length;
    const reported = merged.filter((x) => !!x.reportedAt).length;
    const items =
      filter === 'UNREPLIED'
        ? merged.filter((x) => x.status === 'HIEN' && !x.reply)
        : filter === 'REPORTED'
          ? merged.filter((x) => !!x.reportedAt)
          : merged;

    return {
      summary: {
        avg: combined?.avg ?? null,
        count: combined?.count ?? 0,
        unreplied,
        reported,
        stars,
      },
      items,
    };
  }

  async replyReview(a: Access, id: string, reply: string, ip?: string) {
    assertReviewHandler(a);
    const m = await this.prisma.marketReview.findFirst({ where: { id, tenantId: a.tenantId } });
    if (m) {
      if (m.status === 'AN') throw new ConflictException('Đánh giá này đã bị sàn ẩn');
      await this.prisma.marketReview.update({
        where: { id: m.id },
        data: { reply, repliedBy: a.userId, repliedAt: new Date() },
      });
      await this.audit.log({
        tenantId: a.tenantId,
        actorId: a.userId,
        action: 'market_review.replied',
        entity: 'market_review',
        entityId: m.id,
        after: { reply },
        ip,
      });
      return { status: 'ok' };
    }
    if (a.tenantType === 'GARAGE') {
      const o = await this.prisma.orderReview.findFirst({ where: { id, tenantId: a.tenantId } });
      if (o) {
        await this.prisma.orderReview.update({
          where: { id: o.id },
          data: { reply, repliedBy: a.userId, repliedAt: new Date() },
        });
        await this.audit.log({
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'order_review.replied',
          entity: 'order_review',
          entityId: o.id,
          after: { reply },
          ip,
        });
        return { status: 'ok' };
      }
    }
    throw new NotFoundException('Không tìm thấy đánh giá');
  }

  async reportReview(a: Access, id: string, reason: string, ip?: string) {
    assertReviewHandler(a);
    const m = await this.prisma.marketReview.findFirst({ where: { id, tenantId: a.tenantId } });
    if (!m) throw new NotFoundException('Không tìm thấy đánh giá trên sàn');
    if (m.status === 'AN') throw new ConflictException('Đánh giá này đã được ẩn');
    await this.prisma.marketReview.update({
      where: { id: m.id },
      data: {
        reportedReason: reason,
        reportedBy: a.userId,
        reportedAt: new Date(),
        moderatedAt: null,
        moderatedBy: null,
        moderationNote: null,
      },
    });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'market_review.reported',
      entity: 'market_review',
      entityId: m.id,
      after: { reason },
      ip,
    });
    return { status: 'ok' };
  }

  async sellerReports(a: Access) {
    assertReportExplainer(a);
    const [reports, violations] = await Promise.all([
      this.prisma.marketReport.findMany({
        where: { tenantId: a.tenantId },
        include: { request: { select: { code: true, scheduledAt: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.shopViolation.findMany({
        where: { tenantId: a.tenantId },
        include: { report: { select: { code: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    const offerIds = [...new Set(violations.map((v) => v.offerId).filter((x): x is string => !!x))];
    const offers = offerIds.length
      ? await this.prisma.offer.findMany({ where: { id: { in: offerIds } }, include: { catalogItem: { select: { code: true, name: true } } } })
      : [];
    const counts: Record<string, number> = {};
    for (const r of reports) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return {
      counts,
      items: reports.map((r) => ({
        id: r.id,
        code: r.code,
        requestCode: r.request?.code ?? null,
        reporterName: r.reporterName,
        reporterPhone: r.requestId ? r.reporterPhone : maskPhone(r.reporterPhone),
        reason: r.reason,
        description: r.description,
        status: r.status,
        adminNote: r.adminNote,
        sellerExplanation: r.sellerExplanation,
        explainedAt: r.explainedAt,
        resolution: r.resolution,
        resolvedAt: r.resolvedAt,
        createdAt: r.createdAt,
      })),
      violations: violations.map((v) => {
        const o = offers.find((x) => x.id === v.offerId);
        return {
          id: v.id,
          code: v.code,
          reportCode: v.report?.code ?? null,
          offerName: o?.catalogItem.name ?? null,
          action: v.action,
          reason: v.reason,
          createdAt: v.createdAt,
        };
      }),
    };
  }

  async explainReport(a: Access, id: string, explanation: string, ip?: string) {
    assertReportExplainer(a);
    const r = await this.prisma.marketReport.findFirst({ where: { id, tenantId: a.tenantId } });
    if (!r) throw new NotFoundException('Không tìm thấy phản ánh');
    if (!canMoveReport(r.status as MarketReportStatus, 'DA_GIAI_TRINH')) {
      throw new ConflictException('Phản ánh này không ở trạng thái chờ giải trình');
    }
    await this.prisma.marketReport.update({
      where: { id: r.id },
      data: { status: 'DA_GIAI_TRINH', sellerExplanation: explanation, explainedBy: a.userId, explainedAt: new Date() },
    });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'market_report.explained',
      entity: 'market_report',
      entityId: r.id,
      before: { status: r.status },
      after: { status: 'DA_GIAI_TRINH', explanation },
      ip,
    });
    return { status: 'DA_GIAI_TRINH' };
  }

  // ---------------- Admin sàn: giám sát phản ánh, xử lý vi phạm, kiểm duyệt đánh giá ----------------

  private async applyViolationTx(
    tx: Tx,
    a: Access,
    opts: {
      tenantId: string;
      reportId?: string | null;
      offerId?: string | null;
      action: ViolationAction;
      reason: string;
      ip?: string;
    },
  ) {
    const tenant = await tx.tenant.findFirst({
      where: { id: opts.tenantId, deletedAt: null },
      include: { memberships: { select: { id: true } } },
    });
    if (!tenant || tenant.type === 'PLATFORM') throw new NotFoundException('Không tìm thấy garage / đối tác');
    const actionErr = checkViolationAction(opts.action, tenant, opts.offerId);
    if (actionErr) throw new BadRequestException(actionErr);

    if (opts.action === 'GO_TIN') {
      const offer = await tx.offer.findFirst({ where: { id: opts.offerId!, tenantId: opts.tenantId } });
      if (!offer) throw new BadRequestException('Tin đăng không thuộc garage này');
      if (offer.status !== 'BI_GO') {
        if (!canMoveOffer(offer.status as OfferStatus, 'BI_GO')) {
          throw new ConflictException('Chỉ gỡ được tin đang bán hoặc đang tạm ẩn');
        }
        await tx.offer.update({
          where: { id: offer.id },
          data: { status: 'BI_GO', reviewNote: opts.reason, reviewedBy: a.userId, reviewedAt: new Date() },
        });
      }
    }

    let statusChanged = false;
    if ((opts.action === 'TAM_KHOA' || opts.action === 'CHAM_DUT') && tenant.status !== opts.action) {
      await tx.tenant.update({ where: { id: tenant.id }, data: { status: opts.action } });
      if (opts.action === 'CHAM_DUT') {
        await tx.subscription.updateMany({ where: { tenantId: tenant.id, endedAt: null }, data: { endedAt: new Date() } });
      }
      statusChanged = true;
    }

    const code = violationCode(await reserveNumbers(tx, a.tenantId, 'shop_violation'));
    const violation = await tx.shopViolation.create({
      data: {
        code,
        tenantId: opts.tenantId,
        reportId: opts.reportId ?? null,
        offerId: opts.action === 'GO_TIN' ? (opts.offerId ?? null) : null,
        action: opts.action,
        reason: opts.reason,
        createdBy: a.userId,
      },
    });

    const after = { code, tenantId: opts.tenantId, action: opts.action, reportId: opts.reportId ?? null, offerId: opts.offerId ?? null, reason: opts.reason };
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'shop_violation.created', entity: 'shop_violation', entityId: violation.id, after, ip: opts.ip }, tx);
    await this.audit.log({ tenantId: opts.tenantId, actorId: a.userId, action: 'shop_violation.created', entity: 'shop_violation', entityId: violation.id, after, ip: opts.ip }, tx);

    return {
      violation,
      invalidateMembershipIds: statusChanged ? tenant.memberships.map((m) => m.id) : [],
    };
  }

  async platformReports(a: Access, q: { status?: string; q?: string }) {
    assertPlatformReportHandler(a);
    const where: Prisma.MarketReportWhereInput = {};
    if (q.status === 'DANG_MO') where.status = { in: OPEN_REPORT_STATUSES };
    else if (q.status) where.status = q.status as MarketReportStatus;
    if (q.q?.trim()) {
      const s = q.q.trim();
      const matchingShops = await this.prisma.shop.findMany({
        where: { name: { contains: s, mode: 'insensitive' } },
        select: { tenantId: true },
      });
      const matchingTenants = await this.prisma.tenant.findMany({
        where: { name: { contains: s, mode: 'insensitive' } },
        select: { id: true },
      });
      const tids = [...new Set([...matchingShops.map((x) => x.tenantId), ...matchingTenants.map((x) => x.id)])];
      where.OR = [
        { code: { contains: s.toUpperCase() } },
        { reporterName: { contains: s, mode: 'insensitive' } },
        { reporterPhone: { contains: s.replace(/\D/g, '') || '§' } },
        ...(tids.length ? [{ tenantId: { in: tids } }] : []),
      ];
    }

    const [rows, counts] = await Promise.all([
      this.prisma.marketReport.findMany({
        where,
        include: {
          request: { select: { id: true, code: true, status: true, estimatedTotal: true, finalTotal: true, items: { select: { offerId: true, name: true, quantity: true, kind: true } } } },
          violations: { select: { id: true, code: true, action: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.prisma.marketReport.groupBy({ by: ['status'], _count: true }),
    ]);

    const tenantIds = [...new Set(rows.map((r) => r.tenantId))];
    const [tenants, shops, vCounts, offers] = await Promise.all([
      tenantIds.length ? this.prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true, type: true, status: true } }) : Promise.resolve([]),
      tenantIds.length ? this.prisma.shop.findMany({ where: { tenantId: { in: tenantIds } }, select: { tenantId: true, name: true, slug: true } }) : Promise.resolve([]),
      tenantIds.length ? this.prisma.shopViolation.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds } }, _count: true }) : Promise.resolve([]),
      tenantIds.length
        ? this.prisma.offer.findMany({
            where: { tenantId: { in: tenantIds }, status: { in: ['DANG_BAN', 'TAM_AN'] } },
            include: { catalogItem: { select: { code: true, name: true } } },
          })
        : Promise.resolve([]),
    ]);

    return {
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
      items: rows.map((r) => {
        const t = tenants.find((x) => x.id === r.tenantId);
        const s = shops.find((x) => x.tenantId === r.tenantId);
        const vc = vCounts.find((x) => x.tenantId === r.tenantId)?._count ?? 0;
        const sellerOffers = offers.filter((o) => o.tenantId === r.tenantId).map((o) => ({ id: o.id, code: o.catalogItem.code, name: o.catalogItem.name }));
        return {
          id: r.id,
          code: r.code,
          tenantId: r.tenantId,
          sellerName: s?.name ?? t?.name ?? 'Garage',
          sellerSlug: s?.slug ?? null,
          sellerType: t?.type ?? 'PARTNER',
          sellerStatus: t?.status ?? 'HOAT_DONG',
          sellerViolationCount: vc,
          sellerOffers,
          offerId: r.offerId,
          request: r.request
            ? {
                id: r.request.id,
                code: r.request.code,
                status: r.request.status,
                estimatedTotal: n(r.request.estimatedTotal)!,
                finalTotal: n(r.request.finalTotal),
                items: r.request.items,
              }
            : null,
          reporterName: r.reporterName,
          reporterPhone: r.reporterPhone,
          reason: r.reason,
          description: r.description,
          status: r.status,
          adminNote: r.adminNote,
          sellerExplanation: r.sellerExplanation,
          explainedAt: r.explainedAt,
          resolution: r.resolution,
          resolvedAt: r.resolvedAt,
          violations: r.violations,
          createdAt: r.createdAt,
        };
      }),
    };
  }

  async requestExplanation(a: Access, id: string, note: string, ip?: string) {
    assertPlatformReportHandler(a);
    const r = await this.prisma.marketReport.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Không tìm thấy phản ánh');
    if (!canMoveReport(r.status as MarketReportStatus, 'CHO_GIAI_TRINH')) {
      throw new ConflictException('Trạng thái phản ánh không cho phép yêu cầu giải trình');
    }
    await this.prisma.marketReport.update({
      where: { id: r.id },
      data: { status: 'CHO_GIAI_TRINH', adminNote: note, handledBy: a.userId },
    });
    const payload = { before: { status: r.status }, after: { status: 'CHO_GIAI_TRINH', note }, ip };
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'market_report.explanation_requested', entity: 'market_report', entityId: r.id, ...payload });
    await this.audit.log({ tenantId: r.tenantId, actorId: a.userId, action: 'market_report.explanation_requested', entity: 'market_report', entityId: r.id, ...payload });
    return { status: 'CHO_GIAI_TRINH' };
  }

  async resolveReport(a: Access, id: string, dto: ResolveReportDto, ip?: string) {
    assertPlatformReportHandler(a);
    const res = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM market_reports WHERE id = ${id}::uuid FOR UPDATE`;
      const r = await tx.marketReport.findUnique({ where: { id } });
      if (!r) throw new NotFoundException('Không tìm thấy phản ánh');
      if (!canMoveReport(r.status as MarketReportStatus, dto.decision)) {
        throw new ConflictException('Phản ánh đã được xử lý trước đó');
      }
      let invalidateIds: string[] = [];
      let violationCodeCreated: string | null = null;
      if (dto.decision === 'DA_XU_LY' && dto.violationAction) {
        const applied = await this.applyViolationTx(tx, a, {
          tenantId: r.tenantId,
          reportId: r.id,
          offerId: dto.offerId ?? r.offerId ?? null,
          action: dto.violationAction,
          reason: dto.resolution,
          ip,
        });
        invalidateIds = applied.invalidateMembershipIds;
        violationCodeCreated = applied.violation.code;
      }
      await tx.marketReport.update({
        where: { id: r.id },
        data: {
          status: dto.decision,
          resolution: dto.resolution,
          handledBy: a.userId,
          resolvedAt: new Date(),
        },
      });
      const after = { status: dto.decision, resolution: dto.resolution, violationAction: dto.violationAction ?? null, violationCode: violationCodeCreated };
      await this.audit.log(
        { tenantId: a.tenantId, actorId: a.userId, action: `market_report.${dto.decision.toLowerCase()}`, entity: 'market_report', entityId: r.id, before: { status: r.status }, after, ip },
        tx,
      );
      await this.audit.log(
        { tenantId: r.tenantId, actorId: a.userId, action: `market_report.${dto.decision.toLowerCase()}`, entity: 'market_report', entityId: r.id, before: { status: r.status }, after, ip },
        tx,
      );
      return { status: dto.decision, violationCode: violationCodeCreated, invalidateIds };
    });
    if (res.invalidateIds.length) await this.access.invalidate(...res.invalidateIds);
    return { status: res.status, violationCode: res.violationCode };
  }

  async platformViolations(a: Access, q?: string) {
    assertPlatformReportHandler(a);
    const [rows, tenants, shops, activeOffers] = await Promise.all([
      this.prisma.shopViolation.findMany({
        include: { report: { select: { code: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.prisma.tenant.findMany({
        where: { type: { in: ['PARTNER', 'GARAGE'] }, deletedAt: null },
        select: { id: true, name: true, type: true, status: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.shop.findMany({ select: { tenantId: true, name: true, slug: true } }),
      this.prisma.offer.findMany({
        where: { status: { in: ['DANG_BAN', 'TAM_AN', 'BI_GO'] } },
        include: { catalogItem: { select: { code: true, name: true } } },
      }),
    ]);

    const actorIds = [...new Set(rows.map((r) => r.createdBy))];
    const actors = actorIds.length ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } }) : [];

    const countByTenant = new Map<string, number>();
    for (const r of rows) countByTenant.set(r.tenantId, (countByTenant.get(r.tenantId) ?? 0) + 1);

    let items = rows.map((r) => {
      const t = tenants.find((x) => x.id === r.tenantId);
      const s = shops.find((x) => x.tenantId === r.tenantId);
      const o = activeOffers.find((x) => x.id === r.offerId);
      return {
        id: r.id,
        code: r.code,
        tenantId: r.tenantId,
        sellerName: s?.name ?? t?.name ?? 'Garage',
        sellerType: t?.type ?? 'PARTNER',
        sellerStatus: t?.status ?? 'HOAT_DONG',
        totalViolations: countByTenant.get(r.tenantId) ?? 1,
        reportCode: r.report?.code ?? null,
        offerName: o ? `${o.catalogItem.code} · ${o.catalogItem.name}` : null,
        action: r.action,
        reason: r.reason,
        createdBy: actors.find((u) => u.id === r.createdBy)?.fullName ?? null,
        createdAt: r.createdAt,
      };
    });

    if (q?.trim()) {
      const k = q.trim().toLowerCase();
      items = items.filter((i) => `${i.code} ${i.sellerName} ${i.reportCode ?? ''} ${i.reason}`.toLowerCase().includes(k));
    }

    const sellers = tenants.map((t) => {
      const s = shops.find((x) => x.tenantId === t.id);
      return {
        tenantId: t.id,
        name: s?.name ?? t.name,
        type: t.type,
        status: t.status,
        violations: countByTenant.get(t.id) ?? 0,
        offers: activeOffers
          .filter((o) => o.tenantId === t.id && (o.status === 'DANG_BAN' || o.status === 'TAM_AN'))
          .map((o) => ({ id: o.id, code: o.catalogItem.code, name: o.catalogItem.name })),
      };
    });

    return { items, sellers };
  }

  async createViolation(a: Access, dto: CreateViolationDto, ip?: string) {
    assertPlatformReportHandler(a);
    const res = await this.prisma.$transaction((tx) =>
      this.applyViolationTx(tx, a, {
        tenantId: dto.tenantId,
        offerId: dto.offerId ?? null,
        action: dto.action,
        reason: dto.reason,
        ip,
      }),
    );
    if (res.invalidateMembershipIds.length) await this.access.invalidate(...res.invalidateMembershipIds);
    return { id: res.violation.id, code: res.violation.code, action: res.violation.action };
  }

  async reportedReviews(a: Access, filter?: string) {
    assertPlatformReportHandler(a);
    const where: Prisma.MarketReviewWhereInput =
      filter === 'ALL' ? { reportedAt: { not: null } } : { reportedAt: { not: null }, moderatedAt: null, status: 'HIEN' };
    const [rows, pendingCount] = await Promise.all([
      this.prisma.marketReview.findMany({
        where,
        include: { request: { select: { code: true, items: { select: { name: true } } } } },
        orderBy: { reportedAt: 'desc' },
        take: 200,
      }),
      this.prisma.marketReview.count({ where: { reportedAt: { not: null }, moderatedAt: null, status: 'HIEN' } }),
    ]);
    const tids = [...new Set(rows.map((r) => r.tenantId))];
    const [shops, tenants] = await Promise.all([
      tids.length ? this.prisma.shop.findMany({ where: { tenantId: { in: tids } }, select: { tenantId: true, name: true } }) : Promise.resolve([]),
      tids.length ? this.prisma.tenant.findMany({ where: { id: { in: tids } }, select: { id: true, name: true } }) : Promise.resolve([]),
    ]);
    return {
      pendingCount,
      items: rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        sellerName: shops.find((s) => s.tenantId === r.tenantId)?.name ?? tenants.find((t) => t.id === r.tenantId)?.name ?? 'Garage',
        requestCode: r.request.code,
        items: r.request.items.map((i) => i.name),
        customerName: r.customerName,
        rating: r.rating,
        comment: r.comment,
        reply: r.reply,
        status: r.status,
        reportedReason: r.reportedReason,
        reportedAt: r.reportedAt,
        moderatedAt: r.moderatedAt,
        moderationNote: r.moderationNote,
        createdAt: r.createdAt,
      })),
    };
  }

  async moderateReview(a: Access, id: string, dto: ModerateReviewDto, ip?: string) {
    assertPlatformReportHandler(a);
    const r = await this.prisma.marketReview.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Không tìm thấy đánh giá');
    const toStatus: MarketReviewStatus = dto.action === 'HIDE' ? 'AN' : 'HIEN';
    await this.prisma.marketReview.update({
      where: { id: r.id },
      data: {
        status: toStatus,
        moderatedBy: a.userId,
        moderatedAt: new Date(),
        moderationNote: dto.note ?? null,
      },
    });
    const act = dto.action === 'HIDE' ? 'market_review.hidden' : 'market_review.kept';
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: act,
      entity: 'market_review',
      entityId: r.id,
      before: { status: r.status },
      after: { status: toStatus, note: dto.note ?? null },
      ip,
    });
    await this.audit.log({
      tenantId: r.tenantId,
      actorId: a.userId,
      action: act,
      entity: 'market_review',
      entityId: r.id,
      after: { status: toStatus, note: dto.note ?? null },
      ip,
    });
    return { status: toStatus };
  }
}

@Controller()
export class ReviewsReportsController {
  constructor(private readonly svc: ReviewsReportsService) {}

  // ---- Công khai: khách trên sàn ----
  @Public()
  @Post('public/market/requests/:id/review')
  @HttpCode(200)
  submitReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('t') t: string | undefined,
    @Body(new ZodPipe(submitReviewSchema)) dto: SubmitReviewDto,
    @Req() req: Request,
  ) {
    return this.svc.submitReview(id, t, dto, clientIp(req));
  }

  @Public()
  @Post('public/market/requests/:id/reports')
  submitRequestReport(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('t') t: string | undefined,
    @Body(new ZodPipe(requestReportSchema)) dto: RequestReportDto,
    @Req() req: Request,
  ) {
    return this.svc.submitRequestReport(id, t, dto, clientIp(req));
  }

  @Public()
  @Post('public/market/shops/:slug/reports')
  submitShopReport(@Param('slug') slug: string, @Body(new ZodPipe(shopReportSchema)) dto: ShopReportDto, @Req() req: Request) {
    return this.svc.submitShopReport(slug, dto, clientIp(req));
  }

  // ---- Garage / Đối tác ----
  @Get('seller/reviews')
  sellerReviews(@CurrentAuth() auth: RequestAuth, @Query('filter') filter?: string) {
    return this.svc.sellerReviews(auth.access, filter);
  }

  @Post('seller/reviews/:id/reply')
  @HttpCode(200)
  replyReview(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(replySchema)) dto: { reply: string },
    @Req() req: Request,
  ) {
    return this.svc.replyReview(auth.access, id, dto.reply, clientIp(req));
  }

  @Post('seller/reviews/:id/report')
  @HttpCode(200)
  reportReview(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(reportReviewSchema)) dto: { reason: string },
    @Req() req: Request,
  ) {
    return this.svc.reportReview(auth.access, id, dto.reason, clientIp(req));
  }

  @Get('seller/reports')
  sellerReports(@CurrentAuth() auth: RequestAuth) {
    return this.svc.sellerReports(auth.access);
  }

  @Post('seller/reports/:id/explain')
  @HttpCode(200)
  explainReport(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(explainSchema)) dto: { explanation: string },
    @Req() req: Request,
  ) {
    return this.svc.explainReport(auth.access, id, dto.explanation, clientIp(req));
  }

  // ---- Admin sàn (A6.41, A6.42, A6.33) ----
  @RequirePermissions('platform.report.handle')
  @Get('platform/reports')
  platformReports(@CurrentAuth() auth: RequestAuth, @Query('status') status?: string, @Query('q') q?: string) {
    return this.svc.platformReports(auth.access, { status, q });
  }

  @RequirePermissions('platform.report.handle')
  @Post('platform/reports/:id/request-explanation')
  @HttpCode(200)
  requestExplanation(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(askExplainSchema)) dto: { note: string },
    @Req() req: Request,
  ) {
    return this.svc.requestExplanation(auth.access, id, dto.note, clientIp(req));
  }

  @RequirePermissions('platform.report.handle')
  @Post('platform/reports/:id/resolve')
  @HttpCode(200)
  resolveReport(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(resolveReportSchema)) dto: ResolveReportDto,
    @Req() req: Request,
  ) {
    return this.svc.resolveReport(auth.access, id, dto, clientIp(req));
  }

  @RequirePermissions('platform.report.handle')
  @Get('platform/violations')
  platformViolations(@CurrentAuth() auth: RequestAuth, @Query('q') q?: string) {
    return this.svc.platformViolations(auth.access, q);
  }

  @RequirePermissions('platform.report.handle')
  @Post('platform/violations')
  createViolation(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(createViolationSchema)) dto: CreateViolationDto, @Req() req: Request) {
    return this.svc.createViolation(auth.access, dto, clientIp(req));
  }

  @RequirePermissions('platform.report.handle')
  @Get('platform/reviews/reported')
  reportedReviews(@CurrentAuth() auth: RequestAuth, @Query('filter') filter?: string) {
    return this.svc.reportedReviews(auth.access, filter);
  }

  @RequirePermissions('platform.report.handle')
  @Post('platform/reviews/:id/moderate')
  @HttpCode(200)
  moderateReview(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(moderateReviewSchema)) dto: ModerateReviewDto,
    @Req() req: Request,
  ) {
    return this.svc.moderateReview(auth.access, id, dto, clientIp(req));
  }
}
