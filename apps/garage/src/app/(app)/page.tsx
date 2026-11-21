'use client';

import { Badge, Card, CardTitle, Select, Spinner } from '@cardiy/ui';
import { AlarmClock, Banknote, CalendarDays, Car, HandCoins, PackageX, PhoneCall, Receipt, UserPlus, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { SystemStatus } from '@/components/system-status';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { BOOKING_STATUS, hhmm, type BookingStatus } from '@/lib/bookings';
import { fmtMoney } from '@/lib/crm';
import { homeFor } from '@/lib/nav';

interface Overview {
  money: boolean;
  revenue: { today: number; month: number; monthOrders: number; collectedToday: number; collectedMonth: number; debt: number; days: { date: string; revenue: number; orders: number }[] } | null;
  orders: { TIEP_NHAN: number; DANG_SUA: number; HOAN_THANH: number; overdue: number };
  bookingsToday: { id: string; at: string; status: BookingStatus; customer: string; plate: string | null; service: string }[];
  careDue: number;
  lowStock: number;
  newCustomers: number;
  top: { name: string; kind: string; revenue: number; qty: number }[];
}

/** 1.250.000.000 → "1,25 tỷ"; 3.400.000 → "3,4 tr" */
function compact(v: number) {
  if (v >= 1e9) return `${(v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tỷ`;
  if (v >= 1e6) return `${(v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr`;
  if (v >= 1e3) return `${Math.round(v / 1e3).toLocaleString('vi-VN')} k`;
  return v.toLocaleString('vi-VN');
}
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function Kpi({ title, value, note, icon: Icon, href, testid }: { title: string; value: string; note?: ReactNode; icon: typeof Banknote; href?: string; testid?: string }) {
  const body = (
    <Card className="h-full p-4 transition hover:shadow-md sm:p-5" data-testid={testid}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700 sm:text-base">{title}</span>
        <span className="hidden h-9 w-9 shrink-0 place-items-center rounded-full border border-slate-100 bg-white sm:grid">
          <Icon className="h-4 w-4 text-slate-500" />
        </span>
      </div>
      <div className="mt-3 text-xl font-semibold leading-none tabular-nums sm:mt-4 sm:text-[28px]">{value}</div>
      {note && <div className="mt-2 text-xs text-slate-500">{note}</div>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

/** Doanh thu 30 ngày: một chuỗi số liệu → cột mảnh một màu, trục mờ, rê chuột xem từng ngày; có bảng ẩn cho trình đọc màn hình */
function RevenueChart({ days }: { days: { date: string; revenue: number; orders: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.revenue));
  const W = 600;
  const H = 180;
  const gap = 2;
  const bw = W / days.length - gap;
  const h = hover !== null ? days[hover] : null;
  return (
    <div className="relative" data-testid="revenue-chart">
      <div className="mb-1 flex justify-between text-xs text-slate-400">
        <span>{compact(max)}</span>
        <span>{h ? `${ddmm(h.date)} · ${fmtMoney(h.revenue)} · ${h.orders} đơn` : 'Rê chuột lên cột để xem từng ngày'}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" role="img" aria-label="Doanh thu 30 ngày gần đây" onMouseLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={H - H * f} y2={H - H * f} className="stroke-slate-100" strokeWidth={1} />
        ))}
        <line x1={0} x2={W} y1={H} y2={H} className="stroke-slate-200" strokeWidth={1} />
        {days.map((d, i) => {
          const bh = d.revenue ? Math.max(3, (d.revenue / max) * (H - 4)) : 0;
          const x = i * (bw + gap) + gap / 2;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)}>
              {/* vùng rê chuột rộng hơn cột */}
              <rect x={x - gap / 2} y={0} width={bw + gap} height={H} fill="transparent" />
              {bh > 0 && (
                <path
                  d={`M${x},${H} V${H - bh + 4} Q${x},${H - bh} ${x + 4},${H - bh} H${x + bw - 4} Q${x + bw},${H - bh} ${x + bw},${H - bh + 4} V${H} Z`}
                  className={`fill-current ${hover === null || hover === i ? 'text-brand-500' : 'text-brand-200'}`}
                />
              )}
              {i % 5 === 4 && (
                <text x={x + bw / 2} y={H + 13} textAnchor="middle" className="fill-slate-400 text-[10px]">
                  {ddmm(d.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>Doanh thu theo ngày</caption>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.revenue}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DashboardPage() {
  const { me, can } = useAuth();
  const router = useRouter();
  const allowed = !!me && me.workspace.tenantType === 'GARAGE' && can('dashboard.view');
  const [branch, setBranch] = useState('');
  const [d, setD] = useState<Overview | null>(null);
  // Không có quyền Tổng quan (VD: KTV) hoặc đang ở không gian Sàn: chuyển về trang phù hợp
  useEffect(() => {
    if (me && !allowed) router.replace(homeFor(me.permissions, me.workspace.tenantType));
  }, [me, allowed, router]);
  useEffect(() => {
    if (!allowed) return;
    api<Overview>(`/dashboard${branch ? `?branchId=${branch}` : ''}`).then(setD);
  }, [allowed, branch]);
  if (!allowed) return null;

  const r = d?.revenue;
  const inShop = d ? d.orders.TIEP_NHAN + d.orders.DANG_SUA + d.orders.HOAN_THANH : 0;
  const topMax = Math.max(1, ...(d?.top.map((t) => t.revenue) ?? [1]));

  return (
    <div className="space-y-4">
      {(me?.branches.length ?? 0) > 1 && (
        <Select value={branch} onChange={(e) => setBranch(e.target.value)} className="w-auto rounded-full bg-white/80" aria-label="Chi nhánh tổng quan">
          <option value="">Tất cả chi nhánh</option>
          {me!.branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      )}
      {!d ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            {r ? (
              <>
                <Kpi title="Doanh thu hôm nay" value={fmtMoney(r.today)} icon={Banknote} testid="kpi-today" note="Đơn đã giao xe trong ngày" href="/don-hoan-thanh" />
                <Kpi title="Doanh thu tháng" value={compact(r.month)} icon={Receipt} testid="kpi-month" note={`${r.monthOrders} đơn đã giao`} href="/don-hoan-thanh" />
                <Kpi title="Đã thu tháng này" value={compact(r.collectedMonth)} icon={Wallet} testid="kpi-collected" note={`Hôm nay: ${fmtMoney(r.collectedToday)}`} href="/thu-chi" />
                <Kpi title="Công nợ khách" value={compact(r.debt)} icon={HandCoins} testid="kpi-debt" note="Đơn chưa thu đủ + nợ đầu kỳ" href="/thu-chi" />
              </>
            ) : (
              <>
                <Kpi title="Xe trong xưởng" value={String(inShop)} icon={Car} href="/don-dang-xu-ly" />
                <Kpi title="Lịch hẹn hôm nay" value={String(d.bookingsToday.length)} icon={CalendarDays} href="/lich-sua-chua" />
                <Kpi title="Khách cần gọi" value={String(d.careDue)} icon={PhoneCall} href="/lich-goi" />
                <Kpi title="Khách mới tháng" value={String(d.newCustomers)} icon={UserPlus} href="/khach-hang" />
              </>
            )}
          </div>

          {r && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="ops-strip">
              {[
                {
                  label: 'Xe trong xưởng',
                  value: inShop,
                  sub: `${d.orders.TIEP_NHAN} tiếp nhận · ${d.orders.DANG_SUA} đang sửa · ${d.orders.HOAN_THANH} chờ giao`,
                  href: '/don-dang-xu-ly',
                  icon: Car,
                },
                { label: 'Trễ hẹn giao', value: d.orders.overdue, sub: 'Đơn quá giờ hẹn chưa xong', href: '/don-dang-xu-ly', icon: AlarmClock, warn: d.orders.overdue > 0 },
                { label: 'Lịch hẹn hôm nay', value: d.bookingsToday.length, sub: 'Xem lịch sửa chữa', href: '/lich-sua-chua', icon: CalendarDays },
                { label: 'Khách cần gọi', value: d.careDue, sub: 'Đăng kiểm, bảo dưỡng, hỏi thăm', href: '/lich-goi', icon: PhoneCall },
                { label: 'Hàng sắp hết', value: d.lowStock, sub: 'Dưới tồn tối thiểu', href: '/ton-kho', icon: PackageX, warn: d.lowStock > 0 },
              ].map((x) => (
                <Link key={x.label} href={x.href}>
                  <Card className="h-full p-4 hover:shadow-md">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <x.icon className="h-4 w-4" />
                      {x.label}
                    </div>
                    <div className={`mt-1 text-2xl font-semibold tabular-nums ${x.warn ? 'text-rose-600' : ''}`}>{x.value}</div>
                    <div className="text-xs text-slate-500">{x.sub}</div>
                  </Card>
                </Link>
              ))}
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-3">
            {r && (
              <Card className="p-5 lg:p-6 xl:col-span-2">
                <CardTitle className="mb-3">Doanh thu 30 ngày gần đây</CardTitle>
                <RevenueChart days={r.days} />
              </Card>
            )}
            <Card className="p-5 lg:p-6">
              <CardTitle className="mb-3">Lịch hẹn hôm nay</CardTitle>
              <ul className="space-y-2 text-sm" data-testid="today-bookings">
                {d.bookingsToday.map((b) => (
                  <li key={b.id} className="flex items-start gap-3 rounded-xl bg-slate-50 p-2.5">
                    <span className="w-12 shrink-0 font-semibold tabular-nums">{hhmm(b.at)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {b.plate && <span className="mr-1 font-mono">{b.plate}</span>}
                        {b.customer}
                      </div>
                      <div className="truncate text-xs text-slate-500">{b.service}</div>
                    </div>
                    <Badge tone={BOOKING_STATUS[b.status].tone} className="whitespace-nowrap text-[10px]">
                      {BOOKING_STATUS[b.status].label}
                    </Badge>
                  </li>
                ))}
                {!d.bookingsToday.length && <li className="text-slate-500">Hôm nay chưa có lịch hẹn.</li>}
              </ul>
            </Card>
            {r && (
              <Card className="p-5 lg:p-6 xl:col-span-2">
                <CardTitle className="mb-3">Hạng mục bán chạy tháng này</CardTitle>
                <ul className="space-y-2.5" data-testid="top-items">
                  {d.top.map((t) => (
                    <li key={t.name} className="text-sm">
                      <div className="flex justify-between gap-3">
                        <span className="truncate">
                          {t.name} <span className="text-xs text-slate-400">· {t.kind === 'DICH_VU' ? 'dịch vụ' : `${t.qty.toLocaleString('vi-VN')} đã bán`}</span>
                        </span>
                        <span className="shrink-0 font-medium tabular-nums">{fmtMoney(t.revenue)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                        <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${(t.revenue / topMax) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                  {!d.top.length && <li className="text-sm text-slate-500">Tháng này chưa có đơn giao xe.</li>}
                </ul>
              </Card>
            )}
            <SystemStatus />
          </div>
        </>
      )}
    </div>
  );
}
