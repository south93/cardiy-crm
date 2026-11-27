'use client';

import { Alert, Badge, Button, Card, Dialog, Input, Spinner, Tabs } from '@cardiy/ui';
import { ExternalLink, Eye, LifeBuoy, MapPin, Navigation, Phone, Search, Star } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ExportButton } from '@/components/export-button';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/orders';
import { fmtMoney, mapsDirectionUrl, SOS_STATUS_UI, type SosDetail } from '@/lib/sos';

interface PlatformSosData {
  kpis: {
    searching: number;
    active: number;
    noGarage: number;
    completed: number;
    cancelled: number;
    avgAcceptSec: number | null;
    onDutyGarages: number;
  };
  garages: {
    tenantId: string;
    tenantType: string;
    name: string;
    slug: string | null;
    hotline: string | null;
    address: string | null;
    onDuty: boolean;
    radiusKm: number;
    basePrice: number;
  }[];
  items: SosDetail[];
}

type StatusFilter = 'ALL' | 'DANG_TIM_GARAGE' | 'ACTIVE' | 'KHONG_CO_GARAGE' | 'HOAN_THANH' | 'KHACH_HUY';

/** A6.61 Admin sàn: Giám sát cứu hộ toàn hệ thống */
export default function PlatformSosSupervisionPage() {
  return (
    <RequirePermission permission="platform.report.handle">
      <PlatformSosBody />
    </RequirePermission>
  );
}

