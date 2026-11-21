'use client';

import { Alert, Badge, Button, Card, Dialog, Field, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import { AlarmClock, Car, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CustomerPicker } from '@/components/customer-picker';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCurrentBranch } from '@/lib/branch';
import { addDays, BOOKING_STATUS, CHANNELS, ddmm, hhmm, sameDay, startOfDay, startOfWeek, toLocalInput, WEEKDAYS, type Booking, type BookingChannel } from '@/lib/bookings';

interface CustomerLite {
  id: string;
  name: string;
  phone: string | null;
  vehicles: { id: string; plate: string; make: string | null; model: string | null }[];
}

const errMsg = (e: unknown, f: string) => (e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : f);

function BookingCard({ b, onOpen, compact }: { b: Booking; onOpen: () => void; compact?: boolean }) {
  const st = BOOKING_STATUS[b.status];
  const done = ['KHONG_DEN', 'KHACH_HUY', 'TU_CHOI'].includes(b.status);
  return (
    <button type="button" onClick={onOpen} className={`w-full rounded-xl border bg-white p-2 text-left text-xs shadow-sm hover:border-brand-300 ${b.late ? 'border-rose-300' : 'border-slate-100'} ${done ? 'opacity-50' : ''}`} data-testid="booking-card">
      <div className="flex items-center justify-between gap-1">
        <span className="font-semibold tabular-nums">{hhmm(b.scheduledAt)}</span>
        <Badge tone={b.late ? 'rose' : st.tone} className="whitespace-nowrap text-[10px]">{b.late ? 'Quá giờ' : st.label}</Badge>
      </div>
      {b.vehicle && <div className="mt-1 font-mono font-semibold">{b.vehicle.plate}</div>}
      <div className="truncate text-slate-700">{b.customer.name}</div>
      {!compact && <div className="line-clamp-2 text-slate-500">{b.service}</div>}
    </button>
  );
}

