'use client';

import { Badge, Card, CardTitle, Spinner, Tabs } from '@cardiy/ui';
import { Banknote, CheckCircle2, ExternalLink, Eye, Inbox } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/crm';
import { OFFER_STATUS, type OfferStatus } from '@/lib/marketplace';

interface DayPoint {
  date: string;
  shopViews: number;
  offerViews: number;
  totalViews: number;
  requests: number;
  completed: number;
  revenue: number;
}

interface OfferStat {
  offerId: string;
  code: string;
  name: string;
  kind: 'PRODUCT' | 'SERVICE';
  status: OfferStatus;
  views: number;
  requests: number;
  completed: number;
  soldQty: number;
  closeRate: number | null;
  revenue: number;
}

interface StatsRes {
  periodDays: number;
  shop: { name: string; slug: string } | null;
  views: { total: number; shop: number; offers: number };
  requests: {
    total: number;
    completed: number;
    confirmed: number;
    pending: number;
    rejected: number;
    cancelled: number;
    expired: number;
    noShow: number;
  };
  rates: {
    closeRate: number | null;
    confirmRate: number | null;
    requestPerViewRate: number | null;
  };
  completedRevenue: number;
  rating: { avg: number; count: number } | null;
  days: DayPoint[];
  offers: OfferStat[];
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const pctText = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('vi-VN')}%`);

/** Biểu đồ cột SVG lượt xem & yêu cầu theo ngày (không dùng thư viện ngoài, kèm bảng sr-only) */
function ViewsRequestsChart({ days }: { days: DayPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => Math.max(d.totalViews, d.requests)));
  const W = 640;
  const H = 180;
  const gap = days.length > 40 ? 1.5 : 3;
  const bw = Math.max(2, W / days.length - gap);
  const h = hover !== null ? days[hover] : null;
  const step = days.length <= 10 ? 1 : days.length <= 35 ? 5 : 15;

  return (
    <div className="relative" data-testid="stats-chart">
      <div className="mb-1.5 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-400" /> Lượt xem
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand-600" /> Yêu cầu gửi tới
          </span>
        </div>
        <span>
          {h
            ? `${ddmm(h.date)} · ${h.totalViews} lượt xem · ${h.requests} yêu cầu · ${h.completed} hoàn tất`
            : 'Rê chuột lên cột để xem từng ngày'}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 20}`} className="w-full" role="img" aria-label="Lượt xem và yêu cầu theo ngày" onMouseLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={H - H * f} y2={H - H * f} className="stroke-slate-100" strokeWidth={1} />
        ))}
        <line x1={0} x2={W} y1={H} y2={H} className="stroke-slate-200" strokeWidth={1} />
        {days.map((d, i) => {
          const vh = d.totalViews ? Math.max(3, (d.totalViews / max) * (H - 6)) : 0;
          const rh = d.requests ? Math.max(3, (d.requests / max) * (H - 6)) : 0;
          const x = i * (bw + gap) + gap / 2;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)}>
              <rect x={x - gap / 2} y={0} width={bw + gap} height={H} fill="transparent" />
              {vh > 0 && (
                <rect
                  x={x}
                  y={H - vh}
                  width={bw}
                  height={vh}
                  rx={2}
                  className={hover === null || hover === i ? 'fill-sky-300' : 'fill-sky-100'}
                />
              )}
              {rh > 0 && (
                <rect
                  x={x + bw * 0.2}
                  y={H - rh}
                  width={Math.max(2, bw * 0.6)}
                  height={rh}
                  rx={1.5}
                  className={hover === null || hover === i ? 'fill-brand-600' : 'fill-brand-300'}
                />
              )}
              {i % step === step - 1 && (
                <text x={x + bw / 2} y={H + 14} textAnchor="middle" className="fill-slate-400 text-[10px]">
                  {ddmm(d.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>Thống kê lượt xem và yêu cầu theo ngày</caption>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.totalViews}</td>
              <td>{d.requests}</td>
              <td>{d.completed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Thống kê gian hàng (A7.30 cho Đối tác, A3.57 cho PLG): lượt xem, số yêu cầu, tỉ lệ chốt.
 */
export function SellerStats() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const [data, setData] = useState<StatsRes | null>(null);

  const load = useCallback(() => api<StatsRes>(`/seller/stats?days=${days}`).then(setData), [days]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          tabs={[
            { value: '7', label: '7 ngày qua' },
            { value: '30', label: '30 ngày qua' },
            { value: '90', label: '90 ngày qua' },
          ]}
          value={days}
          onChange={setDays}
        />
        <div className="flex-1" />
        {data?.shop && (
          <a
            href={`/cho/garage/${data.shop.slug}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
          >
            Xem gian hàng trên sàn <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {!data ? (
        <div className="grid place-items-center p-12">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <Card className="p-4 sm:p-5" data-testid="stat-views">
              <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                <span>Lượt xem</span>
                <Eye className="h-4 w-4 text-slate-400" />
              </div>
              <div className="mt-3 text-2xl font-semibold tabular-nums" data-testid="stat-views-value">
                {data.views.total.toLocaleString('vi-VN')}
              </div>
              <div className="mt-1.5 text-xs text-slate-500">
                {data.views.shop.toLocaleString('vi-VN')} trang garage · {data.views.offers.toLocaleString('vi-VN')} tin đăng
              </div>
            </Card>

            <Card className="p-4 sm:p-5" data-testid="stat-requests">
              <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                <span>Số yêu cầu</span>
                <Inbox className="h-4 w-4 text-slate-400" />
              </div>
              <div className="mt-3 text-2xl font-semibold tabular-nums" data-testid="stat-requests-value">
                {data.requests.total.toLocaleString('vi-VN')}
              </div>
              <div className="mt-1.5 text-xs text-slate-500">
                {data.requests.completed} hoàn tất · {data.requests.pending + data.requests.confirmed} đang xử lý
              </div>
            </Card>

            <Card className="p-4 sm:p-5" data-testid="stat-close-rate">
              <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                <span>Tỉ lệ chốt</span>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="mt-3 text-2xl font-semibold tabular-nums text-emerald-700" data-testid="stat-close-rate-value">
                {pctText(data.rates.closeRate)}
              </div>
              <div className="mt-1.5 text-xs text-slate-500">
                Xác nhận: {pctText(data.rates.confirmRate)} · Yêu cầu/xem: {pctText(data.rates.requestPerViewRate)}
              </div>
            </Card>

            <Card className="p-4 sm:p-5" data-testid="stat-revenue">
              <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                <span>Giá trị chốt qua sàn</span>
                <Banknote className="h-4 w-4 text-slate-400" />
              </div>
              <div className="mt-3 text-2xl font-semibold tabular-nums" data-testid="stat-revenue-value">
                {fmtMoney(data.completedRevenue)}
              </div>
              <div className="mt-1.5 text-xs text-slate-500">
                Đánh giá: {data.rating ? `${data.rating.avg.toLocaleString('vi-VN')}★ (${data.rating.count})` : 'chưa có'}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="p-5 xl:col-span-2">
              <CardTitle className="mb-3">Diễn biến {data.periodDays} ngày gần đây</CardTitle>
              <ViewsRequestsChart days={data.days} />
            </Card>

            <Card className="p-5" data-testid="request-breakdown">
              <CardTitle className="mb-3">Phân loại yêu cầu trong kỳ</CardTitle>
              <dl className="space-y-2 text-sm">
                {[
                  { label: 'Hoàn tất (đã chốt)', value: data.requests.completed, cls: 'font-semibold text-emerald-700' },
                  { label: 'Đã xác nhận (chờ khách đến)', value: data.requests.confirmed, cls: 'text-brand-700' },
                  { label: 'Đang chờ xác nhận', value: data.requests.pending, cls: 'text-sky-700' },
                  { label: 'Garage từ chối', value: data.requests.rejected, cls: 'text-rose-600' },
                  { label: 'Khách tự huỷ', value: data.requests.cancelled, cls: 'text-slate-600' },
                  { label: 'Quá 24h chưa phản hồi', value: data.requests.expired, cls: 'text-slate-500' },
                  { label: 'Khách không đến', value: data.requests.noShow, cls: 'text-peach-700' },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between border-b border-slate-50 pb-1.5 last:border-0">
                    <dt className="text-slate-600">{row.label}</dt>
                    <dd className={`tabular-nums ${row.cls}`}>{row.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-slate-400">
                Tỉ lệ chốt = số yêu cầu hoàn tất ÷ tổng số yêu cầu khách gửi trong kỳ. Tiền hàng khách thanh toán trực tiếp tại garage.
              </p>
            </Card>
          </div>

          <Card className="overflow-x-auto">
            <div className="border-b border-slate-100 px-5 py-4">
              <CardTitle>Hiệu quả từng tin đăng</CardTitle>
            </div>
            <table className="w-full text-sm" data-testid="offer-stats-table">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-semibold">Sản phẩm / dịch vụ</th>
                  <th className="px-3 py-3 font-semibold">Trạng thái</th>
                  <th className="px-3 py-3 text-right font-semibold">Lượt xem</th>
                  <th className="px-3 py-3 text-right font-semibold">Yêu cầu</th>
                  <th className="px-3 py-3 text-right font-semibold">Hoàn tất</th>
                  <th className="px-3 py-3 text-right font-semibold">Tỉ lệ chốt</th>
                  <th className="px-5 py-3 text-right font-semibold">Giá trị chốt</th>
                </tr>
              </thead>
              <tbody>
                {data.offers.map((o) => {
                  const st = OFFER_STATUS[o.status] ?? { label: o.status, tone: 'slate' as const };
                  return (
                    <tr key={o.offerId} className="border-b border-slate-50 last:border-0" data-testid="offer-stat-row">
                      <td className="px-5 py-3">
                        <div className="font-medium">{o.name}</div>
                        <div className="text-xs text-slate-500">
                          {o.code} · {o.kind === 'PRODUCT' ? 'Sản phẩm' : 'Dịch vụ'}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{o.views.toLocaleString('vi-VN')}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{o.requests}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-medium text-emerald-700">{o.completed}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{pctText(o.closeRate)}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-medium">{o.revenue ? fmtMoney(o.revenue) : '—'}</td>
                    </tr>
                  );
                })}
                {!data.offers.length && (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-slate-500">
                      Chưa có tin đăng nào trên sàn.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
