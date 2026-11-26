export interface BranchKpiRow {
  branchId: string;
  code: string;
  name: string;
  ordersDelivered: number;
  roRevenue: number;
  partsCost: number;
  grossProfit: number;
  marginPct: number | null;
  collected: number;
  expense: number;
  slaOnTimePct: number | null;
  overdueOpen: number;
  avgRating: number | null;
  rentalRevenue: number;
  appraisalRevenue: number;
}

/** Tính tỉ lệ hoàn thành đúng hẹn SLA (%), làm tròn 0,1% */
export function computeSlaRate(onTimeCount: number, totalDelivered: number): number | null {
  if (totalDelivered <= 0) return null;
  const clamped = Math.max(0, Math.min(totalDelivered, onTimeCount));
  return Math.round((clamped / totalDelivered) * 1000) / 10;
}

/** Tính lợi nhuận gộp và biên lợi nhuận gộp (%) */
export function computeGrossMargin(revenue: number, partsCost: number): { grossProfit: number; marginPct: number | null } {
  const grossProfit = revenue - partsCost;
  if (revenue <= 0) return { grossProfit, marginPct: null };
  return {
    grossProfit,
    marginPct: Math.round((grossProfit / revenue) * 1000) / 10,
  };
}

/** Tính tỉ lệ chuyển đổi (%) */
export function computeRatePct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((Math.max(0, numerator) / denominator) * 1000) / 10;
}

/** Phân tích khách mới vs khách quay lại từ danh sách khách phát sinh đơn trong kỳ */
export function computeRetentionSummary(
  customers: { hadOrderBeforePeriod: boolean; ordersInPeriod: number }[],
): { activeCustomers: number; newCustomers: number; returningCustomers: number; returningRatePct: number } {
  const activeCustomers = customers.length;
  let returningCustomers = 0;
  for (const c of customers) {
    if (c.hadOrderBeforePeriod || c.ordersInPeriod >= 2) returningCustomers += 1;
  }
  const newCustomers = Math.max(0, activeCustomers - returningCustomers);
  return {
    activeCustomers,
    newCustomers,
    returningCustomers,
    returningRatePct: computeRatePct(returningCustomers, activeCustomers),
  };
}

/** Sắp xếp chuỗi chi nhánh theo tổng doanh thu (RO + thuê xe + kiểm định) giảm dần, sau đó theo SLA đúng hẹn */
export function rankBranchesByKpi<T extends { roRevenue: number; rentalRevenue: number; appraisalRevenue: number; slaOnTimePct: number | null; code: string }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const totA = a.roRevenue + a.rentalRevenue + a.appraisalRevenue;
    const totB = b.roRevenue + b.rentalRevenue + b.appraisalRevenue;
    if (totB !== totA) return totB - totA;
    const slaA = a.slaOnTimePct ?? -1;
    const slaB = b.slaOnTimePct ?? -1;
    if (slaB !== slaA) return slaB - slaA;
    return a.code.localeCompare(b.code, 'vi');
  });
}
