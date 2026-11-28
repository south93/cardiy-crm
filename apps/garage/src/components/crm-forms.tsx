'use client';

import { Alert, Button, Checkbox, Field, Input, Select, Spinner } from '@cardiy/ui';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { SOURCES, TIERS, type Source, type Tier } from '@/lib/crm';
import { BADGE_TYPES } from '@/lib/fleet';

export interface CustomerFormValue {
  type: 'PERSON' | 'COMPANY';
  name: string;
  phone: string;
  phone2: string;
  email: string;
  address: string;
  taxCode: string;
  representative: string;
  birthday: string;
  tier: Tier;
  source: Source;
  branchId: string;
  note: string;
  marketingConsent: boolean;
}

export interface VehicleFormValue {
  plate: string;
  make: string;
  model: string;
  year: string;
  color: string;
  vin: string;
  fuel: string;
  transmission: string;
  tireSize: string;
  odometerKm: string;
  registrationExpiry: string;
  insuranceExpiry: string;
  badgeNo: string;
  badgeType: string;
  badgeExpiry: string;
  registrationRemindDays: string;
  insuranceRemindDays: string;
  badgeRemindDays: string;
  note: string;
}

export const emptyVehicle = (): VehicleFormValue => ({
  plate: '',
  make: '',
  model: '',
  year: '',
  color: '',
  vin: '',
  fuel: '',
  transmission: '',
  tireSize: '',
  odometerKm: '',
  registrationExpiry: '',
  insuranceExpiry: '',
  badgeNo: '',
  badgeType: '',
  badgeExpiry: '',
  registrationRemindDays: '',
  insuranceRemindDays: '',
  badgeRemindDays: '',
  note: '',
});

export const emptyCustomer = (): CustomerFormValue => ({
  type: 'PERSON', name: '', phone: '', phone2: '', email: '', address: '', taxCode: '', representative: '', birthday: '', tier: 'THUONG', source: 'VANG_LAI', branchId: '', note: '', marketingConsent: false,
});

/** Chuyển giá trị form xe sang dữ liệu gửi API (bỏ ô trống). */
export function vehiclePayload(v: VehicleFormValue, includeKm = true) {
  const t = (s: string) => (s.trim() ? s.trim() : null);
  const numOrNull = (s: string) => (s.trim() ? Number(s.replace(/\D/g, '')) || null : null);
  return {
    plate: v.plate.trim(),
    make: t(v.make),
    model: t(v.model),
    year: v.year ? Number(v.year) : null,
    color: t(v.color),
    vin: t(v.vin),
    fuel: t(v.fuel),
    transmission: t(v.transmission),
    tireSize: t(v.tireSize),
    ...(includeKm ? { odometerKm: v.odometerKm ? Number(v.odometerKm.replace(/\D/g, '')) : null } : {}),
    registrationExpiry: v.registrationExpiry || null,
    insuranceExpiry: v.insuranceExpiry || null,
    badgeNo: t(v.badgeNo),
    badgeType: t(v.badgeType),
    badgeExpiry: v.badgeExpiry || null,
    registrationRemindDays: numOrNull(v.registrationRemindDays),
    insuranceRemindDays: numOrNull(v.insuranceRemindDays),
    badgeRemindDays: numOrNull(v.badgeRemindDays),
    note: t(v.note),
  };
}

export function customerPayload(c: CustomerFormValue) {
  const t = (s: string) => (s.trim() ? s.trim() : null);
  return {
    type: c.type,
    name: c.name.trim(),
    phone: t(c.phone),
    phone2: t(c.phone2),
    email: t(c.email),
    address: t(c.address),
    taxCode: t(c.taxCode),
    representative: t(c.representative),
    birthday: c.birthday || null,
    tier: c.tier,
    source: c.source,
    branchId: c.branchId || null,
    note: t(c.note),
    marketingConsent: c.marketingConsent,
  };
}

