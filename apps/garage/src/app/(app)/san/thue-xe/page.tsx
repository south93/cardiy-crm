'use client';

import { Alert, Badge, Button, Card, Dialog, Field, Input, Spinner, Tabs } from '@cardiy/ui';
import { Ban, CheckCircle2, Search, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ExportButton } from '@/components/export-button';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/orders';
import {
  fmtVnd,
  FUEL_LABEL,
  RENTAL_CONTRACT_UI,
  RENTAL_LISTING_UI,
  TRANSMISSION_LABEL,
  type RentalContractDetail,
  type RentalListingStatus,
  type RentalVehicleItem,
} from '@/lib/rentals';

export default function PlatformRentalsModerationPage() {
  return (
    <RequirePermission permission="platform.partner.review">
      <PlatformRentalsBody />
    </RequirePermission>
  );
}

function PlatformRentalsBody() {
  const [section, setSection] = useState<'vehicles' | 'contracts'>('vehicles');
  const [status, setStatus] = useState<'CHO_DUYET' | 'DANG_CHO_THUE' | 'BI_TU_CHOI' | 'BI_GO' | 'ALL'>('CHO_DUYET');
  const [q, setQ] = useState('');
  const [vehData, setVehData] = useState<{ counts: Record<string, number>; items: RentalVehicleItem[] } | null>(null);
  const [conData, setConData] = useState<{ counts: Record<string, number>; items: RentalContractDetail[] } | null>(null);
  const [noteTarget, setNoteTarget] = useState<{ item: RentalVehicleItem; action: 'reject' | 'takedown' } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const vQs = new URLSearchParams({ status });
      const cQs = new URLSearchParams();
      if (q.trim()) {
        vQs.set('q', q.trim());
        cQs.set('q', q.trim());
      }
      const [v, c] = await Promise.all([
        api<{ counts: Record<string, number>; items: RentalVehicleItem[] }>(`/platform/rentals/vehicles?${vQs}`),
        api<{ counts: Record<string, number>; items: RentalContractDetail[] }>(`/platform/rentals/contracts?${cQs}`),
      ]);
      setVehData(v);
      setConData(c);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được dữ liệu kiểm duyệt xe thuê');
    }
  }, [status, q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function approve(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/platform/rentals/vehicles/${id}/approve`, { body: {} });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Duyệt thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function submitModerationNote() {
    if (!noteTarget) return;
    setBusy(noteTarget.item.id);
    setError(null);
    try {
      await api(`/platform/rentals/vehicles/${noteTarget.item.id}/${noteTarget.action}`, { body: { note } });
      setNoteTarget(null);
      setNote('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Thao tác thất bại');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4" data-testid="platform-rentals-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          tabs={[
            {
              value: 'vehicles',
              label: `Kiểm duyệt xe cho thuê${vehData?.counts.CHO_DUYET ? ` (${vehData.counts.CHO_DUYET} chờ duyệt)` : ''}`,
            },
            { value: 'contracts', label: `Hợp đồng thuê toàn sàn${conData ? ` (${conData.items.length})` : ''}` },
          ]}
          value={section}
          onChange={(v) => setSection(v)}
        />

        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mã xe, biển số, tên khách…" className="rounded-full bg-white/85 pl-10" aria-label="Tìm xe thuê" />
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      {section === 'vehicles' ? (
        <div className="space-y-3">
          <Tabs
            tabs={[
              { value: 'CHO_DUYET', label: `Chờ duyệt (${vehData?.counts.CHO_DUYET ?? 0})` },
              { value: 'DANG_CHO_THUE', label: `Đang cho thuê (${vehData?.counts.DANG_CHO_THUE ?? 0})` },
              { value: 'BI_TU_CHOI', label: `Bị từ chối (${vehData?.counts.BI_TU_CHOI ?? 0})` },
              { value: 'BI_GO', label: `Đã gỡ (${vehData?.counts.BI_GO ?? 0})` },
              { value: 'ALL', label: 'Tất cả' },
            ]}
            value={status}
            onChange={(v) => setStatus(v)}
          />

          {!vehData ? (
            <Spinner className="h-6 w-6 text-brand-600" />
          ) : !vehData.items.length ? (
            <Card className="p-10 text-center text-sm text-slate-500">Không có xe cho thuê nào trong mục này.</Card>
          ) : (
            <ul className="space-y-3" data-testid="platform-rental-vehicles">
              {vehData.items.map((v) => {
                const st = RENTAL_LISTING_UI[v.status as RentalListingStatus];
                return (
                  <li key={v.id}>
                    <Card className="flex flex-wrap items-start justify-between gap-4 p-5" data-testid="platform-rental-vehicle-card">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-slate-500">{v.code}</span>
                          <Badge tone={st.tone}>{st.label}</Badge>
                          <Badge tone="sky">{v.sellerType === 'GARAGE' ? 'PLG' : 'Đối tác'}</Badge>
                          <span className="text-xs font-medium text-slate-600">{v.shop?.name}</span>
                        </div>
                        <h3 className="text-base font-semibold text-slate-900">{v.title}</h3>
                        <div className="text-xs text-slate-600">
                          Biển số: <b className="font-mono">{v.plateNo}</b> · {v.seats} chỗ · {TRANSMISSION_LABEL[v.transmission]} · {FUEL_LABEL[v.fuel]} · Đời {v.year}
                        </div>
                        <div className="text-xs text-slate-600">
                          Giá thuê: <b>{fmtVnd(v.dailyPrice)}/ngày</b> · Cọc: <b>{fmtVnd(v.deposit)}</b> · Khu vực: {v.province || '—'}
                        </div>
                        {v.terms && <p className="text-xs text-slate-500">Điều kiện: {v.terms}</p>}
                        {v.reviewNote && <p className="text-xs text-rose-600">Lý do: {v.reviewNote}</p>}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {v.status === 'CHO_DUYET' && (
                          <>
                            <Button onClick={() => approve(v.id)} disabled={busy === v.id} data-testid="platform-rental-approve">
                              <CheckCircle2 className="h-4 w-4" /> Duyệt đăng sàn
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => {
                                setNoteTarget({ item: v, action: 'reject' });
                                setNote('');
                              }}
                              disabled={busy === v.id}
                              data-testid="platform-rental-reject"
                            >
                              <XCircle className="h-4 w-4" /> Từ chối
                            </Button>
                          </>
                        )}
                        {(v.status === 'DANG_CHO_THUE' || v.status === 'TAM_AN') && (
                          <Button
                            variant="outline"
                            onClick={() => {
                              setNoteTarget({ item: v, action: 'takedown' });
                              setNote('');
                            }}
                            disabled={busy === v.id}
                            data-testid="platform-rental-takedown"
                          >
                            <Ban className="h-4 w-4 text-rose-600" /> Gỡ khỏi sàn
                          </Button>
                        )}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : !conData ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : !conData.items.length ? (
        <Card className="p-10 text-center text-sm text-slate-500">Chưa có hợp đồng thuê xe nào.</Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <span className="text-sm font-semibold text-slate-800">Danh sách hợp đồng thuê xe ({conData.items.length})</span>
            <ExportButton
              filename="hop-dong-thue-xe-san"
              sheetName="Hợp đồng thuê xe"
              testId="export-platform-rentals"
              rows={conData.items}
              columns={[
                { header: 'Mã HĐ', value: (c) => c.code },
                { header: 'Garage', value: (c) => c.garage.name },
                { header: 'Xe thuê', value: (c) => c.vehicle.title },
                { header: 'Biển số', value: (c) => c.vehicle.plateNo },
                { header: 'Khách hàng', value: (c) => c.customerName },
                { header: 'Số điện thoại', value: (c) => c.phone },
                { header: 'Từ lúc', value: (c) => fmtDateTime(c.startAt) },
                { header: 'Đến lúc', value: (c) => fmtDateTime(c.endAt) },
                { header: 'Số ngày', value: (c) => c.rentalDays },
                { header: 'Chi phí', value: (c) => c.finalTotal ?? c.baseTotal },
                { header: 'Trạng thái', value: (c) => RENTAL_CONTRACT_UI[c.status].label },
              ]}
            />
          </div>
          <table className="w-full text-left text-sm" data-testid="platform-rental-contracts">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Mã HĐ</th>
                <th className="px-4 py-3">Garage</th>
                <th className="px-4 py-3">Xe thuê</th>
                <th className="px-4 py-3">Khách hàng</th>
                <th className="px-4 py-3">Thời gian</th>
                <th className="px-4 py-3">Chi phí</th>
                <th className="px-4 py-3">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {conData.items.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 font-mono font-semibold">{c.code}</td>
                  <td className="px-4 py-3">{c.garage.name}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{c.vehicle.title}</div>
                    <div className="font-mono text-xs text-slate-500">{c.vehicle.plateNo}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{c.customerName}</div>
                    <div className="text-xs text-slate-500">{c.phone}</div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {fmtDateTime(c.startAt)} → {fmtDateTime(c.endAt)} ({c.rentalDays} ngày)
                  </td>
                  <td className="px-4 py-3 tabular-nums">{fmtVnd(c.finalTotal ?? c.baseTotal)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={RENTAL_CONTRACT_UI[c.status].tone}>{RENTAL_CONTRACT_UI[c.status].label}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Dialog
        open={!!noteTarget}
        onClose={() => setNoteTarget(null)}
        title={noteTarget?.action === 'reject' ? 'Từ chối xe cho thuê' : 'Gỡ xe cho thuê khỏi sàn'}
        footer={
          <>
            <Button variant="outline" onClick={() => setNoteTarget(null)}>
              Huỷ
            </Button>
            <Button className="bg-rose-600 hover:bg-rose-700" onClick={submitModerationNote} disabled={!!busy} data-testid="platform-rental-note-confirm">
              Xác nhận
            </Button>
          </>
        }
      >
        <Field label="Lý do gửi tới garage *">
          {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Bổ sung ảnh rõ biển số và điều kiện thuê…" />}
        </Field>
      </Dialog>
    </div>
  );
}
