'use client';

import { Alert, Badge, Button, Card, Checkbox, Dialog, Field, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  ImagePlus,
  LocateFixed,
  MapPin,
  MessageSquareReply,
  Navigation,
  Phone,
  Play,
  Settings2,
  Star,
  Truck,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime } from '@/lib/orders';
import { fmtMoney, mapsDirectionUrl, SOS_STATUS_UI, type SosDetail } from '@/lib/sos';

interface SosConfigData {
  config: {
    enabled: boolean;
    onDuty: boolean;
    hotline: string;
    radiusKm: number;
    basePrice: number;
    branchId: string | null;
    note: string;
  };
  hasCoords: boolean;
  shopCoords: { lat: number; lng: number } | null;
  branches: { id: string; code: string; name: string; lat: number | null; lng: number | null; phone: string | null }[];
}

interface StaffOption {
  membershipId: string;
  name: string;
  phone: string;
  roles: string[];
}

type TabKey = 'incoming' | 'active' | 'done';

export function SosWorkspace({ mode }: { mode: 'PARTNER' | 'DISPATCH' | 'CREW' }) {
  const { me } = useAuth();
  const [tab, setTab] = useState<TabKey>('incoming');
  const [branchFilter, setBranchFilter] = useState<string>('');
  const [cfgData, setCfgData] = useState<SosConfigData | null>(null);
  const [cases, setCases] = useState<{ counts: Record<TabKey, number>; items: SosDetail[] } | null>(null);
  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Hộp thoại cấu hình dịch vụ cứu hộ
  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfgForm, setCfgForm] = useState({
    enabled: true,
    onDuty: true,
    hotline: '',
    radiusKm: '30',
    basePrice: '300000',
    branchId: '',
    note: '',
  });

  // Hộp thoại nhận ca (DA_NHAN)
  const [acceptTarget, setAcceptTarget] = useState<SosDetail | null>(null);
  const [acceptPrice, setAcceptPrice] = useState('300000');
  const [acceptEta, setAcceptEta] = useState('15');
  const [acceptBranchId, setAcceptBranchId] = useState('');
  const [acceptStaffId, setAcceptStaffId] = useState('');
  const [acceptNote, setAcceptNote] = useState('');

  // Hộp thoại điều đội / xuất phát (DANG_DEN)
  const [dispatchTarget, setDispatchTarget] = useState<SosDetail | null>(null);
  const [dispatchStaffId, setDispatchStaffId] = useState('');
  const [dispatchEta, setDispatchEta] = useState('15');
  const [dispatchLat, setDispatchLat] = useState('');
  const [dispatchLng, setDispatchLng] = useState('');

  // Hộp thoại cập nhật GPS
  const [trackTarget, setTrackTarget] = useState<SosDetail | null>(null);
  const [trackLat, setTrackLat] = useState('');
  const [trackLng, setTrackLng] = useState('');
  const [trackEta, setTrackEta] = useState('');
  const [trackNote, setTrackNote] = useState('');

  // Hộp thoại chốt giá / hoàn thành
  const [completeTarget, setCompleteTarget] = useState<SosDetail | null>(null);
  const [completePrice, setCompletePrice] = useState('');
  const [completeNote, setCompleteNote] = useState('');

  // Trả lời đánh giá
  const [replyTarget, setReplyTarget] = useState<SosDetail | null>(null);
  const [replyText, setReplyText] = useState('');

  const canConfigure = mode !== 'CREW';

  const loadAll = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ tab });
      if (branchFilter) qs.set('branchId', branchFilter);
      if (mode === 'CREW') qs.set('crewOnly', '1');
      const [cfg, list] = await Promise.all([
        api<SosConfigData>('/sos/config'),
        api<{ counts: Record<TabKey, number>; items: SosDetail[] }>(`/sos/cases?${qs}`),
      ]);
      setCfgData(cfg);
      setCases(list);
      if (mode === 'DISPATCH') {
        const st = await api<StaffOption[]>(`/sos/staff${branchFilter ? `?branchId=${branchFilter}` : ''}`).catch(() => []);
        setStaffList(st);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được danh sách ca cứu hộ');
    }
  }, [tab, branchFilter, mode]);

  useEffect(() => {
    void loadAll();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadAll();
    }, 6000);
    return () => clearInterval(timer);
  }, [loadAll]);

  function openConfigModal() {
    if (!cfgData) return;
    setCfgForm({
      enabled: cfgData.config.enabled,
      onDuty: cfgData.config.onDuty,
      hotline: cfgData.config.hotline,
      radiusKm: String(cfgData.config.radiusKm),
      basePrice: String(cfgData.config.basePrice),
      branchId: cfgData.config.branchId ?? '',
      note: cfgData.config.note,
    });
    setCfgOpen(true);
  }

  async function saveConfig() {
    setBusy('config');
    setError(null);
    try {
      await api('/sos/config', {
        method: 'PUT',
        body: {
          enabled: cfgForm.enabled,
          onDuty: cfgForm.onDuty,
          hotline: cfgForm.hotline || null,
          radiusKm: Number(cfgForm.radiusKm),
          basePrice: Number(cfgForm.basePrice),
          branchId: cfgForm.branchId || null,
          note: cfgForm.note || null,
        },
      });
      setCfgOpen(false);
      await loadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Lưu cấu hình thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function toggleOnDuty() {
    if (!cfgData) return;
    setBusy('duty');
    setError(null);
    try {
      await api('/sos/config', {
        method: 'PUT',
        body: {
          enabled: true,
          onDuty: !cfgData.config.onDuty,
          hotline: cfgData.config.hotline || null,
          radiusKm: cfgData.config.radiusKm,
          basePrice: cfgData.config.basePrice,
          branchId: cfgData.config.branchId,
          note: cfgData.config.note || null,
        },
      });
      await loadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không đổi được trạng thái trực');
    } finally {
      setBusy(null);
    }
  }

  function openAcceptModal(c: SosDetail) {
    setAcceptTarget(c);
    setAcceptPrice(String(cfgData?.config.basePrice ?? 300_000));
    setAcceptEta('15');
    setAcceptBranchId(cfgData?.config.branchId ?? cfgData?.branches[0]?.id ?? '');
    setAcceptStaffId(staffList[0]?.membershipId ?? '');
    setAcceptNote('');
  }

  async function confirmAccept() {
    if (!acceptTarget) return;
    setBusy(acceptTarget.id);
    setError(null);
    try {
      await api(`/sos/cases/${acceptTarget.id}/accept`, {
        body: {
          quotedPrice: Number(acceptPrice),
          etaMinutes: Number(acceptEta),
          branchId: mode === 'DISPATCH' ? acceptBranchId || null : null,
          assignedStaffId: mode === 'DISPATCH' && acceptStaffId ? acceptStaffId : null,
          sellerNote: acceptNote || null,
        },
      });
      setAcceptTarget(null);
      setTab('active');
      await loadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không nhận được ca cứu hộ');
    } finally {
      setBusy(null);
    }
  }

  function openDispatchModal(c: SosDetail) {
    setDispatchTarget(c);
    setDispatchStaffId(c.assignedStaff?.membershipId ?? staffList[0]?.membershipId ?? '');
    setDispatchEta(String(c.etaMinutes ?? 15));
    setDispatchLat(cfgData?.shopCoords ? String(cfgData.shopCoords.lat) : '');
    setDispatchLng(cfgData?.shopCoords ? String(cfgData.shopCoords.lng) : '');
  }

  async function confirmDispatch() {
    if (!dispatchTarget) return;
    setBusy(dispatchTarget.id);
    setError(null);
    try {
      await api(`/sos/cases/${dispatchTarget.id}/dispatch`, {
        body: {
          assignedStaffId: mode === 'DISPATCH' ? dispatchStaffId || null : undefined,
          etaMinutes: dispatchEta ? Number(dispatchEta) : null,
          lat: dispatchLat && dispatchLng ? Number(dispatchLat) : null,
          lng: dispatchLat && dispatchLng ? Number(dispatchLng) : null,
        },
      });
      setDispatchTarget(null);
      if (tab === 'incoming') setTab('active');
      await loadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không xuất phát được ca cứu hộ');
    } finally {
      setBusy(null);
    }
  }

  function openTrackModal(c: SosDetail) {
    setTrackTarget(c);
    setTrackLat(c.latestTrack ? String(c.latestTrack.lat) : String(c.lat));
    setTrackLng(c.latestTrack ? String(c.latestTrack.lng) : String(c.lng));
    setTrackEta(c.etaMinutes ? String(c.etaMinutes) : '');
    setTrackNote('Đang trên đường tới khách');
  }

  function fillBrowserGps(setLa: (v: string) => void, setLn: (v: string) => void) {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((p) => {
      setLa(p.coords.latitude.toFixed(6));
      setLn(p.coords.longitude.toFixed(6));
    });
  }

  async function confirmTrack() {
    if (!trackTarget) return;
    setBusy(trackTarget.id);
    setError(null);
    try {
      await api(`/sos/cases/${trackTarget.id}/track`, {
        body: {
          lat: Number(trackLat),
          lng: Number(trackLng),
          etaMinutes: trackEta ? Number(trackEta) : null,
          note: trackNote || null,
        },
      });
      setTrackTarget(null);
      await loadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Cập nhật vị trí thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function runCaseAction(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
      await loadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Thao tác không thực hiện được');
    } finally {
      setBusy(null);
    }
  }

  async function uploadScenePhoto(c: SosDetail, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await runCaseAction(c.id, async () => {
      const form = new FormData();
      form.append('file', file);
      const uploaded = await api<{ id: string }>('/files', { form });
      const nextIds = [...c.sceneImages.map((x) => x.id), uploaded.id].slice(0, 6);
      await api(`/sos/cases/${c.id}/scene`, { method: 'PUT', body: { sceneImageIds: nextIds } });
    });
  }

  function openCompleteModal(c: SosDetail) {
    setCompleteTarget(c);
    setCompletePrice(String(c.finalPrice ?? c.quotedPrice ?? 0));
    setCompleteNote(c.sellerNote ?? '');
  }

  async function confirmComplete() {
    if (!completeTarget) return;
    setBusy(completeTarget.id);
    setError(null);
    try {
      await api(`/sos/cases/${completeTarget.id}/complete`, {
        body: {
          finalPrice: Number(completePrice),
          sellerNote: completeNote || null,
        },
      });
      setCompleteTarget(null);
      setTab('done');
      await loadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không hoàn thành được ca cứu hộ');
    } finally {
      setBusy(null);
    }
  }

  async function confirmReply() {
    if (!replyTarget) return;
    setBusy(replyTarget.id);
    setError(null);
    try {
      await api(`/sos/cases/${replyTarget.id}/reply`, { body: { reply: replyText } });
      setReplyTarget(null);
      setReplyText('');
      await loadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gửi phản hồi thất bại');
    } finally {
      setBusy(null);
    }
  }

  const incomingLabel = mode === 'CREW' ? 'Ca chờ xuất phát' : 'Ca mới chờ nhận';

  return (
    <div className="space-y-4" data-testid="sos-workspace">
      {canConfigure && cfgData && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4" data-testid="sos-config-bar">
          <div className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-900">Dịch vụ cứu hộ SOS</span>
              {!cfgData.config.enabled ? (
                <Badge tone="slate">Đang tắt</Badge>
              ) : cfgData.config.onDuty ? (
                <Badge tone="mint">Đang trực nhận ca</Badge>
              ) : (
                <Badge tone="peach">Tạm nghỉ trực</Badge>
              )}
            </div>
            <div className="text-xs text-slate-500">
              Hotline: <b>{cfgData.config.hotline || 'Chưa nhập'}</b> · Bán kính: <b>{cfgData.config.radiusKm} km</b> · Giá tham khảo từ:{' '}
              <b>{fmtMoney(cfgData.config.basePrice)}</b>
              {!cfgData.hasCoords && <span className="ml-2 font-medium text-rose-600">· Cần cập nhật toạ độ bản đồ ở Hồ sơ gian hàng để nhận ca tự động</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={cfgData.config.enabled && cfgData.config.onDuty ? 'outline' : 'primary'}
              onClick={toggleOnDuty}
              disabled={busy === 'duty'}
              data-testid="sos-duty-toggle"
            >
              {cfgData.config.enabled && cfgData.config.onDuty ? 'Tạm dừng nhận ca' : 'Bật trực nhận ca'}
            </Button>
            <Button variant="outline" onClick={openConfigModal} data-testid="sos-config-btn">
              <Settings2 className="h-4 w-4" /> Cấu hình cứu hộ
            </Button>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          tabs={[
            { value: 'incoming', label: `${incomingLabel}${cases ? ` (${cases.counts.incoming})` : ''}` },
            { value: 'active', label: `Đang xử lý${cases ? ` (${cases.counts.active})` : ''}` },
            { value: 'done', label: `Lịch sử & đánh giá${cases ? ` (${cases.counts.done})` : ''}` },
          ]}
          value={tab}
          onChange={(v) => setTab(v)}
        />
        {mode !== 'PARTNER' && (me?.branches.length ?? 0) > 1 && (
          <Select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="w-auto rounded-full bg-white/85" aria-label="Lọc chi nhánh">
            <option value="">Tất cả chi nhánh được giao</option>
            {me!.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      {error && <Alert>{error}</Alert>}

      {!cases ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : !cases.items.length ? (
        <Card className="p-10 text-center text-sm text-slate-500" data-testid="sos-empty">
          {tab === 'incoming'
            ? mode === 'CREW'
              ? 'Không có ca cứu hộ nào đang chờ xuất phát.'
              : 'Hiện không có yêu cầu cứu hộ mới nào trong bán kính phục vụ.'
            : tab === 'active'
              ? 'Chưa có ca cứu hộ nào đang chạy.'
              : 'Chưa có lịch sử ca cứu hộ.'}
        </Card>
      ) : (
        <ul className="space-y-3" data-testid="sos-case-list">
          {cases.items.map((c) => {
            const st = SOS_STATUS_UI[c.status];
            return (
              <li key={c.id}>
                <Card className="p-5 space-y-3" data-testid="sos-case-card">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-lg font-bold">{c.code}</span>
                        <Badge tone={st.tone}>{st.label}</Badge>
                        <Badge tone="rose">{c.issueLabel}</Badge>
                        {c.distanceFromGarageKm != null && <span className="text-xs font-medium text-slate-500">Cách xưởng ~{c.distanceFromGarageKm} km</span>}
                      </div>
                      <div className="mt-1 text-sm text-slate-700">
                        Khách: <b>{c.customerName}</b> ·{' '}
                        <a href={`tel:${c.phone}`} className="font-medium text-brand-700 hover:underline">
                          {c.phone}
                        </a>
                        {(c.plateNo || c.vehicleInfo) && <span> · {[c.plateNo, c.vehicleInfo].filter(Boolean).join(' ')}</span>}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <MapPin className="h-3.5 w-3.5" />
                        <span>{c.addressText || `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`}</span>
                        <a href={mapsDirectionUrl(c.lat, c.lng)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                          Chỉ đường <ExternalLink className="h-3 w-3" />
                        </a>
                        <span>· Gửi {fmtDateTime(c.createdAt)}</span>
                      </div>
                    </div>

                    {c.status === 'DANG_TIM_GARAGE' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                        <Clock className="h-3.5 w-3.5" /> Còn ~{c.remainingSec}s để nhận
                      </span>
                    )}
                  </div>

                  {c.description && <p className="rounded-xl bg-slate-50 px-3.5 py-2 text-sm text-slate-700">{c.description}</p>}

                  {(c.quotedPrice !== null || c.finalPrice !== null || c.assignedStaff || c.order) && (
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
                      {c.quotedPrice !== null && <span>Giá báo dự kiến: <b>{fmtMoney(c.quotedPrice)}</b></span>}
                      {c.finalPrice !== null && <span>Giá chốt: <b className="text-emerald-700">{fmtMoney(c.finalPrice)}</b></span>}
                      {c.etaMinutes !== null && c.status !== 'HOAN_THANH' && <span>ETA: <b>{c.etaMinutes} phút</b></span>}
                      {c.assignedStaff && <span>Đội cứu hộ: <b>{c.assignedStaff.name}</b></span>}
                      {c.order && (
                        <span>
                          Lệnh sửa chữa:{' '}
                          <Link href={`/don-hang/${c.order.id}`} className="font-mono font-semibold text-brand-700 hover:underline" data-testid="sos-case-order-link">
                            {c.order.code}
                          </Link>
                        </span>
                      )}
                    </div>
                  )}

                  {c.sceneImages.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {c.sceneImages.map(
                        (img) =>
                          img.url && (
                            <a key={img.id} href={img.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-slate-200">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={img.url} alt="Hiện trường" className="h-16 w-24 object-cover" />
                            </a>
                          ),
                      )}
                    </div>
                  )}

                  {c.review && (
                    <div className="rounded-2xl bg-amber-50/70 p-3.5 text-sm space-y-1.5" data-testid="sos-case-review">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1 font-semibold text-amber-900">
                          {Array.from({ length: c.review.rating }).map((_, idx) => (
                            <Star key={idx} className="h-4 w-4 fill-amber-400 text-amber-400" />
                          ))}
                          <span className="ml-1">{c.review.rating}/5</span>
                        </span>
                        {!c.review.reply && mode !== 'CREW' && (
                          <Button
                            variant="outline"
                            onClick={() => {
                              setReplyTarget(c);
                              setReplyText('');
                            }}
                            data-testid="sos-reply-open"
                          >
                            <MessageSquareReply className="h-4 w-4" /> Trả lời
                          </Button>
                        )}
                      </div>
                      {c.review.comment && <p className="text-slate-700">{c.review.comment}</p>}
                      {c.review.reply && <p className="rounded-xl bg-white/80 px-3 py-2 text-xs text-slate-600"><b>Đã phản hồi:</b> {c.review.reply}</p>}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {c.status === 'DANG_TIM_GARAGE' && mode !== 'CREW' && (
                      <Button className="bg-rose-600 hover:bg-rose-700" onClick={() => openAcceptModal(c)} disabled={busy === c.id} data-testid="sos-accept-btn">
                        Nhận ca cứu hộ
                      </Button>
                    )}

                    {c.status === 'DA_NHAN' && (
                      <Button onClick={() => openDispatchModal(c)} disabled={busy === c.id} data-testid="sos-dispatch-btn">
                        <Play className="h-4 w-4" /> {mode === 'DISPATCH' ? 'Điều đội xuất phát' : 'Xuất phát cứu hộ'}
                      </Button>
                    )}

                    {(c.status === 'DANG_DEN' || c.status === 'DANG_KEO_XE') && (
                      <Button variant="outline" onClick={() => openTrackModal(c)} disabled={busy === c.id} data-testid="sos-track-btn">
                        <Navigation className="h-4 w-4" /> Cập nhật GPS
                      </Button>
                    )}

                    {c.status === 'DANG_DEN' && (
                      <Button
                        onClick={() => runCaseAction(c.id, () => api(`/sos/cases/${c.id}/arrive`, { body: { lat: c.lat, lng: c.lng } }))}
                        disabled={busy === c.id}
                        data-testid="sos-arrive-btn"
                      >
                        <MapPin className="h-4 w-4" /> Đã tới hiện trường
                      </Button>
                    )}

                    {['TAI_HIEN_TRUONG', 'XU_LY_TAI_CHO', 'DANG_KEO_XE', 'DA_VE_GARAGE'].includes(c.status) && (
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                        <ImagePlus className="h-4 w-4" /> Chụp / tải ảnh hiện trường
                        <input type="file" accept="image/*" onChange={(e) => void uploadScenePhoto(c, e)} disabled={busy === c.id} className="hidden" />
                      </label>
                    )}

                    {c.status === 'TAI_HIEN_TRUONG' && (
                      <>
                        <Button
                          onClick={() =>
                            runCaseAction(c.id, () =>
                              api(`/sos/cases/${c.id}/handle-onsite`, { body: { finalPrice: c.finalPrice ?? c.quotedPrice ?? 0 } }),
                            )
                          }
                          disabled={busy === c.id}
                          data-testid="sos-onsite-btn"
                        >
                          <Wrench className="h-4 w-4" /> Xử lý tại chỗ
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() =>
                            runCaseAction(c.id, () =>
                              api(`/sos/cases/${c.id}/start-tow`, { body: { finalPrice: c.finalPrice ?? c.quotedPrice ?? 0 } }),
                            )
                          }
                          disabled={busy === c.id}
                          data-testid="sos-tow-btn"
                        >
                          <Truck className="h-4 w-4" /> Kéo xe về garage
                        </Button>
                      </>
                    )}

                    {c.status === 'DANG_KEO_XE' && (
                      <Button
                        onClick={() => runCaseAction(c.id, () => api(`/sos/cases/${c.id}/arrive-garage`, { body: {} }))}
                        disabled={busy === c.id}
                        data-testid="sos-arrive-garage-btn"
                      >
                        <Wrench className="h-4 w-4" /> {mode === 'PARTNER' ? 'Xe đã về tới xưởng' : 'Đã về xưởng & tạo lệnh sửa chữa'}
                      </Button>
                    )}

                    {(c.status === 'XU_LY_TAI_CHO' || c.status === 'DA_VE_GARAGE') && (
                      <Button
                        className="bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => openCompleteModal(c)}
                        disabled={busy === c.id}
                        data-testid="sos-complete-btn"
                      >
                        <CheckCircle2 className="h-4 w-4" /> Đã thu tiền & hoàn thành
                      </Button>
                    )}

                    <a
                      href={`tel:${c.phone}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Phone className="h-4 w-4" /> Gọi khách
                    </a>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {/* Hộp thoại cấu hình dịch vụ cứu hộ */}
      <Dialog
        open={cfgOpen}
        onClose={() => setCfgOpen(false)}
        title="Cấu hình dịch vụ cứu hộ SOS"
        footer={
          <>
            <Button variant="outline" onClick={() => setCfgOpen(false)}>
              Huỷ
            </Button>
            <Button onClick={saveConfig} disabled={busy === 'config'} data-testid="sos-config-save">
              Lưu cấu hình
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <Checkbox
            checked={cfgForm.enabled}
            onChange={(e) => setCfgForm((f) => ({ ...f, enabled: e.target.checked }))}
            label="Cung cấp dịch vụ cứu hộ giao thông trên sàn CARDIY"
          />
          <Checkbox
            checked={cfgForm.onDuty}
            onChange={(e) => setCfgForm((f) => ({ ...f, onDuty: e.target.checked }))}
            label="Đang trực nhận yêu cầu cứu hộ trực tuyến"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Số hotline cứu hộ 24/7">
              {(id) => <Input id={id} value={cfgForm.hotline} onChange={(e) => setCfgForm((f) => ({ ...f, hotline: e.target.value }))} placeholder="0901234567" />}
            </Field>
            <Field label="Bán kính phục vụ (km)">
              {(id) => <Input id={id} type="number" min={1} max={200} value={cfgForm.radiusKm} onChange={(e) => setCfgForm((f) => ({ ...f, radiusKm: e.target.value }))} />}
            </Field>
          </div>
          <Field label="Giá cứu hộ tham khảo từ (đồng)">
            {(id) => <Input id={id} type="number" min={0} step={10000} value={cfgForm.basePrice} onChange={(e) => setCfgForm((f) => ({ ...f, basePrice: e.target.value }))} />}
          </Field>
          {mode === 'DISPATCH' && (cfgData?.branches.length ?? 0) > 0 && (
            <Field label="Chi nhánh trực cứu hộ chính">
              {(id) => (
                <Select id={id} value={cfgForm.branchId} onChange={(e) => setCfgForm((f) => ({ ...f, branchId: e.target.value }))}>
                  {cfgData!.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} · {b.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Ghi chú dịch vụ (phương tiện, phạm vi)">
            {(id) => (
              <Input
                id={id}
                value={cfgForm.note}
                onChange={(e) => setCfgForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="VD: Có xe sàn trượt, kích bình, thay lốp lưu động 24/7"
              />
            )}
          </Field>
        </div>
      </Dialog>

      {/* Hộp thoại nhận ca */}
      <Dialog
        open={!!acceptTarget}
        onClose={() => setAcceptTarget(null)}
        title={acceptTarget ? `Nhận ca cứu hộ ${acceptTarget.code}` : 'Nhận ca'}
        footer={
          <>
            <Button variant="outline" onClick={() => setAcceptTarget(null)}>
              Huỷ
            </Button>
            <Button className="bg-rose-600 hover:bg-rose-700" onClick={confirmAccept} disabled={!!busy} data-testid="sos-accept-confirm">
              Xác nhận nhận ca
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Giá dự kiến báo khách (đồng)">
              {(id) => <Input id={id} type="number" min={0} step={10000} value={acceptPrice} onChange={(e) => setAcceptPrice(e.target.value)} />}
            </Field>
            <Field label="Thời gian tới nơi dự kiến (phút)">
              {(id) => <Input id={id} type="number" min={1} max={360} value={acceptEta} onChange={(e) => setAcceptEta(e.target.value)} />}
            </Field>
          </div>
          {mode === 'DISPATCH' && (cfgData?.branches.length ?? 0) > 0 && (
            <Field label="Chi nhánh phụ trách">
              {(id) => (
                <Select id={id} value={acceptBranchId} onChange={(e) => setAcceptBranchId(e.target.value)}>
                  {cfgData!.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} · {b.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {mode === 'DISPATCH' && staffList.length > 0 && (
            <Field label="Phân công nhân viên cứu hộ (có thể chọn sau)">
              {(id) => (
                <Select id={id} value={acceptStaffId} onChange={(e) => setAcceptStaffId(e.target.value)}>
                  <option value="">-- Điều phân công sau --</option>
                  {staffList.map((s) => (
                    <option key={s.membershipId} value={s.membershipId}>
                      {s.name} ({s.roles.join(', ')})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Ghi chú gửi khách">
            {(id) => <Input id={id} value={acceptNote} onChange={(e) => setAcceptNote(e.target.value)} placeholder="VD: Xe cứu hộ đang chuẩn bị xuất phát…" />}
          </Field>
        </div>
      </Dialog>

      {/* Hộp thoại điều đội / xuất phát */}
      <Dialog
        open={!!dispatchTarget}
        onClose={() => setDispatchTarget(null)}
        title={dispatchTarget ? `Xuất phát cứu hộ ${dispatchTarget.code}` : 'Xuất phát'}
        footer={
          <>
            <Button variant="outline" onClick={() => setDispatchTarget(null)}>
              Huỷ
            </Button>
            <Button onClick={confirmDispatch} disabled={!!busy} data-testid="sos-dispatch-confirm">
              Bắt đầu di chuyển
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          {mode === 'DISPATCH' && staffList.length > 0 && (
            <Field label="Nhân viên thực hiện cứu hộ">
              {(id) => (
                <Select id={id} value={dispatchStaffId} onChange={(e) => setDispatchStaffId(e.target.value)}>
                  <option value="">-- Giữ nguyên / tự thực hiện --</option>
                  {staffList.map((s) => (
                    <option key={s.membershipId} value={s.membershipId}>
                      {s.name} ({s.phone})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Cập nhật thời gian dự kiến tới nơi (phút)">
            {(id) => <Input id={id} type="number" min={1} max={360} value={dispatchEta} onChange={(e) => setDispatchEta(e.target.value)} />}
          </Field>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Toạ độ điểm xuất phát (tuỳ chọn)</span>
            <button type="button" onClick={() => fillBrowserGps(setDispatchLat, setDispatchLng)} className="inline-flex items-center gap-1 font-medium text-brand-700">
              <LocateFixed className="h-3.5 w-3.5" /> Lấy GPS hiện tại
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Vĩ độ">
              {(id) => <Input id={id} type="number" step="any" value={dispatchLat} onChange={(e) => setDispatchLat(e.target.value)} />}
            </Field>
            <Field label="Kinh độ">
              {(id) => <Input id={id} type="number" step="any" value={dispatchLng} onChange={(e) => setDispatchLng(e.target.value)} />}
            </Field>
          </div>
        </div>
      </Dialog>

      {/* Hộp thoại cập nhật GPS */}
      <Dialog
        open={!!trackTarget}
        onClose={() => setTrackTarget(null)}
        title={trackTarget ? `Cập nhật vị trí GPS · ${trackTarget.code}` : 'Cập nhật GPS'}
        footer={
          <>
            <Button variant="outline" onClick={() => setTrackTarget(null)}>
              Đóng
            </Button>
            <Button onClick={confirmTrack} disabled={!!busy} data-testid="sos-track-confirm">
              Gửi vị trí lên bản đồ khách
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => fillBrowserGps(setTrackLat, setTrackLng)}>
              <LocateFixed className="h-4 w-4" /> Lấy toạ độ thiết bị
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Vĩ độ hiện tại">
              {(id) => <Input id={id} type="number" step="any" value={trackLat} onChange={(e) => setTrackLat(e.target.value)} />}
            </Field>
            <Field label="Kinh độ hiện tại">
              {(id) => <Input id={id} type="number" step="any" value={trackLng} onChange={(e) => setTrackLng(e.target.value)} />}
            </Field>
          </div>
          <Field label="Còn khoảng bao nhiêu phút tới nơi">
            {(id) => <Input id={id} type="number" min={1} max={360} value={trackEta} onChange={(e) => setTrackEta(e.target.value)} />}
          </Field>
          <Field label="Ghi chú hành trình">
            {(id) => <Input id={id} value={trackNote} onChange={(e) => setTrackNote(e.target.value)} placeholder="VD: Đã qua trạm thu phí, còn 3km…" />}
          </Field>
        </div>
      </Dialog>

      {/* Hộp thoại hoàn thành & ghi nhận đã thu tiền */}
      <Dialog
        open={!!completeTarget}
        onClose={() => setCompleteTarget(null)}
        title={completeTarget ? `Hoàn thành ca cứu hộ ${completeTarget.code}` : 'Hoàn thành'}
        footer={
          <>
            <Button variant="outline" onClick={() => setCompleteTarget(null)}>
              Huỷ
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={confirmComplete} disabled={!!busy} data-testid="sos-complete-confirm">
              Xác nhận đã thu & hoàn tất
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <p className="text-sm text-slate-600">
            Khách thanh toán chi phí cứu hộ trực tiếp cho garage (tiền mặt hoặc chuyển khoản). Sàn không thu hộ khoản này.
          </p>
          <Field label="Tổng tiền cứu hộ đã thu của khách (đồng)">
            {(id) => <Input id={id} type="number" min={0} step={10000} value={completePrice} onChange={(e) => setCompletePrice(e.target.value)} />}
          </Field>
          <Field label="Ghi chú bàn giao / hoàn tất">
            {(id) => <Input id={id} value={completeNote} onChange={(e) => setCompleteNote(e.target.value)} placeholder="VD: Đã kích bình nổ máy ổn định…" />}
          </Field>
        </div>
      </Dialog>

      {/* Hộp thoại trả lời đánh giá */}
      <Dialog
        open={!!replyTarget}
        onClose={() => setReplyTarget(null)}
        title={replyTarget ? `Phản hồi đánh giá · ${replyTarget.code}` : 'Phản hồi đánh giá'}
        footer={
          <>
            <Button variant="outline" onClick={() => setReplyTarget(null)}>
              Huỷ
            </Button>
            <Button onClick={confirmReply} disabled={!!busy} data-testid="sos-reply-confirm">
              Gửi phản hồi
            </Button>
          </>
        }
      >
        <Field label="Nội dung phản hồi khách hàng">
          {(id) => <Input id={id} value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Cảm ơn anh/chị đã tin tưởng đội cứu hộ…" />}
        </Field>
      </Dialog>
    </div>
  );
}
