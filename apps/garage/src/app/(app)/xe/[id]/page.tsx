'use client';

import { Alert, Badge, Button, Card, CardTitle, Checkbox, Dialog, Field, Input, Spinner } from '@cardiy/ui';
import { ArrowRightLeft, ChevronLeft, Gauge, Pencil, Plus, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { VehicleFields, vehiclePayload, type VehicleFormValue } from '@/components/crm-forms';
import { VehicleAiSummaryCard } from '@/components/ai-assistant-cards';
import { OrderHistory } from '@/components/order-history';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { daysUntil, expiryText, expiryTone, fmtDate, fmtKm } from '@/lib/crm';

interface Vehicle {
  id: string;
  plate: string;
  plateValid: boolean;
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  fuel: string | null;
  transmission: string | null;
  tireSize: string | null;
  odometerKm: number | null;
  registrationExpiry: string | null;
  insuranceExpiry: string | null;
  note: string | null;
  owner: { id: string; code: string; name: string; phone: string | null } | null;
  owners: { customer: { id: string; code: string; name: string; phone: string | null }; fromDate: string; toDate: string | null }[];
  odometers: { km: number; source: string; createdAt: string }[];
}

const toForm = (v: Vehicle): VehicleFormValue => ({
  plate: v.plate, make: v.make ?? '', model: v.model ?? '', year: v.year ? String(v.year) : '', color: v.color ?? '', vin: v.vin ?? '', fuel: v.fuel ?? '',
  transmission: v.transmission ?? '', tireSize: v.tireSize ?? '', odometerKm: '', registrationExpiry: v.registrationExpiry?.slice(0, 10) ?? '', insuranceExpiry: v.insuranceExpiry?.slice(0, 10) ?? '', note: v.note ?? '',
});

const SOURCE_LABEL: Record<string, string> = { MANUAL: 'Nhập tay', IMPORT: 'Nhập file', CORRECTION: 'Sửa sai', RO: 'Tiếp nhận xe' };

function Spec({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 font-medium">{value || '—'}</div>
    </div>
  );
}

function VehicleDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const [v, setV] = useState<Vehicle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'edit' | 'km' | 'transfer' | null>(null);
  const [form, setForm] = useState<VehicleFormValue | null>(null);
  const [km, setKm] = useState('');
  const [correction, setCorrection] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ id: string; code: string; name: string; phone: string | null }[]>([]);
  const [dError, setDError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setV(await api<Vehicle>(`/vehicles/${id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được xe');
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  useEffect(() => {
    if (dialog !== 'transfer' || q.trim().length < 2) return setFound([]);
    const t = setTimeout(async () => {
      const r = await api<{ items: { id: string; code: string; name: string; phone: string | null }[] }>(`/customers?pageSize=8&q=${encodeURIComponent(q.trim())}`);
      setFound(r.items.filter((c) => c.id !== v?.owner?.id));
    }, 300);
    return () => clearTimeout(t);
  }, [q, dialog, v?.owner?.id]);

  const run = async (fn: () => Promise<unknown>) => {
    setDError(null);
    try {
      await fn();
      setDialog(null);
      await load();
    } catch (e) {
      setDError(e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : 'Không lưu được');
    }
  };

  if (error) return <Alert>{error}</Alert>;
  if (!v) return <div className="grid place-items-center p-10"><Spinner className="h-6 w-6 text-brand-600" /></div>;

  return (
    <div className="space-y-4" data-testid="vehicle-detail">
      <Link href="/xe" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
        <ChevronLeft className="h-4 w-4" />
        Xe
      </Link>
      <Card className="flex flex-wrap items-center gap-4 p-4 lg:p-5">
        <div className="rounded-xl border-2 border-slate-800 bg-white px-4 py-2 font-mono text-2xl font-bold tracking-wider" data-testid="vehicle-plate">{v.plate}</div>
        <div className="min-w-[200px] flex-1">
          <div className="text-lg font-semibold">{[v.make, v.model, v.year].filter(Boolean).join(' · ') || 'Chưa có thông tin xe'}</div>
          <div className="text-sm text-slate-500">{fmtKm(v.odometerKm)}{v.color ? ` · ${v.color}` : ''}</div>
        </div>
        {!v.plateValid && <Badge tone="peach">Biển số cần xem lại</Badge>}
        {can('ro.manage') && v.owners.some((o) => !o.toDate) && (
          <Link href={`/ban-hang?customerId=${v.owners.find((o) => !o.toDate)!.customer.id}&vehicleId=${v.id}`}>
            <Button data-testid="new-order-for-vehicle">
              <Plus className="h-4 w-4" />
              Tạo đơn
            </Button>
          </Link>
        )}
        {(can('vehicle.manage') || can('ro.task.update')) && (
          <Button variant="outline" onClick={() => { setKm(''); setCorrection(false); setDError(null); setDialog('km'); }} data-testid="add-km">
            <Gauge className="h-4 w-4" />
            Ghi số km
          </Button>
        )}
        {can('vehicle.manage') && (
          <button type="button" aria-label="Sửa xe" onClick={() => { setForm(toForm(v)); setDError(null); setDialog('edit'); }} className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white hover:bg-slate-50">
            <Pencil className="h-4 w-4" />
          </button>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card className="p-4 lg:p-5">
            <CardTitle className="mb-3">Thông số</CardTitle>
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
              <Spec label="Số VIN" value={v.vin && <span className="font-mono text-sm">{v.vin}</span>} />
              <Spec label="Nhiên liệu" value={v.fuel} />
              <Spec label="Hộp số" value={v.transmission} />
              <Spec label="Size lốp" value={v.tireSize} />
              <Spec label="Đăng kiểm" value={<Badge tone={expiryTone(daysUntil(v.registrationExpiry))}>{expiryText(daysUntil(v.registrationExpiry), v.registrationExpiry)}</Badge>} />
              <Spec label="Bảo hiểm" value={<Badge tone={expiryTone(daysUntil(v.insuranceExpiry))}>{expiryText(daysUntil(v.insuranceExpiry), v.insuranceExpiry)}</Badge>} />
            </div>
            {v.note && <p className="mt-3 whitespace-pre-line rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">{v.note}</p>}
          </Card>
          {can('ai.use') && <VehicleAiSummaryCard vehicleId={v.id} />}
          {can('ro.view') && <OrderHistory vehicleId={v.id} />}
          <Card className="p-4 lg:p-5">
            <CardTitle className="mb-3">Lịch sử số km</CardTitle>
            <ul className="space-y-1.5 text-sm" data-testid="odometer-list">
              {v.odometers.map((o, i) => (
                <li key={i} className="flex justify-between border-b border-dashed border-slate-100 py-1.5 last:border-0">
                  <span className="font-medium">{fmtKm(o.km)}</span>
                  <span className="text-slate-500">{SOURCE_LABEL[o.source] ?? o.source} · {fmtDate(o.createdAt)}</span>
                </li>
              ))}
              {!v.odometers.length && <li className="text-slate-500">Chưa ghi số km</li>}
            </ul>
          </Card>
        </div>
        <Card className="space-y-3 p-4 lg:p-5">
          <div className="flex items-center justify-between">
            <CardTitle>Chủ xe</CardTitle>
            {can('vehicle.manage') && can('customer.view') && (
              <Button variant="outline" className="px-3 py-1.5 text-xs" onClick={() => { setQ(''); setDError(null); setDialog('transfer'); }} data-testid="transfer-vehicle">
                <ArrowRightLeft className="h-3.5 w-3.5" />
                Chuyển chủ
              </Button>
            )}
          </div>
          {v.owners.map((o, i) => (
            <div key={i} className={`flex items-center gap-3 rounded-2xl border p-3 ${o.toDate ? 'border-slate-100 bg-slate-50/60 text-slate-500' : 'border-brand-100 bg-brand-50/50'}`} data-testid={o.toDate ? 'past-owner' : 'current-owner'}>
              <UserRound className="h-4 w-4" />
              <div className="min-w-0 flex-1 text-sm">
                {can('customer.view') ? <Link href={`/khach-hang/${o.customer.id}`} className="font-medium hover:text-brand-600">{o.customer.name}</Link> : <span className="font-medium">{o.customer.name}</span>}
                <div className="text-xs">{o.customer.phone ?? 'Chưa có SĐT'} · {fmtDate(o.fromDate)} → {o.toDate ? fmtDate(o.toDate) : 'nay'}</div>
              </div>
              {!o.toDate && <Badge tone="brand">Hiện tại</Badge>}
            </div>
          ))}
          {!v.owners.length && <p className="text-sm text-slate-500">Xe chưa có chủ</p>}
        </Card>
      </div>

      <Dialog open={dialog === 'edit'} onClose={() => setDialog(null)} title={`Sửa xe ${v.plate}`} wide footer={<><Button variant="outline" onClick={() => setDialog(null)}>Huỷ</Button><Button onClick={() => form && void run(() => api(`/vehicles/${v.id}`, { method: 'PATCH', body: vehiclePayload(form, false) }))}>Lưu</Button></>}>
        {dError && <Alert className="mb-3">{dError}</Alert>}
        {form && <VehicleFields value={form} onChange={setForm} showKm={false} />}
      </Dialog>

      <Dialog open={dialog === 'km'} onClose={() => setDialog(null)} title="Ghi số km" footer={<><Button variant="outline" onClick={() => setDialog(null)}>Huỷ</Button><Button data-testid="save-km" onClick={() => void run(() => api(`/vehicles/${v.id}/odometer`, { body: { km: Number(km.replace(/\D/g, '')), correction } }))}>Lưu</Button></>}>
        <div className="space-y-3">
          {dError && <Alert>{dError}</Alert>}
          <Field label="Số km trên đồng hồ" hint={v.odometerKm !== null ? `Lần trước: ${fmtKm(v.odometerKm)}` : undefined}>{(fid) => <Input id={fid} inputMode="numeric" autoFocus value={km} onChange={(e) => setKm(e.target.value)} />}</Field>
          <Checkbox checked={correction} onChange={(e) => setCorrection(e.target.checked)} label="Sửa số km (nhập nhầm lần trước, thay đồng hồ)" />
        </div>
      </Dialog>

      <Dialog open={dialog === 'transfer'} onClose={() => setDialog(null)} title={`Chuyển chủ xe ${v.plate}`}>
        <div className="space-y-3">
          {dError && <Alert>{dError}</Alert>}
          <p className="text-sm text-slate-500">Lịch sử sửa chữa vẫn gắn với xe. Chủ cũ được lưu trong lịch sử chủ xe.</p>
          <Field label="Tìm khách nhận xe">{(fid) => <Input id={fid} autoFocus placeholder="Tên, SĐT, mã KH…" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
          <ul className="space-y-1.5">
            {found.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => window.confirm(`Chuyển xe ${v.plate} sang ${c.name}?`) && void run(() => api(`/vehicles/${v.id}/transfer`, { body: { customerId: c.id } }))} className="flex w-full items-center gap-3 rounded-xl border border-slate-100 bg-white p-2.5 text-left text-sm hover:border-brand-200" data-testid="transfer-candidate">
                  <UserRound className="h-4 w-4 text-slate-400" />
                  <span className="flex-1 font-medium">{c.name}</span>
                  <span className="text-xs text-slate-500">{c.phone ?? c.code}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Dialog>
    </div>
  );
}

export default function VehiclePage() {
  return (
    <RequirePermission permission="vehicle.view">
      <VehicleDetail />
    </RequirePermission>
  );
}