function NewBooking({ branchId, day, onDone, onCancel }: { branchId: string; day: Date; onDone: (warnings: string[]) => void; onCancel: () => void }) {
  const { me } = useAuth();
  const [customer, setCustomer] = useState<CustomerLite | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [branch, setBranch] = useState(branchId);
  const [at, setAt] = useState(() => {
    const d = new Date(day);
    d.setHours(Math.max(8, new Date().getHours() + 1), 0, 0, 0);
    return toLocalInput(d);
  });
  const [duration, setDuration] = useState('60');
  const [service, setService] = useState('');
  const [channel, setChannel] = useState<BookingChannel>('GOI_DIEN');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (cid: string, vid: string | null) => {
    const c = await api<CustomerLite>(`/customers/${cid}`);
    setCustomer(c);
    setVehicleId(vid ?? (c.vehicles.length === 1 ? c.vehicles[0]!.id : null));
  };

  const save = async () => {
    if (!customer) return setError('Chọn khách hàng');
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ warnings: string[] }>('/bookings', { body: { branchId: branch, customerId: customer.id, vehicleId, scheduledAt: new Date(at).toISOString(), durationMin: Number(duration), service, channel, note: note || null } });
      onDone(r.warnings);
    } catch (e) {
      setError(errMsg(e, 'Không lưu được lịch hẹn'));
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4" data-testid="new-booking">
      {error && <Alert>{error}</Alert>}
      {!customer ? (
        <CustomerPicker onPick={(c, v) => void pick(c, v)} />
      ) : (
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-semibold">{customer.name}</div>
              <div className="text-sm text-slate-500">{customer.phone ?? 'Không có SĐT'}</div>
            </div>
            <button type="button" aria-label="Đổi khách" onClick={() => setCustomer(null)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {customer.vehicles.map((v) => (
              <button key={v.id} type="button" onClick={() => setVehicleId(v.id)} aria-pressed={vehicleId === v.id} className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm ${vehicleId === v.id ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white'}`}>
                <Car className="h-4 w-4" />
                <span className="font-mono font-semibold">{v.plate}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ngày giờ hẹn">{(id) => <Input id={id} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />}</Field>
        <Field label="Thời gian dự kiến">
          {(id) => (
            <Select id={id} value={duration} onChange={(e) => setDuration(e.target.value)}>
              {[30, 60, 90, 120, 180, 240].map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} phút` : `${m / 60} giờ`}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {(me?.branches.length ?? 0) > 1 && (
          <Field label="Chi nhánh">
            {(id) => (
              <Select id={id} value={branch} onChange={(e) => setBranch(e.target.value)}>
                {me!.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Kênh đặt">
          {(id) => (
            <Select id={id} value={channel} onChange={(e) => setChannel(e.target.value as BookingChannel)}>
              {CHANNELS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Khách cần làm gì" className="sm:col-span-2">
          {(id) => <Input id={id} value={service} onChange={(e) => setService(e.target.value)} placeholder="VD: Bảo dưỡng 40.000 km, thay lốp trước" />}
        </Field>
        <Field label="Ghi chú" className="sm:col-span-2">
          {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Huỷ
        </Button>
        <Button onClick={() => void save()} disabled={busy || !customer || !service.trim()} data-testid="save-booking">
          {busy && <Spinner />}
          Đặt lịch
        </Button>
      </div>
    </div>
  );
}

function BookingDetail({ b, onChanged }: { b: Booking; onChanged: () => void }) {
  const { can } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<null | 'reschedule' | 'checkin' | 'KHACH_HUY' | 'TU_CHOI'>(null);
  const [at, setAt] = useState(toLocalInput(new Date(b.scheduledAt)));
  const [km, setKm] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = b.status === 'CHO_XAC_NHAN' || b.status === 'DA_XAC_NHAN';
  const manage = can('booking.manage');

  const run = async (fn: () => Promise<unknown>, f: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(errMsg(e, f));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 text-sm" data-testid="booking-detail">
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={BOOKING_STATUS[b.status].tone}>{BOOKING_STATUS[b.status].label}</Badge>
        {b.late && (
          <Badge tone="rose">
            <AlarmClock className="h-3 w-3" /> Quá giờ hẹn
          </Badge>
        )}
        <span className="text-slate-500">
          {b.code} · {b.branch.name} · {CHANNELS.find((c) => c.value === b.channel)?.label}
        </span>
      </div>
      <div className="rounded-2xl bg-slate-50 p-3">
        <div className="text-base font-semibold">
          {new Date(b.scheduledAt).toLocaleString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {b.durationMin} phút
        </div>
        <Link href={`/khach-hang/${b.customer.id}`} className="mt-1 block font-medium hover:text-brand-600">
          {b.customer.name} {b.customer.phone && <span className="font-normal text-slate-500">· {b.customer.phone}</span>}
        </Link>
        {b.vehicle && (
          <Link href={`/xe/${b.vehicle.id}`} className="font-mono font-semibold hover:text-brand-600">
            {b.vehicle.plate} <span className="font-sans font-normal text-slate-500">{[b.vehicle.make, b.vehicle.model].filter(Boolean).join(' ')}</span>
          </Link>
        )}
        <div className="mt-2">{b.service}</div>
        {b.note && <div className="text-slate-500">{b.note}</div>}
        {b.reason && <div className="text-rose-600">Lý do: {b.reason}</div>}
        {b.order && (
          <Link href={`/don-hang/${b.order.id}`} className="mt-2 inline-block font-semibold text-brand-600 hover:underline">
            Đơn {b.order.code} →
          </Link>
        )}
      </div>

      {mode === 'reschedule' && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Giờ hẹn mới">{(id) => <Input id={id} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />}</Field>
          <Button disabled={busy} onClick={() => void run(() => api(`/bookings/${b.id}`, { method: 'PATCH', body: { scheduledAt: new Date(at).toISOString() } }), 'Không đổi được giờ')}>
            Lưu giờ mới
          </Button>
        </div>
      )}
      {mode === 'checkin' && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Số km lúc nhận xe">{(id) => <Input id={id} inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, ''))} />}</Field>
          <Button
            disabled={busy}
            data-testid="confirm-checkin"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const o = await api<{ id: string }>(`/bookings/${b.id}/check-in`, { body: { odometerKm: km ? Number(km) : null } });
                router.push(`/don-hang/${o.id}`);
              } catch (e) {
                setError(errMsg(e, 'Không nhận xe được'));
                setBusy(false);
              }
            }}
          >
            Tạo đơn tiếp nhận
          </Button>
        </div>
      )}
      {(mode === 'KHACH_HUY' || mode === 'TU_CHOI') && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Lý do">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}</Field>
          <Button disabled={busy || !reason.trim()} onClick={() => void run(() => api(`/bookings/${b.id}/status`, { body: { to: mode, reason } }), 'Không lưu được')}>
            Xác nhận
          </Button>
        </div>
      )}

      {manage && active && (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          {b.status === 'CHO_XAC_NHAN' && (
            <Button disabled={busy} onClick={() => void run(() => api(`/bookings/${b.id}/status`, { body: { to: 'DA_XAC_NHAN' } }), 'Không xác nhận được')} data-testid="confirm-booking">
              Xác nhận lịch
            </Button>
          )}
          {can('ro.manage') && (
            <Button variant={b.status === 'DA_XAC_NHAN' ? 'primary' : 'outline'} onClick={() => setMode('checkin')} data-testid="checkin">
              Khách đến — nhận xe
            </Button>
          )}
          <Button variant="outline" onClick={() => setMode('reschedule')}>
            Đổi giờ
          </Button>
          {b.status === 'DA_XAC_NHAN' && (
            <Button variant="outline" disabled={busy} onClick={() => void run(() => api(`/bookings/${b.id}/status`, { body: { to: 'KHONG_DEN' } }), 'Không lưu được')}>
              Không đến
            </Button>
          )}
          <Button variant="outline" onClick={() => setMode('KHACH_HUY')}>
            Khách huỷ
          </Button>
          {b.status === 'CHO_XAC_NHAN' && (
            <Button variant="outline" onClick={() => setMode('TU_CHOI')}>
              Từ chối
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Calendar() {
  const { can, me } = useAuth();
  const current = useCurrentBranch();
  const [branch, setBranch] = useState('');
  const [view, setView] = useState<'ngay' | 'tuan'>('tuan');
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [open, setOpen] = useState<Booking | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (current && !branch) setBranch(current);
  }, [current, branch]);

  const range = useMemo(() => (view === 'ngay' ? { from: day, to: addDays(day, 1) } : { from: startOfWeek(day), to: addDays(startOfWeek(day), 7) }), [view, day]);
  const load = useCallback(async () => {
    if (!branch) return;
    const p = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString(), branchId: branch });
    setRows(await api<Booking[]>(`/bookings?${p}`));
  }, [branch, range]);
  useEffect(() => void load(), [load]);

  const days = view === 'ngay' ? [day] : Array.from({ length: 7 }, (_, i) => addDays(range.from, i));
  const today = startOfDay(new Date());
  const step = view === 'ngay' ? 1 : 7;
  const active = rows?.filter((r) => r.status === 'CHO_XAC_NHAN' || r.status === 'DA_XAC_NHAN') ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          tabs={[
            { value: 'ngay' as const, label: 'Ngày' },
            { value: 'tuan' as const, label: 'Tuần' },
          ]}
          value={view}
          onChange={setView}
        />
        <div className="flex items-center gap-1 rounded-full bg-white/80 p-1">
          <button type="button" aria-label="Trước" onClick={() => setDay(addDays(day, -step))} className="grid h-8 w-8 place-items-center rounded-full hover:bg-slate-100">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setDay(today)} className="rounded-full px-3 py-1 text-sm hover:bg-slate-100">
            Hôm nay
          </button>
          <button type="button" aria-label="Sau" onClick={() => setDay(addDays(day, step))} className="grid h-8 w-8 place-items-center rounded-full hover:bg-slate-100">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <span className="font-semibold" data-testid="range-label">
          {view === 'ngay' ? day.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }) : `${ddmm(range.from)} – ${ddmm(addDays(range.to, -1))}/${range.from.getFullYear()}`}
        </span>
        {(me?.branches.length ?? 0) > 1 && (
          <Select value={branch} onChange={(e) => setBranch(e.target.value)} className="w-auto rounded-full bg-white/80" aria-label="Chi nhánh">
            {me!.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
        <div className="flex-1" />
        <span className="text-sm text-slate-500">{active.length} lịch còn hiệu lực</span>
        {can('booking.manage') && (
          <Button onClick={() => setCreating(true)} data-testid="add-booking">
            <Plus className="h-4 w-4" />
            Đặt lịch
          </Button>
        )}
      </div>
      {notice && (
        <Alert tone="peach">
          {notice}
          <button type="button" className="ml-2 underline" onClick={() => setNotice(null)}>
            Đóng
          </button>
        </Alert>
      )}

      {!rows ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : view === 'tuan' ? (
        <div className="grid gap-2 md:grid-cols-7" data-testid="week-view">
          {days.map((d, i) => {
            const list = rows.filter((r) => sameDay(new Date(r.scheduledAt), d));
            return (
              <Card key={i} className={`min-h-[180px] p-2 ${sameDay(d, today) ? 'ring-2 ring-brand-300' : ''}`}>
                <button type="button" onClick={() => (setDay(d), setView('ngay'))} className="mb-2 flex w-full items-baseline justify-between px-1 text-left">
                  <span className="text-xs font-semibold uppercase text-slate-500">{WEEKDAYS[i]}</span>
                  <span className={`text-sm font-semibold ${sameDay(d, today) ? 'text-brand-600' : ''}`}>{ddmm(d)}</span>
                </button>
                <div className="space-y-1.5">
                  {list.map((b) => (
                    <BookingCard key={b.id} b={b} onOpen={() => setOpen(b)} compact />
                  ))}
                  {!list.length && <div className="px-1 text-xs text-slate-400">Trống</div>}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="divide-y divide-slate-50 p-2" data-testid="day-view">
          {Array.from({ length: 13 }, (_, k) => k + 7).map((h) => {
            const list = rows.filter((r) => new Date(r.scheduledAt).getHours() === h || (h === 7 && new Date(r.scheduledAt).getHours() < 7) || (h === 19 && new Date(r.scheduledAt).getHours() > 19));
            return (
              <div key={h} className="flex gap-3 py-2">
                <div className="w-14 shrink-0 pt-1 text-right text-xs font-semibold text-slate-500">{String(h).padStart(2, '0')}:00</div>
                <div className="grid flex-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {list.map((b) => (
                    <BookingCard key={b.id} b={b} onOpen={() => setOpen(b)} />
                  ))}
                </div>
              </div>
            );
          })}
        </Card>
      )}

      <Dialog open={creating} onClose={() => setCreating(false)} title="Đặt lịch hẹn" wide>
        {creating && (
          <NewBooking
            branchId={branch}
            day={day < today ? today : day}
            onCancel={() => setCreating(false)}
            onDone={(w) => {
              setCreating(false);
              setNotice(w.length ? `Đã đặt lịch. Lưu ý: ${w.join('; ')}` : null);
              void load();
            }}
          />
        )}
      </Dialog>
      <Dialog open={open !== null} onClose={() => setOpen(null)} title={open ? `Lịch hẹn ${open.code}` : ''} wide>
        {open && (
          <BookingDetail
            key={open.id + open.status}
            b={open}
            onChanged={async () => {
              const fresh = await api<Booking>(`/bookings/${open.id}`);
              setOpen(fresh);
              void load();
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

export default function BookingsPage() {
  return (
    <RequirePermission permission="booking.view">
      <Calendar />
    </RequirePermission>
  );
}
