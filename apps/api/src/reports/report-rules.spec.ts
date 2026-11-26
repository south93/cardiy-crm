import {
  computeGrossMargin,
  computeRatePct,
  computeRetentionSummary,
  computeSlaRate,
  rankBranchesByKpi,
} from './report-rules';

describe('Quy tắc KPI & SLA Chuỗi chi nhánh & Báo cáo sàn (Vòng 4.4 — M30)', () => {
  it('tính tỉ lệ giao đúng hẹn SLA và biên lợi nhuận gộp chính xác', () => {
    expect(computeSlaRate(0, 0)).toBeNull();
    expect(computeSlaRate(18, 20)).toBe(90);
    expect(computeSlaRate(2, 3)).toBe(66.7);

    expect(computeGrossMargin(10_000_000, 6_500_000)).toEqual({
      grossProfit: 3_500_000,
      marginPct: 35,
    });
    expect(computeGrossMargin(0, 0)).toEqual({
      grossProfit: 0,
      marginPct: null,
    });
  });

  it('phân loại khách mới và khách quay lại (đã từng sửa trước kỳ hoặc >= 2 đơn trong kỳ)', () => {
    const res = computeRetentionSummary([
      { hadOrderBeforePeriod: true, ordersInPeriod: 1 },
      { hadOrderBeforePeriod: false, ordersInPeriod: 2 },
      { hadOrderBeforePeriod: false, ordersInPeriod: 1 },
      { hadOrderBeforePeriod: false, ordersInPeriod: 1 },
    ]);
    expect(res).toEqual({
      activeCustomers: 4,
      newCustomers: 2,
      returningCustomers: 2,
      returningRatePct: 50,
    });
    expect(computeRatePct(3, 8)).toBe(37.5);
  });

  it('xếp hạng các chi nhánh theo tổng doanh thu kết hợp SLA đúng hẹn', () => {
    const ranked = rankBranchesByKpi([
      { code: 'CN2', roRevenue: 40_000_000, rentalRevenue: 0, appraisalRevenue: 0, slaOnTimePct: 95 },
      { code: 'CN1', roRevenue: 50_000_000, rentalRevenue: 5_000_000, appraisalRevenue: 1_200_000, slaOnTimePct: 88 },
      { code: 'CN3', roRevenue: 40_000_000, rentalRevenue: 0, appraisalRevenue: 0, slaOnTimePct: 100 },
    ]);
    expect(ranked.map((r) => r.code)).toEqual(['CN1', 'CN3', 'CN2']);
  });
});
