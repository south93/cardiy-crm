import { BadRequestException, Controller, ForbiddenException, Get, Injectable, Module, Query } from '@nestjs/common';
import { z } from 'zod';
import { AccessService, type Access } from '../auth/access.service';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import type { RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import {
  computeGrossMargin,
  computeRatePct,
  computeRetentionSummary,
  computeSlaRate,
  rankBranchesByKpi,
  type BranchKpiRow,
} from './report-rules';

const VN = 7 * 3_600_000;
const n = (v: bigint | number | null | undefined | { toString(): string }) => Number(v ?? 0);

const dateRangeQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày bắt đầu có dạng YYYY-MM-DD')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày kết thúc có dạng YYYY-MM-DD')
    .optional(),
  branchId: z.string().uuid().optional(),
});

/** Đổi ngày YYYY-MM-DD (giờ Việt Nam) sang khoảng UTC [startUtc, endExclusiveUtc) */
function parseVnDateRange(fromStr?: string, toStr?: string) {
  const nowVn = new Date(Date.now() + VN);
  const todayStr = nowVn.toISOString().slice(0, 10);
  const defaultFrom = new Date(nowVn.getTime() - 29 * 86_400_000).toISOString().slice(0, 10);

  const f = fromStr ?? defaultFrom;
  const t = toStr ?? todayStr;
  if (f > t) throw new BadRequestException('Ngày bắt đầu không được lớn hơn ngày kết thúc');

  const [fy, fm, fd] = f.split('-').map(Number);
  const [ty, tm, td] = t.split('-').map(Number);
  const startUtc = new Date(Date.UTC(fy!, fm! - 1, fd!) - VN);
  const endExclusiveUtc = new Date(Date.UTC(ty!, tm! - 1, td! + 1) - VN);
  const daysSpan = Math.round((endExclusiveUtc.getTime() - startUtc.getTime()) / 86_400_000);
  if (daysSpan > 366) throw new BadRequestException('Khoảng thời gian báo cáo tối đa 366 ngày');

  // Cho các cột @db.Date (như shop_daily_views.view_date, platform_invoices.due_date)
  const fromDateOnly = new Date(`${f}T00:00:00.000Z`);
  const toDateOnly = new Date(`${t}T00:00:00.000Z`);

  return { from: f, to: t, startUtc, endExclusiveUtc, fromDateOnly, toDateOnly, daysSpan };
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------- M30 · A3.80 Báo cáo & KPI SLA chuỗi chi nhánh PLG ----------------

  async garageReport(a: Access, q: { from?: string; to?: string; branchId?: string }) {
    if (a.tenantType !== 'GARAGE') throw new ForbiddenException('Báo cáo vận hành chuỗi chỉ dành cho Garage PLG');
    if (q.branchId && !AccessService.canAccessBranch(a, q.branchId)) {
      throw new ForbiddenException('Bạn không có quyền xem báo cáo của chi nhánh này');
    }

    const range = parseVnDateRange(q.from, q.to);
    const allTenantBranches = await this.prisma.branch.findMany({
      where: { tenantId: a.tenantId, deletedAt: null },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true },
    });
    const allowedBranches = allTenantBranches.filter((b) => a.branchIds === 'ALL' || a.branchIds.includes(b.id));
    const targetBranches = q.branchId ? allowedBranches.filter((b) => b.id === q.branchId) : allowedBranches;
    const branchIds = targetBranches.map((b) => b.id);

    if (!branchIds.length) {
      return {
        period: { from: range.from, to: range.to },
        branches: allowedBranches,
        summary: {
          roRevenue: 0,
          grossProfit: 0,
          marginPct: null,
          ordersDelivered: 0,
          slaOnTimePct: null,
          overdueOpen: 0,
          collected: 0,
          expense: 0,
          netCash: 0,
          rentalRevenue: 0,
          appraisalRevenue: 0,
          returningRatePct: 0,
        },
        branchComparison: [],
        technicians: [],
        inventory: { activeParts: 0, stockCostValue: 0, lowStockCount: 0, lowStockItems: [] },
        retention: { activeCustomers: 0, newCustomers: 0, returningCustomers: 0, returningRatePct: 0, totalReceivable: 0 },
        marketplace: {
          views: 0,
          requestsTotal: 0,
          requestsCompleted: 0,
          conversionPct: 0,
          marketRevenue: 0,
          sosCompleted: 0,
          rentalsSettled: 0,
          appraisalsCompleted: 0,
        },
      };
    }

    const now = new Date();
    const tId = a.tenantId;

    const [
      deliveredOrders,
      overdueByBranch,
      orderPayments,
      cashEntries,
      orderReviews,
      settledRentals,
      completedAppraisals,
      techMembers,
      productsWithStock,
      customerHistoryBefore,
      receivableAgg,
      shopViewsAgg,
      marketReqs,
      sosDoneCount,
    ] = await Promise.all([
      this.prisma.repairOrder.findMany({
        where: {
          tenantId: tId,
          branchId: { in: branchIds },
          status: 'DA_GIAO',
          deliveredAt: { gte: range.startUtc, lt: range.endExclusiveUtc },
        },
        include: {
          items: { include: { product: { select: { costPrice: true } } } },
        },
      }),
      this.prisma.repairOrder.groupBy({
        by: ['branchId'],
        where: {
          tenantId: tId,
          branchId: { in: branchIds },
          status: { in: ['TIEP_NHAN', 'DANG_SUA'] },
          promisedAt: { lt: now },
        },
        _count: true,
      }),
      this.prisma.payment.findMany({
        where: {
          tenantId: tId,
          voidedAt: null,
          paidAt: { gte: range.startUtc, lt: range.endExclusiveUtc },
          order: { branchId: { in: branchIds } },
        },
        select: { amount: true, order: { select: { branchId: true } } },
      }),
      this.prisma.cashEntry.findMany({
        where: {
          tenantId: tId,
          branchId: { in: branchIds },
          voidedAt: null,
          occurredAt: { gte: range.startUtc, lt: range.endExclusiveUtc },
        },
        select: { branchId: true, type: true, category: true, amount: true },
      }),
      this.prisma.orderReview.findMany({
        where: {
          tenantId: tId,
          createdAt: { gte: range.startUtc, lt: range.endExclusiveUtc },
          order: { branchId: { in: branchIds } },
        },
        select: { rating: true, order: { select: { branchId: true } } },
      }),
      this.prisma.rentalContract.findMany({
        where: {
          tenantId: tId,
          branchId: { in: branchIds },
          status: 'DA_QUYET_TOAN',
          settledAt: { gte: range.startUtc, lt: range.endExclusiveUtc },
        },
        select: { branchId: true, finalTotal: true },
      }),
      this.prisma.usedCarAppraisal.findMany({
        where: {
          tenantId: tId,
          branchId: { in: branchIds },
          status: 'HOAN_THANH',
          completedAt: { gte: range.startUtc, lt: range.endExclusiveUtc },
        },
        select: { branchId: true, assignedMemberId: true, finalFee: true },
      }),
      this.prisma.membership.findMany({
        where: {
          tenantId: tId,
          status: 'ACTIVE',
          roles: { some: { role: { code: 'KTV' }, OR: [{ branchId: null }, { branchId: { in: branchIds } }] } },
        },
        include: { user: { select: { fullName: true, phone: true } } },
      }),
      this.prisma.product.findMany({
        where: { tenantId: tId, deletedAt: null, active: true, kind: 'PHU_TUNG' },
        include: { stock: { where: { branchId: { in: branchIds } } } },
      }),
      this.prisma.repairOrder.groupBy({
        by: ['customerId'],
        where: {
          tenantId: tId,
          status: 'DA_GIAO',
          deliveredAt: { lt: range.startUtc },
        },
        _count: true,
      }),
      this.prisma.$queryRaw<{ orders: bigint; opening: bigint }[]>`
        SELECT
          (SELECT COALESCE(SUM(total - paid), 0) FROM repair_orders WHERE tenant_id = ${tId}::uuid AND status IN ('HOAN_THANH', 'DA_GIAO') AND total > paid AND branch_id = ANY(${branchIds}::uuid[])) AS orders,
          (SELECT COALESCE(SUM(GREATEST(c.opening_debt - COALESCE(e.paid, 0), 0)), 0) FROM customers c
             LEFT JOIN (SELECT customer_id, SUM(amount) AS paid FROM cash_entries WHERE tenant_id = ${tId}::uuid AND category = 'THU_NO_DAU_KY' AND voided_at IS NULL GROUP BY 1) e ON e.customer_id = c.id
             WHERE c.tenant_id = ${tId}::uuid AND c.deleted_at IS NULL AND c.opening_debt > 0 AND (${!q.branchId && a.branchIds === 'ALL'} OR c.branch_id = ANY(${branchIds}::uuid[]))) AS opening`,
      this.prisma.shopDailyView.aggregate({
        where: { tenantId: tId, viewDate: { gte: range.fromDateOnly, lte: range.toDateOnly } },
        _sum: { views: true },
      }),
      this.prisma.orderRequest.findMany({
        where: { tenantId: tId, createdAt: { gte: range.startUtc, lt: range.endExclusiveUtc } },
        select: { status: true, finalTotal: true, estimatedTotal: true },
      }),
      this.prisma.sosRequest.count({
        where: {
          assignedTenantId: tId,
          assignedBranchId: { in: branchIds },
          status: 'HOAN_THANH',
          completedAt: { gte: range.startUtc, lt: range.endExclusiveUtc },
        },
      }),
    ]);

    // 1. So sánh KPI & SLA từng chi nhánh (M30)
    const overdueMap = new Map(overdueByBranch.map((o) => [o.branchId, o._count]));
    const branchRows: BranchKpiRow[] = targetBranches.map((b) => {
      const bOrders = deliveredOrders.filter((o) => o.branchId === b.id);
      const roRevenue = bOrders.reduce((s, o) => s + n(o.total), 0);
      let partsCost = 0;
      let onTime = 0;
      for (const o of bOrders) {
        if (!o.promisedAt || (o.deliveredAt && o.deliveredAt.getTime() <= o.promisedAt.getTime())) {
          onTime += 1;
        }
        for (const it of o.items) {
          if (it.kind === 'PHU_TUNG' && it.product) {
            partsCost += Math.round(Number(it.quantity) * n(it.product.costPrice));
          }
        }
      }
      const gm = computeGrossMargin(roRevenue, partsCost);
      const bPay = orderPayments.filter((p) => p.order.branchId === b.id).reduce((s, p) => s + n(p.amount), 0);
      const bCashIn = cashEntries
        .filter((e) => e.branchId === b.id && e.type === 'THU' && e.category !== 'QUY_DAU_KY')
        .reduce((s, e) => s + n(e.amount), 0);
      const bCashOut = cashEntries
        .filter((e) => e.branchId === b.id && e.type === 'CHI')
        .reduce((s, e) => s + n(e.amount), 0);

      const bReviews = orderReviews.filter((r) => r.order.branchId === b.id);
      const avgRating =
        bReviews.length > 0 ? Math.round((bReviews.reduce((s, r) => s + r.rating, 0) / bReviews.length) * 10) / 10 : null;

      const rentalRevenue = settledRentals.filter((r) => r.branchId === b.id).reduce((s, r) => s + n(r.finalTotal), 0);
      const appraisalRevenue = completedAppraisals.filter((ap) => ap.branchId === b.id).reduce((s, ap) => s + n(ap.finalFee), 0);

      return {
        branchId: b.id,
        code: b.code,
        name: b.name,
        ordersDelivered: bOrders.length,
        roRevenue,
        partsCost,
        grossProfit: gm.grossProfit,
        marginPct: gm.marginPct,
        collected: bPay + bCashIn,
        expense: bCashOut,
        slaOnTimePct: computeSlaRate(onTime, bOrders.length),
        overdueOpen: overdueMap.get(b.id) ?? 0,
        avgRating,
        rentalRevenue,
        appraisalRevenue,
      };
    });

    const branchComparison = rankBranchesByKpi(branchRows);

    // 2. Năng suất Kỹ thuật viên
    const allPeriodOrders = await this.prisma.repairOrder.findMany({
      where: {
        tenantId: tId,
        branchId: { in: branchIds },
        technicianId: { not: null },
        receivedAt: { lt: range.endExclusiveUtc },
        OR: [
          { deliveredAt: { gte: range.startUtc, lt: range.endExclusiveUtc } },
          { completedAt: { gte: range.startUtc, lt: range.endExclusiveUtc } },
          { status: { in: ['TIEP_NHAN', 'DANG_SUA', 'HOAN_THANH'] } },
        ],
      },
      select: {
        technicianId: true,
        status: true,
        total: true,
        promisedAt: true,
        completedAt: true,
        deliveredAt: true,
      },
    });

    const technicians = techMembers
      .map((m) => {
        const myOrders = allPeriodOrders.filter((o) => o.technicianId === m.id);
        const doneOrders = myOrders.filter((o) => o.status === 'HOAN_THANH' || o.status === 'DA_GIAO');
        const onTimeDone = doneOrders.filter((o) => {
          const fin = o.completedAt ?? o.deliveredAt;
          return !o.promisedAt || (fin && fin.getTime() <= o.promisedAt.getTime());
        }).length;
        const revenue = doneOrders.reduce((s, o) => s + n(o.total), 0);
        const appraisalsDone = completedAppraisals.filter((ap) => ap.assignedMemberId === m.id).length;

        return {
          membershipId: m.id,
          fullName: m.user.fullName,
          phone: m.user.phone,
          ordersAssigned: myOrders.length,
          ordersCompleted: doneOrders.length,
          slaOnTimePct: computeSlaRate(onTimeDone, doneOrders.length),
          revenueContributed: revenue,
          appraisalsCompleted: appraisalsDone,
        };
      })
      .sort((x, y) => y.ordersCompleted - x.ordersCompleted || y.revenueContributed - x.revenueContributed);

    // 3. Tồn kho & cảnh báo dưới định mức
    const branchCodeMap = new Map(targetBranches.map((b) => [b.id, b.code]));
    let stockCostValue = 0;
    const lowStockItems: { code: string; name: string; unit: string | null; branchCode: string; onHand: number; minStock: number }[] = [];

    for (const p of productsWithStock) {
      const cost = n(p.costPrice);
      const min = p.minStock !== null ? Number(p.minStock) : null;
      const byBranch = new Map(p.stock.map((s) => [s.branchId, Number(s.quantity)]));
      for (const bId of branchIds) {
        const qty = byBranch.get(bId) ?? 0;
        if (qty > 0) stockCostValue += Math.round(qty * cost);
        if (min !== null && qty <= min) {
          lowStockItems.push({
            code: p.code,
            name: p.name,
            unit: p.unit,
            branchCode: branchCodeMap.get(bId) ?? '',
            onHand: qty,
            minStock: min,
          });
        }
      }
    }

    // 4. Khách mới vs Khách quay lại
    const hadBeforeSet = new Set(customerHistoryBefore.map((c) => c.customerId));
    const perCustOrders = new Map<string, number>();
    for (const o of deliveredOrders) {
      perCustOrders.set(o.customerId, (perCustOrders.get(o.customerId) ?? 0) + 1);
    }
    const retention = computeRetentionSummary(
      [...perCustOrders.entries()].map(([cid, cnt]) => ({
        hadOrderBeforePeriod: hadBeforeSet.has(cid),
        ordersInPeriod: cnt,
      })),
    );
    const totalReceivable = n(receivableAgg[0]?.orders) + n(receivableAgg[0]?.opening);

    // 5. Hiệu quả kênh Sàn & dịch vụ mở rộng
    const reqCompleted = marketReqs.filter((r) => r.status === 'HOAN_THANH');
    const marketRevenue = reqCompleted.reduce((s, r) => s + n(r.finalTotal ?? r.estimatedTotal), 0);

    // Tổng hợp toàn chuỗi (theo các chi nhánh đang chọn)
    const totRoRev = branchRows.reduce((s, b) => s + b.roRevenue, 0);
    const totPartsCost = branchRows.reduce((s, b) => s + b.partsCost, 0);
    const totGm = computeGrossMargin(totRoRev, totPartsCost);
    const totOrders = branchRows.reduce((s, b) => s + b.ordersDelivered, 0);
    const totalOnTime = deliveredOrders.filter(
      (o) => !o.promisedAt || (o.deliveredAt && o.deliveredAt.getTime() <= o.promisedAt.getTime()),
    ).length;
    const totCollected = branchRows.reduce((s, b) => s + b.collected, 0);
    const totExpense = branchRows.reduce((s, b) => s + b.expense, 0);

    return {
      period: { from: range.from, to: range.to },
      branches: allowedBranches,
      summary: {
        roRevenue: totRoRev,
        grossProfit: totGm.grossProfit,
        marginPct: totGm.marginPct,
        ordersDelivered: totOrders,
        slaOnTimePct: computeSlaRate(totalOnTime, totOrders),
        overdueOpen: branchRows.reduce((s, b) => s + b.overdueOpen, 0),
        collected: totCollected,
        expense: totExpense,
        netCash: totCollected - totExpense,
        rentalRevenue: branchRows.reduce((s, b) => s + b.rentalRevenue, 0),
        appraisalRevenue: branchRows.reduce((s, b) => s + b.appraisalRevenue, 0),
        returningRatePct: retention.returningRatePct,
      },
      branchComparison,
      technicians,
      inventory: {
        activeParts: productsWithStock.length,
        stockCostValue,
        lowStockCount: lowStockItems.length,
        lowStockItems: lowStockItems.slice(0, 30),
      },
      retention: {
        ...retention,
        totalReceivable,
      },
      marketplace: {
        views: shopViewsAgg._sum.views ?? 0,
        requestsTotal: marketReqs.length,
        requestsCompleted: reqCompleted.length,
        conversionPct: computeRatePct(reqCompleted.length, marketReqs.length),
        marketRevenue,
        sosCompleted: sosDoneCount,
        rentalsSettled: settledRentals.length,
        appraisalsCompleted: completedAppraisals.length,
      },
    };
  }

  // ---------------- A6.01 Dashboard sàn & A6.80 Báo cáo toàn sàn ----------------

  async platformOverview(a: Access, q: { from?: string; to?: string }) {
    if (a.tenantType !== 'PLATFORM') throw new ForbiddenException('Chỉ dành cho không gian Quản trị sàn');
    const range = parseVnDateRange(q.from, q.to);
    const todayDateOnly = new Date(`${new Date(Date.now() + VN).toISOString().slice(0, 10)}T00:00:00.000Z`);

    const [
      dailyViewsRows,
      orderReqs,
      partnerTenants,
      pendingAppsCount,
      paidInvoices,
      unpaidInvoices,
      sosRows,
      activeRentalVehicles,
      rentalContracts,
      activeUsedCars,
      verifiedUsedCars,
      completedAppraisalsCount,
      publishedPostsCount,
      pendingPostsCount,
      commentsInPeriod,
      openReportsCount,
      violationsInPeriod,
      shops,
      tenantsForTop,
    ] = await Promise.all([
      this.prisma.shopDailyView.groupBy({
        by: ['viewDate'],
        where: { viewDate: { gte: range.fromDateOnly, lte: range.toDateOnly } },
        _sum: { views: true },
      }),
      this.prisma.orderRequest.findMany({
        where: { createdAt: { gte: range.startUtc, lt: range.endExclusiveUtc } },
        select: { tenantId: true, status: true, finalTotal: true, estimatedTotal: true, createdAt: true },
      }),
      this.prisma.tenant.findMany({
        where: { type: 'PARTNER', deletedAt: null },
        select: { id: true, status: true, createdAt: true },
      }),
      this.prisma.partnerApplication.count({ where: { status: { in: ['CHO_DUYET', 'CAN_BO_SUNG'] } } }),
      this.prisma.platformInvoice.aggregate({
        where: { status: 'DA_THANH_TOAN', paidAt: { gte: range.startUtc, lt: range.endExclusiveUtc } },
        _sum: { amount: true },
      }),
      this.prisma.platformInvoice.findMany({
        where: { status: 'DA_PHAT_HANH' },
        select: { amount: true, dueDate: true },
      }),
      this.prisma.sosRequest.findMany({
        where: { createdAt: { gte: range.startUtc, lt: range.endExclusiveUtc } },
        select: { status: true, assignedTenantId: true },
      }),
      this.prisma.rentalVehicle.count({ where: { status: 'DANG_CHO_THUE' } }),
      this.prisma.rentalContract.findMany({
        where: { createdAt: { gte: range.startUtc, lt: range.endExclusiveUtc } },
        select: { status: true },
      }),
      this.prisma.usedCarListing.count({ where: { status: 'DANG_BAN' } }),
      this.prisma.usedCarListing.count({ where: { status: 'DANG_BAN', hasVerifiedBadge: true } }),
      this.prisma.usedCarAppraisal.count({
        where: { status: 'HOAN_THANH', completedAt: { gte: range.startUtc, lt: range.endExclusiveUtc } },
      }),
      this.prisma.communityPost.count({ where: { status: 'DA_DANG' } }),
      this.prisma.communityPost.count({ where: { status: 'CHO_DUYET' } }),
      this.prisma.communityComment.count({
        where: { hidden: false, createdAt: { gte: range.startUtc, lt: range.endExclusiveUtc } },
      }),
      this.prisma.marketReport.count({ where: { status: { in: ['MOI', 'CHO_GIAI_TRINH', 'DA_GIAI_TRINH'] } } }),
      this.prisma.shopViolation.count({ where: { createdAt: { gte: range.startUtc, lt: range.endExclusiveUtc } } }),
      this.prisma.shop.findMany(),
      this.prisma.tenant.findMany({
        where: { type: { in: ['GARAGE', 'PARTNER'] }, deletedAt: null },
        select: { id: true, name: true, type: true, status: true },
      }),
    ]);

    const totalViews = dailyViewsRows.reduce((s, r) => s + (r._sum.views ?? 0), 0);
    const completedReqs = orderReqs.filter((r) => r.status === 'HOAN_THANH');
    const connectedGmv = completedReqs.reduce((s, r) => s + n(r.finalTotal ?? r.estimatedTotal), 0);

    const sosDone = sosRows.filter((s) => s.status === 'HOAN_THANH').length;
    const sosAccepted = sosRows.filter((s) => s.assignedTenantId !== null).length;
    const sosNoGarage = sosRows.filter((s) => s.status === 'KHONG_CO_GARAGE').length;

    // Chuỗi thời gian theo ngày (tối đa 30 điểm gần nhất trong kỳ để vẽ biểu đồ rõ)
    const viewsByDay = new Map(dailyViewsRows.map((r) => [r.viewDate.toISOString().slice(0, 10), r._sum.views ?? 0]));
    const reqsByDay = new Map<string, number>();
    for (const r of orderReqs) {
      const dk = new Date(r.createdAt.getTime() + VN).toISOString().slice(0, 10);
      reqsByDay.set(dk, (reqsByDay.get(dk) ?? 0) + 1);
    }

    const chartDays = Math.min(range.daysSpan, 30);
    const chartStartMs = range.endExclusiveUtc.getTime() - chartDays * 86_400_000;
    const dailySeries = Array.from({ length: chartDays }, (_, i) => {
      const dateStr = new Date(chartStartMs + VN + i * 86_400_000).toISOString().slice(0, 10);
      return {
        date: dateStr,
        views: viewsByDay.get(dateStr) ?? 0,
        requests: reqsByDay.get(dateStr) ?? 0,
      };
    });

    // Top gian hàng trên sàn trong kỳ
    const viewsByTenantRows = await this.prisma.shopDailyView.groupBy({
      by: ['tenantId'],
      where: { viewDate: { gte: range.fromDateOnly, lte: range.toDateOnly } },
      _sum: { views: true },
    });
    const viewsByTenant = new Map(viewsByTenantRows.map((r) => [r.tenantId, r._sum.views ?? 0]));
    const shopByTenant = new Map(shops.map((s) => [s.tenantId, s]));

    const topShops = tenantsForTop
      .map((t) => {
        const sh = shopByTenant.get(t.id);
        const tReqs = orderReqs.filter((r) => r.tenantId === t.id);
        const tDone = tReqs.filter((r) => r.status === 'HOAN_THANH');
        const tSos = sosRows.filter((s) => s.assignedTenantId === t.id && s.status === 'HOAN_THANH').length;
        return {
          tenantId: t.id,
          name: sh?.name ?? t.name,
          slug: sh?.slug ?? null,
          tenantType: t.type,
          status: t.status,
          views: viewsByTenant.get(t.id) ?? 0,
          requests: tReqs.length,
          completed: tDone.length,
          gmv: tDone.reduce((s, r) => s + n(r.finalTotal ?? r.estimatedTotal), 0),
          sosCompleted: tSos,
        };
      })
      .sort((a, b) => b.completed - a.completed || b.requests - a.requests || b.views - a.views)
      .slice(0, 15);

    return {
      period: { from: range.from, to: range.to },
      kpis: {
        totalViews,
        orderRequests: {
          total: orderReqs.length,
          completed: completedReqs.length,
          conversionPct: computeRatePct(completedReqs.length, orderReqs.length),
          connectedGmv,
        },
        partners: {
          active: partnerTenants.filter((p) => p.status === 'HOAT_DONG').length,
          pendingApplications: pendingAppsCount,
          newInPeriod: partnerTenants.filter((p) => p.createdAt >= range.startUtc && p.createdAt < range.endExclusiveUtc).length,
          lockedOrSuspended: partnerTenants.filter((p) => ['TAM_KHOA', 'CHAM_DUT'].includes(p.status)).length,
        },
        platformFee: {
          collectedInPeriod: n(paidInvoices._sum.amount),
          unpaidTotal: unpaidInvoices.reduce((s, i) => s + n(i.amount), 0),
          overdueCount: unpaidInvoices.filter((i) => i.dueDate < todayDateOnly).length,
        },
        sos: {
          totalInPeriod: sosRows.length,
          completedInPeriod: sosDone,
          noGarageCount: sosNoGarage,
          acceptRatePct: computeRatePct(sosAccepted, sosRows.length),
        },
        rentals: {
          activeVehicles: activeRentalVehicles,
          contractsInPeriod: rentalContracts.length,
          settledInPeriod: rentalContracts.filter((c) => c.status === 'DA_QUYET_TOAN').length,
        },
        usedCars: {
          activeListings: activeUsedCars,
          verifiedListings: verifiedUsedCars,
          appraisalsCompleted: completedAppraisalsCount,
        },
        community: {
          publishedPosts: publishedPostsCount,
          pendingPosts: pendingPostsCount,
          commentsInPeriod,
        },
        moderation: {
          openReports: openReportsCount,
          violationsInPeriod,
        },
      },
      dailySeries,
      topShops,
    };
  }
}

@RequirePermissions('report.view')
@Controller('reports')
export class GarageReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get('garage')
  garage(@CurrentAuth() auth: RequestAuth, @Query(new ZodPipe(dateRangeQuerySchema)) q: z.infer<typeof dateRangeQuerySchema>) {
    return this.svc.garageReport(auth.access, q);
  }
}

@RequirePermissions('platform.report.view')
@Controller('platform/reports')
export class PlatformReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get('overview')
  overview(
    @CurrentAuth() auth: RequestAuth,
    @Query(new ZodPipe(dateRangeQuerySchema.omit({ branchId: true }))) q: { from?: string; to?: string },
  ) {
    return this.svc.platformOverview(auth.access, q);
  }
}

@Module({
  controllers: [GarageReportsController, PlatformReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
