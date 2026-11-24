import { Controller, ForbiddenException, Get, Injectable, Module, Query } from '@nestjs/common';
import { formatPlate } from '@cardiy/shared';
import { z } from 'zod';
import { AccessService, type Access } from '../auth/access.service';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import type { RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const TZ = 'Asia/Ho_Chi_Minh';
const n = (v: bigint | number | null | undefined | { toString(): string }) => Number(v ?? 0);
const VN = 7 * 3_600_000;
/** 00:00 hôm nay theo giờ VN, dạng thời điểm UTC */
function vnStartOfDay(d = new Date()) {
  const x = new Date(d.getTime() + VN);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()) - VN);
}
function vnStartOfMonth(d = new Date()) {
  const x = new Date(d.getTime() + VN);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1) - VN);
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(a: Access, branchId?: string) {
    if (branchId && !AccessService.canAccessBranch(a, branchId)) throw new ForbiddenException('Bạn không làm việc ở chi nhánh này');
    const branches = branchId ? [branchId] : a.branchIds === 'ALL' ? (await this.prisma.branch.findMany({ where: { tenantId: a.tenantId }, select: { id: true } })).map((b) => b.id) : a.branchIds;
    const money = a.permissions.includes('finance.view') || a.permissions.includes('ro.manage');
    const now = new Date();
    const today = vnStartOfDay(now);
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const month = vnStartOfMonth(now);
    const from30 = new Date(today.getTime() - 29 * 86_400_000);
    const t = a.tenantId;

    const [series, collected, open, overdue, debt, bookings, careDue, lowStock, newCustomers, top] = await Promise.all([
      // Doanh thu theo ngày (đơn đã giao, theo ngày giao)
      this.prisma.$queryRaw<{ d: Date; revenue: bigint; orders: bigint }[]>`
        -- delivered_at lưu giờ UTC không kèm múi giờ: đổi UTC → giờ VN rồi mới lấy ngày (thiếu bước 'UTC' sẽ lùi 14 tiếng)
        SELECT (delivered_at AT TIME ZONE 'UTC' AT TIME ZONE ${TZ})::date AS d, SUM(total) AS revenue, COUNT(*) AS orders
        FROM repair_orders
        WHERE tenant_id = ${t}::uuid AND status = 'DA_GIAO' AND delivered_at >= ${month < from30 ? month : from30} AND branch_id = ANY(${branches}::uuid[])
        GROUP BY 1 ORDER BY 1`,
      // Tiền đã thu (hôm nay / tháng này)
      this.prisma.$queryRaw<{ today: bigint; month: bigint }[]>`
        SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.paid_at >= ${today}), 0) AS today, COALESCE(SUM(p.amount), 0) AS month
        FROM payments p JOIN repair_orders o ON o.id = p.order_id
        WHERE p.tenant_id = ${t}::uuid AND p.voided_at IS NULL AND p.paid_at >= ${month} AND o.branch_id = ANY(${branches}::uuid[])`,
      this.prisma.repairOrder.groupBy({ by: ['status'], where: { tenantId: t, branchId: { in: branches }, status: { in: ['TIEP_NHAN', 'DANG_SUA', 'HOAN_THANH'] } }, _count: true }),
      this.prisma.repairOrder.count({ where: { tenantId: t, branchId: { in: branches }, status: { in: ['TIEP_NHAN', 'DANG_SUA'] }, promisedAt: { lt: now } } }),
      // Công nợ: đơn chưa thu đủ + nợ đầu kỳ còn lại
      this.prisma.$queryRaw<{ orders: bigint; opening: bigint }[]>`
        SELECT
          (SELECT COALESCE(SUM(total - paid), 0) FROM repair_orders WHERE tenant_id = ${t}::uuid AND status IN ('HOAN_THANH', 'DA_GIAO') AND total > paid AND branch_id = ANY(${branches}::uuid[])) AS orders,
          (SELECT COALESCE(SUM(GREATEST(c.opening_debt - COALESCE(e.paid, 0), 0)), 0) FROM customers c
             LEFT JOIN (SELECT customer_id, SUM(amount) AS paid FROM cash_entries WHERE tenant_id = ${t}::uuid AND category = 'THU_NO_DAU_KY' AND voided_at IS NULL GROUP BY 1) e ON e.customer_id = c.id
             WHERE c.tenant_id = ${t}::uuid AND c.deleted_at IS NULL AND c.opening_debt > 0 AND (${!branchId && a.branchIds === 'ALL'} OR c.branch_id = ANY(${branches}::uuid[]))) AS opening`,
      this.prisma.booking.findMany({
        where: { tenantId: t, branchId: { in: branches }, scheduledAt: { gte: today, lt: tomorrow }, status: { in: ['CHO_XAC_NHAN', 'DA_XAC_NHAN', 'DA_DEN'] } },
        orderBy: { scheduledAt: 'asc' },
        take: 8,
        include: { customer: { select: { name: true } }, vehicle: { select: { plateNo: true } } },
      }),
      this.prisma.careTask.count({
        where: { tenantId: t, status: { in: ['CAN_GOI', 'GOI_LAI'] }, dueDate: { lte: new Date(today.getTime() + VN) }, OR: [{ branchId: null }, { branchId: { in: branches } }] },
      }),
      this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM (
          SELECT p.id FROM products p
          LEFT JOIN stock_levels s ON s.product_id = p.id AND s.branch_id = ANY(${branches}::uuid[])
          WHERE p.tenant_id = ${t}::uuid AND p.deleted_at IS NULL AND p.active AND p.kind = 'PHU_TUNG' AND p.min_stock IS NOT NULL
          GROUP BY p.id, p.min_stock HAVING COALESCE(MIN(s.quantity), 0) <= p.min_stock) x`,
      this.prisma.customer.count({ where: { tenantId: t, deletedAt: null, createdAt: { gte: month }, importBatchId: null } }),
      // Hạng mục bán chạy tháng này
      this.prisma.$queryRaw<{ name: string; kind: string; revenue: bigint; qty: number }[]>`
        SELECT i.name, i.kind, SUM(i.amount) AS revenue, SUM(i.quantity)::float AS qty
        FROM order_items i JOIN repair_orders o ON o.id = i.order_id
        WHERE o.tenant_id = ${t}::uuid AND o.status = 'DA_GIAO' AND o.delivered_at >= ${month} AND o.branch_id = ANY(${branches}::uuid[])
        GROUP BY i.name, i.kind ORDER BY 3 DESC LIMIT 6`,
    ]);

    // Đủ 30 ngày, ngày không có doanh thu = 0
    const byDay = new Map(series.map((r) => [r.d.toISOString().slice(0, 10), r]));
    const days = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(from30.getTime() + VN + i * 86_400_000).toISOString().slice(0, 10);
      const r = byDay.get(d);
      return { date: d, revenue: n(r?.revenue), orders: n(r?.orders) };
    });
    const todayKey = new Date(today.getTime() + VN).toISOString().slice(0, 10);
    const monthKey = todayKey.slice(0, 7);
    const monthRows = series.filter((r) => r.d.toISOString().slice(0, 7) === monthKey);
    const counts = Object.fromEntries(open.map((o) => [o.status, o._count]));

    return {
      money,
      revenue: money
        ? {
            today: n(byDay.get(todayKey)?.revenue),
            month: monthRows.reduce((s, r) => s + n(r.revenue), 0),
            monthOrders: monthRows.reduce((s, r) => s + n(r.orders), 0),
            collectedToday: n(collected[0]?.today),
            collectedMonth: n(collected[0]?.month),
            debt: n(debt[0]?.orders) + n(debt[0]?.opening),
            days,
          }
        : null,
      orders: { TIEP_NHAN: counts.TIEP_NHAN ?? 0, DANG_SUA: counts.DANG_SUA ?? 0, HOAN_THANH: counts.HOAN_THANH ?? 0, overdue },
      bookingsToday: bookings.map((b) => ({ id: b.id, at: b.scheduledAt, status: b.status, customer: b.customer.name, plate: b.vehicle ? formatPlate(b.vehicle.plateNo) : null, service: b.service })),
      careDue,
      lowStock: n(lowStock[0]?.n),
      newCustomers,
      top: money ? top.map((r) => ({ name: r.name, kind: r.kind, revenue: n(r.revenue), qty: Number(r.qty) })) : [],
    };
  }
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dash: DashboardService) {}

  @RequirePermissions('dashboard.view')
  @Get()
  get(@CurrentAuth() auth: RequestAuth, @Query(new ZodPipe(z.object({ branchId: z.string().uuid().optional() }))) q: { branchId?: string }) {
    return this.dash.overview(auth.access, q.branchId);
  }
}

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
