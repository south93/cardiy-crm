'use client';

import { Alert, Badge, Button, Card, CardTitle, Dialog, Field, Input, Select, Spinner } from '@cardiy/ui';
import { Car, ShoppingBag, UserPlus, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { CustomerForm, customerPayload, emptyCustomer, vehiclePayload } from '@/components/crm-forms';
import { OrderItemsEditor } from '@/components/order-items';
import {
  emptyIntakeDraft,
  IntakeDraftCard,
  intakeDraftToPayload,
  type DraftPhoto,
  type IntakeDraft,
} from '@/components/order-media';
import { CustomerPicker } from '@/components/customer-picker';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCurrentBranch } from '@/lib/branch';
import { fmtKm } from '@/lib/crm';
import { draftsToPayload, newItem, parseMoney, type ItemDraft } from '@/lib/orders';

interface CustomerLite {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  orderDebt?: number;
  vehicles: {
    id: string;
    plate: string;
    make: string | null;
    model: string | null;
    odometerKm: number | null;
  }[];
}
interface Staff {
  id: string;
  name: string;
  roles: string[];
}


function NewOrder() {
  const router = useRouter();
  const params = useSearchParams();
  const { me } = useAuth();
  const currentBranch = useCurrentBranch();
  const [branchId, setBranchId] = useState('');
  const [customer, setCustomer] = useState<CustomerLite | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [newCustomer, setNewCustomer] = useState(false);
  const [km, setKm] = useState('');
  const [request, setRequest] = useState('');
  const [note, setNote] = useState('');
  const [promisedAt, setPromisedAt] = useState('');
  const [technicianId, setTechnicianId] = useState('');
  const [staff, setStaff] = useState<Staff[]>([]);
  const [rows, setRows] = useState<ItemDraft[]>([newItem('DICH_VU')]);
  const [discount, setDiscount] = useState('');
  const [intake, setIntake] = useState<IntakeDraft>(() => emptyIntakeDraft());
  const [intakePhotos, setIntakePhotos] = useState<DraftPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!branchId && currentBranch) setBranchId(currentBranch);
  }, [currentBranch, branchId]);
  useEffect(() => {
    if (!branchId) return;
    api<Staff[]>(`/orders/staff-options?branchId=${branchId}`).then(setStaff, () => setStaff([]));
  }, [branchId]);

  const pick = async (customerId: string, vId: string | null) => {
    setError(null);
    const c = await api<CustomerLite>(`/customers/${customerId}`);
    setCustomer(c);
    setVehicleId(vId ?? (c.vehicles.length === 1 ? c.vehicles[0]!.id : null));
  };

  // Mở từ hồ sơ khách / xe: ?customerId=…&vehicleId=…
  useEffect(() => {
    const cid = params.get('customerId');
    if (cid) void pick(cid, params.get('vehicleId'));
  }, [params]);

  const vehicle = customer?.vehicles.find((v) => v.id === vehicleId) ?? null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!customer) return setError('Chọn khách hàng trước');
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>('/orders', {
        body: {
          branchId,
          customerId: customer.id,
          vehicleId,
          odometerKm: km ? Number(km.replace(/\D/g, '')) : null,
          request: request || null,
          note: note || null,
          promisedAt: promisedAt ? new Date(promisedAt).toISOString() : null,
          technicianId: technicianId || null,
          orderDiscount: parseMoney(discount),
          items: draftsToPayload(rows),
          intake: vehicle ? intakeDraftToPayload(intake) : null,
          intakePhotos:
            vehicle && intakePhotos.length
              ? intakePhotos.map((p) => ({ fileId: p.fileId, tag: p.tag, caption: p.caption }))
              : null,
        },
      });
      router.push(`/don-hang/${r.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? (err.errors?.[0]?.message ?? err.message) : 'Không tạo được đơn');
      setBusy(false);
    }
  };

  return (
    <>
      <form onSubmit={submit} className="space-y-4" data-testid="new-order">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <Card className="p-4 lg:p-5">
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Khách hàng & xe</CardTitle>
              {!customer && (
                <Button type="button" variant="outline" onClick={() => setNewCustomer(true)}>
                  <UserPlus className="h-4 w-4" />
                  Khách mới
                </Button>
              )}
            </div>
            {!customer ? (
              <div className="mt-3">
                <CustomerPicker onPick={(c, v) => void pick(c, v)} />
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="flex items-start justify-between gap-3 rounded-2xl bg-slate-50 p-3" data-testid="picked-customer">
                  <div>
                    <div className="font-semibold">{customer.name}</div>
                    <div className="text-sm text-slate-500">
                      {customer.phone ?? 'Không có SĐT'} · {customer.code}
                    </div>
                    {!!customer.orderDebt && customer.orderDebt > 0 && (
                      <Badge tone="rose" className="mt-1">
                        Đang nợ {customer.orderDebt.toLocaleString('vi-VN')} đ
                      </Badge>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label="Đổi khách"
                    onClick={() => (setCustomer(null), setVehicleId(null))}
                    className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Xe">
                  {customer.vehicles.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      role="radio"
                      aria-checked={vehicleId === v.id}
                      onClick={() => setVehicleId(v.id)}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${vehicleId === v.id ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white'}`}
                    >
                      <Car className="h-4 w-4" />
                      <span className="font-mono font-semibold">{v.plate}</span>
                      <span className="text-slate-500">{[v.make, v.model].filter(Boolean).join(' ')}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={vehicleId === null}
                    onClick={() => setVehicleId(null)}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${vehicleId === null ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white'}`}
                  >
                    <ShoppingBag className="h-4 w-4" />
                    Bán lẻ (không có xe)
                  </button>
                </div>
              </div>
            )}
          </Card>

          <Card className="grid gap-3 p-4 lg:p-5">
            <Field label="Chi nhánh">
              {(id) => (
                <Select id={id} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                  {me?.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {vehicle && (
              <Field label="Số km lúc nhận xe" hint={vehicle.odometerKm ? `Lần trước: ${fmtKm(vehicle.odometerKm)}` : undefined}>
                {(id) => (
                  <Input id={id} inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, '') ? Number(e.target.value.replace(/\D/g, '')).toLocaleString('vi-VN') : '')} />
                )}
              </Field>
            )}
            <Field label="Kỹ thuật viên">
              {(id) => (
                <Select id={id} value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
                  <option value="">— Chưa giao —</option>
                  {staff
                    .filter((s) => s.roles.includes('KTV'))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <Field label="Hẹn giao xe">{(id) => <Input id={id} type="datetime-local" value={promisedAt} onChange={(e) => setPromisedAt(e.target.value)} />}</Field>
          </Card>
        </div>

        <Card className="p-4 lg:p-5">
          <Field label="Khách yêu cầu / tình trạng xe">
            {(id) => (
              <textarea
                id={id}
                rows={2}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                placeholder="VD: Thay dầu, kêu gầm bánh trước bên phải"
              />
            )}
          </Field>
        <Field label="Ghi chú" className="mt-3">
          {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Mai khách lấy" />}
        </Field>
        </Card>

        {vehicle && (
          <IntakeDraftCard
            intake={intake}
            onIntakeChange={setIntake}
            photos={intakePhotos}
            onPhotosChange={setIntakePhotos}
          />
        )}

        <Card className="p-4 lg:p-5">
          <CardTitle>Hạng mục</CardTitle>
          <div className="mt-3">
            <OrderItemsEditor rows={rows} onChange={setRows} orderDiscount={discount} onDiscountChange={setDiscount} make={vehicle?.make} branchId={branchId || undefined} />
          </div>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={busy || !customer} data-testid="create-order">
            {busy && <Spinner />}
            Tạo đơn
          </Button>
        </div>
      </form>
      <Dialog open={newCustomer} onClose={() => setNewCustomer(false)} title="Khách mới" wide>
        {newCustomer && (
          <CustomerForm
            initial={emptyCustomer()}
            withVehicle
            submitLabel="Thêm khách và chọn"
            onCancel={() => setNewCustomer(false)}
            onSubmit={async (c, v) => {
              const r = await api<{ id: string }>('/customers', {
                body: {
                  ...customerPayload(c),
                  vehicle: v ? vehiclePayload(v) : null,
                },
              });
              setNewCustomer(false);
              await pick(r.id, null);
            }}
          />
        )}
      </Dialog>
    </>
  );
}

export default function SalesPage() {
  return (
    <RequirePermission permission="ro.manage">
      <Suspense>
        <NewOrder />
      </Suspense>
    </RequirePermission>
  );
}
