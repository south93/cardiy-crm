'use client';

import { Alert, Badge, Button, Card, CardTitle, Input, Spinner } from '@cardiy/ui';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/crm';
import { MAINT_ALERT_UI, WARRANTY_STATE_UI, badgeTypeLabel, type VehicleMaintenanceItemView, type WarrantyState } from '@/lib/fleet';
import { ownerApi } from '@/lib/owner';
import { STATUS, type OrderStatus } from '@/lib/orders';
import { Reminders } from '@/components/owner-reminders';

interface Detail {
  id: string;
  plate: string;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  vin: string | null;
  fuel: string | null;
  transmission: string | null;
  tireSize: string | null;
  odometerKm: number | null;
  registrationExpiry: string | null;
  insuranceExpiry: string | null;
  badgeNo?: string | null;
  badgeType?: string | null;
  badgeExpiry?: string | null;
  maintenanceItems?: VehicleMaintenanceItemView[];
  serialItems?: {
    id: string;
    serialNo: string;
    kind: string;
    kindLabel: string;
    productName: string;
    brand: string | null;
    positionLabel: string | null;
    installedAt: string | null;
    installedKm: number | null;
    warrantyState: WarrantyState;
    warrantySummary: string;
  }[];
  orders: {
    id: string;
    code: string;
    status: OrderStatus;
    statusLabel: string;
    branch: string;
    receivedAt: string;
    deliveredAt: string | null;
    odometerKm: number | null;
    total: number;
    items: string[];
  }[];
}