function PlatformSosBody() {
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [q, setQ] = useState('');
  const [data, setData] = useState<PlatformSosData | null>(null);
  const [selected, setSelected] = useState<SosDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ status });
      if (q.trim()) qs.set('q', q.trim());
      setData(await api<PlatformSosData>(`/platform/sos?${qs}`));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được dữ liệu giám sát cứu hộ');
    }
  }, [status, q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  return (
    <div className="space-y-5" data-testid="platform-sos-page">
      {error && <Alert>{error}</Alert>}

      {data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6" data-testid="platform-sos-kpis">
          <Card className="p-4">
            <div className="text-xs text-slate-500">Đang tìm garage</div>
            <div className="mt-1 text-2xl font-bold text-amber-600">{data.kpis.searching}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-slate-500">Đang cứu hộ</div>
            <div className="mt-1 text-2xl font-bold text-brand-700">{data.kpis.active}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-slate-500">Chưa có garage nhận</div>
            <div className="mt-1 text-2xl font-bold text-rose-600">{data.kpis.noGarage}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-slate-500">Đã hoàn thành</div>
            <div className="mt-1 text-2xl font-bold text-emerald-700">{data.kpis.completed}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-slate-500">Phản hồi TB</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">
              {data.kpis.avgAcceptSec !== null ? `${data.kpis.avgAcceptSec}s` : '—'}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-slate-500">Garage đang trực</div>
            <div className="mt-1 text-2xl font-bold text-emerald-700">{data.kpis.onDutyGarages}</div>
          </Card>
        </div>
      )}

      {data && data.garages.length > 0 && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <LifeBuoy className="h-4 w-4 text-rose-600" /> Mạng lưới garage cứu hộ trên sàn ({data.garages.length})
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3" data-testid="platform-sos-garages">
            {data.garages.map((g) => (
              <div key={g.tenantId} className="flex items-start justify-between gap-2 rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-xs">
                <div>
                  <div className="font-semibold text-slate-900">{g.name}</div>
                  <div className="text-slate-500">
                    {g.tenantType === 'GARAGE' ? 'PLG' : 'Đối tác'} · Bán kính {g.radiusKm} km · Từ {fmtMoney(g.basePrice)}
                  </div>
                  {g.hotline && <div className="font-mono text-slate-700">Hotline: {g.hotline}</div>}
                </div>
                <Badge tone={g.onDuty ? 'mint' : 'slate'}>{g.onDuty ? 'Đang trực' : 'Tạm nghỉ'}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          tabs={[
            { value: 'ALL', label: 'Tất cả' },
            { value: 'DANG_TIM_GARAGE', label: 'Đang tìm garage' },
            { value: 'ACTIVE', label: 'Đang cứu hộ' },
            { value: 'KHONG_CO_GARAGE', label: 'Chưa có garage nhận' },
            { value: 'HOAN_THANH', label: 'Hoàn thành' },
            { value: 'KHACH_HUY', label: 'Khách huỷ' },
          ]}
          value={status}
          onChange={(v) => setStatus(v)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Mã SOS, SĐT, biển số…"
              className="rounded-full bg-white/85 pl-10"
              aria-label="Tìm ca cứu hộ"
            />
          </div>
          <ExportButton
            filename="giam-sat-cuu-ho-sos"
            sheetName="Ca cứu hộ SOS"
            testId="export-platform-sos"
            rows={data?.items ?? []}
            columns={[
              { header: 'Mã ca', value: (c) => c.code },
              { header: 'Thời gian', value: (c) => fmtDateTime(c.createdAt) },
              { header: 'Khách hàng', value: (c) => c.customerName },
              { header: 'Số điện thoại', value: (c) => c.phone },
              { header: 'Biển số', value: (c) => c.plateNo ?? '' },
              { header: 'Sự cố', value: (c) => c.issueLabel },
              { header: 'Vị trí', value: (c) => c.addressText || `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}` },
              { header: 'Garage thực hiện', value: (c) => c.assignedGarage?.name ?? '' },
              { header: 'Đội cứu hộ', value: (c) => c.assignedStaff?.name ?? '' },
              { header: 'Chi phí dự kiến', value: (c) => c.quotedPrice },
              { header: 'Chi phí chốt', value: (c) => c.finalPrice },
              { header: 'Trạng thái', value: (c) => SOS_STATUS_UI[c.status].label },
            ]}
          />
        </div>
      </div>

      {!data ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : !data.items.length ? (
        <Card className="p-10 text-center text-sm text-slate-500">Không có ca cứu hộ nào khớp bộ lọc.</Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm" data-testid="platform-sos-table">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Mã ca</th>
                <th className="px-4 py-3">Khách & xe</th>
                <th className="px-4 py-3">Sự cố & vị trí</th>
                <th className="px-4 py-3">Garage thực hiện</th>
                <th className="px-4 py-3">Chi phí</th>
                <th className="px-4 py-3">Trạng thái</th>
                <th className="px-4 py-3 text-right">Chi tiết</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <div className="font-mono font-semibold">{c.code}</div>
                    <div className="text-xs text-slate-500">{fmtDateTime(c.createdAt)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{c.customerName}</div>
                    <div className="text-xs text-slate-500">
                      {c.phone}
                      {c.plateNo ? ` · ${c.plateNo}` : ''}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{c.issueLabel}</div>
                    <div className="max-w-xs truncate text-xs text-slate-500">{c.addressText || `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`}</div>
                  </td>
                  <td className="px-4 py-3">
                    {c.assignedGarage ? (
                      <div>
                        <div className="font-medium">{c.assignedGarage.name}</div>
                        {c.assignedStaff && <div className="text-xs text-slate-500">Đội: {c.assignedStaff.name}</div>}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">Thông báo {c.candidatesCount} garage</span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {c.finalPrice !== null ? (
                      <span className="font-semibold text-emerald-700">{fmtMoney(c.finalPrice)}</span>
                    ) : c.quotedPrice !== null ? (
                      <span className="text-slate-600">Dự kiến {fmtMoney(c.quotedPrice)}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={SOS_STATUS_UI[c.status].tone}>{SOS_STATUS_UI[c.status].label}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="outline" onClick={() => setSelected(c)} data-testid="platform-sos-detail-btn">
                      <Eye className="h-4 w-4" /> Xem
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Dialog
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `Chi tiết ca cứu hộ ${selected.code}` : 'Chi tiết'}
        wide
        footer={
          <Button variant="outline" onClick={() => setSelected(null)}>
            Đóng
          </Button>
        }
      >
        {selected && (
          <div className="space-y-4 text-sm">
            <div className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2">
              <div>
                <div className="text-xs text-slate-500">Khách hàng</div>
                <div className="font-semibold">
                  {selected.customerName} ·{' '}
                  <a href={`tel:${selected.phone}`} className="text-brand-700 hover:underline">
                    <Phone className="mr-0.5 inline h-3.5 w-3.5" />
                    {selected.phone}
                  </a>
                </div>
                <div className="text-slate-600">{[selected.plateNo, selected.vehicleInfo].filter(Boolean).join(' · ') || 'Chưa rõ biển số'}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Vị trí sự cố</div>
                <div className="font-medium">{selected.addressText || `${selected.lat}, ${selected.lng}`}</div>
                <a href={mapsDirectionUrl(selected.lat, selected.lng)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline">
                  <MapPin className="h-3.5 w-3.5" /> Mở Google Maps <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              {selected.assignedGarage && (
                <div>
                  <div className="text-xs text-slate-500">Garage nhận ca</div>
                  <div className="font-semibold">{selected.assignedGarage.name}</div>
                  {selected.assignedStaff && (
                    <div className="text-xs text-slate-600">
                      Nhân sự: {selected.assignedStaff.name} ({selected.assignedStaff.phone})
                    </div>
                  )}
                </div>
              )}
              <div>
                <div className="text-xs text-slate-500">Chi phí (khách trả trực tiếp garage)</div>
                <div>
                  Báo giá: <b>{fmtMoney(selected.quotedPrice)}</b> · Chốt: <b className="text-emerald-700">{fmtMoney(selected.finalPrice)}</b>
                </div>
                {selected.order && <div className="text-xs text-indigo-700">Lệnh sửa chữa PLG: {selected.order.code}</div>}
              </div>
            </div>

            {selected.tracks.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                  <Navigation className="h-4 w-4 text-brand-600" /> Nhật ký toạ độ GPS ({selected.tracks.length})
                </div>
                <ul className="space-y-1 rounded-2xl border border-slate-100 p-3 text-xs text-slate-600">
                  {selected.tracks.map((t) => (
                    <li key={t.id}>
                      {fmtDateTime(t.at)} — <span className="font-mono">{t.lat.toFixed(5)}, {t.lng.toFixed(5)}</span>
                      {t.note ? ` · ${t.note}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {selected.review && (
              <div className="rounded-2xl bg-amber-50 p-3.5">
                <div className="flex items-center gap-1 font-semibold text-amber-900">
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" /> Đánh giá khách hàng: {selected.review.rating}/5
                </div>
                {selected.review.comment && <p className="mt-1 text-slate-700">{selected.review.comment}</p>}
                {selected.review.reply && <p className="mt-1 text-xs text-slate-600">Garage phản hồi: {selected.review.reply}</p>}
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
