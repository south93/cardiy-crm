'use client';

import { cn, Field, Input } from '@cardiy/ui';
import { Check } from 'lucide-react';
import { planPrice, type ApplicationForm, type PublicPlan } from '@/lib/partners';

/** Thông tin hồ sơ đăng ký đối tác: dùng chung cho trang đăng ký và trang bổ sung hồ sơ */
export function PartnerApplicationFields({ v, onChange, plans, errors }: { v: ApplicationForm; onChange: (v: ApplicationForm) => void; plans: PublicPlan[]; errors?: Record<string, string> }) {
  const set = (k: keyof ApplicationForm) => (e: { target: { value: string } }) => onChange({ ...v, [k]: e.target.value });
  return (
    <div className="space-y-5">
      {plans.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-medium text-slate-700">Chọn gói</div>
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Chọn gói">
            {plans.map((p) => {
              const on = v.planId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onChange({ ...v, planId: on ? '' : p.id })}
                  className={cn('rounded-2xl border p-4 text-left transition-colors', on ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-200' : 'border-slate-200 bg-white hover:border-brand-300')}
                  data-testid="plan-option"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold">{p.name}</div>
                    {on && <Check className="h-5 w-5 text-brand-600" />}
                  </div>
                  <div className="mt-1 text-lg font-bold tabular-nums text-brand-700">{planPrice(p.monthlyFee, p.billingMonths)}</div>
                  {p.description && <p className="mt-1 text-xs text-slate-500">{p.description}</p>}
                  {p.features.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                      {p.features.map((f) => (
                        <li key={f}>• {f}</li>
                      ))}
                    </ul>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tên garage *" className="sm:col-span-2" error={errors?.garageName}>
          {(id) => <Input id={id} required value={v.garageName} onChange={set('garageName')} placeholder="VD: Garage Minh Phát" />}
        </Field>
        <Field label="Mã số thuế" hint="10 số, hoặc 10 số-3 số (chi nhánh)" error={errors?.taxCode}>
          {(id) => <Input id={id} inputMode="numeric" value={v.taxCode} onChange={set('taxCode')} />}
        </Field>
        <Field label="Tỉnh / thành phố" error={errors?.province}>
          {(id) => <Input id={id} value={v.province} onChange={set('province')} />}
        </Field>
        <Field label="Địa chỉ garage *" className="sm:col-span-2" error={errors?.address}>
          {(id) => <Input id={id} required value={v.address} onChange={set('address')} />}
        </Field>
        <Field label="Người đại diện *" error={errors?.representative}>
          {(id) => <Input id={id} required value={v.representative} onChange={set('representative')} />}
        </Field>
        <Field label="Số điện thoại *" hint="Dùng làm tài khoản đăng nhập khi được duyệt" error={errors?.phone}>
          {(id) => <Input id={id} required inputMode="tel" value={v.phone} onChange={set('phone')} />}
        </Field>
        <Field label="Email" className="sm:col-span-2" error={errors?.email}>
          {(id) => <Input id={id} type="email" value={v.email} onChange={set('email')} />}
        </Field>
        <Field label="Ghi chú cho sàn" className="sm:col-span-2" error={errors?.note}>
          {(id) => <Input id={id} value={v.note} onChange={set('note')} placeholder="Dịch vụ chính, số khoang sửa chữa…" />}
        </Field>
      </div>
    </div>
  );
}

export const fieldErrors = (errors?: { field: string; message: string }[]) => Object.fromEntries((errors ?? []).map((e) => [e.field, e.message]));
