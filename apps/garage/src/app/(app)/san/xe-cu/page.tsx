'use client';

import { Alert, Badge, Button, Card, Dialog, Field, Input, Spinner, Tabs } from '@cardiy/ui';
import { Ban, CheckCircle2, FileText, Search, ShieldCheck, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AppraisalReportCard } from '@/components/appraisal-report-card';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/orders';
import {
  APPRAISAL_GRADE_UI,
  APPRAISAL_STATUS_UI,
  BODY_STYLE_LABEL,
  fmtCarPrice,
  fmtVnd,
  FUEL_LABEL,
  TRANSMISSION_LABEL,
  USED_CAR_LISTING_UI,
  type UsedCarAppraisalItem,
  type UsedCarListingItem,
  type UsedCarListingStatus,
} from '@/lib/used-cars';

/** A6.31 Kiểm duyệt tin xe cũ & giám sát báo cáo kiểm định trên toàn sàn */
export default function PlatformUsedCarsModerationPage() {
  return (
    <RequirePermission permission="platform.partner.review">
      <PlatformUsedCarsBody />
    </RequirePermission>
  );
}

function PlatformUsedCarsBody() {
  const [section, setSection] = useState<'listings' | 'appraisals'>('listings');
  const [status, setStatus] = useState<'CHO_DUYET' | 'DANG_BAN' | 'BI_TU_CHOI' | 'DA_BAN' | 'HET_HAN' | 'BI_GO' | 'ALL'>('CHO_DUYET');
  const [q, setQ] = useState('');
  const [listData, setListData] = useState<{ counts: Record<string, number>; items: UsedCarListingItem[] } | null>(null);
  const [appData, setAppData] = useState<{ counts: Record<string, number>; items: UsedCarAppraisalItem[] } | null>(null);
  const [noteTarget, setNoteTarget] = useState<{ item: UsedCarListingItem; action: 'reject' | 'takedown' } | null>(null);
  const [note, setNote] = useState('');
  const [reportPreview, setReportPreview] = useState<UsedCarAppraisalItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const lQs = new URLSearchParams({ status });
      const aQs = new URLSearchParams();
      if (q.trim()) {
        lQs.set('q', q.trim());
        aQs.set('q', q.trim());
      }
      const [l, a] = await Promise.all([
        api<{ counts: Record<string, number>; items: UsedCarListingItem[] }>(`/platform/used-cars/listings?${lQs}`),
        api<{ counts: Record<string, number>; items: UsedCarAppraisalItem[] }>(`/platform/used-cars/appraisals?${aQs}`),
      ]);
      setListData(l);
      setAppData(a);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được dữ liệu kiểm duyệt xe cũ');
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
      await api(`/platform/used-cars/listings/${id}/approve`, { body: {} });
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
      await api(`/platform/used-cars/listings/${noteTarget.item.id}/${noteTarget.action}`, { body: { note } });
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
    <div className="space-y-4" data-testid="platform-used-cars-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          tabs={[
            {
              value: 'listings',
              label: `Kiểm duyệt tin xe cũ${listData?.counts.CHO_DUYET ? ` (${listData.counts.CHO_DUYET} chờ duyệt)` : ''}`,
            },
            { value: 'appraisals', label: `Phiếu kiểm định toàn sàn${appData ? ` (${appData.items.length})` : ''}` },
          ]}
          value={section}
          onChange={(v) => setSection(v)}
        />

        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mã XC/KD, tên xe, tỉnh…" className="rounded-full bg-white/85 pl-10" aria-label="Tìm tin xe cũ" />
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      {section === 'listings' ? (
        <div className="space-y-3">
          <Tabs
            tabs={[
              { value: 'CHO_DUYET', label: `Chờ duyệt (${listData?.counts.CHO_DUYET ?? 0})` },
              { value: 'DANG_BAN', label: `Đang bán (${listData?.counts.DANG_BAN ?? 0})` },
              { value: 'BI_TU_CHOI', label: `Bị từ chối (${listData?.counts.BI_TU_CHOI ?? 0})` },
              { value: 'DA_BAN', label: `Đã bán (${listData?.counts.DA_BAN ?? 0})` },
              { value: 'HET_HAN', label: `Hết hạn (${listData?.counts.HET_HAN ?? 0})` },
              { value: 'ALL', label: 'Tất cả' },
            ]}
            value={status}
            onChange={(v) => setStatus(v)}
          />

          {!listData ? (
            <Spinner className="h-6 w-6 text-brand-600" />
          ) : !listData.items.length ? (
            <Card className="p-10 text-center text-sm text-slate-500">Không có tin bán xe cũ nào trong mục này.</Card>
          ) : (
            <ul className="space-y-3" data-testid="platform-used-car-list">
              {listData.items.map((l) => {
                const st = USED_CAR_LISTING_UI[l.status as UsedCarListingStatus];
                return (
                  <li key={l.id}>
                    <Card className="flex flex-wrap items-start justify-between gap-4 p-5" data-testid="platform-used-car-card">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-slate-500">{l.code}</span>
                          <Badge tone={st.tone}>{st.label}</Badge>
                          <Badge tone="sky">{l.sellerType === 'OWNER' ? 'Chủ xe cá nhân' : `Garage: ${l.sellerShop?.name ?? l.contactName}`}</Badge>
                          {l.hasVerifiedBadge && (
                            <Badge tone="mint">
                              <ShieldCheck className="h-3 w-3" /> Đã kiểm định {l.appraisalReport?.score ? `${l.appraisalReport.score}/100` : ''}
                            </Badge>
                          )}
                        </div>
                        <h3 className="text-base font-semibold text-slate-900">{l.title}</h3>
                        <div className="text-xs text-slate-600">
                          Giá đề xuất: <b className="text-emerald-700">{fmtCarPrice(l.price)}</b> ({fmtVnd(l.price)}) · Đời {l.year} · ODO{' '}
                          {l.mileageKm.toLocaleString('vi-VN')} km · {BODY_STYLE_LABEL[l.bodyStyle] ?? l.bodyStyle} · {TRANSMISSION_LABEL[l.transmission]} ·{' '}
                          {FUEL_LABEL[l.fuel]}
                        </div>
                        <div className="text-xs text-slate-600">
                          Biển số đối chiếu: <b className="font-mono">{l.plateNo ?? '—'}</b>
                          {l.vin ? ` · VIN: ${l.vin}` : ''} · Khu vực: {l.province} · Liên hệ: {l.contactName} ({l.contactPhone})
                        </div>
                        {l.docImages.length > 0 && (
                          <div className="flex flex-wrap items-center gap-2 text-xs text-amber-800">
                            <FileText className="h-3.5 w-3.5" /> Giấy tờ xe ({l.docImages.length}):
                            {l.docImages.map(
                              (d, idx) =>
                                d.url && (
                                  <a key={d.id} href={d.url} target="_blank" rel="noreferrer" className="underline">
                                    Cà vẹt / ĐK #{idx + 1}
                                  </a>
                                ),
                            )}
                          </div>
                        )}
                        {l.reviewNote && <p className="text-xs text-rose-600">Lý do kiểm duyệt: {l.reviewNote}</p>}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {l.appraisalReport && (
                          <Button variant="outline" onClick={() => setReportPreview(l.appraisalReport)}>
                            <ShieldCheck className="h-4 w-4" /> Báo cáo kiểm định
                          </Button>
                        )}
                        {l.status === 'CHO_DUYET' && (
                          <>
                            <Button onClick={() => approve(l.id)} disabled={busy === l.id} data-testid="platform-used-car-approve">
                              <CheckCircle2 className="h-4 w-4" /> Duyệt hiển thị (60 ngày)
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => {
                                setNoteTarget({ item: l, action: 'reject' });
                                setNote('');
                              }}
                              disabled={busy === l.id}
                              data-testid="platform-used-car-reject"
                            >
                              <XCircle className="h-4 w-4" /> Từ chối
                            </Button>
                          </>
                        )}
                        {(l.status === 'DANG_BAN' || l.status === 'TAM_AN') && (
                          <Button
                            variant="outline"
                            onClick={() => {
                              setNoteTarget({ item: l, action: 'takedown' });
                              setNote('');
                            }}
                            disabled={busy === l.id}
                            data-testid="platform-used-car-takedown"
                          >
                            <Ban className="h-4 w-4 text-rose-600" /> Gỡ tin vi phạm
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
      ) : !appData ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : !appData.items.length ? (
        <Card className="p-10 text-center text-sm text-slate-500">Chưa có phiếu kiểm định xe cũ nào.</Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm" data-testid="platform-appraisal-table">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Mã KD</th>
                <th className="px-4 py-3">Garage kiểm định</th>
                <th className="px-4 py-3">Tin xe</th>
                <th className="px-4 py-3">Ngày hẹn</th>
                <th className="px-4 py-3">Điểm / Xếp loại</th>
                <th className="px-4 py-3">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {appData.items.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-3 font-mono font-semibold">{a.code}</td>
                  <td className="px-4 py-3">{a.garage.name}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{a.listing?.title}</div>
                    <div className="font-mono text-xs text-slate-500">{a.listing?.code}</div>
                  </td>
                  <td className="px-4 py-3 text-xs">{fmtDateTime(a.scheduledAt)}</td>
                  <td className="px-4 py-3">
                    {a.score !== null && a.grade ? (
                      <div className="flex items-center gap-1.5">
                        <b>{a.score}/100</b>
                        <Badge tone={APPRAISAL_GRADE_UI[a.grade].tone}>{APPRAISAL_GRADE_UI[a.grade].label}</Badge>
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={APPRAISAL_STATUS_UI[a.status].tone}>{APPRAISAL_STATUS_UI[a.status].label}</Badge>
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
        title={noteTarget?.action === 'reject' ? 'Từ chối tin bán xe cũ' : 'Gỡ tin bán xe cũ khỏi sàn'}
        footer={
          <>
            <Button variant="outline" onClick={() => setNoteTarget(null)}>
              Huỷ
            </Button>
            <Button className="bg-rose-600 hover:bg-rose-700" onClick={submitModerationNote} disabled={!!busy} data-testid="platform-used-car-note-confirm">
              Xác nhận
            </Button>
          </>
        }
      >
        <Field label="Lý do gửi tới người đăng *">
          {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Vui lòng bổ sung ảnh rõ đăng kiểm & ODO…" />}
        </Field>
      </Dialog>

      <Dialog
        open={!!reportPreview}
        onClose={() => setReportPreview(null)}
        title="Báo cáo kiểm định đính kèm"
        wide
        footer={
          <Button variant="outline" onClick={() => setReportPreview(null)}>
            Đóng
          </Button>
        }
      >
        {reportPreview && <AppraisalReportCard report={reportPreview} />}
      </Dialog>
    </div>
  );
}
