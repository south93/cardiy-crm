'use client';

import { Card, Spinner } from '@cardiy/ui';
import { CalendarClock, ChevronRight, Gauge, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fmtDate } from '@/lib/crm';
import { Reminders } from '@/components/owner-reminders';
import { ownerApi, useOwner } from '@/lib/owner';
import { fmtDateTime } from '@/lib/orders';

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
  garage: string;
  visits: number;
  lastVisit: { date: string; km: number | null } | null;
  openOrder: { id: string; code: string; status: string; statusLabel: string; promisedAt: string | null } | null;
}

export default function OwnerHome() {
  const { me } = useOwner();
  const [vs, setVs] = useState<OwnerVehicle[] | null>(null);
  useEffect(() => {
    ownerApi<OwnerVehicle[]>('/vehicles').then(setVs);
  }, []);
  return (
    <div className="space-y-4">
      <header>
        <p className="text-sm text-slate-500">Xin chào</p>
        <h1 className="text-2xl font-semibold" data-testid="owner-name">
          {me?.name}
        </h1>
      </header>
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
                  <Link href={`/app/don/${v.openOrder.id}`} className="flex items-center gap-2 bg-brand-600 px-4 py-2.5 text-sm text-white" data-testid="open-order">
                    <Wrench className="h-4 w-4" />
                    <span className="flex-1">
                      Xe đang ở garage · <b>{v.openOrder.statusLabel}</b>
                      {v.openOrder.promisedAt && <span className="opacity-80"> · hẹn {fmtDateTime(v.openOrder.promisedAt)}</span>}
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
