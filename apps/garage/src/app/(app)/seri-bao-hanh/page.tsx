'use client';

import { Alert, Badge, Button, Card, CardTitle, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import { ArrowRightLeft, History, Plus, RotateCw, Search, ShieldCheck, Wrench, X } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { ExportButton } from '@/components/export-button';
import { Pager } from '@/components/pager';
import { RequirePermission } from '@/components/require-permission';
import {
  SerialCreateDialog,
  SerialEventsTimeline,
  SerialHistoryDialog,
  SerialTransitionDialog,
} from '@/components/vehicle-fleet-panels';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCurrentBranch } from '@/lib/branch';
import { fmtDate, fmtKm, type Paged } from '@/lib/crm';
import { fetchAllPages } from '@/lib/export';
import {
  SERIAL_KINDS,
  SERIAL_STATUS_UI,
  WARRANTY_STATE_UI,
  type SerialItemView,
  type SerialKind,
  type SerialLookupResponse,
  type SerialStatus,
  type SerialTransitionAction,
} from '@/lib/fleet';

function SerialWarrantyScreen() {
  const searchParams = useSearchParams();
  const initialLookup = searchParams.get('q') ?? '';
  const { can } = useAuth();
  const branchId = useCurrentBranch();
  const canEdit = can('vehicle.manage') || can('inventory.manage') || can('ro.manage') || can('ro.task.update');

  // --- Tra cứu bảo hành tức thì theo Biển số hoặc Số Sê-ri ---
  const [lookupInput, setLookupInput] = useState(initialLookup);
  const [lookupData, setLookupData] = useState<SerialLookupResponse | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupErr, setLookupErr] = useState<string | null>(null);

  const runLookup = useCallback(async (qRaw: string) => {
    const trimmed = qRaw.trim();
    if (trimmed.length < 2) {
      setLookupErr('Nhập ít nhất 2 ký tự biển số xe hoặc số sê-ri để tra cứu bảo hành.');
      return;
    }
    setLookupBusy(true);
    setLookupErr(null);
    try {
      setLookupData(await api<SerialLookupResponse>(`/serials/lookup?q=${encodeURIComponent(trimmed)}`));
    } catch (e) {
      setLookupErr(e instanceof ApiError ? e.message : 'Không tra cứu được');
    } finally {
      setLookupBusy(false);
    }
  }, []);

  useEffect(() => {
    if (initialLookup.trim().length >= 2) {
      void runLookup(initialLookup);
    }
  }, [initialLookup, runLookup]);

  // --- Bảng quản lý danh sách Sê-ri ---
  const [kindTab, setKindTab] = useState<'' | SerialKind>('');
  const [statusFilter, setStatusFilter] = useState<'' | SerialStatus>('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<SerialItemView> | null>(null);
  const [openCreate, setOpenCreate] = useState(false);
  const [transitionState, setTransitionState] = useState<{ item: SerialItemView; action: SerialTransitionAction } | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);

  const buildListUrl = useCallback(
    (p: number, ps: number) => {
      const qs = new URLSearchParams({ page: String(p), pageSize: String(ps) });
      if (kindTab) qs.set('kind', kindTab);
      if (statusFilter) qs.set('status', statusFilter);
      if (q.trim()) qs.set('q', q.trim());
      if (branchId) qs.set('branchId', branchId);
      return `/serials?${qs}`;
    },
    [kindTab, statusFilter, q, branchId],
  );

  const loadList = useCallback(async () => {
    setData(await api<Paged<SerialItemView>>(buildListUrl(page, 25)));
  }, [buildListUrl, page]);

  useEffect(() => {
    const t = setTimeout(() => void loadList(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadList, q]);

  const reloadAll = () => {
    void loadList();
    if (lookupData) void runLookup(lookupData.query);
  };

  const onLookupSubmit = (e: FormEvent) => {
    e.preventDefault();
    void runLookup(lookupInput);
  };

  return (
    <div className="space-y-4" data-testid="serials-page">
      {/* Khối Tra cứu Bảo hành tức thì theo Biển số hoặc Số Sê-ri */}
      <Card className="space-y-3 border-brand-100 bg-gradient-to-r from-brand-50/70 via-white to-mint-50/50 p-5" data-testid="warranty-lookup-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-brand-600" />
              Tra cứu Bảo hành theo Biển số xe hoặc Số Sê-ri
            </CardTitle>
            <p className="mt-0.5 text-sm text-slate-600">
              Nhập <b>biển số xe</b> (VD: <code>61A-123.45</code>) hoặc <b>số sê-ri lốp / ắc quy / pin lithium</b> để kiểm tra hạn bảo hành, vị trí lắp và toàn bộ lịch sử đảo lốp, tháo rời, chuyển sang xe khác.
            </p>
          </div>
        </div>
        <form onSubmit={onLookupSubmit} className="flex flex-wrap gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
            <Input
              value={lookupInput}
              onChange={(e) => setLookupInput(e.target.value)}
              placeholder="Nhập biển số xe hoặc mã sê-ri sản phẩm…"
              className="bg-white pl-10 font-mono"
              data-testid="serial-warranty-lookup-input"
            />
          </div>
          <Button type="submit" disabled={lookupBusy} data-testid="serial-warranty-lookup-btn">
            {lookupBusy && <Spinner />}
            Tra cứu bảo hành
          </Button>
          {lookupData && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setLookupData(null);
                setLookupInput('');
              }}
            >
              <X className="h-4 w-4" />
              Đóng kết quả
            </Button>
          )}
        </form>

        {lookupErr && <Alert>{lookupErr}</Alert>}

        {lookupData && (
          <div className="space-y-3 pt-2" data-testid="warranty-lookup-results">
            {lookupData.vehicles.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span>Xe khớp biển số:</span>
                {lookupData.vehicles.map((v) => (
                  <Link
                    key={v.id}
                    href={`/xe/${v.id}`}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono font-semibold text-brand-700 hover:border-brand-300"
                  >
                    {v.plate} {v.owner ? `· ${v.owner.name}` : ''} ({fmtKm(v.odometerKm)})
                  </Link>
                ))}
              </div>
            )}

            {lookupData.items.length === 0 ? (
              <Alert tone="peach">Không tìm thấy sản phẩm sê-ri (lốp, ắc quy, pin lithium) nào khớp với từ khoá &ldquo;{lookupData.query}&rdquo;.</Alert>
            ) : (
              <div className="space-y-3">
                {lookupData.items.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="lookup-serial-card">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-base font-bold text-slate-900">{item.serialNo}</span>
                          <Badge tone="sky">{item.kindLabel}</Badge>
                          <Badge tone={SERIAL_STATUS_UI[item.status].tone}>{item.statusLabel}</Badge>
                          <Badge tone={WARRANTY_STATE_UI[item.warrantyState].tone}>
                            {WARRANTY_STATE_UI[item.warrantyState].label}
                          </Badge>
                        </div>
                        <div className="text-sm font-medium text-slate-800">
                          {item.productName}
                          {item.brand && ` · ${item.brand}`}
                          {item.dotOrMfg && <span className="ml-2 font-mono text-xs text-slate-500">({item.dotOrMfg})</span>}
                        </div>
                        <div className="text-xs text-slate-600">
                          {item.vehicle ? (
                            <>
                              Đang lắp trên xe:{' '}
                              <Link href={`/xe/${item.vehicle.id}`} className="font-mono font-semibold text-brand-600 hover:underline">
                                {item.vehicle.plate}
                              </Link>
                              {item.positionLabel && ` (${item.positionLabel})`}
                              {item.vehicle.owner && ` · Chủ xe: ${item.vehicle.owner.name} ${item.vehicle.owner.phone ?? ''}`}
                            </>
                          ) : (
                            'Hiện không gắn trên xe'
                          )}
                        </div>
                        <div className="text-xs font-medium text-slate-700">{item.warrantySummary}</div>
                      </div>
                      {canEdit && item.status !== 'LOAI_BO' && (
                        <div className="flex flex-wrap gap-1.5">
                          {item.status === 'DANG_SU_DUNG' ? (
                            <>
                              <Button
                                variant="outline"
                                className="px-2.5 py-1.5 text-xs"
                                onClick={() => setTransitionState({ item, action: 'CHUYEN_XE' })}
                              >
                                <ArrowRightLeft className="h-3.5 w-3.5" />
                                Chuyển xe
                              </Button>
                              <Button
                                variant="outline"
                                className="px-2.5 py-1.5 text-xs"
                                onClick={() => setTransitionState({ item, action: 'DOI_BAO_HANH' })}
                              >
                                <Wrench className="h-3.5 w-3.5" />
                                Đổi bảo hành
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="outline"
                              className="px-2.5 py-1.5 text-xs"
                              onClick={() => setTransitionState({ item, action: item.installedAt ? 'LAP_LAI' : 'LAP_MOI' })}
                            >
                              Lắp lên xe
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Lịch sử vòng đời sản phẩm ({item.events.length} sự kiện)
                      </div>
                      <SerialEventsTimeline events={item.events} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Bảng quản lý danh sách tất cả Sê-ri */}
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          tabs={[
            { value: '' as const, label: 'Tất cả' },
            ...SERIAL_KINDS.map((k) => ({ value: k.value, label: k.label })),
          ]}
          value={kindTab}
          onChange={(v) => {
            setKindTab(v);
            setPage(1);
          }}
        />
        <Select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as '' | SerialStatus);
            setPage(1);
          }}
          className="w-auto rounded-full bg-white/80"
          aria-label="Lọc trạng thái sê-ri"
        >
          <option value="">Mọi trạng thái</option>
          {(Object.keys(SERIAL_STATUS_UI) as SerialStatus[]).map((st) => (
            <option key={st} value={st}>
              {SERIAL_STATUS_UI[st].label}
            </option>
          ))}
        </Select>
        <div className="relative w-full md:w-64">
          <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Lọc nhanh mã sê-ri, tên SP, biển số…"
            className="rounded-full bg-white/80 pl-10"
            aria-label="Lọc danh sách sê-ri"
          />
        </div>
        <div className="flex-1" />
        <ExportButton<SerialItemView>
          filename="danh-sach-seri-bao-hanh"
          sheetName="Sê-ri & Bảo hành"
          testId="export-serials"
          disabled={!data || data.total === 0}
          fetchRows={() => fetchAllPages<SerialItemView>(buildListUrl)}
          columns={[
            { header: 'Số Sê-ri', value: (s) => s.serialNo },
            { header: 'Nhóm', value: (s) => s.kindLabel },
            { header: 'Tên sản phẩm', value: (s) => s.productName },
            { header: 'Thương hiệu', value: (s) => s.brand ?? '' },
            { header: 'DOT / Mã lô', value: (s) => s.dotOrMfg ?? '' },
            { header: 'Trạng thái', value: (s) => s.statusLabel },
            { header: 'Xe đang sử dụng', value: (s) => s.vehicle?.plate ?? '' },
            { header: 'Vị trí lắp', value: (s) => s.positionLabel ?? '' },
            { header: 'Chủ xe', value: (s) => s.vehicle?.owner?.name ?? '' },
            { header: 'SĐT chủ xe', value: (s) => s.vehicle?.owner?.phone ?? '' },
            { header: 'Ngày lắp', value: (s) => (s.installedAt ? fmtDate(s.installedAt) : '') },
            { header: 'Km lúc lắp', value: (s) => s.installedKm },
            { header: 'Km đã chạy', value: (s) => s.kmUsedSinceInstall },
            { header: 'Tình trạng bảo hành', value: (s) => WARRANTY_STATE_UI[s.warrantyState].label },
            { header: 'Chi tiết hạn bảo hành', value: (s) => s.warrantySummary },
          ]}
        />
        {canEdit && (
          <Button onClick={() => setOpenCreate(true)} data-testid="new-serial-btn">
            <Plus className="h-4 w-4" />
            Đăng ký / Lắp Sê-ri
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        {!data ? (
          <div className="grid place-items-center p-10">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="serial-table">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 font-semibold">Số Sê-ri</th>
                    <th className="px-3 py-3 font-semibold">Sản phẩm</th>
                    <th className="px-3 py-3 font-semibold">Xe đang dùng & Vị trí</th>
                    <th className="px-3 py-3 font-semibold">Bảo hành</th>
                    <th className="px-3 py-3 font-semibold">Trạng thái</th>
                    <th className="px-4 py-3 text-right font-semibold">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((s) => (
                    <tr key={s.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60" data-testid="serial-row">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setHistoryId(s.id)}
                          className="font-mono font-bold text-slate-900 hover:text-brand-600"
                        >
                          {s.serialNo}
                        </button>
                        {s.dotOrMfg && <div className="font-mono text-xs text-slate-400">{s.dotOrMfg}</div>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-slate-800">{s.productName}</div>
                        <div className="text-xs text-slate-500">
                          {s.kindLabel}
                          {s.brand && ` · ${s.brand}`}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {s.vehicle ? (
                          <div>
                            <Link href={`/xe/${s.vehicle.id}`} className="font-mono font-semibold text-brand-600 hover:underline">
                              {s.vehicle.plate}
                            </Link>
                            {s.positionLabel && <span className="ml-1.5 text-xs text-slate-600">· {s.positionLabel}</span>}
                            {s.vehicle.owner && <div className="text-xs text-slate-500">{s.vehicle.owner.name}</div>}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">— Chưa gắn xe —</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={WARRANTY_STATE_UI[s.warrantyState].tone}>{WARRANTY_STATE_UI[s.warrantyState].label}</Badge>
                        <div className="mt-0.5 max-w-xs text-xs text-slate-500">{s.warrantySummary}</div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={SERIAL_STATUS_UI[s.status].tone}>{s.statusLabel}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex flex-wrap justify-end gap-1">
                          {canEdit && s.status === 'DANG_SU_DUNG' && (
                            <>
                              <Button
                                variant="outline"
                                className="px-2.5 py-1 text-xs"
                                onClick={() => setTransitionState({ item: s, action: 'DAO_VI_TRI' })}
                                title="Đảo vị trí trên xe"
                                data-testid="btn-rotate-serial"
                              >
                                <RotateCw className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="outline"
                                className="px-2.5 py-1 text-xs"
                                onClick={() => setTransitionState({ item: s, action: 'CHUYEN_XE' })}
                                title="Chuyển sang xe khác"
                                data-testid="btn-transfer-serial"
                              >
                                <ArrowRightLeft className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="outline"
                                className="px-2.5 py-1 text-xs"
                                onClick={() => setTransitionState({ item: s, action: 'DOI_BAO_HANH' })}
                                title="Đổi bảo hành"
                                data-testid="btn-warranty-serial"
                              >
                                <Wrench className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                          {canEdit && (s.status === 'TRONG_KHO' || s.status === 'DA_THAO') && (
                            <Button
                              variant="outline"
                              className="px-2.5 py-1 text-xs"
                              onClick={() => setTransitionState({ item: s, action: s.installedAt ? 'LAP_LAI' : 'LAP_MOI' })}
                              data-testid="btn-mount-serial"
                            >
                              Lắp lên xe
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            className="px-2.5 py-1 text-xs"
                            onClick={() => setHistoryId(s.id)}
                            title="Xem lịch sử sê-ri"
                            data-testid="btn-history-serial"
                          >
                            <History className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!data.items.length && (
                    <tr>
                      <td colSpan={6} className="px-5 py-12 text-center text-slate-500">
                        Chưa có dữ liệu sê-ri phù hợp. Bấm <b>Đăng ký / Lắp Sê-ri</b> để thêm mới lốp, ắc quy hoặc pin lithium.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <SerialCreateDialog open={openCreate} onClose={() => setOpenCreate(false)} onCreated={reloadAll} />
      <SerialTransitionDialog
        serial={transitionState?.item ?? null}
        initialAction={transitionState?.action ?? 'DAO_VI_TRI'}
        onClose={() => setTransitionState(null)}
        onDone={reloadAll}
      />
      <SerialHistoryDialog serialId={historyId} onClose={() => setHistoryId(null)} />
    </div>
  );
}

export default function SerialWarrantyPage() {
  return (
    <RequirePermission permission="ro.view">
      <Suspense fallback={<Spinner className="text-brand-600" />}>
        <SerialWarrantyScreen />
      </Suspense>
    </RequirePermission>
  );
}
