'use client';

import { Alert, Button, Field, Input, Select, Spinner } from '@cardiy/ui';
import { Car, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CustomerPicker } from '@/components/customer-picker';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CHANNELS, toLocalInput, type BookingChannel } from '@/lib/bookings';

interface CustomerLite {
  id: string;
  name: string;
  phone: string | null;
  vehicles: { id: string; plate: string; make: string | null; model: string | null }[];
}

const errMsg = (e: unknown, f: string) => (e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : f);

/** Form đặt lịch hẹn (dùng ở Lịch sửa chữa và Lịch gọi) */
export function NewBooking({
  branchId,
  day,
  onDone,
  onCancel,
  customerId,
  vehicleId: initialVehicle,
  service: initialService = '',
}: {
  branchId: string;
  day: Date;
  onDone: (warnings: string[], id: string) => void;
  onCancel: () => void;
  /** Mở từ Lịch gọi / hồ sơ khách: chọn sẵn khách, xe */
  customerId?: string;
  vehicleId?: string | null;
  service?: string;
}) {
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
  const [service, setService] = useState(initialService);
  const [channel, setChannel] = useState<BookingChannel>('GOI_DIEN');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (cid: string, vid: string | null) => {
    const c = await api<CustomerLite>(`/customers/${cid}`);
    setCustomer(c);
    setVehicleId(vid ?? (c.vehicles.length === 1 ? c.vehicles[0]!.id : null));
  };
  useEffect(() => {
    if (customerId) void pick(customerId, initialVehicle ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const save = async () => {
    if (!customer) return setError('Chọn khách hàng');
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string; warnings: string[] }>('/bookings', { body: { branchId: branch, customerId: customer.id, vehicleId, scheduledAt: new Date(at).toISOString(), durationMin: Number(duration), service, channel, note: note || null } });
      onDone(r.warnings, r.id);
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
              {CHANNELS.filter((c) => c.value !== 'APP').map((c) => (
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
