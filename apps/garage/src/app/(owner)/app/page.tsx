'use client';

import { Card, Spinner } from '@cardiy/ui';
import { Bell, CalendarClock, CalendarPlus, ChevronRight, Gauge, Headphones, LifeBuoy, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fmtDate } from '@/lib/crm';
import { Reminders } from '@/components/owner-reminders';
import { ownerApi, useOwner } from '@/lib/owner';
import { fmtDateTime } from '@/lib/orders';
import type { SosDetail } from '@/lib/sos';

interface OwnerVehicle {
  id: string;
  plate: string;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  odometerKm: number | null;
  registrationExpiry: string | null;
  insuranceExpiry: string | null;
  nextMaintenance: string | null;
  garage: string;
  visits: number;
  lastVisit: { date: string; km: number | null } | null;
  openOrder: { id: string; code: string; status: string; statusLabel: string; promisedAt: string | null; pendingQuote?: boolean } | null;
}

export default function OwnerHome() {
  const { me } = useOwner();
  const [vs, setVs] = useState<OwnerVehicle[] | null>(null);
  const [activeSos, setActiveSos] = useState<SosDetail | null>(null);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  useEffect(() => {
    const load = () => {
      void ownerApi<OwnerVehicle[]>('/vehicles').then(setVs);
      void ownerApi<{ active: SosDetail | null }>('/sos')
        .then((r) => setActiveSos(r.active))
        .catch(() => null);
      void ownerApi<{ unreadCount: number }>('/notifications')
        .then((r) => setUnreadNotifs(r.unreadCount))
        .catch(() => null);
    };
    load();
    // Theo dõi tiến độ: tự cập nhật trạng thái xe đang ở garage & ca cứu hộ
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-slate-500">Xin chào</p>
          <h1 className="truncate text-2xl font-semibold" data-testid="owner-name">
            {me?.name}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Link
            href="/app/thong-bao"
            className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-brand-300"
            aria-label="Thông báo"
            data-testid="owner-notif-bell"
          >
            <Bell className="h-4 w-4" />
            {unreadNotifs > 0 && (
              <span
                className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white"
                data-testid="owner-notif-badge"
              >
                {unreadNotifs}
              </span>
            )}
          </Link>
          <Link
            href="/app/cuu-ho"
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-700"
            data-testid="owner-sos-cta"
          >
            <LifeBuoy className="h-4 w-4" /> SOS
          </Link>
          <Link href="/app/dat-lich" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm" data-testid="book-cta">
            <CalendarPlus className="h-4 w-4" /> Đặt lịch
          </Link>
        </div>
      </header>
      <Link
        href="/app/cong-dong"
        className="flex items-center gap-3 rounded-2xl border border-sky-200 bg-white px-4 py-3 text-sm shadow-sm hover:border-brand-300"
        data-testid="owner-community-cta"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-100 text-sky-700">
          <Headphones className="h-4 w-4" />
        </span>
        <div className="flex-1">
          <div className="font-semibold text-slate-900">Cộng đồng chủ xe & Sách nói</div>
          <div className="text-xs text-slate-500">Đặt câu hỏi kỹ thuật, đọc blog chuyên gia & nghe sách nói đường dài</div>
        </div>
        <ChevronRight className="h-4 w-4 text-slate-400" />
      </Link>
      {activeSos && (
        <Link
          href={`/app/cuu-ho/${activeSos.id}`}
          className="flex items-center gap-2.5 rounded-2xl bg-rose-600 px-4 py-3 text-sm text-white shadow-sm"
          data-testid="owner-active-sos"
        >
          <LifeBuoy className="h-5 w-5 shrink-0" />
          <div className="flex-1">
            <div className="font-semibold">
              Cứu hộ {activeSos.code} · {activeSos.statusLabel}
            </div>
            <div className="text-xs text-rose-100">
              {activeSos.assignedGarage ? activeSos.assignedGarage.name : 'Bấm để theo dõi tiến độ đội cứu hộ'}
            </div>
          </div>
          <ChevronRight className="h-4 w-4" />
        </Link>
      )}
      {!vs ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : !vs.length ? (
        <Card className="p-6 text-center text-sm text-slate-500">Chưa có xe nào đứng tên bạn. Khi bạn mang xe tới garage, xe sẽ hiện ở đây.</Card>
      ) : (
        <ul className="space-y-3" data-testid="owner-vehicles">
          {vs.map((v) => (
            <li key={v.id}>
              <Card className="overflow-hidden p-0">
                {v.openOrder && (
                  <Link
                    href={`/app/don/${v.openOrder.id}`}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm text-white ${v.openOrder.pendingQuote ? 'bg-amber-500' : 'bg-brand-600'}`}
                    data-testid="open-order"
                  >
                    <Wrench className="h-4 w-4" />
                    <span className="flex-1">
                      {v.openOrder.pendingQuote ? (
                        <b>Garage gửi báo giá, bấm để xem và duyệt</b>
                      ) : (
                        <>
                          Xe đang ở garage · <b>{v.openOrder.statusLabel}</b>
                          {v.openOrder.promisedAt && <span className="opacity-80"> · hẹn {fmtDateTime(v.openOrder.promisedAt)}</span>}
                        </>
                      )}
                    </span>
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                )}
                <Link href={`/app/xe/${v.id}`} className="block space-y-3 p-4" data-testid="vehicle-card">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-2xl font-bold tracking-wide">{v.plate}</div>
                      <div className="text-sm text-slate-500">{[v.make, v.model, v.year].filter(Boolean).join(' ') || 'Chưa có thông tin xe'}</div>
                    </div>
                    <ChevronRight className="mt-2 h-5 w-5 text-slate-400" />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="flex items-center gap-1 text-xs text-slate-500">
                        <Gauge className="h-3.5 w-3.5" /> Số km
                      </div>
                      <div className="font-semibold tabular-nums">{v.odometerKm !== null ? `${v.odometerKm.toLocaleString('vi-VN')} km` : '—'}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="flex items-center gap-1 text-xs text-slate-500">
                        <CalendarClock className="h-3.5 w-3.5" /> Lần sửa gần nhất
                      </div>
                      <div className="font-semibold">{v.lastVisit ? fmtDate(v.lastVisit.date) : '—'}</div>
                    </div>
                  </div>
                  <Reminders v={v} />
                  <div className="text-xs text-slate-500">
                    {v.garage} · {v.visits} lần sửa
                  </div>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