export function VehicleFields({ value, onChange, showKm = true }: { value: VehicleFormValue; onChange: (v: VehicleFormValue) => void; showKm?: boolean }) {
  const set = (k: keyof VehicleFormValue) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Biển số" hint="VD: 61C-279.99">{(id) => <Input id={id} name="plate" required value={value.plate} onChange={set('plate')} className="uppercase" />}</Field>
        <Field label="Hãng xe">{(id) => <Input id={id} name="make" value={value.make} onChange={set('make')} placeholder="Toyota" />}</Field>
        <Field label="Dòng xe">{(id) => <Input id={id} name="model" value={value.model} onChange={set('model')} placeholder="Vios" />}</Field>
        <Field label="Đời xe (năm)">{(id) => <Input id={id} name="year" inputMode="numeric" value={value.year} onChange={set('year')} />}</Field>
        <Field label="Màu xe">{(id) => <Input id={id} name="color" value={value.color} onChange={set('color')} />}</Field>
        {showKm && <Field label="Số km hiện tại">{(id) => <Input id={id} name="odometerKm" inputMode="numeric" value={value.odometerKm} onChange={set('odometerKm')} />}</Field>}
        <Field label="Số VIN" hint="17 ký tự" className="sm:col-span-2">{(id) => <Input id={id} name="vin" value={value.vin} onChange={set('vin')} className="uppercase" />}</Field>
        <Field label="Size lốp">{(id) => <Input id={id} name="tireSize" value={value.tireSize} onChange={set('tireSize')} placeholder="185/60R15" />}</Field>
        <Field label="Nhiên liệu">
          {(id) => (
            <Select id={id} name="fuel" value={value.fuel} onChange={set('fuel')}>
              <option value="">—</option>
              {['Xăng', 'Dầu', 'Hybrid', 'Điện'].map((f) => <option key={f}>{f}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Hộp số">
          {(id) => (
            <Select id={id} name="transmission" value={value.transmission} onChange={set('transmission')}>
              <option value="">—</option>
              {['Số sàn', 'Số tự động', 'CVT'].map((f) => <option key={f}>{f}</option>)}
            </Select>
          )}
        </Field>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Theo dõi hạn giấy tờ & thời điểm gửi thông báo trước khi hết hạn
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Hạn đăng kiểm">{(id) => <Input id={id} name="registrationExpiry" type="date" value={value.registrationExpiry} onChange={set('registrationExpiry')} />}</Field>
          <Field label="Hạn bảo hiểm">{(id) => <Input id={id} name="insuranceExpiry" type="date" value={value.insuranceExpiry} onChange={set('insuranceExpiry')} />}</Field>
          <Field label="Hạn phù hiệu xe">{(id) => <Input id={id} name="badgeExpiry" type="date" value={value.badgeExpiry} onChange={set('badgeExpiry')} />}</Field>
          <Field label="Số phù hiệu xe">{(id) => <Input id={id} name="badgeNo" value={value.badgeNo} onChange={set('badgeNo')} placeholder="VD: HP-612409" />}</Field>
          <Field label="Loại phù hiệu">
            {(id) => (
              <Select id={id} name="badgeType" value={value.badgeType} onChange={set('badgeType')}>
                <option value="">— Không / Chưa gắn —</option>
                {BADGE_TYPES.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="hidden sm:block" />
          <Field label="Nhắc trước hạn đăng kiểm (ngày)" hint="Để trống = theo Cài đặt chung">
            {(id) => <Input id={id} name="registrationRemindDays" type="number" min={1} max={180} value={value.registrationRemindDays} onChange={set('registrationRemindDays')} placeholder="Mặc định" />}
          </Field>
          <Field label="Nhắc trước hạn bảo hiểm (ngày)" hint="Để trống = theo Cài đặt chung">
            {(id) => <Input id={id} name="insuranceRemindDays" type="number" min={1} max={180} value={value.insuranceRemindDays} onChange={set('insuranceRemindDays')} placeholder="Mặc định" />}
          </Field>
          <Field label="Nhắc trước hạn phù hiệu (ngày)" hint="Để trống = theo Cài đặt chung">
            {(id) => <Input id={id} name="badgeRemindDays" type="number" min={1} max={180} value={value.badgeRemindDays} onChange={set('badgeRemindDays')} placeholder="Mặc định" />}
          </Field>
        </div>
      </div>
    </div>
  );
}

export function CustomerForm({
  initial,
  withVehicle,
  submitLabel,
  onSubmit,
  onCancel,
  extra,
}: {
  initial: CustomerFormValue;
  withVehicle?: boolean;
  submitLabel: string;
  onSubmit: (c: CustomerFormValue, v: VehicleFormValue | null) => Promise<void>;
  onCancel: () => void;
  extra?: ReactNode;
}) {
  const { me, can } = useAuth();
  const [c, setC] = useState(initial);
  const [addVehicle, setAddVehicle] = useState(!!withVehicle && can('vehicle.manage'));
  const [v, setV] = useState(emptyVehicle());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof CustomerFormValue) => (e: { target: { value: string } }) => setC({ ...c, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onSubmit(c, addVehicle ? v : null);
    } catch (err) {
      setError(err instanceof ApiError ? (err.errors?.[0]?.message ?? err.message) : 'Không lưu được');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" id="customer-form">
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Loại khách">
          {(id) => (
            <Select id={id} name="type" value={c.type} onChange={set('type')}>
              <option value="PERSON">Cá nhân</option>
              <option value="COMPANY">Doanh nghiệp</option>
            </Select>
          )}
        </Field>
        <Field label={c.type === 'COMPANY' ? 'Tên doanh nghiệp' : 'Họ tên / cách gọi'} className="sm:col-span-2">
          {(id) => <Input id={id} name="name" required value={c.name} onChange={set('name')} placeholder="VD: Anh Tuấn" />}
        </Field>
        <Field label="Số điện thoại" hint="Bỏ trống nếu khách không để lại số">{(id) => <Input id={id} name="phone" inputMode="tel" value={c.phone} onChange={set('phone')} />}</Field>
        <Field label="SĐT phụ">{(id) => <Input id={id} name="phone2" inputMode="tel" value={c.phone2} onChange={set('phone2')} />}</Field>
        <Field label="Email">{(id) => <Input id={id} name="email" type="email" value={c.email} onChange={set('email')} />}</Field>
        <Field label="Địa chỉ" className="sm:col-span-2">{(id) => <Input id={id} name="address" value={c.address} onChange={set('address')} />}</Field>
        <Field label="Ngày sinh">{(id) => <Input id={id} name="birthday" type="date" value={c.birthday} onChange={set('birthday')} />}</Field>
        {c.type === 'COMPANY' && (
          <>
            <Field label="Mã số thuế">{(id) => <Input id={id} name="taxCode" value={c.taxCode} onChange={set('taxCode')} />}</Field>
            <Field label="Người đại diện" className="sm:col-span-2">{(id) => <Input id={id} name="representative" value={c.representative} onChange={set('representative')} />}</Field>
          </>
        )}
        <Field label="Hạng">
          {(id) => (
            <Select id={id} name="tier" value={c.tier} onChange={set('tier')}>
              {TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Nguồn khách">
          {(id) => (
            <Select id={id} name="source" value={c.source} onChange={set('source')}>
              {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Chi nhánh">
          {(id) => (
            <Select id={id} name="branchId" value={c.branchId} onChange={set('branchId')}>
              <option value="">—</option>
              {me?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Ghi chú" className="sm:col-span-3">{(id) => <Input id={id} name="note" value={c.note} onChange={set('note')} />}</Field>
      </div>
      <Checkbox
        checked={c.marketingConsent}
        onChange={(e) => setC({ ...c, marketingConsent: e.target.checked })}
        label="Khách đồng ý nhận tin nhắn chăm sóc, khuyến mại (Zalo/SMS)"
      />
      {withVehicle && can('vehicle.manage') && (
        <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
          <Checkbox checked={addVehicle} onChange={(e) => setAddVehicle(e.target.checked)} label={<span className="font-medium">Thêm xe của khách</span>} />
          {addVehicle && (
            <div className="mt-3">
              <VehicleFields value={v} onChange={setV} />
            </div>
          )}
        </div>
      )}
      {extra}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" onClick={onCancel}>
          Huỷ
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
