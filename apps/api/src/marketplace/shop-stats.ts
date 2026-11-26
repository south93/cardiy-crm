import { createHash } from 'node:crypto';
import { Body, Controller, ForbiddenException, Get, HttpCode, Injectable, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { Access } from '../auth/access.service';
import { CurrentAuth, Public } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { vnDate } from '../platform/partner-rules';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { tenantListable } from './offer-rules';
import { expireStale } from './requests';
import { combineRating, ratePercent, statsWindow, vnYmd } from './review-report-rules';

const VIEW_DEDUP_SECONDS = 1800; // 30 phút cho cùng 1 người xem trên cùng gian hàng / tin đăng

function assertStatsViewer(a: Access) {
  const ok =
    a.tenantType === 'PARTNER'
      ? a.permissions.includes('partner.report.view')
      : a.tenantType === 'GARAGE' && (a.permissions.includes('report.view') || a.permissions.includes('shop.manage'));
  if (!ok) throw new ForbiddenException('Bạn không có quyền xem thống kê gian hàng');
}

export const trackViewSchema = z
  .object({
    tenantId: z.string().uuid().optional(),
    offerIds: z.array(z.string().uuid()).max(30).optional(),
  })
  .refine((v) => !!v.tenantId || (v.offerIds?.length ?? 0) > 0, {
    message: 'Thiếu đối tượng ghi nhận lượt xem',
  });
type TrackViewDto = z.infer<typeof trackViewSchema>;

@Injectable()
export class ShopStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Ghi nhận lượt xem gian hàng hoặc tin đăng từ khách trên sàn (chống F5 / trùng trong 30 phút) */
  async recordViews(dto: TrackViewDto, ip?: string, ua?: string) {
    const viewerHash = createHash('sha256').update(`${ip ?? 'na'}|${ua ?? ''}`).digest('hex').slice(0, 16);
    const today = vnDate();
    let counted = 0;

    if (dto.tenantId) {
      const [tenant, shop] = await Promise.all([
        this.prisma.tenant.findUnique({ where: { id: dto.tenantId }, select: { id: true, type: true, status: true, deletedAt: true } }),
        this.prisma.shop.findUnique({ where: { tenantId: dto.tenantId }, select: { id: true } }),
      ]);
      if (tenant && shop && tenantListable(tenant)) {
        const fresh = await this.redis.client.set(`market-view:${viewerHash}:${dto.tenantId}:SHOP`, '1', 'EX', VIEW_DEDUP_SECONDS, 'NX');
        if (fresh === 'OK') {
          await this.prisma.$executeRaw`
            INSERT INTO shop_daily_views (tenant_id, view_date, target_key, offer_id, views)
            VALUES (${dto.tenantId}::uuid, ${today}::date, 'SHOP', NULL, 1)
            ON CONFLICT (tenant_id, view_date, target_key)
            DO UPDATE SET views = shop_daily_views.views + 1
          `;
          counted += 1;
        }
      }
    }

    const offerIds = [...new Set(dto.offerIds ?? [])];
    if (offerIds.length) {
      const offers = await this.prisma.offer.findMany({
        where: { id: { in: offerIds }, status: 'DANG_BAN' },
        select: { id: true, tenantId: true },
      });
      if (offers.length) {
        const tids = [...new Set(offers.map((o) => o.tenantId))];
        const [tenants, shops] = await Promise.all([
          this.prisma.tenant.findMany({ where: { id: { in: tids } }, select: { id: true, type: true, status: true, deletedAt: true } }),
          this.prisma.shop.findMany({ where: { tenantId: { in: tids } }, select: { tenantId: true } }),
        ]);
        const shopSet = new Set(shops.map((s) => s.tenantId));
        const okTenants = new Set(tenants.filter((t) => shopSet.has(t.id) && tenantListable(t)).map((t) => t.id));
        for (const o of offers) {
          if (!okTenants.has(o.tenantId)) continue;
          const fresh = await this.redis.client.set(`market-view:${viewerHash}:${o.tenantId}:${o.id}`, '1', 'EX', VIEW_DEDUP_SECONDS, 'NX');
          if (fresh === 'OK') {
            await this.prisma.$executeRaw`
              INSERT INTO shop_daily_views (tenant_id, view_date, target_key, offer_id, views)
              VALUES (${o.tenantId}::uuid, ${today}::date, ${o.id}, ${o.id}::uuid, 1)
              ON CONFLICT (tenant_id, view_date, target_key)
              DO UPDATE SET views = shop_daily_views.views + 1
            `;
            counted += 1;
          }
        }
      }
    }

    return { counted };
  }

  /** Thống kê gian hàng cho đối tác (A7.30) và PLG (A3.57) theo kỳ 7 / 30 / 90 ngày */
  async getStats(a: Access, rawDays?: string) {
    assertStatsViewer(a);
    await expireStale(this.prisma);
    const w = statsWindow(Number(rawDays) || 30);

    const [viewRows, reqRows, offers, marketAgg, orderAgg, shop] = await Promise.all([
      this.prisma.shopDailyView.findMany({
        where: { tenantId: a.tenantId, viewDate: { gte: w.fromDate, lte: w.toDate } },
      }),
      this.prisma.orderRequest.findMany({
        where: { tenantId: a.tenantId, createdAt: { gte: w.fromTimestamp } },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.offer.findMany({
        where: { tenantId: a.tenantId },
        include: { catalogItem: { select: { code: true, name: true } } },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.marketReview.aggregate({
        where: { tenantId: a.tenantId, status: 'HIEN' },
        _sum: { rating: true },
        _count: true,
      }),
      a.tenantType === 'GARAGE'
        ? this.prisma.orderReview.aggregate({
            where: { tenantId: a.tenantId },
            _sum: { rating: true },
            _count: true,
          })
        : Promise.resolve({ _sum: { rating: 0 }, _count: 0 }),
      this.prisma.shop.findUnique({ where: { tenantId: a.tenantId }, select: { slug: true, name: true } }),
    ]);

    const dayMap = new Map(
      w.keys.map((date) => [
        date,
        { date, shopViews: 0, offerViews: 0, totalViews: 0, requests: 0, completed: 0, revenue: 0 },
      ]),
    );

    let shopViews = 0;
    let offerViews = 0;
    const viewsByOffer = new Map<string, number>();

    for (const v of viewRows) {
      const key = v.viewDate.toISOString().slice(0, 10);
      const bucket = dayMap.get(key);
      if (v.targetKey === 'SHOP') {
        shopViews += v.views;
        if (bucket) {
          bucket.shopViews += v.views;
          bucket.totalViews += v.views;
        }
      } else {
        offerViews += v.views;
        if (v.offerId) viewsByOffer.set(v.offerId, (viewsByOffer.get(v.offerId) ?? 0) + v.views);
        if (bucket) {
          bucket.offerViews += v.views;
          bucket.totalViews += v.views;
        }
      }
    }

    const statusCounts: Record<string, number> = {
      CHO_XAC_NHAN: 0,
      DA_XAC_NHAN: 0,
      HOAN_THANH: 0,
      TU_CHOI: 0,
      HET_HAN: 0,
      KHACH_HUY: 0,
      KHONG_DEN: 0,
    };
    let completedRevenue = 0;
    const offerStats = new Map<string, { requests: number; completed: number; soldQty: number; revenue: number }>();

    for (const r of reqRows) {
      statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
      const key = vnYmd(r.createdAt);
      const bucket = dayMap.get(key);
      if (bucket) bucket.requests += 1;

      const isDone = r.status === 'HOAN_THANH';
      const val = Number(r.finalTotal ?? r.estimatedTotal);
      if (isDone) {
        completedRevenue += val;
        if (bucket) {
          bucket.completed += 1;
          bucket.revenue += val;
        }
      }

      const seenOffers = new Set<string>();
      for (const it of r.items) {
        const cur = offerStats.get(it.offerId) ?? { requests: 0, completed: 0, soldQty: 0, revenue: 0 };
        if (!seenOffers.has(it.offerId)) {
          cur.requests += 1;
          if (isDone) cur.completed += 1;
          seenOffers.add(it.offerId);
        }
        if (isDone) {
          cur.soldQty += it.quantity;
          cur.revenue += Number(it.unitPrice) * it.quantity;
        }
        offerStats.set(it.offerId, cur);
      }
    }

    const totalRequests = reqRows.length;
    const completed = statusCounts.HOAN_THANH ?? 0;
    const confirmed = statusCounts.DA_XAC_NHAN ?? 0;
    const totalViews = shopViews + offerViews;

    const rating = combineRating([
      { sum: marketAgg._sum.rating ?? 0, count: marketAgg._count },
      { sum: orderAgg._sum.rating ?? 0, count: orderAgg._count },
    ]);

    const offerRows = offers
      .map((o) => {
        const views = viewsByOffer.get(o.id) ?? 0;
        const st = offerStats.get(o.id) ?? { requests: 0, completed: 0, soldQty: 0, revenue: 0 };
        return {
          offerId: o.id,
          code: o.catalogItem.code,
          name: o.catalogItem.name,
          kind: o.kind,
          status: o.status,
          views,
          requests: st.requests,
          completed: st.completed,
          soldQty: st.soldQty,
          closeRate: ratePercent(st.completed, st.requests),
          revenue: st.revenue,
        };
      })
      .sort(
        (x, y) =>
          y.completed - x.completed ||
          y.requests - x.requests ||
          y.views - x.views ||
          x.name.localeCompare(y.name, 'vi'),
      );

    return {
      periodDays: w.days,
      shop: shop ? { name: shop.name, slug: shop.slug } : null,
      views: {
        total: totalViews,
        shop: shopViews,
        offers: offerViews,
      },
      requests: {
        total: totalRequests,
        completed,
        confirmed,
        pending: statusCounts.CHO_XAC_NHAN ?? 0,
        rejected: statusCounts.TU_CHOI ?? 0,
        cancelled: statusCounts.KHACH_HUY ?? 0,
        expired: statusCounts.HET_HAN ?? 0,
        noShow: statusCounts.KHONG_DEN ?? 0,
      },
      rates: {
        closeRate: ratePercent(completed, totalRequests),
        confirmRate: ratePercent(completed + confirmed, totalRequests),
        requestPerViewRate: ratePercent(totalRequests, totalViews),
      },
      completedRevenue,
      rating,
      days: w.keys.map((k) => dayMap.get(k)!),
      offers: offerRows,
    };
  }
}

@Controller()
export class ShopStatsController {
  constructor(private readonly stats: ShopStatsService) {}

  @Public()
  @Post('public/market/views')
  @HttpCode(200)
  recordViews(@Body(new ZodPipe(trackViewSchema)) dto: TrackViewDto, @Req() req: Request) {
    return this.stats.recordViews(dto, clientIp(req), req.headers['user-agent']);
  }

  @Get('seller/stats')
  getStats(@CurrentAuth() auth: RequestAuth, @Query('days') days?: string) {
    return this.stats.getStats(auth.access, days);
  }
}
