'use client';

import { Alert, Badge, Button, Card, CardTitle, Dialog, Spinner, Tabs } from '@cardiy/ui';
import { CalendarClock, Car, ChevronLeft, MessageCircle, Pencil, Phone, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CustomerForm, VehicleFields, customerPayload, emptyVehicle, vehiclePayload, type CustomerFormValue } from '@/components/crm-forms';
import { OrderHistory } from '@/components/order-history';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { daysUntil, expiryText, expiryTone, fmtDate, fmtKm, fmtMoney, initials, sourceLabel, tierOf, type Source, type Tier } from '@/lib/crm';

interface VehicleRow {
  id: string;
  plate: string;
  plateValid: boolean;
  make: string | null;
  model: string | null;
  year: number | null;
  odometerKm: number | null;
  registrationExpiry: string | null;
  insuranceExpiry: string | null;
  fromDate: string;
  toDate: string | null;
}

interface Customer {
  id: string;
  code: string;
  type: 'PERSON' | 'COMPANY';
  name: string;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  address: string | null;
  taxCode: string | null;
  representative: string | null;
  birthday: string | null;
  tier: Tier;
  source: Source;
  note: string | null;
  marketingConsent: boolean;
  openingDebt: number;
  orderDebt: number;
  debt: number;
  orderCount: number;
  createdAt: string;
  branch: { id: string; name: string } | null;
  vehicles: VehicleRow[];
  pastVehicles: VehicleRow[];
}

type Tab = 'xe' | 'thong-tin' | 'lich-su';

function toForm(c: Customer): CustomerFormValue {
  return {
    type: c.type, name: c.name, phone: c.phone ?? '', phone2: c.phone2 ?? '', email: c.email ?? '', address: c.address ?? '', taxCode: c.taxCode ?? '',
    representative: c.representative ?? '', birthday: c.birthday?.slice(0, 10) ?? '', tier: c.tier, source: c.source, branchId: c.branch?.id ?? '', note: c.note ?? '', marketingConsent: c.marketingConsent,
  };
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-dashed border-slate-100 py-2.5 text-sm last:border-0">
      <span className="w-36 shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 flex-1 whitespace-pre-line break-words">{children || '—'}</span>
    </div>
  );
}

