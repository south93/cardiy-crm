'use client';

import { Alert, Button, Card, CardTitle, Input, Spinner } from '@cardiy/ui';
import { ArrowLeft, CalendarCheck2, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { ownerApi } from '@/lib/owner';

interface Options {
  garages: {
    garage: string;
    branches: { id: string; name: string; address: string | null; phone: string | null }[];
    vehicles: { id: string; plate: string; make: string | null; model: string | null }[];
  }[];
  hours: { open: number; lastSlot: number; stepMin: number; minLeadMin: number; maxDays: number };
}
const SERVICES = ['Bảo dưỡng định kỳ', 'Thay / vá lốp', 'Kiểm tra phanh', 'Điều hoà', 'Ắc quy', 'Kiểm tra gầm', 'Rửa xe'];
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const VN = 7 * 3_600_000;
/** Ngày theo giờ VN: {y, m, d} của hôm nay + n ngày */
function vnDay(n: number) {
  const x = new Date(Date.now() + VN + n * 86_400_000);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), wd: x.getUTCDay() };
}
/** Thời điểm (UTC) của ngày VN + giờ phút VN */
const vnTime = (day: { y: number; m: number; d: number }, minutes: number) => new Date(Date.UTC(day.y, day.m, day.d, 0, minutes) - VN);
const hhmm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

