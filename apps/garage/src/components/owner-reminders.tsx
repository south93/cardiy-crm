'use client';

import { ShieldAlert, Wrench } from 'lucide-react';
import { fmtDate } from '@/lib/crm';
import { daysLeft } from '@/lib/owner';

/** Nhắc hạn đăng kiểm / bảo hiểm: hiện khi còn ≤ 45 ngày hoặc đã quá hạn */
export function Reminders({ v }: { v: { registrationExpiry: string | null; insuranceExpiry: string | null; nextMaintenance?: string | null } }) {
  const rows = [
    { label: 'Đăng kiểm', d: v.registrationExpiry },
    { label: 'Bảo hiểm', d: v.insuranceExpiry },
  ]
    .map((r) => ({ ...r, left: daysLeft(r.d) }))
    .filter((r) => r.left !== null && r.left <= 45);
  const m = daysLeft(v.nextMaintenance);
  const maint = m !== null && m <= 30 ? { d: v.nextMaintenance!, left: m } : null;
  if (!rows.length && !maint) return null;
  return (
    <div className="space-y-1.5" data-testid="reminders">
      {rows.map((r) => (
        <div key={r.label} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${r.left! < 0 ? 'bg-rose-100 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>
          <ShieldAlert className="h-4 w-4 shrink-0" />
          {r.left! < 0 ? `${r.label} đã hết hạn ${fmtDate(r.d)}` : `${r.label} hết hạn ${fmtDate(r.d)} (còn ${r.left} ngày)`}
        </div>
      ))}
      {maint && (
        <div className="flex items-center gap-2 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-800" data-testid="maintenance-reminder">
          <Wrench className="h-4 w-4 shrink-0" />
          {maint.left < 0 ? `Đã quá kỳ bảo dưỡng (dự kiến ${fmtDate(maint.d)}): nên đặt lịch` : `Sắp đến kỳ bảo dưỡng, khoảng ${fmtDate(maint.d)}`}
        </div>
      )}
    </div>
  );
}
