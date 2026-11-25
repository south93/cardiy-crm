'use client';

import { Alert, Badge, Button, Card, Dialog, Field, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import { Plus, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Stars } from '@/components/order-review-card';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { fmtMoney } from '@/lib/crm';
import { REPORT_REASONS, REPORT_STATUS, REQ_STATUS, VIOLATION_ACTION } from '@/lib/market-client';
import { fmtDateTime } from '@/lib/orders';
import { PARTNER_STATUS } from '@/lib/partners';

interface PlatformReportRow {
  id: string;
  code: string;
  tenantId: string;
  sellerName: string;
  sellerSlug: string | null;
  sellerType: 'PARTNER' | 'GARAGE';
  sellerStatus: string;
  sellerViolationCount: number;
  sellerOffers: { id: string; code: string; name: string }[];
  offerId: string | null;
  request: {
    id: string;
    code: string;
    status: string;
    estimatedTotal: number;
    finalTotal: number | null;
    items: { offerId: string; name: string; quantity: number; kind: string }[];
  } | null;
  reporterName: string;
  reporterPhone: string;
  reason: string;
  description: string;
  status: string;
  adminNote: string | null;
  sellerExplanation: string | null;
  explainedAt: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  violations: { id: string; code: string; action: string }[];
  createdAt: string;
}

interface ViolationRow {
  id: string;
  code: string;
  tenantId: string;
  sellerName: string;
  sellerType: 'PARTNER' | 'GARAGE';
  sellerStatus: string;
  totalViolations: number;
  reportCode: string | null;
  offerName: string | null;
  action: string;
  reason: string;
  createdBy: string | null;
  createdAt: string;
}

interface SellerOption {
  tenantId: string;
  name: string;
  type: 'PARTNER' | 'GARAGE';
  status: string;
  violations: number;
  offers: { id: string; code: string; name: string }[];
}

interface ReportedReviewRow {
  id: string;
  tenantId: string;
  sellerName: string;
  requestCode: string;
  items: string[];
  customerName: string;
  rating: number;
  comment: string | null;
  reply: string | null;
  status: 'HIEN' | 'AN';
  reportedReason: string | null;
  reportedAt: string | null;
  moderatedAt: string | null;
  moderationNote: string | null;
  createdAt: string;
}

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : fallback);

