'use client';

import { Alert, Badge, Card, CardTitle, Input, Spinner } from '@cardiy/ui';
import { Building2, Car, CarFront, Eye, Flag, Headphones, Inbox, LifeBuoy, Receipt } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { defaultReportRange, fmtPct, type PlatformReportOverviewResponse } from '@/lib/community';
import { fmtMoney } from '@/lib/crm';

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function PlatformDailyChart({ series }: { series: { date: string; views: number; requests: number }[] }) {
  const max = Math.max(1, ...series.map((d) => Math.max(d.views, d.requests)));
  const W = 640;
  const H = 160;
  const gap = 3;
  const bw = Math.max(3, W / Math.max(1, series.length) - gap);
  const step = series.length <= 10 ? 1 : 5;

  return (
    <div data-testid="platform-daily-chart">
      <div className="mb-2 flex items-center gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-300" /> Lượt xem toàn sàn
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand-600" /> Yêu cầu đặt hàng/lịch
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 20}`} className="w-full" role="img" aria-label="Biểu đồ lưu lượng và yêu cầu toàn sàn">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={H - H * f} y2={H - H * f} className="stroke-slate-100" strokeWidth={1} />
        ))}
        <line x1={0} x2={W} y1={H} y2={H} className="stroke-slate-200" strokeWidth={1} />
        {series.map((d, i) => {
          const vh = d.views ? Math.max(3, (d.views / max) * (H - 6)) : 0;
          const rh = d.requests ? Math.max(3, (d.requests / max) * (H - 6)) : 0;
          const x = i * (bw + gap) + gap / 2;
          return (
            <g key={d.date}>
              {vh > 0 && <rect x={x} y={H - vh} width={bw} height={vh} rx={2} className="fill-sky-300" />}
              {rh > 0 && <rect x={x + bw * 0.2} y={H - rh} width={Math.max(2, bw * 0.6)} height={rh} rx={1.5} className="fill-brand-600" />}
              {i % step === step - 1 && (
                <text x={x + bw / 2} y={H + 14} textAnchor="middle" className="fill-slate-400 text-[10px]">
                  {ddmm(d.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** A6.01 Dashboard sàn & A6.80 Báo cáo vận hành toàn sàn */
export default function PlatformReportsOverviewPage() {
  return (
    <RequirePermission permission="platform.report.view">
      <PlatformReportsBody />
    </RequirePermission>
  );
}

function PlatformReportsBody() {
  const init = defaultReportRange(30);
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [data, setData] = useState<PlatformReportOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyPreset = (days: number) => {
    const r = defaultReportRange(days);
    setFrom(r.from);
    setTo(r.to);
  };

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ from, to });
      const res = await api<PlatformReportOverviewResponse>(`/platform/reports/overview?${qs}`);
      setData(res);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được báo cáo toàn sàn');
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4" data-testid="platform-reports-page">
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
        <span className="text-xs text-slate-500">Tổng hợp toàn bộ hệ sinh thái Sàn CARDIY</span>
      </Card>

      {error && <Alert>{error}</Alert>}

      {!data ? (
        <div className="grid place-items-center p-12">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="platform-report-kpis">
            <Card className="p-4 sm:p-5" data-testid="platform-kpi-views">
              <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                <span>Lưu lượng xem toàn sàn</span>
                <Eye className="h-4 w-4 text-sky-600" />
              </div>
              <div className="mt-2.5 text-2xl font-bold tabular-nums">{data.kpis.totalViews.toLocaleString('vi-VN')}</div>
              <div className="mt-1 text-xs text-slate-500">Lượt xem gian hàng & tin đăng trong kỳ</div>
            </Card>

            <Card className="p-4 sm:p-5" data-testid="platform-kpi-gmv">
              <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                <span>GMV kết nối qua sàn</span>
                <Inbox className="h-4 w-4 text-brand-600" />
              </div>
              <div className="mt-2.5 text-2xl font-bold tabular-nums text-emerald-700">
                {fmtMoney(data.kpis.orderRequests.connectedGmv)}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {data.kpis.orderRequests.completed}/{data.kpis.orderRequests.total} yêu cầu hoàn tất ({fmtPct(data.kpis.orderRequests.conversionPct)})
              </div>
            </Card>

            <Card className="p-4 sm:p-5" data-testid="platform-kpi-partners">
              <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                <span>Đối tác Garage</span>
                <Building2 className="h-4 w-4 text-indigo-600" />
              </div>
              <div className="mt-2.5 text-2xl font-bold tabular-nums">{data.kpis.partners.active} hoạt động</div>
              <div className="mt-1 text-xs text-slate-500">
                +{data.kpis.partners.newInPeriod} mới · {data.kpis.partners.pendingApplications} hồ sơ chờ duyệt
              </div>
            </Card>

            <Card className="p-4 sm:p-5" data-testid="platform-kpi-fees">
              <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                <span>Phí đối tác thu về</span>
                <Receipt className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="mt-2.5 text-2xl font-bold tabular-nums">{fmtMoney(data.kpis.platformFee.collectedInPeriod)}</div>
              <div className="mt-1 text-xs text-slate-500">
                Chưa thu: {fmtMoney(data.kpis.platformFee.unpaidTotal)} ({data.kpis.platformFee.overdueCount} quá hạn)
              </div>
            </Card>
          </div>

          {/* Lưới giám sát các phân hệ mở rộng */}
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="platform-domain-cards">
            <Card className="space-y-1.5 p-4">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-700">
                <LifeBuoy className="h-4 w-4" /> Cứu hộ SOS 24/7
              </div>
              <div className="text-lg font-bold tabular-nums">
                {data.kpis.sos.completedInPeriod}/{data.kpis.sos.totalInPeriod} ca xong
              </div>
              <div className="text-xs text-slate-500">
                Nhận ca: {fmtPct(data.kpis.sos.acceptRatePct)} · Trống garage: {data.kpis.sos.noGarageCount}
              </div>
            </Card>

            <Card className="space-y-1.5 p-4">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                <CarFront className="h-4 w-4" /> Thuê xe tự lái
              </div>
              <div className="text-lg font-bold tabular-nums">{data.kpis.rentals.activeVehicles} xe mở thuê</div>
              <div className="text-xs text-slate-500">
                {data.kpis.rentals.contractsInPeriod} hợp đồng · {data.kpis.rentals.settledInPeriod} quyết toán
              </div>
            </Card>

            <Card className="space-y-1.5 p-4">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700">
                <Car className="h-4 w-4" /> Xe cũ & Kiểm định
              </div>
              <div className="text-lg font-bold tabular-nums">{data.kpis.usedCars.activeListings} tin đang bán</div>
              <div className="text-xs text-slate-500">
                {data.kpis.usedCars.verifiedListings} xe có kiểm định · {data.kpis.usedCars.appraisalsCompleted} phiếu xong
              </div>
            </Card>

            <Card className="space-y-1.5 p-4">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-700">
                <Headphones className="h-4 w-4" /> Cộng đồng chủ xe
              </div>
              <div className="text-lg font-bold tabular-nums">{data.kpis.community.publishedPosts} bài hiển thị</div>
              <div className="text-xs text-slate-500">
                <Link href="/san/cong-dong" className="font-medium text-brand-700 hover:underline">
                  {data.kpis.community.pendingPosts} chờ duyệt
                </Link>{' '}
                · {data.kpis.community.commentsInPeriod} bình luận
              </div>
            </Card>

            <Card className="space-y-1.5 p-4">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                <Flag className="h-4 w-4" /> Giám sát chất lượng
              </div>
              <div className="text-lg font-bold tabular-nums">{data.kpis.moderation.openReports} phản ánh mở</div>
              <div className="text-xs text-slate-500">{data.kpis.moderation.violationsInPeriod} xử lý vi phạm trong kỳ</div>
            </Card>
          </div>

          <Card className="p-5">
            <CardTitle className="mb-3">Diễn biến lưu lượng & yêu cầu trên sàn theo ngày</CardTitle>
            <PlatformDailyChart series={data.dailySeries} />
          </Card>

          <Card className="overflow-x-auto p-0">
            <div className="border-b border-slate-100 px-5 py-4">
              <CardTitle>Bảng xếp hạng Gian hàng Garage sôi nổi trên sàn</CardTitle>
            </div>
            <table className="w-full text-left text-sm" data-testid="platform-top-shops-table">
              <thead className="border-b border-slate-100 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3">Gian hàng Garage</th>
                  <th className="px-3 py-3">Mô hình</th>
                  <th className="px-3 py-3 text-right">Lượt xem</th>
                  <th className="px-3 py-3 text-right">Yêu cầu</th>
                  <th className="px-3 py-3 text-right">Hoàn tất</th>
                  <th className="px-3 py-3 text-right">Ca SOS xong</th>
                  <th className="px-5 py-3 text-right">GMV kết nối</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.topShops.map((s) => (
                  <tr key={s.tenantId} data-testid="platform-top-shop-row">
                    <td className="px-5 py-3">
                      <div className="font-semibold text-slate-900">{s.name}</div>
                      {s.slug && <div className="font-mono text-xs text-slate-400">/cho/garage/{s.slug}</div>}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={s.tenantType === 'GARAGE' ? 'brand' : 'sky'}>
                        {s.tenantType === 'GARAGE' ? 'Chuỗi PLG' : 'Đối tác'}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{s.views.toLocaleString('vi-VN')}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{s.requests}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-semibold text-emerald-700">{s.completed}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{s.sosCompleted}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-medium">{fmtMoney(s.gmv)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
