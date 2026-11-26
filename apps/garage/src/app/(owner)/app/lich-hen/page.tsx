'use client';

import { Badge, Button, Card, Spinner, type Tone } from '@cardiy/ui';
import { CalendarPlus, MapPin, Phone } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { ownerApi } from '@/lib/owner';

interface Booking {
  id: string;
  code: string;
  status: string;
  statusLabel: string;
  scheduledAt: string;
  service: string;
  note: string | null;
  reason: string | null;
  branch: { name: string; address: string | null; phone: string | null };
  plate: string | null;
  orderId: string | null;
  cancellable: boolean;
}
const TONE: Record<string, Tone> = { CHO_XAC_NHAN: 'peach', DA_XAC_NHAN: 'mint', DA_DEN: 'sky', KHONG_DEN: 'slate', KHACH_HUY: 'slate', TU_CHOI: 'rose' };

export default function MyBookingsPage() {
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => ownerApi<Booking[]>('/bookings').then(setRows), []);
  useEffect(() => {
    void load();
    // Garage xác nhận / từ chối: tự cập nhật
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);
  const cancel = async (b: Booking) => {
    if (!confirm(`Huỷ lịch hẹn ${b.code}?`)) return;
    setError(null);
    try {
      await ownerApi(`/bookings/${b.id}/cancel`, { body: {} });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không huỷ được');
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Lịch hẹn</h1>
        <Link href="/app/dat-lich" className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white" data-testid="new-booking">
          <CalendarPlus className="h-4 w-4" /> Đặt lịch
        </Link>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {!rows ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : !rows.length ? (
        <Card className="p-6 text-center text-sm text-slate-500">Bạn chưa có lịch hẹn nào.</Card>
      ) : (
        <ul className="space-y-3" data-testid="my-bookings">
          {rows.map((b) => (
            <li key={b.id}>
              <Card className="space-y-2 p-4" data-testid="booking-card">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-lg font-semibold">
                      {new Date(b.scheduledAt).toLocaleString('vi-VN', { weekday: 'short', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })}
                    </div>
                    <div className="text-sm text-slate-500">
                      {b.code}
                      {b.plate && <span className="font-mono"> · {b.plate}</span>}
                    </div>
                  </div>
                  <span data-testid="booking-status">
                    <Badge tone={TONE[b.status] ?? 'slate'}>{b.statusLabel}</Badge>
                  </span>
                </div>
                <p className="text-sm">{b.service}</p>
                {b.reason && b.status === 'TU_CHOI' && <p className="text-sm text-rose-600">Lý do: {b.reason}</p>}
                <div className="text-xs text-slate-500">
                  <span className="flex items-start gap-1">
                    <MapPin className="mt-0.5 h-3 w-3 shrink-0" /> {b.branch.name}
                    {b.branch.address ? ` · ${b.branch.address}` : ''}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {b.branch.phone && (
                    <a href={`tel:${b.branch.phone}`} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-sm text-brand-700">
                      <Phone className="h-3.5 w-3.5" /> Gọi garage
                    </a>
                  )}
                  {b.orderId && (
                    <Link href={`/app/don/${b.orderId}`} className="rounded-full border border-slate-200 px-3 py-1.5 text-sm text-brand-700">
                      Xem đơn sửa chữa
                    </Link>
                  )}
                  {b.cancellable && (
                    <Button variant="outline" className="px-3 py-1.5 text-sm text-rose-600" onClick={() => void cancel(b)} data-testid="cancel-booking">
                      Huỷ lịch
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
