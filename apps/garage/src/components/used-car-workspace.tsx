'use client';

import { Alert, Badge, Button, Card, Dialog, Field, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import {
  CheckCircle2,
  ClipboardCheck,
  EyeOff,
  FileText,
  ImagePlus,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Tag,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AppraisalReportCard } from '@/components/appraisal-report-card';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { convertImageToWebp } from '@/lib/image-webp';
import { fmtDateTime } from '@/lib/orders';
import {
  APPRAISAL_GRADE_UI,
  APPRAISAL_STATUS_UI,
  BODY_STYLE_LABEL,
  fmtCarPrice,
  fmtVnd,
  FUEL_LABEL,
  localInputToIso,
  TRANSMISSION_LABEL,
  USED_CAR_LISTING_UI,
  VIEWING_STATUS_UI,
  type AppraisalChecklistItem,
  type ChecklistItemStatus,
  type UsedCarAppraisalItem,
  type UsedCarListingItem,
  type UsedCarThreadItem,
} from '@/lib/used-cars';

export function UsedCarWorkspace({ mode }: { mode: 'PARTNER' | 'GARAGE' }) {
  const { me, can } = useAuth();
  const canManage =
    mode === 'PARTNER'
      ? can('partner.request.manage') || can('partner.listing.manage')
      : can('used_car.manage');
  const canAppraise =
    mode === 'PARTNER'
      ? can('partner.request.manage')
      : can('used_car.appraise') || can('used_car.manage');

  const [section, setSection] = useState<'appraisals' | 'listings' | 'threads'>('appraisals');
  const [appraisalFilter, setAppraisalFilter] = useState<'OPEN' | 'DONE' | 'ALL'>('OPEN');
  const [branchFilter, setBranchFilter] = useState('');
  const [q, setQ] = useState('');

  const [config, setConfig] = useState<{
    enabled: boolean;
    fee: number;
    branchId: string | null;
    note: string | null;
    branches: { id: string; code: string; name: string }[];
    technicians: { membershipId: string; fullName: string; phone: string; roles: string[] }[];
  } | null>(null);
  const [appraisals, setAppraisals] = useState<{ counts: Record<string, number>; items: UsedCarAppraisalItem[] } | null>(null);
  const [listings, setListings] = useState<UsedCarListingItem[] | null>(null);
  const [threads, setThreads] = useState<UsedCarThreadItem[] | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Cấu hình dịch vụ kiểm định
  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfgForm, setCfgForm] = useState({ enabled: true, fee: '500000', branchId: '', note: '' });

  // Xác nhận / từ chối lịch kiểm định
  const [confirmTarget, setConfirmTarget] = useState<UsedCarAppraisalItem | null>(null);
  const [confirmScheduled, setConfirmScheduled] = useState('');
  const [confirmAssignee, setConfirmAssignee] = useState('');

  const [rejectTarget, setRejectTarget] = useState<UsedCarAppraisalItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Chấm checklist kiểm định 6 nhóm
  const [gradeTarget, setGradeTarget] = useState<UsedCarAppraisalItem | null>(null);
  const [checklist, setChecklist] = useState<AppraisalChecklistItem[]>([]);
  const [noMajorAccident, setNoMajorAccident] = useState(true);
  const [noFloodDamage, setNoFloodDamage] = useState(true);
  const [validDocuments, setValidDocuments] = useState(true);
  const [inspectedOdo, setInspectedOdo] = useState('');
  const [gradeSummary, setGradeSummary] = useState('');
  const [reportImageIds, setReportImageIds] = useState<string[]>([]);
  const [finalFee, setFinalFee] = useState('');
  const [payMethod, setPayMethod] = useState<'CHUYEN_KHOAN' | 'TIEN_MAT' | 'THE'>('CHUYEN_KHOAN');

  // Xem báo cáo chi tiết
  const [previewReport, setPreviewReport] = useState<UsedCarAppraisalItem | null>(null);

  // Đăng / sửa tin bán xe cũ của garage
  const [listingOpen, setListingOpen] = useState(false);
  const [editingListing, setEditingListing] = useState<UsedCarListingItem | null>(null);
  const [listForm, setListForm] = useState({
    title: '',
    plateNo: '',
    vin: '',
    make: '',
    model: '',
    year: '2022',
    mileageKm: '30000',
    bodyStyle: 'SUV_CUV',
    transmission: 'TU_DONG' as 'TU_DONG' | 'SO_SAN',
    fuel: 'XANG' as 'XANG' | 'DAU' | 'DIEN' | 'HYBRID',
    exteriorColor: 'Trắng',
    seats: '5',
    ownersCount: '1',
    price: '650000000',
    negotiable: true,
    province: 'Hà Nội',
    addressText: '',
    branchId: '',
    description: '',
    imageFileIds: [] as string[],
    docFileIds: [] as string[],
  });

  // Hộp thoại trả lời hội thoại & chốt lịch xem xe
  const [activeThread, setActiveThread] = useState<UsedCarThreadItem | null>(null);
  const [replyText, setReplyText] = useState('');

  const loadAll = useCallback(async () => {
    try {
      const aQs = new URLSearchParams({ status: appraisalFilter });
      const lQs = new URLSearchParams();
      const tQs = new URLSearchParams();
      if (branchFilter) {
        aQs.set('branchId', branchFilter);
        lQs.set('branchId', branchFilter);
        tQs.set('branchId', branchFilter);
      }
      if (q.trim()) {
        aQs.set('q', q.trim());
        lQs.set('q', q.trim());
      }

      const [cfgData, apData, lData, tData] = await Promise.all([
        api<NonNullable<typeof config>>('/used-cars/config'),
        api<{ counts: Record<string, number>; items: UsedCarAppraisalItem[] }>(`/used-cars/appraisals?${aQs}`),
        api<UsedCarListingItem[]>(`/used-cars/listings?${lQs}`),
        canManage ? api<UsedCarThreadItem[]>(`/used-cars/threads?${tQs}`) : Promise.resolve([]),
      ]);
      setConfig(cfgData);
      setAppraisals(apData);
      setListings(lData);
      setThreads(tData);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được dữ liệu Xe cũ & Kiểm định');
    }
  }, [appraisalFilter, branchFilter, q, canManage]);

  useEffect(() => {
    const t = setTimeout(() => void loadAll(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadAll, q]);

  async function runAction(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await loadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Thao tác thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function uploadPhoto(e: React.ChangeEvent<HTMLInputElement>, append: (id: string) => void) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy('upload');
    try {
      const webpFile = await convertImageToWebp(file);
      const form = new FormData();
      form.append('file', webpFile);
      const res = await api<{ id: string }>('/files', { form });
      append(res.id);
    } catch (ex) {
      setError(ex instanceof ApiError ? ex.message : 'Tải ảnh thất bại');
    } finally {
      setBusy(null);
    }
  }

  function openGradeModal(ap: UsedCarAppraisalItem) {
    setGradeTarget(ap);
    setChecklist(ap.checklist.map((c) => ({ ...c })));
    setNoMajorAccident(ap.noMajorAccident);
    setNoFloodDamage(ap.noFloodDamage);
    setValidDocuments(ap.validDocuments);
    setInspectedOdo(String(ap.inspectedMileageKm ?? ap.listing?.mileageKm ?? 30000));
    setGradeSummary(ap.summary ?? 'Xe nguyên bản, khung gầm và động cơ hoạt động ổn định.');
    setReportImageIds(ap.reportImages.map((i) => i.id));
    setFinalFee(String(ap.finalFee ?? ap.quotedFee));
    setPayMethod('CHUYEN_KHOAN');
  }

  function previewLiveScore() {
    let raw = 0;
    let crit = false;
    for (const item of checklist) {
      if (item.status === 'TOT') raw += item.maxPoints;
      else if (item.status === 'LUU_Y') raw += Math.round(item.maxPoints * 0.6);
      else if (item.key === 'BODY_FRAME' || item.key === 'ENGINE_GEARBOX' || item.key === 'LEGAL_ODO') crit = true;
    }
    if (!noMajorAccident || !noFloodDamage || !validDocuments) {
      return { score: Math.min(raw, 49), grade: 'KHONG_DAT' as const };
    }
    if (crit || raw < 50) return { score: raw, grade: 'KHONG_DAT' as const };
    if (raw >= 75) return { score: raw, grade: 'DAT_CHUAN' as const };
    return { score: raw, grade: 'LUU_Y' as const };
  }

  function openNewListing() {
    setEditingListing(null);
    setListForm({
      title: '',
      plateNo: '',
      vin: '',
      make: '',
      model: '',
      year: '2022',
      mileageKm: '30000',
      bodyStyle: 'SUV_CUV',
      transmission: 'TU_DONG',
      fuel: 'XANG',
      exteriorColor: 'Trắng',
      seats: '5',
      ownersCount: '1',
      price: '650000000',
      negotiable: true,
      province: mode === 'PARTNER' ? 'Hà Nội' : 'Bình Phước',
      addressText: '',
      branchId: config?.branches[0]?.id ?? '',
      description: '',
      imageFileIds: [],
      docFileIds: [],
    });
    setListingOpen(true);
  }

  function openEditListing(l: UsedCarListingItem) {
    setEditingListing(l);
    setListForm({
      title: l.title,
      plateNo: l.plateNo ?? '',
      vin: l.vin ?? '',
      make: l.make,
      model: l.model,
      year: String(l.year),
      mileageKm: String(l.mileageKm),
      bodyStyle: l.bodyStyle,
      transmission: l.transmission,
      fuel: l.fuel,
      exteriorColor: l.exteriorColor ?? '',
      seats: String(l.seats),
      ownersCount: String(l.ownersCount),
      price: String(l.price),
      negotiable: l.negotiable,
      province: l.province,
      addressText: l.addressText ?? '',
      branchId: l.branch?.id ?? '',
      description: l.description ?? '',
      imageFileIds: l.images.map((i) => i.id),
      docFileIds: l.docImages.map((i) => i.id),
    });
    setListingOpen(true);
  }

  async function saveListing() {
    const body = {
      title: listForm.title,
      plateNo: listForm.plateNo || null,
      vin: listForm.vin || null,
      make: listForm.make,
      model: listForm.model,
      year: Number(listForm.year),
      mileageKm: Number(listForm.mileageKm),
      bodyStyle: listForm.bodyStyle,
      transmission: listForm.transmission,
      fuel: listForm.fuel,
      exteriorColor: listForm.exteriorColor || null,
      seats: Number(listForm.seats),
      ownersCount: Number(listForm.ownersCount),
      price: Number(listForm.price),
      negotiable: listForm.negotiable,
      province: listForm.province,
      addressText: listForm.addressText || null,
      branchId: mode === 'GARAGE' ? listForm.branchId || null : null,
      description: listForm.description || null,
      imageFileIds: listForm.imageFileIds,
      docFileIds: listForm.docFileIds,
    };
    await runAction('save-listing', async () => {
      if (editingListing) {
        await api(`/used-cars/listings/${editingListing.id}`, { method: 'PUT', body });
      } else {
        await api('/used-cars/listings', { body });
      }
      setListingOpen(false);
    });
  }

  const liveEval = gradeTarget ? previewLiveScore() : null;

  return (
    <div className="space-y-4" data-testid="used-car-workspace">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          tabs={[
            { value: 'appraisals', label: `Phiếu kiểm định${appraisals ? ` (${appraisals.items.length})` : ''}` },
            ...(canManage
              ? [
                  { value: 'listings' as const, label: `Tin bán xe của garage${listings ? ` (${listings.length})` : ''}` },
                  { value: 'threads' as const, label: `Khách hỏi & hẹn xem${threads ? ` (${threads.length})` : ''}` },
                ]
              : []),
          ]}
          value={section}
          onChange={(v) => setSection(v)}
        />

        <div className="flex flex-wrap items-center gap-2">
          {mode === 'GARAGE' && (me?.branches.length ?? 0) > 1 && (
            <Select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="w-auto rounded-full bg-white/85" aria-label="Lọc chi nhánh">
              <option value="">Tất cả chi nhánh</option>
              {me!.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}
          <div className="relative w-56">
            <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mã KD/XC, tên xe, SĐT…" className="rounded-full bg-white/85 pl-10" aria-label="Tìm xe cũ & kiểm định" />
          </div>

          {canManage && section === 'appraisals' && (
            <Button
              variant="outline"
              onClick={() => {
                setCfgForm({
                  enabled: config?.enabled ?? true,
                  fee: String(config?.fee ?? 500000),
                  branchId: config?.branchId ?? config?.branches[0]?.id ?? '',
                  note: config?.note ?? '',
                });
                setCfgOpen(true);
              }}
              data-testid="appraisal-config-btn"
            >
              <Settings className="h-4 w-4" /> Dịch vụ kiểm định ({config?.enabled ? fmtVnd(config.fee) : 'Đang tắt'})
            </Button>
          )}

          {canManage && section === 'listings' && (
            <Button onClick={openNewListing} data-testid="used-car-add-listing">
              <Plus className="h-4 w-4" /> Đăng bán xe cũ
            </Button>
          )}
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      {/* ==================== TAB 1: PHIẾU KIỂM ĐỊNH ==================== */}
      {section === 'appraisals' && (
        <div className="space-y-3">
          <Tabs
            tabs={[
              { value: 'OPEN', label: 'Đang chờ / Đang chấm' },
              { value: 'DONE', label: 'Đã hoàn tất / Huỷ' },
              { value: 'ALL', label: 'Tất cả' },
            ]}
            value={appraisalFilter}
            onChange={(v) => setAppraisalFilter(v)}
          />

          {!appraisals ? (
            <Spinner className="h-6 w-6 text-brand-600" />
          ) : !appraisals.items.length ? (
            <Card className="p-10 text-center text-sm text-slate-500">Chưa có phiếu kiểm định xe cũ nào trong mục này.</Card>
          ) : (
            <ul className="space-y-3" data-testid="appraisal-list">
              {appraisals.items.map((ap) => {
                const st = APPRAISAL_STATUS_UI[ap.status];
                return (
                  <li key={ap.id}>
                    <Card className="p-5 space-y-3" data-testid="appraisal-card">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-lg font-bold">{ap.code}</span>
                            <Badge tone={st.tone}>{st.label}</Badge>
                            {ap.grade && <Badge tone={APPRAISAL_GRADE_UI[ap.grade].tone}>{APPRAISAL_GRADE_UI[ap.grade].label}</Badge>}
                            {ap.score !== null && <span className="text-xs font-bold text-emerald-700">{ap.score}/100 điểm</span>}
                          </div>
                          {ap.listing && (
                            <div className="text-sm font-semibold text-slate-900">
                              Xe kiểm định: {ap.listing.title}{' '}
                              <span className="font-mono text-xs font-normal text-slate-500">
                                ({ap.listing.code}
                                {ap.listing.plateNo ? ` · ${ap.listing.plateNo}` : ''})
                              </span>
                            </div>
                          )}
                          <div className="text-xs text-slate-600">
                            Lịch hẹn: <b>{fmtDateTime(ap.scheduledAt)}</b>
                            {ap.listing ? ` · Chủ xe / liên hệ: ${ap.listing.contactName} (${ap.listing.contactPhone})` : ''}
                            {ap.assigneeName ? ` · KTV phụ trách: ${ap.assigneeName}` : ''}
                          </div>
                          {ap.customerNote && <p className="text-xs text-slate-500">Ghi chú: {ap.customerNote}</p>}
                          {(ap.listing?.docImages.length ?? 0) > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-slate-500">
                              <FileText className="h-3.5 w-3.5" /> Giấy tờ xe đính kèm ({ap.listing!.docImages.length}):
                              {ap.listing!.docImages.map(
                                (d, i) =>
                                  d.url && (
                                    <a key={d.id} href={d.url} target="_blank" rel="noreferrer" className="text-brand-700 underline">
                                      Ảnh #{i + 1}
                                    </a>
                                  ),
                              )}
                            </div>
                          )}
                        </div>

                        <div className="text-right text-sm">
                          <div>
                            Phí kiểm định: <b className="tabular-nums">{fmtVnd(ap.finalFee ?? ap.quotedFee)}</b>
                          </div>
                          {ap.cashEntry && (
                            <div className="font-mono text-xs text-indigo-700" data-testid="appraisal-cash-entry">
                              Phiếu thu: {ap.cashEntry.code}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-1">
                        {canManage && ap.status === 'CHO_XAC_NHAN' && (
                          <>
                            <Button
                              onClick={() => {
                                setConfirmTarget(ap);
                                setConfirmScheduled('');
                                setConfirmAssignee(ap.assignedMemberId ?? '');
                              }}
                              disabled={busy === ap.id}
                              data-testid="appraisal-confirm-btn"
                            >
                              <CheckCircle2 className="h-4 w-4" /> Xác nhận lịch hẹn
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => {
                                setRejectTarget(ap);
                                setRejectReason('');
                              }}
                              disabled={busy === ap.id}
                              data-testid="appraisal-reject-btn"
                            >
                              <XCircle className="h-4 w-4" /> Từ chối
                            </Button>
                          </>
                        )}

                        {canAppraise && ['CHO_XAC_NHAN', 'DA_HEN', 'DANG_KIEM_DINH'].includes(ap.status) && (
                          <Button onClick={() => openGradeModal(ap)} disabled={busy === ap.id} data-testid="appraisal-grade-btn">
                            <ClipboardCheck className="h-4 w-4" /> Chấm checklist & xuất báo cáo
                          </Button>
                        )}

                        {ap.status === 'HOAN_THANH' && (
                          <Button variant="outline" onClick={() => setPreviewReport(ap)} data-testid="appraisal-view-report-btn">
                            <ShieldCheck className="h-4 w-4" /> Xem báo cáo kiểm định
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
      )}

      {/* ==================== TAB 2: TIN BÁN XE CỦA GARAGE ==================== */}
      {section === 'listings' && canManage && (
        <div>
          {!listings ? (
            <Spinner className="h-6 w-6 text-brand-600" />
          ) : !listings.length ? (
            <Card className="p-10 text-center text-sm text-slate-500">
              Garage chưa có tin đăng bán xe cũ nào. Bấm &ldquo;Đăng bán xe cũ&rdquo; để tạo tin mới.
            </Card>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2" data-testid="garage-used-car-list">
              {listings.map((l) => {
                const st = USED_CAR_LISTING_UI[l.status];
                return (
                  <li key={l.id}>
                    <Card className="p-4 space-y-3" data-testid="garage-used-car-card">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-xs text-slate-500">{l.code}</span>
                            <Badge tone={st.tone}>{st.label}</Badge>
                            {l.hasVerifiedBadge && (
                              <Badge tone="mint">
                                <ShieldCheck className="h-3 w-3" /> Đã kiểm định {l.appraisalReport?.score ? `${l.appraisalReport.score}/100` : ''}
                              </Badge>
                            )}
                          </div>
                          <h3 className="mt-1 font-semibold text-slate-900">{l.title}</h3>
                          <div className="text-xs text-slate-500">
                            {l.year} · {l.mileageKm.toLocaleString('vi-VN')} km · {BODY_STYLE_LABEL[l.bodyStyle] ?? l.bodyStyle} ·{' '}
                            {TRANSMISSION_LABEL[l.transmission]} · {FUEL_LABEL[l.fuel]}
                            {l.plateNo ? ` · ${l.plateNo}` : ''}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-emerald-700">{fmtCarPrice(l.price)}</div>
                          <div className="text-xs text-slate-400">{l.viewsCount} lượt xem</div>
                        </div>
                      </div>

                      {l.reviewNote && (
                        <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
                          <b>Ghi chú kiểm duyệt sàn:</b> {l.reviewNote}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        {(l.status === 'NHAP' || l.status === 'BI_TU_CHOI') && (
                          <Button
                            onClick={() => runAction(l.id, () => api(`/used-cars/listings/${l.id}/submit`, { body: {} }))}
                            disabled={busy === l.id}
                            data-testid="garage-submit-used-car"
                          >
                            <Send className="h-4 w-4" /> Gửi sàn duyệt
                          </Button>
                        )}
                        {!l.hasVerifiedBadge && l.status !== 'DA_BAN' && l.status !== 'BI_GO' && (
                          <Button
                            variant="outline"
                            onClick={() =>
                              runAction(l.id, async () => {
                                await api(`/used-cars/listings/${l.id}/self-appraisal`, { body: {} });
                                setSection('appraisals');
                              })
                            }
                            disabled={busy === l.id}
                            data-testid="garage-self-appraisal-btn"
                          >
                            <ClipboardCheck className="h-4 w-4" /> Lập phiếu kiểm định
                          </Button>
                        )}
                        {l.status === 'DANG_BAN' && (
                          <Button
                            variant="outline"
                            onClick={() => runAction(l.id, () => api(`/used-cars/listings/${l.id}/hide`, { body: {} }))}
                            disabled={busy === l.id}
                          >
                            <EyeOff className="h-4 w-4" /> Tạm ẩn
                          </Button>
                        )}
                        {l.status === 'TAM_AN' && (
                          <Button
                            variant="outline"
                            onClick={() => runAction(l.id, () => api(`/used-cars/listings/${l.id}/show`, { body: {} }))}
                            disabled={busy === l.id}
                          >
                            Mở lại
                          </Button>
                        )}
                        {l.status === 'HET_HAN' && (
                          <Button
                            onClick={() => runAction(l.id, () => api(`/used-cars/listings/${l.id}/renew`, { body: {} }))}
                            disabled={busy === l.id}
                          >
                            <RefreshCw className="h-4 w-4" /> Gia hạn +60 ngày
                          </Button>
                        )}
                        {['DANG_BAN', 'TAM_AN', 'HET_HAN'].includes(l.status) && (
                          <Button
                            variant="outline"
                            onClick={() => runAction(l.id, () => api(`/used-cars/listings/${l.id}/sold`, { body: {} }))}
                            disabled={busy === l.id}
                            data-testid="garage-mark-sold-btn"
                          >
                            <Tag className="h-4 w-4" /> Đánh dấu Đã bán
                          </Button>
                        )}
                        {l.status !== 'DA_BAN' && l.status !== 'BI_GO' && (
                          <Button variant="outline" onClick={() => openEditListing(l)}>
                            <Pencil className="h-4 w-4" /> Sửa
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
      )}

      {/* ==================== TAB 3: KHÁCH HỎI MUA & HẸN XEM XE ==================== */}
      {section === 'threads' && canManage && (
        <div>
          {!threads ? (
            <Spinner className="h-6 w-6 text-brand-600" />
          ) : !threads.length ? (
            <Card className="p-10 text-center text-sm text-slate-500">Chưa có tin nhắn hỏi mua hoặc hẹn xem xe nào từ khách.</Card>
          ) : (
            <ul className="space-y-3" data-testid="garage-thread-list">
              {threads.map((t) => {
                const vst = VIEWING_STATUS_UI[t.viewingStatus] ?? VIEWING_STATUS_UI.NONE;
                const last = t.messages[t.messages.length - 1];
                return (
                  <li key={t.id}>
                    <Card className="flex flex-wrap items-center justify-between gap-3 p-4" data-testid="garage-thread-card">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-900">{t.buyerName}</span>
                          <span className="text-xs text-slate-500">({t.buyerPhone})</span>
                          {t.viewingStatus !== 'NONE' && <Badge tone={vst.tone}>{vst.label}</Badge>}
                        </div>
                        <div className="text-xs font-medium text-brand-700">
                          Quan tâm: {t.listing.title} ({t.listing.code})
                        </div>
                        {t.viewingAt && <div className="text-xs text-slate-600">Giờ hẹn xem xe: <b>{fmtDateTime(t.viewingAt)}</b></div>}
                        {last && (
                          <div className="text-sm text-slate-600">
                            <b>{last.senderName}:</b> {last.content}
                          </div>
                        )}
                      </div>

                      <Button
                        onClick={() => {
                          setActiveThread(t);
                          setReplyText('');
                        }}
                        data-testid="garage-open-thread-btn"
                      >
                        <MessageSquare className="h-4 w-4" /> Mở hội thoại & xác nhận lịch
                      </Button>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Hộp thoại cấu hình dịch vụ kiểm định xe cũ */}
      <Dialog
        open={cfgOpen}
        onClose={() => setCfgOpen(false)}
        title="Cấu hình dịch vụ Kiểm định xe cũ của garage"
        footer={
          <>
            <Button variant="outline" onClick={() => setCfgOpen(false)}>
              Đóng
            </Button>
            <Button
              onClick={() =>
                runAction('save-cfg', async () => {
                  await api('/used-cars/config', {
                    method: 'PUT',
                    body: {
                      enabled: cfgForm.enabled,
                      fee: Number(cfgForm.fee),
                      branchId: mode === 'GARAGE' ? cfgForm.branchId || null : null,
                      note: cfgForm.note || null,
                    },
                  });
                  setCfgOpen(false);
                })
              }
              disabled={!!busy}
              data-testid="appraisal-config-save"
            >
              Lưu cấu hình
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <input type="checkbox" checked={cfgForm.enabled} onChange={(e) => setCfgForm((f) => ({ ...f, enabled: e.target.checked }))} />
            Nhận đặt lịch dịch vụ kiểm định xe cũ từ chủ xe trên sàn
          </label>
          <Field label="Phí dịch vụ kiểm định (đồng, khách trả trực tiếp tại garage) *">
            {(id) => <Input id={id} type="number" min={0} step={50000} value={cfgForm.fee} onChange={(e) => setCfgForm((f) => ({ ...f, fee: e.target.value }))} />}
          </Field>
          {mode === 'GARAGE' && (config?.branches.length ?? 0) > 0 && (
            <Field label="Chi nhánh tiếp nhận mặc định">
              {(id) => (
                <Select id={id} value={cfgForm.branchId} onChange={(e) => setCfgForm((f) => ({ ...f, branchId: e.target.value }))}>
                  {config!.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} · {b.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Mô tả quy trình & trang thiết bị kiểm định">
            {(id) => <Input id={id} value={cfgForm.note} onChange={(e) => setCfgForm((f) => ({ ...f, note: e.target.value }))} placeholder="Cầu nâng 2 trụ, máy quét lỗi OBD, đo sơn điện tử…" />}
          </Field>
        </div>
      </Dialog>

      {/* Hộp thoại xác nhận lịch hẹn kiểm định */}
      <Dialog
        open={!!confirmTarget}
        onClose={() => setConfirmTarget(null)}
        title={confirmTarget ? `Xác nhận lịch kiểm định · ${confirmTarget.code}` : 'Xác nhận lịch'}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmTarget(null)}>
              Huỷ
            </Button>
            <Button
              onClick={() =>
                confirmTarget &&
                runAction(confirmTarget.id, async () => {
                  await api(`/used-cars/appraisals/${confirmTarget.id}/confirm`, {
                    body: {
                      ...(confirmScheduled ? { scheduledAt: localInputToIso(confirmScheduled) } : {}),
                      assignedMemberId: mode === 'GARAGE' ? confirmAssignee || null : null,
                    },
                  });
                  setConfirmTarget(null);
                })
              }
              disabled={!!busy}
              data-testid="appraisal-confirm-submit"
            >
              Xác nhận hẹn kiểm định
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Đổi ngày giờ hẹn (bỏ trống để giữ giờ khách đặt)">
            {(id) => <Input id={id} type="datetime-local" value={confirmScheduled} onChange={(e) => setConfirmScheduled(e.target.value)} />}
          </Field>
          {mode === 'GARAGE' && (config?.technicians.length ?? 0) > 0 && (
            <Field label="Phân công Kỹ thuật viên kiểm định">
              {(id) => (
                <Select id={id} value={confirmAssignee} onChange={(e) => setConfirmAssignee(e.target.value)}>
                  <option value="">-- Bất kỳ KTV tại chi nhánh --</option>
                  {config!.technicians.map((t) => (
                    <option key={t.membershipId} value={t.membershipId}>
                      {t.fullName} ({t.roles.join(', ')})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>
      </Dialog>

      {/* Hộp thoại từ chối lịch kiểm định */}
      <Dialog
        open={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        title="Từ chối yêu cầu kiểm định"
        footer={
          <>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              Huỷ
            </Button>
            <Button
              className="bg-rose-600 hover:bg-rose-700"
              onClick={() =>
                rejectTarget &&
                runAction(rejectTarget.id, async () => {
                  await api(`/used-cars/appraisals/${rejectTarget.id}/reject`, { body: { reason: rejectReason } });
                  setRejectTarget(null);
                })
              }
              disabled={!!busy}
              data-testid="appraisal-reject-submit"
            >
              Xác nhận từ chối
            </Button>
          </>
        }
      >
        <Field label="Lý do từ chối *">
          {(id) => <Input id={id} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="VD: Khoang kiểm định kín lịch khung giờ này…" />}
        </Field>
      </Dialog>

      {/* Hộp thoại chấm checklist kiểm định 6 nhóm (100 điểm) */}
      <Dialog
        open={!!gradeTarget}
        onClose={() => setGradeTarget(null)}
        title={gradeTarget ? `Chấm báo cáo kiểm định · ${gradeTarget.code}` : 'Chấm kiểm định'}
        wide
        footer={
          <>
            <Button variant="outline" onClick={() => setGradeTarget(null)}>
              Đóng
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                gradeTarget &&
                runAction(gradeTarget.id, async () => {
                  await api(`/used-cars/appraisals/${gradeTarget.id}/save-checklist`, {
                    body: {
                      checklist,
                      noMajorAccident,
                      noFloodDamage,
                      validDocuments,
                      inspectedMileageKm: Number(inspectedOdo),
                      summary: gradeSummary || null,
                      reportImageIds,
                    },
                  });
                  setGradeTarget(null);
                })
              }
              disabled={!!busy}
              data-testid="appraisal-save-draft-btn"
            >
              Lưu nháp đang chấm
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() =>
                gradeTarget &&
                runAction(gradeTarget.id, async () => {
                  await api(`/used-cars/appraisals/${gradeTarget.id}/complete`, {
                    body: {
                      checklist,
                      noMajorAccident,
                      noFloodDamage,
                      validDocuments,
                      inspectedMileageKm: Number(inspectedOdo),
                      summary: gradeSummary || null,
                      reportImageIds,
                      finalFee: finalFee.trim() !== '' ? Number(finalFee) : null,
                      paymentMethod: payMethod,
                    },
                  });
                  setGradeTarget(null);
                  setAppraisalFilter('DONE');
                })
              }
              disabled={!!busy}
              data-testid="appraisal-complete-btn"
            >
              Hoàn tất & gắn báo cáo lên tin
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {liveEval && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm">
              <div>
                Điểm kỹ thuật dự kiến: <b className="text-lg text-emerald-800">{liveEval.score}/100</b> · Xếp loại:{' '}
                <Badge tone={APPRAISAL_GRADE_UI[liveEval.grade].tone}>{APPRAISAL_GRADE_UI[liveEval.grade].label}</Badge>
              </div>
              <span className="text-xs text-slate-600">
                {liveEval.grade === 'DAT_CHUAN' ? 'Đủ điều kiện cấp Huy hiệu Đã kiểm định trên sàn' : 'Gắn báo cáo minh bạch, không cấp huy hiệu Đạt chuẩn'}
              </span>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-3 text-sm">
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 p-2.5">
              <input type="checkbox" checked={noMajorAccident} onChange={(e) => setNoMajorAccident(e.target.checked)} />
              <span>Không đâm đụng khung gầm</span>
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 p-2.5">
              <input type="checkbox" checked={noFloodDamage} onChange={(e) => setNoFloodDamage(e.target.checked)} />
              <span>Không thuỷ kích / ngập nước</span>
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 p-2.5">
              <input type="checkbox" checked={validDocuments} onChange={(e) => setValidDocuments(e.target.checked)} />
              <span>Giấy tờ & số khung hợp lệ</span>
            </label>
          </div>

          <div className="space-y-2.5">
            {checklist.map((item, idx) => (
              <div key={item.key} className="rounded-2xl border border-slate-200 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {item.group} <span className="text-xs font-normal text-slate-400">({item.maxPoints} điểm)</span>
                    </div>
                    <div className="text-xs text-slate-500">{item.label}</div>
                  </div>
                  <Select
                    value={item.status}
                    onChange={(e) => {
                      const next = e.target.value as ChecklistItemStatus;
                      setChecklist((prev) => prev.map((x, i) => (i === idx ? { ...x, status: next } : x)));
                    }}
                    className="w-auto"
                    aria-label={`Đánh giá ${item.group}`}
                  >
                    <option value="TOT">Tốt (100%)</option>
                    <option value="LUU_Y">Lưu ý (60%)</option>
                    <option value="KHONG_DAT">Không đạt (0đ)</option>
                  </Select>
                </div>
                <Input
                  value={item.note ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setChecklist((prev) => prev.map((x, i) => (i === idx ? { ...x, note: val || null } : x)));
                  }}
                  placeholder={`Ghi chú cho mục ${item.group}…`}
                />
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="ODO thực tế lúc kiểm định (km) *">
              {(id) => <Input id={id} type="number" min={0} value={inspectedOdo} onChange={(e) => setInspectedOdo(e.target.value)} />}
            </Field>
            <Field label="Phí kiểm định đã thu (đồng)">
              {(id) => <Input id={id} type="number" min={0} step={50000} value={finalFee} onChange={(e) => setFinalFee(e.target.value)} />}
            </Field>
            <Field label="Hình thức thu phí">
              {(id) => (
                <Select id={id} value={payMethod} onChange={(e) => setPayMethod(e.target.value as 'CHUYEN_KHOAN' | 'TIEN_MAT' | 'THE')}>
                  <option value="CHUYEN_KHOAN">Chuyển khoản</option>
                  <option value="TIEN_MAT">Tiền mặt</option>
                  <option value="THE">Quẹt thẻ</option>
                </Select>
              )}
            </Field>
          </div>

          <Field label="Nhận xét tổng thể của chuyên gia kiểm định">
            {(id) => <Input id={id} value={gradeSummary} onChange={(e) => setGradeSummary(e.target.value)} />}
          </Field>

          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
            <ImagePlus className="h-4 w-4" /> Ảnh chụp khoang máy / gầm / keo chỉ ({reportImageIds.length}/10)
            <input type="file" accept="image/*" className="hidden" onChange={(e) => void uploadPhoto(e, (fid) => setReportImageIds((xs) => [...xs, fid].slice(0, 10)))} />
          </label>
        </div>
      </Dialog>

      {/* Xem báo cáo kiểm định */}
      <Dialog
        open={!!previewReport}
        onClose={() => setPreviewReport(null)}
        title={previewReport ? `Báo cáo kiểm định · ${previewReport.code}` : 'Báo cáo kiểm định'}
        wide
        footer={
          <Button variant="outline" onClick={() => setPreviewReport(null)}>
            Đóng
          </Button>
        }
      >
        {previewReport && <AppraisalReportCard report={previewReport} />}
      </Dialog>

      {/* Hộp thoại đăng / sửa tin xe cũ của garage */}
      <Dialog
        open={listingOpen}
        onClose={() => setListingOpen(false)}
        title={editingListing ? `Sửa tin xe cũ · ${editingListing.code}` : 'Đăng tin bán xe cũ tại garage'}
        wide
        footer={
          <>
            <Button variant="outline" onClick={() => setListingOpen(false)}>
              Huỷ
            </Button>
            <Button onClick={saveListing} disabled={!!busy} data-testid="used-car-save-listing">
              Lưu tin xe cũ
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tiêu đề tin đăng *">
              {(id) => <Input id={id} value={listForm.title} onChange={(e) => setListForm((f) => ({ ...f, title: e.target.value }))} placeholder="VD: Mazda CX-5 2.0 Premium 2022 · 1 chủ" />}
            </Field>
            <Field label="Giá bán đề xuất (đồng) *">
              {(id) => <Input id={id} type="number" step={5000000} value={listForm.price} onChange={(e) => setListForm((f) => ({ ...f, price: e.target.value }))} />}
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Hãng xe *">
              {(id) => <Input id={id} value={listForm.make} onChange={(e) => setListForm((f) => ({ ...f, make: e.target.value }))} placeholder="Mazda" />}
            </Field>
            <Field label="Dòng xe *">
              {(id) => <Input id={id} value={listForm.model} onChange={(e) => setListForm((f) => ({ ...f, model: e.target.value }))} placeholder="CX-5" />}
            </Field>
            <Field label="Năm sản xuất *">
              {(id) => <Input id={id} type="number" value={listForm.year} onChange={(e) => setListForm((f) => ({ ...f, year: e.target.value }))} />}
            </Field>
            <Field label="Số ODO đã đi (km) *">
              {(id) => <Input id={id} type="number" value={listForm.mileageKm} onChange={(e) => setListForm((f) => ({ ...f, mileageKm: e.target.value }))} />}
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Kiểu dáng">
              {(id) => (
                <Select id={id} value={listForm.bodyStyle} onChange={(e) => setListForm((f) => ({ ...f, bodyStyle: e.target.value }))}>
                  {Object.entries(BODY_STYLE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Hộp số">
              {(id) => (
                <Select id={id} value={listForm.transmission} onChange={(e) => setListForm((f) => ({ ...f, transmission: e.target.value as 'TU_DONG' | 'SO_SAN' }))}>
                  <option value="TU_DONG">Số tự động</option>
                  <option value="SO_SAN">Số sàn</option>
                </Select>
              )}
            </Field>
            <Field label="Nhiên liệu">
              {(id) => (
                <Select id={id} value={listForm.fuel} onChange={(e) => setListForm((f) => ({ ...f, fuel: e.target.value as 'XANG' | 'DAU' | 'DIEN' | 'HYBRID' }))}>
                  <option value="XANG">Xăng</option>
                  <option value="DAU">Dầu Diesel</option>
                  <option value="DIEN">Xe điện</option>
                  <option value="HYBRID">Hybrid</option>
                </Select>
              )}
            </Field>
            <Field label="Biển số xe">
              {(id) => <Input id={id} value={listForm.plateNo} onChange={(e) => setListForm((f) => ({ ...f, plateNo: e.target.value }))} placeholder="30H-123.45" />}
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Tỉnh / thành phố xem xe *">
              {(id) => <Input id={id} value={listForm.province} onChange={(e) => setListForm((f) => ({ ...f, province: e.target.value }))} />}
            </Field>
            <Field label="Địa chỉ xem xe">
              {(id) => <Input id={id} value={listForm.addressText} onChange={(e) => setListForm((f) => ({ ...f, addressText: e.target.value }))} />}
            </Field>
            <Field label="Màu ngoại thất">
              {(id) => <Input id={id} value={listForm.exteriorColor} onChange={(e) => setListForm((f) => ({ ...f, exteriorColor: e.target.value }))} />}
            </Field>
          </div>
          {mode === 'GARAGE' && (config?.branches.length ?? 0) > 0 && (
            <Field label="Chi nhánh quản lý xe">
              {(id) => (
                <Select id={id} value={listForm.branchId} onChange={(e) => setListForm((f) => ({ ...f, branchId: e.target.value }))}>
                  {config!.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} · {b.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Mô tả chi tiết tình trạng & lịch sử bảo dưỡng">
            {(id) => <Input id={id} value={listForm.description} onChange={(e) => setListForm((f) => ({ ...f, description: e.target.value }))} />}
          </Field>
          <div className="flex flex-wrap gap-3">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
              <ImagePlus className="h-4 w-4" /> Ảnh xe công khai ({listForm.imageFileIds.length}/12)
              <input type="file" accept="image/*" className="hidden" onChange={(e) => void uploadPhoto(e, (fid) => setListForm((f) => ({ ...f, imageFileIds: [...f.imageFileIds, fid].slice(0, 12) })))} />
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100">
              <FileText className="h-4 w-4" /> Ảnh cà vẹt / đăng kiểm riêng tư ({listForm.docFileIds.length}/6)
              <input type="file" accept="image/*" className="hidden" onChange={(e) => void uploadPhoto(e, (fid) => setListForm((f) => ({ ...f, docFileIds: [...f.docFileIds, fid].slice(0, 6) })))} />
            </label>
          </div>
        </div>
      </Dialog>

      {/* Hộp thoại trả lời khách hỏi mua & chốt lịch xem xe */}
      <Dialog
        open={!!activeThread}
        onClose={() => setActiveThread(null)}
        title={activeThread ? `Hội thoại với ${activeThread.buyerName} (${activeThread.buyerPhone})` : 'Hội thoại'}
        wide
        footer={
          <Button variant="outline" onClick={() => setActiveThread(null)}>
            Đóng
          </Button>
        }
      >
        {activeThread && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 p-3.5 text-sm">
              <div>
                <div className="font-semibold text-slate-900">{activeThread.listing.title}</div>
                {activeThread.viewingAt && (
                  <div className="text-xs text-slate-600">
                    Khách hẹn xem xe lúc: <b>{fmtDateTime(activeThread.viewingAt)}</b>
                  </div>
                )}
              </div>
              {activeThread.viewingStatus === 'CHO_XAC_NHAN' && (
                <div className="flex gap-2">
                  <Button
                    onClick={async () => {
                      const upd = await api<UsedCarThreadItem>(`/used-cars/threads/${activeThread.id}/viewing`, {
                        body: { status: 'DA_XAC_NHAN', note: 'Mời bạn ghé xem xe đúng hẹn' },
                      });
                      setActiveThread(upd);
                      await loadAll();
                    }}
                    data-testid="garage-confirm-viewing-btn"
                  >
                    Xác nhận lịch xem xe
                  </Button>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      const upd = await api<UsedCarThreadItem>(`/used-cars/threads/${activeThread.id}/viewing`, {
                        body: { status: 'TU_CHOI', note: 'Khung giờ này xe bận, hẹn bạn giờ khác nhé' },
                      });
                      setActiveThread(upd);
                      await loadAll();
                    }}
                  >
                    Từ chối lịch
                  </Button>
                </div>
              )}
            </div>

            <div className="max-h-64 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 p-3" data-testid="garage-thread-messages">
              {activeThread.messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-2xl px-3.5 py-2 text-sm ${m.senderRole === 'SELLER' ? 'ml-8 bg-brand-50 text-slate-900' : 'mr-8 bg-slate-100 text-slate-800'}`}
                >
                  <div className="text-xs font-semibold text-slate-500">
                    {m.senderName} · {fmtDateTime(m.createdAt)}
                  </div>
                  <div className="mt-0.5">{m.content}</div>
                </div>
              ))}
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!replyText.trim()) return;
                const upd = await api<UsedCarThreadItem>(`/used-cars/threads/${activeThread.id}/messages`, {
                  body: { content: replyText },
                });
                setActiveThread(upd);
                setReplyText('');
                await loadAll();
              }}
              className="flex gap-2"
            >
              <Input value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Nhập tin nhắn phản hồi khách mua…" aria-label="Phản hồi khách mua" />
              <Button type="submit" data-testid="garage-send-reply-btn">
                <Send className="h-4 w-4" /> Gửi
              </Button>
            </form>
          </div>
        )}
      </Dialog>
    </div>
  );
}