export default function OwnerVehiclePage() {
  const { id } = useParams<{ id: string }>();
  const [v, setV] = useState<Detail | null>(null);
  const [km, setKm] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => ownerApi<Detail>(`/vehicles/${id}`).then(setV), [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function saveKm(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await ownerApi(`/vehicles/${id}/odometer`, { body: { km: Number(km.replace(/\D/g, '')) } });
      setKm('');
      setMsg({ ok: true, text: 'Đã cập nhật số km' });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Không lưu được' });
    }
  }

  if (!v) return <Spinner className="h-6 w-6 text-brand-600" />;
  const info = [
    ['Hãng / dòng', [v.make, v.model].filter(Boolean).join(' ')],
    ['Đời xe', v.year],
    ['Màu', v.color],
    ['Nhiên liệu', v.fuel],
    ['Hộp số', v.transmission],
    ['Size lốp', v.tireSize],
    ['Số khung', v.vin],
    ['Hạn đăng kiểm', v.registrationExpiry ? fmtDate(v.registrationExpiry) : null],
    ['Hạn bảo hiểm', v.insuranceExpiry ? fmtDate(v.insuranceExpiry) : null],
    ['Phù hiệu xe', v.badgeExpiry ? `${fmtDate(v.badgeExpiry)}${v.badgeNo ? ` (${v.badgeNo})` : ''}` : v.badgeNo ? `${v.badgeNo} (${badgeTypeLabel(v.badgeType)})` : null],
  ].filter(([, x]) => x);
  return (
    <div className="space-y-4">
      <Link href="/app" className="flex items-center gap-1 text-sm text-slate-500">
        <ArrowLeft className="h-4 w-4" /> Xe của tôi
      </Link>
      <div>
        <div className="font-mono text-3xl font-bold tracking-wide" data-testid="vehicle-plate">
          {v.plate}
        </div>
        <div className="text-sm text-slate-500">{[v.make, v.model, v.year].filter(Boolean).join(' ')}</div>
      </div>
      <Reminders v={v} />

      <Card className="p-4">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs text-slate-500">Số km hiện tại</div>
            <div className="text-2xl font-semibold tabular-nums" data-testid="vehicle-km">
              {v.odometerKm !== null ? `${v.odometerKm.toLocaleString('vi-VN')} km` : '—'}
            </div>
          </div>
        </div>
        <form onSubmit={saveKm} className="mt-3 flex gap-2">
          <Input inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} placeholder="Nhập số km mới" aria-label="Số km mới" required />
          <Button type="submit" className="shrink-0">
            Cập nhật
          </Button>
        </form>
        {msg?.ok && <p className="mt-2 text-sm text-emerald-700">{msg.text}</p>}
        {msg && !msg.ok && <Alert className="mt-2">{msg.text}</Alert>}
      </Card>

      {v.maintenanceItems && v.maintenanceItems.length > 0 && (
        <Card className="space-y-2.5 p-4" data-testid="owner-maintenance-items">
          <CardTitle className="text-base">Theo dõi bảo dưỡng định kỳ</CardTitle>
          {v.maintenanceItems.map((m) => (
            <div key={m.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{m.itemName}</span>
                <Badge tone={MAINT_ALERT_UI[m.alertState].tone}>{MAINT_ALERT_UI[m.alertState].label}</Badge>
              </div>
              <div className="mt-1 text-xs text-slate-600">
                Thay ngày {fmtDate(m.installedAt)}
                {m.installedKm !== null && ` tại ${m.installedKm.toLocaleString('vi-VN')} km`}
                {m.kmDriven !== null && ` · Đã chạy ${m.kmDriven.toLocaleString('vi-VN')} km`}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">{m.reasonText}</div>
            </div>
          ))}
        </Card>
      )}

      {v.serialItems && v.serialItems.length > 0 && (
        <Card className="space-y-2.5 p-4" data-testid="owner-serial-items">
          <CardTitle className="text-base">Bảo hành điện tử (Lốp / Ắc quy / Pin)</CardTitle>
          {v.serialItems.map((s) => (
            <div key={s.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs font-bold">{s.serialNo}</span>
                <Badge tone={WARRANTY_STATE_UI[s.warrantyState].tone}>{WARRANTY_STATE_UI[s.warrantyState].label}</Badge>
              </div>
              <div className="mt-0.5 font-medium">
                {s.productName}
                {s.positionLabel && <span className="ml-1.5 text-xs font-normal text-slate-500">({s.positionLabel})</span>}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">{s.warrantySummary}</div>
            </div>
          ))}
        </Card>
      )}

      {info.length > 0 && (
        <Card className="p-4">
          <CardTitle className="mb-2 text-base">Thông tin xe</CardTitle>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {info.map(([k, x]) => (
              <div key={String(k)} className="contents">
                <dt className="text-slate-500">{k}</dt>
                <dd className="text-right font-medium">{x}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      <section>
        <h2 className="mb-2 font-semibold">Lịch sử sửa chữa</h2>
        <ol className="space-y-2" data-testid="service-history">
          {v.orders.map((o) => (
            <li key={o.id}>
              <Link href={`/app/don/${o.id}`}>
                <Card className="flex items-center gap-3 p-3.5">
                  <div className="w-14 shrink-0 text-center">
                    <div className="text-lg font-semibold leading-none">{new Date(o.deliveredAt ?? o.receivedAt).getDate()}</div>
                    <div className="text-xs text-slate-500">
                      Th{new Date(o.deliveredAt ?? o.receivedAt).getMonth() + 1}/{new Date(o.deliveredAt ?? o.receivedAt).getFullYear()}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{o.items.slice(0, 3).join(', ') || 'Sửa chữa'}</div>
                    <div className="text-xs text-slate-500">
                      {o.code} · {o.branch}
                      {o.odometerKm ? ` · ${o.odometerKm.toLocaleString('vi-VN')} km` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold tabular-nums">{fmtMoney(o.total)}</div>
                    {o.status !== 'DA_GIAO' && (
                      <Badge tone={STATUS[o.status].tone} className="text-[10px]">
                        {o.statusLabel}
                      </Badge>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                </Card>
              </Link>
            </li>
          ))}
          {!v.orders.length && <li className="text-sm text-slate-500">Chưa có lần sửa nào.</li>}
        </ol>
      </section>
    </div>
  );
}
