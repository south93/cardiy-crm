'use client';

import { Alert, Badge, Card, CardTitle, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import { AlertTriangle, Award, Banknote, Building2, CheckCircle2, Star, TrendingUp, Users, Warehouse, Wrench } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { defaultReportRange, fmtPct, type GarageReportResponse } from '@/lib/community';
import { fmtMoney } from '@/lib/crm';

/** A3.80 · M30 Báo cáo vận hành & So sánh KPI / SLA chuỗi chi nhánh Garage PLG */
export default function GarageReportsPage() {
  return (
    <RequirePermission permission="report.view">
      <GarageReportsBody />
    </RequirePermission>
  );
}

function GarageReportsBody() {
  const init = defaultReportRange(30);
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [branchId, setBranchId] = useState('');
  const [tab, setTab] = useState<'branches' | 'technicians' | 'inventory' | 'retention' | 'marketplace'>('branches');
  const [data, setData] = useState<GarageReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyPreset = (days: number) => {
    const r = defaultReportRange(days);
    setFrom(r.from);
    setTo(r.to);
  };

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ from, to });
      if (branchId) qs.set('branchId', branchId);
      const res = await api<GarageReportResponse>(`/reports/garage?${qs}`);
      setData(res);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được báo cáo vận hành');
    }
  }, [from, to, branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const maxBranchRev = Math.max(1, ...(data?.branchComparison.map((b) => b.roRevenue) ?? [1]));

  return (
    <div className="space-y-4" data-testid="garage-reports-page">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { d: 7, lb: '7 ngày' },
            { d: 30, lb: '30 ngày' },
            { d: 90, lb: '90 ngày' },
          ].map((p) => (
            <button
              key={p.d}
              type="button"
              onClick={() => applyPreset(p.d)}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-brand-300 hover:bg-white"
            >
              {p.lb}
            </button>
          ))}
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Từ ngày" className="w-38 bg-white" />
          <span className="text-xs text-slate-400">→</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Đến ngày" className="w-38 bg-white" />
        </div>

        {data && (
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-slate-400" />
            <Select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              aria-label="Phạm vi chi nhánh"
              className="w-60 bg-white"
              data-testid="report-branch-select"
            >
              {data.branches.length > 1 && <option value="">Toàn chuỗi ({data.branches.length} chi nhánh)</option>}
              {data.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} · {b.name}
                </option>
              ))}
            </Select>
          </div>
        )}
      </Card>

      {error && <Alert>{error}</Alert>}

      {!data ? (
        <div className="grid place-items-center p-12">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="garage-report-kpis">
            <Card className="p-4 sm:p-5" data-testid="kpi-ro-revenue">
              <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                <span>Doanh thu sửa chữa (RO)</span>
                <TrendingUp className="h-4 w-4 text-brand-600" />
              </div>
              <div className="mt-2.5 text-2xl font-bold tabular-nums text-slate-900">{fmtMoney(data.summary.roRevenue)}</div>
              <div className="mt-1 text-xs text-slate-500">
                Lãi gộp ước tính: <b className="text-emerald-700">{fmtMoney(data.summary.grossProfit)}</b> ({fmtPct(data.summary.marginPct)})
              </div>
            </Card>

            <Card className="p-4 sm:p-5" data-testid="kpi-sla">
              <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                <span>SLA giao xe đúng hẹn</span>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="mt-2.5 text-2xl font-bold tabular-nums text-emerald-700">{fmtPct(data.summary.slaOnTimePct)}</div>
              <div className="mt-1 text-xs text-slate-500">
                {data.summary.ordersDelivered} xe đã giao ·{' '}
                <span className={data.summary.overdueOpen > 0 ? 'font-semibold text-rose-600' : ''}>
                  {data.summary.overdueOpen} xe đang trễ hẹn
                </span>
              </div>
            </Card>

            <Card className="p-4 sm:p-5" data-testid="kpi-cashflow">
              <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                <span>Thực thu trong kỳ</span>
                <Banknote className="h-4 w-4 text-sky-600" />
              </div>
              <div className="mt-2.5 text-2xl font-bold tabular-nums text-slate-900">{fmtMoney(data.summary.collected)}</div>
              <div className="mt-1 text-xs text-slate-500">
                Thực chi: {fmtMoney(data.summary.expense)} · Dòng tiền ròng: <b>{fmtMoney(data.summary.netCash)}</b>
              </div>
            </Card>

            <Card className="p-4 sm:p-5" data-testid="kpi-retention">
              <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                <span>Tỉ lệ khách quay lại</span>
                <Users className="h-4 w-4 text-indigo-600" />
              </div>
              <div className="mt-2.5 text-2xl font-bold tabular-nums text-indigo-700">{fmtPct(data.summary.returningRatePct)}</div>
              <div className="mt-1 text-xs text-slate-500">
                Thuê xe: {fmtMoney(data.summary.rentalRevenue)} · Kiểm định: {fmtMoney(data.summary.appraisalRevenue)}
              </div>
            </Card>
          </div>

          <Tabs
            tabs={[
              { value: 'branches', label: `Chuỗi chi nhánh & SLA (${data.branchComparison.length})` },
              { value: 'technicians', label: `Năng suất KTV (${data.technicians.length})` },
              { value: 'inventory', label: `Tồn kho & Vật tư (${data.inventory.lowStockCount} cảnh báo)` },
              { value: 'retention', label: 'Khách quay lại & Công nợ' },
              { value: 'marketplace', label: 'Kênh Sàn & Dịch vụ mở rộng' },
            ]}
            value={tab}
            onChange={setTab}
          />

          {tab === 'branches' && (
            <div className="space-y-4">
              <Card className="space-y-3 p-5">
                <CardTitle>Biểu đồ so sánh doanh thu RO & SLA giữa các chi nhánh</CardTitle>
                <div className="space-y-2.5">
                  {data.branchComparison.map((b) => {
                    const widthPct = Math.max(4, Math.round((b.roRevenue / maxBranchRev) * 100));
                    return (
                      <div key={b.branchId} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-800">
                            #{b.rank} {b.code} · {b.name}
                          </span>
                          <span className="tabular-nums text-slate-600">
                            {fmtMoney(b.roRevenue)} · SLA {fmtPct(b.slaOnTimePct)}
                          </span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-brand-600" style={{ width: `${widthPct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>

              <Card className="overflow-x-auto p-0">
                <table className="w-full text-left text-sm" data-testid="branch-kpi-table">
                  <thead className="border-b border-slate-100 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Hạng</th>
                      <th className="px-4 py-3">Chi nhánh</th>
                      <th className="px-3 py-3 text-right">Xe giao</th>
                      <th className="px-3 py-3 text-right">Doanh thu RO</th>
                      <th className="px-3 py-3 text-right">Lãi gộp (Biên)</th>
                      <th className="px-3 py-3 text-right">Thực thu / Chi</th>
                      <th className="px-3 py-3 text-right">SLA đúng hẹn</th>
                      <th className="px-3 py-3 text-right">Đang trễ</th>
                      <th className="px-3 py-3 text-right">Đánh giá</th>
                      <th className="px-4 py-3 text-right">Thuê xe & KĐ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.branchComparison.map((b) => (
                      <tr key={b.branchId} data-testid="branch-kpi-row">
                        <td className="px-4 py-3">
                          <Badge tone={b.rank === 1 ? 'brand' : 'slate'}>
                            <Award className="h-3 w-3" /> #{b.rank}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{b.name}</div>
                          <div className="font-mono text-xs text-slate-500">{b.code}</div>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums font-medium">{b.ordersDelivered}</td>
                        <td className="px-3 py-3 text-right tabular-nums font-semibold">{fmtMoney(b.roRevenue)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          <div className="font-medium text-emerald-700">{fmtMoney(b.grossProfit)}</div>
                          <div className="text-xs text-slate-500">{fmtPct(b.marginPct)}</div>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-xs">
                          <div className="font-medium text-sky-700">+{fmtMoney(b.collected)}</div>
                          <div className="text-rose-600">-{fmtMoney(b.expense)}</div>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          <Badge tone={b.slaOnTimePct === null ? 'slate' : b.slaOnTimePct >= 85 ? 'mint' : 'peach'}>
                            {fmtPct(b.slaOnTimePct)}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {b.overdueOpen > 0 ? <Badge tone="rose">{b.overdueOpen} xe</Badge> : <span className="text-slate-400">0</span>}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {b.avgRating !== null ? (
                            <span className="inline-flex items-center gap-0.5 font-medium text-amber-600">
                              {b.avgRating} <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-xs">
                          {fmtMoney(b.rentalRevenue + b.appraisalRevenue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          )}

          {tab === 'technicians' && (
            <Card className="overflow-x-auto p-0">
              <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
                <Wrench className="h-4 w-4 text-brand-600" />
                <CardTitle>Hiệu suất Kỹ thuật viên trong kỳ</CardTitle>
              </div>
              <table className="w-full text-left text-sm" data-testid="tech-kpi-table">
                <thead className="border-b border-slate-100 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Kỹ thuật viên</th>
                    <th className="px-3 py-3 text-right">Đơn phụ trách</th>
                    <th className="px-3 py-3 text-right">Đơn hoàn tất</th>
                    <th className="px-3 py-3 text-right">SLA đúng hẹn</th>
                    <th className="px-3 py-3 text-right">Xe cũ đã kiểm định</th>
                    <th className="px-5 py-3 text-right">Doanh thu đơn tham gia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.technicians.map((t) => (
                    <tr key={t.membershipId} data-testid="tech-kpi-row">
                      <td className="px-5 py-3">
                        <div className="font-semibold text-slate-900">{t.fullName}</div>
                        <div className="text-xs text-slate-500">{t.phone}</div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{t.ordersAssigned}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold text-emerald-700">{t.ordersCompleted}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{fmtPct(t.slaOnTimePct)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{t.appraisalsCompleted}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-medium">{fmtMoney(t.revenueContributed)}</td>
                    </tr>
                  ))}
                  {!data.technicians.length && (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                        Chưa có dữ liệu kỹ thuật viên ở phạm vi chi nhánh này.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>
          )}

          {tab === 'inventory' && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Card className="p-4">
                  <div className="text-xs text-slate-500">Danh mục phụ tùng hoạt động</div>
                  <div className="mt-1 text-xl font-bold tabular-nums">{data.inventory.activeParts} mã</div>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Warehouse className="h-3.5 w-3.5" /> Giá trị tồn kho (theo giá vốn)
                  </div>
                  <div className="mt-1 text-xl font-bold tabular-nums text-brand-700">{fmtMoney(data.inventory.stockCostValue)}</div>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-1.5 text-xs text-rose-600">
                    <AlertTriangle className="h-3.5 w-3.5" /> Chạm / dưới định mức tồn tối thiểu
                  </div>
                  <div className="mt-1 text-xl font-bold tabular-nums text-rose-700">{data.inventory.lowStockCount} mục</div>
                </Card>
              </div>

              <Card className="overflow-x-auto p-0">
                <div className="border-b border-slate-100 px-5 py-3.5">
                  <CardTitle>Danh sách phụ tùng cần nhập bổ sung</CardTitle>
                </div>
                <table className="w-full text-left text-sm" data-testid="low-stock-table">
                  <thead className="border-b border-slate-100 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Chi nhánh</th>
                      <th className="px-3 py-3">Mã / Tên phụ tùng</th>
                      <th className="px-3 py-3 text-right">Tồn hiện tại</th>
                      <th className="px-5 py-3 text-right">Định mức tối thiểu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.inventory.lowStockItems.map((it, idx) => (
                      <tr key={`${it.branchCode}-${it.code}-${idx}`}>
                        <td className="px-5 py-2.5 font-mono text-xs font-semibold">{it.branchCode}</td>
                        <td className="px-3 py-2.5">
                          <span className="font-mono text-xs text-slate-500">{it.code}</span> · <span className="font-medium">{it.name}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold text-rose-600 tabular-nums">
                          {it.onHand} {it.unit ?? ''}
                        </td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-slate-600">
                          {it.minStock} {it.unit ?? ''}
                        </td>
                      </tr>
                    ))}
                    {!data.inventory.lowStockItems.length && (
                      <tr>
                        <td colSpan={4} className="px-5 py-8 text-center text-slate-500">
                          Tất cả phụ tùng đều đảm bảo trên định mức tối thiểu.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </Card>
            </div>
          )}

          {tab === 'retention' && (
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="space-y-3 p-5" data-testid="retention-card">
                <CardTitle>Phân tích tệp khách hàng giao xe trong kỳ</CardTitle>
                <dl className="divide-y divide-slate-100 text-sm">
                  <div className="flex justify-between py-2.5">
                    <dt className="text-slate-600">Tổng khách hàng có đơn hoàn tất</dt>
                    <dd className="font-semibold tabular-nums">{data.retention.activeCustomers} khách</dd>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <dt className="text-slate-600">Khách mới đến lần đầu</dt>
                    <dd className="font-medium text-sky-700 tabular-nums">{data.retention.newCustomers} khách</dd>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <dt className="text-slate-600">Khách cũ quay lại bảo dưỡng / sửa chữa</dt>
                    <dd className="font-semibold text-emerald-700 tabular-nums">{data.retention.returningCustomers} khách</dd>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <dt className="text-slate-600">Tỉ lệ giữ chân khách hàng</dt>
                    <dd className="font-bold text-indigo-700 tabular-nums">{fmtPct(data.retention.returningRatePct)}</dd>
                  </div>
                </dl>
              </Card>

              <Card className="space-y-3 p-5">
                <CardTitle>Tổng hợp công nợ khách hàng hiện tại</CardTitle>
                <div className="rounded-2xl bg-amber-50 p-4">
                  <div className="text-xs text-amber-800">Tổng dư nợ phải thu khách hàng (đơn nợ + công nợ đầu kỳ)</div>
                  <div className="mt-1 text-2xl font-bold text-amber-900 tabular-nums">{fmtMoney(data.retention.totalReceivable)}</div>
                </div>
                <p className="text-xs text-slate-500">
                  Để đối chiếu chi tiết từng khách nợ và lập phiếu thu công nợ, truy cập mục <b>Thu chi & công nợ</b>.
                </p>
              </Card>
            </div>
          )}

          {tab === 'marketplace' && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="garage-market-summary">
              <Card className="p-4">
                <div className="text-xs text-slate-500">Lượt xem gian hàng trên sàn</div>
                <div className="mt-1.5 text-xl font-bold tabular-nums">{data.marketplace.views.toLocaleString('vi-VN')}</div>
              </Card>
              <Card className="p-4">
                <div className="text-xs text-slate-500">Yêu cầu đặt hàng / đặt lịch</div>
                <div className="mt-1.5 text-xl font-bold tabular-nums">
                  {data.marketplace.requestsCompleted}/{data.marketplace.requestsTotal} ({fmtPct(data.marketplace.conversionPct)})
                </div>
              </Card>
              <Card className="p-4">
                <div className="text-xs text-slate-500">Giá trị đơn chốt qua sàn</div>
                <div className="mt-1.5 text-xl font-bold text-emerald-700 tabular-nums">{fmtMoney(data.marketplace.marketRevenue)}</div>
              </Card>
              <Card className="p-4">
                <div className="text-xs text-slate-500">Dịch vụ mở rộng hoàn tất</div>
                <div className="mt-1.5 text-sm font-semibold text-slate-800">
                  SOS: {data.marketplace.sosCompleted} · Thuê xe: {data.marketplace.rentalsSettled} · Kiểm định: {data.marketplace.appraisalsCompleted}
                </div>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