export default function BookPage() {
  const [opt, setOpt] = useState<Options | null>(null);
  const [vehicle, setVehicle] = useState('');
  const [branch, setBranch] = useState('');
  const [day, setDay] = useState(1);
  const [slot, setSlot] = useState<number | null>(null);
  const [service, setService] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ code: string; at: Date } | null>(null);

  useEffect(() => {
    // Từ web sàn (/cho): ?dv=<dịch vụ / sản phẩm khách chọn> điền sẵn ô dịch vụ
    const dv = new URLSearchParams(window.location.search).get('dv');
    if (dv) setService(dv.slice(0, 120));
    ownerApi<Options>('/bookings/options').then((o) => {
      setOpt(o);
      const g = o.garages[0];
      if (g?.vehicles.length === 1) setVehicle(g.vehicles[0]!.id);
      if (g?.branches.length === 1) setBranch(g.branches[0]!.id);
    });
  }, []);
  const garage = useMemo(() => opt?.garages.find((g) => g.vehicles.some((v) => v.id === vehicle)) ?? opt?.garages[0], [opt, vehicle]);
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => ({ i, ...vnDay(i) })), []);
  const slots = useMemo(() => {
    if (!opt) return [];
    const h = opt.hours;
    const list: number[] = [];
    for (let m = h.open * 60; m <= h.lastSlot * 60; m += h.stepMin) list.push(m);
    const d = vnDay(day);
    return list.map((m) => ({ m, ok: vnTime(d, m).getTime() >= Date.now() + h.minLeadMin * 60_000 }));
  }, [opt, day]);

  if (!opt) return <Spinner className="h-6 w-6 text-brand-600" />;
  if (done)
    return (
      <div className="space-y-4 pt-6 text-center" data-testid="booking-done">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-500 text-white">
          <CalendarCheck2 className="h-7 w-7" />
        </div>
        <h1 className="text-xl font-semibold">Đã gửi lịch hẹn {done.code}</h1>
        <p className="text-sm text-slate-600">
          {WD[new Date(done.at.getTime() + VN).getUTCDay()]} {done.at.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })}.
          Garage sẽ xác nhận sớm, bạn xem trạng thái trong mục Lịch hẹn.
        </p>
        <Link href="/app/lich-hen" className="inline-block rounded-full bg-brand-600 px-5 py-2.5 text-sm font-medium text-white">
          Xem lịch hẹn của tôi
        </Link>
      </div>
    );

  const submit = async () => {
    if (slot === null) return;
    setBusy(true);
    setError(null);
    const at = vnTime(vnDay(day), slot);
    try {
      const r = await ownerApi<{ code: string }>('/bookings', { body: { branchId: branch, vehicleId: vehicle, scheduledAt: at.toISOString(), service, note: note || null } });
      setDone({ code: r.code, at });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không đặt được lịch, thử lại sau');
    } finally {
      setBusy(false);
    }
  };
  const pill = (on: boolean) => `rounded-xl border px-3 py-2 text-sm ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-700'}`;

  return (
    <div className="space-y-4">
      <Link href="/app" className="flex items-center gap-1 text-sm text-slate-500">
        <ArrowLeft className="h-4 w-4" /> Xe của tôi
      </Link>
      <h1 className="text-xl font-semibold">Đặt lịch sửa xe</h1>

      <Card className="p-4">
        <CardTitle className="mb-2 text-base">Xe</CardTitle>
        <div className="grid gap-2" role="radiogroup" aria-label="Chọn xe">
          {opt.garages.flatMap((g) =>
            g.vehicles.map((v) => (
              <button key={v.id} type="button" role="radio" aria-checked={vehicle === v.id} onClick={() => setVehicle(v.id)} className={`${pill(vehicle === v.id)} text-left`}>
                <span className="font-mono font-bold">{v.plate}</span> <span className="opacity-80">{[v.make, v.model].filter(Boolean).join(' ')}</span>
              </button>
            )),
          )}
        </div>
      </Card>

      <Card className="p-4">
        <CardTitle className="mb-2 text-base">Chi nhánh</CardTitle>
        <div className="grid gap-2" role="radiogroup" aria-label="Chọn chi nhánh">
          {garage?.branches.map((b) => (
            <button key={b.id} type="button" role="radio" aria-checked={branch === b.id} onClick={() => setBranch(b.id)} className={`${pill(branch === b.id)} text-left`}>
              <span className="font-medium">{b.name}</span>
              {b.address && (
                <span className="mt-0.5 flex items-start gap-1 text-xs opacity-80">
                  <MapPin className="mt-0.5 h-3 w-3 shrink-0" /> {b.address}
                </span>
              )}
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <CardTitle className="mb-2 text-base">Ngày & giờ</CardTitle>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="radiogroup" aria-label="Chọn ngày">
          {days.map((d) => (
            <button key={d.i} type="button" role="radio" aria-checked={day === d.i} onClick={() => (setDay(d.i), setSlot(null))} className={`${pill(day === d.i)} shrink-0 text-center leading-tight`}>
              <span className="block text-xs opacity-80">{d.i === 0 ? 'Hôm nay' : d.i === 1 ? 'Ngày mai' : WD[d.wd]}</span>
              <span className="font-semibold">
                {d.d}/{d.m + 1}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Chọn giờ">
          {slots.map((s) => (
            <button key={s.m} type="button" role="radio" aria-checked={slot === s.m} disabled={!s.ok} onClick={() => setSlot(s.m)} className={`${pill(slot === s.m)} px-1 disabled:opacity-30`}>
              {hhmm(s.m)}
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <CardTitle className="mb-2 text-base">Bạn cần làm gì cho xe?</CardTitle>
        <div className="flex flex-wrap gap-1.5">
          {SERVICES.map((x) => (
            <button key={x} type="button" onClick={() => setService(x)} className={pill(service === x)}>
              {x}
            </button>
          ))}
        </div>
        <Input value={service} onChange={(e) => setService(e.target.value)} placeholder="Hoặc ghi cụ thể…" className="mt-2" aria-label="Dịch vụ cần làm" />
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Ghi chú thêm (triệu chứng, yêu cầu…)"
          className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          aria-label="Ghi chú"
        />
      </Card>

      {error && <Alert>{error}</Alert>}
      <Button className="w-full justify-center" disabled={busy || !vehicle || !branch || slot === null || service.trim().length < 2} onClick={() => void submit()} data-testid="submit-booking">
        {busy ? 'Đang gửi…' : slot === null ? 'Chọn giờ hẹn' : `Đặt lịch ${hhmm(slot)} ${days[day]!.d}/${days[day]!.m + 1}`}
      </Button>
    </div>
  );
}