function ReportsTab({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState('DANG_MO');
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ counts: Record<string, number>; items: PlatformReportRow[] } | null>(null);
  const [selected, setSelected] = useState<PlatformReportRow | null>(null);
  const [mode, setMode] = useState<'view' | 'ask' | 'resolve'>('view');
  const [note, setNote] = useState('');
  const [decision, setDecision] = useState<'DA_XU_LY' | 'TU_CHOI'>('DA_XU_LY');
  const [resolution, setResolution] = useState('');
  const [violationAction, setViolationAction] = useState('');
  const [offerId, setOfferId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<NonNullable<typeof data>>(`/platform/reports?${new URLSearchParams({ ...(status ? { status } : {}), ...(q.trim() ? { q: q.trim() } : {}) })}`).then(setData),
    [status, q],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const openReport = (r: PlatformReportRow) => {
    setSelected(r);
    setMode('view');
    setNote(r.adminNote ?? '');
    setDecision('DA_XU_LY');
    setResolution('');
    setViolationAction('');
    setOfferId(r.offerId ?? r.request?.items[0]?.offerId ?? '');
    setError(null);
  };

  const submitAsk = async () => {
    if (!selected) return;
    setError(null);
    try {
      await api(`/platform/reports/${selected.id}/request-explanation`, { body: { note } });
      setSelected(null);
      await load();
      onChanged();
    } catch (e) {
      setError(errMsg(e, 'Không gửi được yêu cầu giải trình'));
    }
  };

  const submitResolve = async () => {
    if (!selected) return;
    setError(null);
    try {
      await api(`/platform/reports/${selected.id}/resolve`, {
        body: {
          decision,
          resolution,
          violationAction: decision === 'DA_XU_LY' && violationAction ? violationAction : null,
          offerId: decision === 'DA_XU_LY' && violationAction === 'GO_TIN' ? offerId || null : null,
        },
      });
      setSelected(null);
      await load();
      onChanged();
    } catch (e) {
      setError(errMsg(e, 'Không xử lý được phản ánh'));
    }
  };

  const c = data?.counts ?? {};
  const openCount = (c.MOI ?? 0) + (c.CHO_GIAI_TRINH ?? 0) + (c.DA_GIAI_TRINH ?? 0);
  const canAct = selected && ['MOI', 'CHO_GIAI_TRINH', 'DA_GIAI_TRINH'].includes(selected.status);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          tabs={[
            { value: 'DANG_MO', label: `Đang mở${openCount ? ` (${openCount})` : ''}` },
            { value: 'MOI', label: `Mới${c.MOI ? ` (${c.MOI})` : ''}` },
            { value: 'CHO_GIAI_TRINH', label: `Chờ giải trình${c.CHO_GIAI_TRINH ? ` (${c.CHO_GIAI_TRINH})` : ''}` },
            { value: 'DA_GIAI_TRINH', label: `Đã giải trình${c.DA_GIAI_TRINH ? ` (${c.DA_GIAI_TRINH})` : ''}` },
            { value: 'DA_XU_LY', label: 'Đã xử lý' },
            { value: 'TU_CHOI', label: 'Không có cơ sở' },
            { value: '', label: 'Tất cả' },
          ]}
          value={status}
          onChange={setStatus}
        />
        <div className="relative w-full md:w-64">
          <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mã PA, garage, SĐT khách…" className="rounded-full bg-white/80 pl-10" aria-label="Tìm phản ánh" />
        </div>
      </div>

      {!data ? (
        <div className="grid place-items-center p-10">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2" data-testid="platform-report-list">
          {data.items.map((r) => {
            const st = REPORT_STATUS[r.status] ?? { label: r.status, tone: 'slate' as const };
            return (
              <Card key={r.id} onClick={() => openReport(r)} className="cursor-pointer p-4 text-sm transition hover:shadow-md" data-testid="platform-report-card">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.code}</span>
                  <Badge tone={st.tone}>{st.label}</Badge>
                  {r.sellerViolationCount > 0 && <Badge tone="rose">{r.sellerViolationCount} vi phạm trước</Badge>}
                  <span className="ml-auto text-xs text-slate-400">{fmtDateTime(r.createdAt)}</span>
                </div>
                <div className="mt-1.5 font-medium text-slate-900">
                  Garage: {r.sellerName}
                  {r.request && <span className="ml-2 text-xs font-normal text-brand-700">· Yêu cầu {r.request.code}</span>}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  Người gửi: {r.reporterName} · {r.reporterPhone} · {REPORT_REASONS[r.reason] ?? r.reason}
                </div>
                <p className="mt-2 line-clamp-2 text-slate-700">{r.description}</p>
                {r.sellerExplanation && <p className="mt-1.5 line-clamp-1 text-xs text-emerald-700">Garage đã giải trình: {r.sellerExplanation}</p>}
                {r.resolution && <p className="mt-1.5 line-clamp-1 text-xs text-slate-600">Kết luận: {r.resolution}</p>}
              </Card>
            );
          })}
          {!data.items.length && <Card className="p-10 text-center text-sm text-slate-500 lg:col-span-2">Không có phản ánh phù hợp.</Card>}
        </div>
      )}

      <Dialog
        open={selected !== null}
        onClose={() => setSelected(null)}
        wide
        title={selected ? `Phản ánh ${selected.code} · ${selected.sellerName}` : ''}
        footer={
          selected &&
          (mode === 'view' ? (
            canAct ? (
              <>
                <Button variant="outline" onClick={() => setSelected(null)}>
                  Đóng
                </Button>
                {(selected.status === 'MOI' || selected.status === 'DA_GIAI_TRINH') && (
                  <Button variant="outline" onClick={() => setMode('ask')} data-testid="ask-explanation-btn">
                    Yêu cầu giải trình
                  </Button>
                )}
                <Button onClick={() => setMode('resolve')} data-testid="resolve-report-btn">
                  Kết luận & xử lý
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setSelected(null)}>
                Đóng
              </Button>
            )
          ) : (
            <>
              <Button variant="outline" onClick={() => setMode('view')}>
                Quay lại
              </Button>
              {mode === 'ask' ? (
                <Button onClick={() => void submitAsk()} disabled={note.trim().length < 3} data-testid="confirm-ask-explanation">
                  Gửi yêu cầu giải trình
                </Button>
              ) : (
                <Button
                  onClick={() => void submitResolve()}
                  disabled={resolution.trim().length < 3 || (decision === 'DA_XU_LY' && violationAction === 'GO_TIN' && !offerId)}
                  data-testid="confirm-resolve-report"
                >
                  Lưu kết luận
                </Button>
              )}
            </>
          ))
        }
      >
        {selected && (
          <div className="space-y-4 text-sm">
            {error && <Alert>{error}</Alert>}
            {mode === 'view' && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={REPORT_STATUS[selected.status]?.tone ?? 'slate'}>{REPORT_STATUS[selected.status]?.label ?? selected.status}</Badge>
                  <Badge tone={PARTNER_STATUS[selected.sellerStatus]?.tone ?? 'slate'}>
                    Garage: {PARTNER_STATUS[selected.sellerStatus]?.label ?? selected.sellerStatus}
                  </Badge>
                  {selected.sellerViolationCount > 0 && <Badge tone="rose">Đã vi phạm {selected.sellerViolationCount} lần</Badge>}
                </div>

                <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-500">Khách phản ánh</dt>
                    <dd className="font-medium">
                      {selected.reporterName} · <a href={`tel:${selected.reporterPhone}`} className="text-brand-700">{selected.reporterPhone}</a>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Nhóm vấn đề</dt>
                    <dd className="font-medium">{REPORT_REASONS[selected.reason] ?? selected.reason}</dd>
                  </div>
                </dl>

                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-xs font-medium text-slate-500">Nội dung khách gửi ({fmtDateTime(selected.createdAt)})</div>
                  <p className="mt-1 whitespace-pre-line text-slate-800">{selected.description}</p>
                </div>

                {selected.request && (
                  <div className="rounded-xl border border-slate-100 p-3 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">Yêu cầu gốc {selected.request.code}</span>
                      <Badge tone={REQ_STATUS[selected.request.status]?.tone ?? 'slate'}>
                        {REQ_STATUS[selected.request.status]?.label ?? selected.request.status}
                      </Badge>
                      <span className="ml-auto font-medium tabular-nums">
                        {selected.request.finalTotal !== null
                          ? `Giá chốt: ${fmtMoney(selected.request.finalTotal)}`
                          : `Tạm tính: ${fmtMoney(selected.request.estimatedTotal)}`}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600">
                      Hạng mục: {selected.request.items.map((i) => `${i.name}${i.kind === 'PRODUCT' ? ` × ${i.quantity}` : ''}`).join(', ')}
                    </div>
                  </div>
                )}

                {selected.adminNote && <Alert tone="peach">Nội dung đã yêu cầu giải trình: {selected.adminNote}</Alert>}
                {selected.sellerExplanation && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                    <div className="text-xs font-semibold text-emerald-800">Giải trình từ garage ({fmtDateTime(selected.explainedAt)})</div>
                    <p className="mt-1 whitespace-pre-line text-slate-800">{selected.sellerExplanation}</p>
                  </div>
                )}
                {selected.resolution && (
                  <Alert tone="mint">
                    <div className="font-semibold">Kết luận của sàn:</div>
                    {selected.resolution}
                    {selected.violations.length > 0 && (
                      <div className="mt-1 text-xs">
                        Đã lập biên bản vi phạm: {selected.violations.map((v) => `${v.code} (${VIOLATION_ACTION[v.action]?.label ?? v.action})`).join(', ')}
                      </div>
                    )}
                  </Alert>
                )}
              </>
            )}

            {mode === 'ask' && (
              <Field label="Nội dung cần garage giải trình (garage sẽ thấy trong Cổng đối tác / CRM)">
                {(id) => (
                  <textarea
                    id={id}
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="VD: Đề nghị đối chiếu hoá đơn thu tiền và giải trình lý do thu chênh lệch 300.000 đ…"
                    data-testid="ask-explanation-input"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  />
                )}
              </Field>
            )}

            {mode === 'resolve' && (
              <div className="space-y-3">
                <Field label="Quyết định xử lý">
                  {(id) => (
                    <Select id={id} value={decision} onChange={(e) => setDecision(e.target.value as 'DA_XU_LY' | 'TU_CHOI')} data-testid="resolve-decision">
                      <option value="DA_XU_LY">Xác nhận có vi phạm / Đã giải quyết cho khách</option>
                      <option value="TU_CHOI">Phản ánh không có cơ sở / Nhầm lẫn</option>
                    </Select>
                  )}
                </Field>

                {decision === 'DA_XU_LY' && (
                  <Field label="Chế tài áp dụng cho garage (không bắt buộc)">
                    {(id) => (
                      <Select id={id} value={violationAction} onChange={(e) => setViolationAction(e.target.value)} data-testid="resolve-violation-action">
                        <option value="">Không áp dụng chế tài (garage đã khắc phục thoả đáng)</option>
                        <option value="NHAC_NHO">Nhắc nhở / Cảnh cáo (ghi lịch sử vi phạm)</option>
                        <option value="GO_TIN">Gỡ tin đăng vi phạm</option>
                        {selected.sellerType === 'PARTNER' && <option value="TAM_KHOA">Tạm khoá gian hàng đối tác</option>}
                        {selected.sellerType === 'PARTNER' && <option value="CHAM_DUT">Chấm dứt hợp đồng đối tác</option>}
                      </Select>
                    )}
                  </Field>
                )}

                {decision === 'DA_XU_LY' && violationAction === 'GO_TIN' && (
                  <Field label="Chọn tin đăng cần gỡ">
                    {(id) => (
                      <Select id={id} value={offerId} onChange={(e) => setOfferId(e.target.value)} data-testid="resolve-offer-select">
                        <option value="">— Chọn tin đăng —</option>
                        {selected.sellerOffers.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.code} · {o.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                )}

                {decision === 'DA_XU_LY' && violationAction === 'TAM_KHOA' && (
                  <Alert tone="rose">Đối tác sẽ bị khoá đăng nhập và toàn bộ gian hàng + tin đăng biến mất khỏi sàn ngay lập tức.</Alert>
                )}

                <Field label="Kết luận xử lý (hiển thị cho cả khách và garage)">
                  {(id) => (
                    <textarea
                      id={id}
                      rows={3}
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                      placeholder="Ghi rõ kết quả xác minh và biện pháp xử lý của sàn…"
                      data-testid="resolve-note-input"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                    />
                  )}
                </Field>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}

function ViolationsTab() {
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ items: ViolationRow[]; sellers: SellerOption[] } | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [tenantId, setTenantId] = useState('');
  const [action, setAction] = useState<'NHAC_NHO' | 'GO_TIN' | 'TAM_KHOA' | 'CHAM_DUT'>('NHAC_NHO');
  const [offerId, setOfferId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () => api<NonNullable<typeof data>>(`/platform/violations${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`).then(setData),
    [q],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const currentSeller = data?.sellers.find((s) => s.tenantId === tenantId) ?? null;

  const submit = async () => {
    setError(null);
    try {
      await api('/platform/violations', {
        body: {
          tenantId,
          action,
          offerId: action === 'GO_TIN' ? offerId || null : null,
          reason,
        },
      });
      setOpenNew(false);
      await load();
    } catch (e) {
      setError(errMsg(e, 'Không lập được biên bản vi phạm'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full md:w-64">
          <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mã VP, tên garage, lý do…" className="rounded-full bg-white/80 pl-10" aria-label="Tìm vi phạm" />
        </div>
        <div className="flex-1" />
        <Button
          onClick={() => {
            setTenantId('');
            setAction('NHAC_NHO');
            setOfferId('');
            setReason('');
            setError(null);
            setOpenNew(true);
          }}
          data-testid="new-violation-btn"
        >
          <Plus className="h-4 w-4" /> Lập xử lý vi phạm
        </Button>
      </div>

      <Card className="overflow-x-auto">
        {!data ? (
          <div className="grid place-items-center p-10">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="violation-table">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-semibold">Biên bản</th>
                <th className="px-3 py-3 font-semibold">Garage / Đối tác</th>
                <th className="px-3 py-3 font-semibold">Biện pháp</th>
                <th className="px-3 py-3 font-semibold">Lý do xử lý</th>
                <th className="px-5 py-3 font-semibold">Người lập</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((v) => {
                const act = VIOLATION_ACTION[v.action] ?? { label: v.action, tone: 'rose' as const };
                return (
                  <tr key={v.id} className="border-b border-slate-50 last:border-0" data-testid="violation-row">
                    <td className="px-5 py-3">
                      <div className="font-semibold">{v.code}</div>
                      <div className="text-xs text-slate-500">
                        {fmtDateTime(v.createdAt)}
                        {v.reportCode && ` · từ ${v.reportCode}`}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium">{v.sellerName}</div>
                      <div className="text-xs text-slate-500">Tổng {v.totalViolations} lần vi phạm</div>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={act.tone}>{act.label}</Badge>
                      {v.offerName && <div className="mt-0.5 text-xs text-slate-500">{v.offerName}</div>}
                    </td>
                    <td className="max-w-md px-3 py-3 text-slate-700">{v.reason}</td>
                    <td className="px-5 py-3 text-slate-500">{v.createdBy ?? '—'}</td>
                  </tr>
                );
              })}
              {!data.items.length && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-slate-500">
                    Chưa có biên bản xử lý vi phạm nào.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>

      <Dialog
        open={openNew}
        onClose={() => setOpenNew(false)}
        title="Lập xử lý vi phạm gian hàng (A6.42)"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpenNew(false)}>
              Huỷ
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={!tenantId || reason.trim().length < 5 || (action === 'GO_TIN' && !offerId)}
              data-testid="confirm-new-violation"
            >
              Xác nhận xử lý
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          {error && <Alert>{error}</Alert>}
          <Field label="Garage / Đối tác">
            {(id) => (
              <Select
                id={id}
                value={tenantId}
                onChange={(e) => {
                  setTenantId(e.target.value);
                  setAction('NHAC_NHO');
                  setOfferId('');
                }}
                data-testid="violation-seller-select"
              >
                <option value="">— Chọn garage / đối tác —</option>
                {(data?.sellers ?? []).map((s) => (
                  <option key={s.tenantId} value={s.tenantId}>
                    {s.name} ({s.type === 'PARTNER' ? 'Đối tác' : 'PLG'}{s.violations ? ` · ${s.violations} vi phạm` : ''})
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Biện pháp xử lý">
            {(id) => (
              <Select id={id} value={action} onChange={(e) => setAction(e.target.value as typeof action)} data-testid="violation-action-select">
                <option value="NHAC_NHO">Nhắc nhở / Cảnh cáo</option>
                <option value="GO_TIN">Gỡ tin đăng vi phạm</option>
                {currentSeller?.type === 'PARTNER' && <option value="TAM_KHOA">Tạm khoá đối tác</option>}
                {currentSeller?.type === 'PARTNER' && <option value="CHAM_DUT">Chấm dứt hợp tác</option>}
              </Select>
            )}
          </Field>

          {action === 'GO_TIN' && (
            <Field label="Tin đăng cần gỡ">
              {(id) => (
                <Select id={id} value={offerId} onChange={(e) => setOfferId(e.target.value)} data-testid="violation-offer-select">
                  <option value="">— Chọn tin đăng —</option>
                  {(currentSeller?.offers ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.code} · {o.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          <Field label="Lý do xử lý" hint="Tối thiểu 5 ký tự (garage sẽ thấy trong lịch sử vi phạm)">
            {(id) => (
              <textarea
                id={id}
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                data-testid="violation-reason-input"
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            )}
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

function ReportedReviewsTab({ onChanged }: { onChanged: () => void }) {
  const [filter, setFilter] = useState<'PENDING' | 'ALL'>('PENDING');
  const [data, setData] = useState<{ pendingCount: number; items: ReportedReviewRow[] } | null>(null);

  const load = useCallback(() => api<NonNullable<typeof data>>(`/platform/reviews/reported?filter=${filter}`).then(setData), [filter]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: 'HIDE' | 'KEEP') => {
    await api(`/platform/reviews/${id}/moderate`, {
      body: { action, note: action === 'HIDE' ? 'Ẩn đánh giá vi phạm quy chuẩn cộng đồng' : 'Đánh giá hợp lệ, giữ nguyên hiển thị' },
    });
    await load();
    onChanged();
  };

  return (
    <div className="space-y-4">
      <Tabs
        tabs={[
          { value: 'PENDING', label: `Chờ duyệt${data?.pendingCount ? ` (${data.pendingCount})` : ''}` },
          { value: 'ALL', label: 'Tất cả đã báo cáo' },
        ]}
        value={filter}
        onChange={setFilter}
      />

      {!data ? (
        <div className="grid place-items-center p-10">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2" data-testid="reported-review-list">
          {data.items.map((r) => (
            <Card key={r.id} className="p-4 text-sm space-y-2" data-testid="reported-review-card">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{r.sellerName}</span>
                <Badge tone="sky">Yêu cầu {r.requestCode}</Badge>
                <Badge tone={r.status === 'AN' ? 'slate' : 'mint'}>{r.status === 'AN' ? 'Đã ẩn' : 'Đang hiện'}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{r.customerName}</span>
                <Stars n={r.rating} />
                <span className="text-xs text-slate-400">{fmtDateTime(r.createdAt)}</span>
              </div>
              {r.comment && <p className="text-slate-800">“{r.comment}”</p>}
              {r.reportedReason && (
                <Alert tone="peach" className="text-xs">
                  <span className="font-semibold">Garage báo cáo:</span> {r.reportedReason}
                </Alert>
              )}
              <div className="flex justify-end gap-2 pt-1">
                {r.status === 'HIEN' && (
                  <Button variant="outline" onClick={() => void act(r.id, 'HIDE')} data-testid="hide-review-btn">
                    Ẩn đánh giá
                  </Button>
                )}
                {(!r.moderatedAt || r.status === 'AN') && (
                  <Button onClick={() => void act(r.id, 'KEEP')} data-testid="keep-review-btn">
                    {r.status === 'AN' ? 'Hiện lại đánh giá' : 'Giữ nguyên (bác báo cáo)'}
                  </Button>
                )}
              </div>
            </Card>
          ))}
          {!data.items.length && <Card className="p-10 text-center text-sm text-slate-500 lg:col-span-2">Không có đánh giá bị báo cáo.</Card>}
        </div>
      )}
    </div>
  );
}

function SupervisionAdmin() {
  const [tab, setTab] = useState<'reports' | 'violations' | 'reviews'>('reports');
  const [badges, setBadges] = useState({ openReports: 0, pendingReviews: 0 });

  const refreshBadges = useCallback(() => {
    void Promise.all([
      api<{ counts: Record<string, number> }>('/platform/reports?status=DANG_MO'),
      api<{ pendingCount: number }>('/platform/reviews/reported?filter=PENDING'),
    ])
      .then(([rp, rv]) => {
        const c = rp.counts;
        setBadges({
          openReports: (c.MOI ?? 0) + (c.CHO_GIAI_TRINH ?? 0) + (c.DA_GIAI_TRINH ?? 0),
          pendingReviews: rv.pendingCount,
        });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshBadges();
  }, [refreshBadges]);

  return (
    <div className="space-y-4">
      <Tabs
        tabs={[
          { value: 'reports', label: `Phản ánh của khách${badges.openReports ? ` (${badges.openReports})` : ''}` },
          { value: 'violations', label: 'Xử lý vi phạm garage' },
          { value: 'reviews', label: `Đánh giá bị báo cáo${badges.pendingReviews ? ` (${badges.pendingReviews})` : ''}` },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'reports' && <ReportsTab onChanged={refreshBadges} />}
      {tab === 'violations' && <ViolationsTab />}
      {tab === 'reviews' && <ReportedReviewsTab onChanged={refreshBadges} />}
    </div>
  );
}

/** A6.41 Phản ánh của khách · A6.42 Xử lý vi phạm garage · A6.33 Đánh giá bị báo cáo */
export default function PlatformReportsPage() {
  return (
    <RequirePermission permission="platform.report.handle">
      <SupervisionAdmin />
    </RequirePermission>
  );
}