function CustomerProfile() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const [c, setC] = useState<Customer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('xe');
  const [dialog, setDialog] = useState<'edit' | 'vehicle' | null>(null);
  const [vehicle, setVehicle] = useState(emptyVehicle());
  const [vError, setVError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setC(await api<Customer>(`/customers/${id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được khách hàng');
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  if (error) return <Alert>{error}</Alert>;
  if (!c) return <div className="grid place-items-center p-10"><Spinner className="h-6 w-6 text-brand-600" /></div>;

  const tier = tierOf(c.tier);
  const reminders = c.vehicles
    .flatMap((v) => [
      { label: `Đăng kiểm ${v.plate}`, days: daysUntil(v.registrationExpiry), date: v.registrationExpiry },
      { label: `Bảo hiểm ${v.plate}`, days: daysUntil(v.insuranceExpiry), date: v.insuranceExpiry },
    ])
    .filter((r) => r.days !== null && r.days <= 60)
    .sort((a, b) => a.days! - b.days!);

  return (
    <div className="space-y-4" data-testid="customer-profile">
      <Link href="/khach-hang" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
        <ChevronLeft className="h-4 w-4" />
        Khách hàng
      </Link>

      <Card className="flex flex-wrap items-center gap-4 p-4 lg:p-5">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-sky-100 text-xl font-semibold text-sky-700 ring-4 ring-white">{initials(c.name) || '?'}</div>
        <div className="min-w-[200px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold" data-testid="customer-name">{c.name}</h2>
            <Badge tone={tier.tone}>Hạng {tier.label}</Badge>
            {c.type === 'COMPANY' && <Badge tone="lav">Doanh nghiệp</Badge>}
          </div>
          <div className="mt-0.5 text-sm text-slate-500">
            {c.phone ?? 'Chưa có SĐT'} · {c.code} · Khách từ {fmtDate(c.createdAt)} · {c.vehicles.length} xe · {c.orderCount} đơn
          </div>
          {c.debt > 0 && (
            <div className="mt-1" data-testid="customer-debt">
              <Badge tone="rose">Công nợ {fmtMoney(c.debt)}</Badge>
            </div>
          )}
        </div>
        {can('ro.manage') && (
          <Link href={`/ban-hang?customerId=${c.id}`}>
            <Button variant="outline" data-testid="new-order-for-customer">
              <Plus className="h-4 w-4" />
              Tạo đơn
            </Button>
          </Link>
        )}
        {c.phone && (
          <>
            <a href={`https://zalo.me/${c.phone}`} target="_blank" rel="noreferrer">
              <Button>
                <MessageCircle className="h-4 w-4" />
                Nhắn Zalo
              </Button>
            </a>
            <a href={`tel:${c.phone}`} aria-label="Gọi" className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white hover:bg-slate-50">
              <Phone className="h-4 w-4" />
            </a>
          </>
        )}
        {can('customer.manage') && (
          <button type="button" onClick={() => setDialog('edit')} aria-label="Sửa khách hàng" className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white hover:bg-slate-50">
            <Pencil className="h-4 w-4" />
          </button>
        )}
      </Card>

      <Tabs
        tabs={[
          { value: 'xe', label: `Xe (${c.vehicles.length})` },
          { value: 'thong-tin', label: 'Thông tin' },
          { value: 'lich-su', label: `Lịch sử sửa chữa (${c.orderCount})` },
        ]}
        value={tab}
        onChange={setTab}
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {tab === 'xe' && (
            <Card className="p-4 lg:p-5">
              <div className="mb-3 flex items-center justify-between">
                <CardTitle>Xe đang sở hữu</CardTitle>
                {can('vehicle.manage') && (
                  <Button variant="outline" onClick={() => { setVehicle(emptyVehicle()); setVError(null); setDialog('vehicle'); }} data-testid="add-vehicle">
                    <Plus className="h-4 w-4" />
                    Thêm xe
                  </Button>
                )}
              </div>
              <div className="space-y-2.5" data-testid="vehicle-list">
                {c.vehicles.map((v) => (
                  <Link key={v.id} href={`/xe/${v.id}`} className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3.5 hover:border-brand-200">
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-50"><Car className="h-4 w-4 text-brand-600" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="font-mono font-semibold">{v.plate}</div>
                      <div className="text-xs text-slate-500">{[v.make, v.model, v.year].filter(Boolean).join(' · ') || 'Chưa có thông tin xe'} · {fmtKm(v.odometerKm)}</div>
                    </div>
                    {!v.plateValid && <Badge tone="peach">Biển cần xem lại</Badge>}
                    <Badge tone={expiryTone(daysUntil(v.registrationExpiry))}>Đăng kiểm: {expiryText(daysUntil(v.registrationExpiry), v.registrationExpiry)}</Badge>
                  </Link>
                ))}
                {!c.vehicles.length && <p className="py-6 text-center text-sm text-slate-500">Khách chưa có xe nào</p>}
              </div>
              {c.pastVehicles.length > 0 && (
                <div className="mt-4 border-t border-dashed border-slate-200 pt-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Xe đã bán / chuyển chủ</div>
                  {c.pastVehicles.map((v) => (
                    <Link key={v.id + v.fromDate} href={`/xe/${v.id}`} className="block py-1 text-sm text-slate-600 hover:text-brand-600">
                      <span className="font-mono">{v.plate}</span> · {fmtDate(v.fromDate)} → {fmtDate(v.toDate)}
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          )}
          {tab === 'thong-tin' && (
            <Card className="p-4 lg:p-5">
              <Info label="Mã khách">{c.code}</Info>
              <Info label="Số điện thoại">{[c.phone, c.phone2].filter(Boolean).join(' · ')}</Info>
              <Info label="Email">{c.email}</Info>
              <Info label="Địa chỉ">{c.address}</Info>
              <Info label="Ngày sinh">{c.birthday ? fmtDate(c.birthday) : null}</Info>
              {c.type === 'COMPANY' && <Info label="Mã số thuế">{c.taxCode}</Info>}
              {c.type === 'COMPANY' && <Info label="Người đại diện">{c.representative}</Info>}
              <Info label="Nguồn khách">{sourceLabel(c.source)}</Info>
              <Info label="Chi nhánh">{c.branch?.name}</Info>
              <Info label="Nhận tin chăm sóc">{c.marketingConsent ? 'Đã đồng ý' : 'Chưa đồng ý'}</Info>
              <Info label="Công nợ ban đầu">{c.openingDebt ? fmtMoney(c.openingDebt) : null}</Info>
              <Info label="Ghi chú">{c.note}</Info>
            </Card>
          )}
          {tab === 'lich-su' && <OrderHistory customerId={c.id} />}
        </div>

        <div className="space-y-4">
          <Card className="p-4 lg:p-5">
            <CardTitle className="mb-3">Nhắc nhở sắp tới</CardTitle>
            {reminders.length ? (
              <ul className="space-y-2">
                {reminders.map((r) => (
                  <li key={r.label} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3 text-sm">
                    <CalendarClock className="h-4 w-4 text-slate-400" />
                    <span className="flex-1">{r.label}</span>
                    <Badge tone={expiryTone(r.days)}>{expiryText(r.days, r.date)}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <ShieldCheck className="h-4 w-4 text-mint-700" />
                Không có hạn đăng kiểm / bảo hiểm trong 60 ngày tới
              </p>
            )}
          </Card>
          {can('customer.manage') && (
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm(`Xoá khách ${c.name}? Thông tin vẫn được giữ trong nhật ký.`)) return;
                try {
                  await api(`/customers/${c.id}`, { method: 'DELETE' });
                  router.replace('/khach-hang');
                } catch (e) {
                  window.alert(e instanceof ApiError ? e.message : 'Không xoá được');
                }
              }}
              className="flex w-full items-center justify-center gap-2 rounded-full py-2 text-sm text-rose-700 hover:bg-rose-100"
            >
              <Trash2 className="h-4 w-4" />
              Xoá khách hàng
            </button>
          )}
        </div>
      </div>

      <Dialog open={dialog === 'edit'} onClose={() => setDialog(null)} title="Sửa khách hàng" wide>
        {dialog === 'edit' && (
          <CustomerForm
            initial={toForm(c)}
            submitLabel="Lưu thay đổi"
            onCancel={() => setDialog(null)}
            onSubmit={async (v) => {
              await api(`/customers/${c.id}`, { method: 'PATCH', body: customerPayload(v) });
              setDialog(null);
              await load();
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={dialog === 'vehicle'}
        onClose={() => setDialog(null)}
        title={`Thêm xe cho ${c.name}`}
        wide
        footer={
          <>
            <Button variant="outline" onClick={() => setDialog(null)}>Huỷ</Button>
            <Button
              data-testid="save-vehicle"
              onClick={async () => {
                setVError(null);
                try {
                  await api('/vehicles', { body: { ...vehiclePayload(vehicle), customerId: c.id } });
                  setDialog(null);
                  await load();
                } catch (e) {
                  setVError(e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : 'Không lưu được');
                }
              }}
            >
              Thêm xe
            </Button>
          </>
        }
      >
        {vError && <Alert className="mb-3">{vError}</Alert>}
        <VehicleFields value={vehicle} onChange={setVehicle} />
      </Dialog>
    </div>
  );
}

export default function CustomerPage() {
  return (
    <RequirePermission permission="customer.view">
      <CustomerProfile />
    </RequirePermission>
  );
}
