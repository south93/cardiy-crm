'use client';

import { Alert, Badge, Button, Card, Dialog, Field, Input, Spinner, Tabs } from '@cardiy/ui';
import { ChevronRight, KeyRound, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/orders';
import { ownerApi } from '@/lib/owner';
import {
  defaultRentalDates,
  fmtVnd,
  localInputToIso,
  publicRentalGet,
  RENTAL_CONTRACT_UI,
  TRANSMISSION_LABEL,
  type RentalContractDetail,
  type RentalVehicleItem,
} from '@/lib/rentals';

/** A2.08 Màn hình Thuê xe trên App chủ xe: Đơn thuê của tôi & Tìm xe đặt thuê */
export default function OwnerRentalsPage() {
  const router = useRouter();
  const def = defaultRentalDates();
  const [tab, setTab] = useState<'mine' | 'find'>('mine');
  const [contracts, setContracts] = useState<RentalContractDetail[] | null>(null);
  const [vehicles, setVehicles] = useState<RentalVehicleItem[] | null>(null);
  const [startLocal, setStartLocal] = useState(def.startLocal);
  const [endLocal, setEndLocal] = useState(def.endLocal);
  const [bookTarget, setBookTarget] = useState<RentalVehicleItem | null>(null);
  const [idCardNo, setIdCardNo] = useState('');
  const [driverLicenseNo, setDriverLicenseNo] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMine = useCallback(async () => {
    setContracts(await ownerApi<RentalContractDetail[]>('/rentals/contracts'));
  }, []);

  const loadVehicles = useCallback(async () => {
    const qs = new URLSearchParams();
    if (startLocal && endLocal) {
      qs.set('startAt', localInputToIso(startLocal));
      qs.set('endAt', localInputToIso(endLocal));
    }
    const res = await publicRentalGet<{ items: RentalVehicleItem[] }>(`/vehicles?${qs}`);
    setVehicles(res.items);
  }, [startLocal, endLocal]);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  useEffect(() => {
    if (tab === 'find') void loadVehicles();
  }, [tab, loadVehicles]);

  async function submitOwnerBook() {
    if (!bookTarget) return;
    setBusy(true);
    setError(null);
    try {
      const res = await ownerApi<{ id: string }>('/rentals/contracts', {
        body: {
          rentalVehicleId: bookTarget.id,
          startAt: localInputToIso(startLocal),
          endAt: localInputToIso(endLocal),
          idCardNo: idCardNo || null,
          driverLicenseNo: driverLicenseNo || null,
          note: note || null,
        },
      });
      setBookTarget(null);
      router.push(`/app/thue-xe/${res.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Đặt thuê xe thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Thuê xe tự lái</h1>
        <Tabs
          tabs={[
            { value: 'mine', label: 'Đơn thuê' },
            { value: 'find', label: 'Tìm xe' },
          ]}
          value={tab}
          onChange={(v) => setTab(v)}
        />
      </div>

      {error && <Alert>{error}</Alert>}

      {tab === 'mine' ? (
        !contracts ? (
          <Spinner className="h-6 w-6 text-brand-600" />
        ) : !contracts.length ? (
          <Card className="p-6 text-center space-y-3">
            <p className="text-sm text-slate-500">Bạn chưa có hợp đồng thuê xe nào.</p>
            <Button onClick={() => setTab('find')} data-testid="owner-find-rental-btn">
              <KeyRound className="h-4 w-4" /> Tìm xe đang cho thuê
            </Button>
          </Card>
        ) : (
          <ul className="space-y-2.5" data-testid="owner-rental-list">
            {contracts.map((c) => (
              <li key={c.id}>
                <Link href={`/app/thue-xe/${c.id}`} className="block">
                  <Card className="flex items-center justify-between gap-2 p-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold">{c.code}</span>
                        <Badge tone={RENTAL_CONTRACT_UI[c.status].tone}>{RENTAL_CONTRACT_UI[c.status].label}</Badge>
                      </div>
                      <div className="mt-1 truncate text-sm font-medium text-slate-800">{c.vehicle.title}</div>
                      <div className="text-xs text-slate-500">
                        {fmtDateTime(c.startAt)} → {fmtDateTime(c.endAt)} · {fmtVnd(c.finalTotal ?? c.baseTotal)}
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="space-y-3">
          <Card className="grid grid-cols-2 gap-2 p-3.5">
            <Field label="Nhận xe">
              {(id) => <Input id={id} type="datetime-local" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} />}
            </Field>
            <Field label="Trả xe">
              {(id) => <Input id={id} type="datetime-local" value={endLocal} onChange={(e) => setEndLocal(e.target.value)} />}
            </Field>
          </Card>

          {!vehicles ? (
            <Spinner className="h-6 w-6 text-brand-600" />
          ) : !vehicles.length ? (
            <Card className="p-6 text-center text-sm text-slate-500">Không có xe nào còn trống trong khoảng ngày này.</Card>
          ) : (
            <ul className="space-y-2.5" data-testid="owner-rental-vehicles">
              {vehicles.map((v) => (
                <li key={v.id}>
                  <Card className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-slate-900">{v.title}</div>
                        <div className="text-xs text-slate-500">
                          {v.seats} chỗ · {TRANSMISSION_LABEL[v.transmission]} · Cọc {fmtVnd(v.deposit)}
                        </div>
                        {v.shop && (
                          <div className="flex items-center gap-1 text-xs text-slate-500">
                            <MapPin className="h-3 w-3" /> {v.shop.name}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-emerald-700">{fmtVnd(v.dailyPrice)}</div>
                        <div className="text-xs text-slate-400">/ ngày</div>
                      </div>
                    </div>
                    <Button className="w-full justify-center" onClick={() => setBookTarget(v)} data-testid="owner-book-rental-open">
                      Đặt thuê ngay
                    </Button>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Dialog
        open={!!bookTarget}
        onClose={() => setBookTarget(null)}
        title={bookTarget ? `Đặt thuê: ${bookTarget.title}` : 'Đặt thuê xe'}
        footer={
          <>
            <Button variant="outline" onClick={() => setBookTarget(null)}>
              Huỷ
            </Button>
            <Button onClick={submitOwnerBook} disabled={busy} data-testid="owner-book-rental-confirm">
              Gửi yêu cầu đặt thuê
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Số CCCD">
              {(id) => <Input id={id} value={idCardNo} onChange={(e) => setIdCardNo(e.target.value)} placeholder="07909..." />}
            </Field>
            <Field label="Số GPLX">
              {(id) => <Input id={id} value={driverLicenseNo} onChange={(e) => setDriverLicenseNo(e.target.value)} placeholder="B2..." />}
            </Field>
          </div>
          <Field label="Ghi chú cho garage">
            {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Nhận xe đúng 8h sáng" />}
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
