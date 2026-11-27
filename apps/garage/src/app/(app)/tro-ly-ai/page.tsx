'use client';

import { Alert, Badge, Button, Card, CardTitle, Dialog, Field, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import { BookOpen, Car, CheckCircle2, Eye, FileSpreadsheet, HelpCircle, Plus, Search, ShieldCheck, Sparkles, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ExportButton } from '@/components/export-button';
import { RequirePermission } from '@/components/require-permission';
import {
  AI_DOC_CATEGORIES,
  AI_KIND_UI,
  AI_STATUS_UI,
  type AiDocCategoryCode,
  type AiDocumentDto,
  type AiOverviewResponse,
  type AiSuggestionDto,
} from '@/lib/ai';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtMoney } from '@/lib/crm';
import { fmtDateTime } from '@/lib/orders';

interface OpenOrderOption {
  id: string;
  code: string;
  status: string;
  branch: { id: string; code: string; name: string };
  vehicle: { id: string; plate: string; make: string | null; model: string | null } | null;
  request: string | null;
}

interface VehicleOption {
  id: string;
  plate: string;
  make: string | null;
  model: string | null;
  year: number | null;
  odometerKm: number | null;
}

/** A3.63 · M36 Trợ lý AI nội bộ Garage PLG */
export default function GarageAiAssistantPage() {
  return (
    <RequirePermission permission="ai.use">
      <GarageAiBody />
    </RequirePermission>
  );
}

function GarageAiBody() {
  const { can } = useAuth();
  const canManageAi = can('ai.manage');
  const canApplyOrder = can('ro.manage');
  const seesMoney = can('ro.manage') || can('finance.view') || can('quote.manage');

  const [tab, setTab] = useState<'quote' | 'summary' | 'tech' | 'knowledge'>('quote');
  const [overview, setOverview] = useState<AiOverviewResponse | null>(null);
  const [docs, setDocs] = useState<AiDocumentDto[] | null>(null);
  const [openOrders, setOpenOrders] = useState<OpenOrderOption[]>([]);
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [vehSearch, setVehSearch] = useState('');

  // Tab 1: Gợi ý báo giá
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [symptoms, setSymptoms] = useState('');
  const [quoteRes, setQuoteRes] = useState<AiSuggestionDto | null>(null);
  const [checkedIndexes, setCheckedIndexes] = useState<number[]>([]);
  const [showQuoteSanitized, setShowQuoteSanitized] = useState(false);

  // Tab 2: Tóm tắt xe
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [summaryRes, setSummaryRes] = useState<AiSuggestionDto | null>(null);
  const [showSumSanitized, setShowSumSanitized] = useState(false);

  // Tab 3: Hỏi đáp kỹ thuật
  const [techQ, setTechQ] = useState('');
  const [techMake, setTechMake] = useState('');
  const [techRes, setTechRes] = useState<AiSuggestionDto | null>(null);

  // Tab 4: Thêm tài liệu tri thức
  const [openDocModal, setOpenDocModal] = useState(false);
  const [docCode, setDocCode] = useState('');
  const [docTitle, setDocTitle] = useState('');
  const [docCat, setDocCat] = useState<AiDocCategoryCode>('CHAN_DOAN');
  const [docMake, setDocMake] = useState('');
  const [docTags, setDocTags] = useState('');
  const [docContent, setDocContent] = useState('');

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadBase = useCallback(async () => {
    try {
      const [ov, dc] = await Promise.all([
        api<AiOverviewResponse>('/ai/overview'),
        api<AiDocumentDto[]>('/ai/documents'),
      ]);
      setOverview(ov);
      setDocs(dc);

      if (can('ro.view')) {
        const ord = await api<{ items: OpenOrderOption[] }>('/orders?view=open&pageSize=30');
        setOpenOrders(ord.items);
      }
      if (can('vehicle.view')) {
        const vs = await api<{ items: VehicleOption[] }>(`/vehicles?pageSize=30${vehSearch.trim() ? `&q=${encodeURIComponent(vehSearch.trim())}` : ''}`);
        setVehicles(vs.items);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được dữ liệu Trợ lý AI');
    }
  }, [can, vehSearch]);

  useEffect(() => {
    const t = setTimeout(() => void loadBase(), vehSearch ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadBase, vehSearch]);

  async function runSuggestQuote() {
    setBusy('quote');
    setError(null);
    try {
      const res = await api<AiSuggestionDto>('/ai/suggest-quote', {
        body: {
          orderId: selectedOrderId || null,
          symptoms,
        },
      });
      setQuoteRes(res);
      setCheckedIndexes(res.suggestedItems.map((_, idx) => idx));
      await loadBase();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gợi ý báo giá thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function applyQuoteToOrder() {
    if (!quoteRes || !selectedOrderId) return;
    setBusy('apply');
    setError(null);
    try {
      await api(`/ai/suggestions/${quoteRes.id}/apply-to-order`, {
        body: {
          orderId: selectedOrderId,
          selectedIndexes: checkedIndexes,
        },
      });
      setQuoteRes({ ...quoteRes, status: 'DA_AP_DUNG', appliedItemCount: checkedIndexes.length });
      await loadBase();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không ghi được hạng mục vào đơn');
    } finally {
      setBusy(null);
    }
  }

  async function dismissSuggestion(id: string) {
    setBusy('dismiss');
    try {
      await api(`/ai/suggestions/${id}/dismiss`, { body: {} });
      if (quoteRes?.id === id) setQuoteRes({ ...quoteRes, status: 'BO_QUA' });
      await loadBase();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Thao tác thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function runVehicleSummary() {
    if (!selectedVehicleId) return;
    setBusy('summary');
    setError(null);
    try {
      const res = await api<AiSuggestionDto>('/ai/summarize-vehicle', { body: { vehicleId: selectedVehicleId } });
      setSummaryRes(res);
      await loadBase();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Tóm tắt lịch sử xe thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function runTechQa() {
    setBusy('tech');
    setError(null);
    try {
      const res = await api<AiSuggestionDto>('/ai/ask-tech', {
        body: { question: techQ, vehicleMake: techMake || null },
      });
      setTechRes(res);
      await loadBase();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Tra cứu kỹ thuật thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function saveDocument() {
    setBusy('doc');
    setError(null);
    try {
      await api('/ai/documents', {
        body: {
          code: docCode.toUpperCase(),
          title: docTitle,
          category: docCat,
          make: docMake || null,
          tags: docTags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          content: docContent,
          active: true,
        },
      });
      setOpenDocModal(false);
      setDocCode('');
      setDocTitle('');
      setDocTags('');
      setDocContent('');
      await loadBase();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Lưu tài liệu kỹ thuật thất bại');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4" data-testid="ai-assistant-page">
      {overview && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="ai-kpis">
          <Card className="p-4 sm:p-5">
            <div className="flex items-center justify-between text-sm font-medium text-slate-700">
              <span>Bảo vệ dữ liệu cá nhân</span>
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="mt-2.5 text-lg font-bold text-emerald-700">Luôn bật lọc PII</div>
            <div className="mt-1 text-xs text-slate-500">Tự động ẩn SĐT, email, CCCD, họ tên & địa chỉ khách</div>
          </Card>

          <Card className="p-4 sm:p-5">
            <div className="flex items-center justify-between text-sm font-medium text-slate-700">
              <span>Kho tri thức kỹ thuật</span>
              <BookOpen className="h-4 w-4 text-indigo-600" />
            </div>
            <div className="mt-2.5 text-2xl font-bold tabular-nums">{overview.documentsCount} quy trình</div>
            <div className="mt-1 text-xs text-slate-500">Đối chiếu trực tiếp cùng danh mục kho hiện tại</div>
          </Card>

          <Card className="p-4 sm:p-5">
            <div className="flex items-center justify-between text-sm font-medium text-slate-700">
              <span>Lượt AI đề xuất</span>
              <Sparkles className="h-4 w-4 text-amber-500" />
            </div>
            <div className="mt-2.5 text-2xl font-bold tabular-nums">{overview.suggestionsTotal}</div>
            <div className="mt-1 text-xs text-slate-500">AI tuyệt đối không tự ghi đè dữ liệu gốc</div>
          </Card>

          <Card className="p-4 sm:p-5">
            <div className="flex items-center justify-between text-sm font-medium text-slate-700">
              <span>Đã được người duyệt ghi</span>
              <CheckCircle2 className="h-4 w-4 text-brand-600" />
            </div>
            <div className="mt-2.5 text-2xl font-bold tabular-nums text-brand-700">{overview.appliedCount}</div>
            <div className="mt-1 text-xs text-slate-500">Cố vấn dịch vụ kiểm tra và xác nhận ghi vào RO</div>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          tabs={[
            { value: 'quote', label: 'Chẩn đoán & Gợi ý báo giá' },
            { value: 'summary', label: 'Tóm tắt lịch sử xe' },
            { value: 'tech', label: 'Hỏi đáp kỹ thuật xưởng' },
            { value: 'knowledge', label: `Kho tri thức & Nhật ký${docs ? ` (${docs.length})` : ''}` },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === 'knowledge' && canManageAi && (
          <Button onClick={() => setOpenDocModal(true)} data-testid="ai-add-doc-btn">
            <Plus className="h-4 w-4" /> Thêm quy trình kỹ thuật
          </Button>
        )}
      </div>

      {error && <Alert>{error}</Alert>}

      {/* TAB 1: CHẨN ĐOÁN & GỢI Ý BÁO GIÁ */}
      {tab === 'quote' && (
        <div className="grid gap-4 xl:grid-cols-5">
          <Card className="space-y-3 p-5 xl:col-span-2">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-indigo-600" />
              <CardTitle>Nhập triệu chứng & Chọn đơn mở</CardTitle>
            </div>

            <Field label="Gắn với Lệnh sửa chữa đang mở (tuỳ chọn)">
              {(id) => (
                <Select
                  id={id}
                  value={selectedOrderId}
                  onChange={(e) => {
                    const oid = e.target.value;
                    setSelectedOrderId(oid);
                    const found = openOrders.find((x) => x.id === oid);
                    if (found?.request && !symptoms.trim()) setSymptoms(found.request);
                  }}
                >
                  <option value="">— Đề xuất độc lập (chưa gắn đơn) —</option>
                  {openOrders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.code} · {o.vehicle ? `${o.vehicle.plate} (${o.vehicle.make ?? ''})` : 'Bán lẻ'} · {o.branch.code}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Mô tả triệu chứng / Yêu cầu kiểm tra *">
              {(id) => (
                <textarea
                  id={id}
                  rows={4}
                  value={symptoms}
                  onChange={(e) => setSymptoms(e.target.value)}
                  placeholder="VD: Xe phanh kêu két két ở bánh trước, điều hoà kém mát, cần bảo dưỡng mốc 40.000km…"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                />
              )}
            </Field>

            <Button onClick={runSuggestQuote} disabled={busy === 'quote' || symptoms.trim().length < 3} className="w-full justify-center" data-testid="ai-suggest-quote-btn">
              {busy === 'quote' ? <Spinner /> : <Sparkles className="h-4 w-4" />}
              Phân tích triệu chứng & Gợi ý báo giá
            </Button>
          </Card>

          <Card className="space-y-4 p-5 xl:col-span-3" data-testid="ai-quote-output">
            {!quoteRes ? (
              <div className="grid min-h-[220px] place-items-center text-center text-sm text-slate-500">
                <div>
                  <Sparkles className="mx-auto mb-2 h-8 w-8 text-indigo-300" />
                  Nhập triệu chứng bên trái để Trợ lý AI đối chiếu kho phụ tùng & quy trình chẩn đoán.
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={AI_STATUS_UI[quoteRes.status].tone}>{AI_STATUS_UI[quoteRes.status].label}</Badge>
                    <Badge tone="mint">
                      <ShieldCheck className="h-3 w-3" /> Đã che {quoteRes.piiMaskedCount} thông tin PII
                    </Badge>
                    {quoteRes.citedDocCodes.map((c) => (
                      <Badge key={c} tone="sky">
                        {c}
                      </Badge>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowQuoteSanitized(!showQuoteSanitized)}
                    className="inline-flex items-center gap-1 font-medium text-indigo-700 hover:underline"
                    data-testid="ai-toggle-sanitized-btn"
                  >
                    <Eye className="h-3.5 w-3.5" /> {showQuoteSanitized ? 'Ẩn ngữ cảnh' : 'Đối chứng ngữ cảnh sạch PII'}
                  </button>
                </div>

                <p className="whitespace-pre-line rounded-2xl bg-slate-50 p-3.5 text-sm leading-relaxed text-slate-800">{quoteRes.responseText}</p>

                {showQuoteSanitized && (
                  <pre className="max-h-48 overflow-auto rounded-xl bg-slate-900 p-3 font-mono text-xs text-emerald-300" data-testid="ai-sanitized-box">
                    {quoteRes.sanitizedContext}
                  </pre>
                )}

                <div className="flex items-center justify-end">
                  <ExportButton
                    filename="ai-de-xuat-bao-gia"
                    sheetName="Đề xuất AI"
                    testId="export-ai-suggested"
                    rows={quoteRes.suggestedItems}
                    columns={() => [
                      { header: 'Mã', value: (it) => it.code ?? '' },
                      { header: 'Hạng mục đề xuất', value: (it) => it.name },
                      { header: 'Loại', value: (it) => (it.kind === 'PHU_TUNG' ? 'Phụ tùng kho' : 'Nhân công / Dịch vụ') },
                      { header: 'Số lượng', value: (it) => it.quantity },
                      { header: 'Đơn vị', value: (it) => it.unit ?? '' },
                      { header: 'Căn cứ & Tồn chi nhánh', value: (it) => it.reason },
                      ...(seesMoney ? [{ header: 'Đơn giá', value: (it: (typeof quoteRes.suggestedItems)[number]) => it.unitPrice }] : []),
                    ]}
                  />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm" data-testid="ai-suggested-table">
                    <thead className="border-b border-slate-100 text-xs uppercase text-slate-500">
                      <tr>
                        {canApplyOrder && selectedOrderId && quoteRes.status === 'DE_XUAT' && <th className="py-2 pr-2">Duyệt</th>}
                        <th className="py-2">Hạng mục đề xuất</th>
                        <th className="py-2">Căn cứ & Tồn chi nhánh</th>
                        {seesMoney && <th className="py-2 text-right">Đơn giá</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {quoteRes.suggestedItems.map((it, idx) => {
                        const checked = checkedIndexes.includes(idx);
                        return (
                          <tr key={idx} data-testid="ai-suggested-row">
                            {canApplyOrder && selectedOrderId && quoteRes.status === 'DE_XUAT' && (
                              <td className="py-2.5 pr-2">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setCheckedIndexes(
                                      checked ? checkedIndexes.filter((x) => x !== idx) : [...checkedIndexes, idx],
                                    )
                                  }
                                />
                              </td>
                            )}
                            <td className="py-2.5">
                              <div className="font-medium text-slate-900">{it.name}</div>
                              <div className="text-xs text-slate-500">
                                {it.code ? `${it.code} · ` : ''}
                                {it.kind === 'PHU_TUNG' ? 'Phụ tùng kho' : 'Nhân công / Dịch vụ'} · SL: {it.quantity} {it.unit ?? ''}
                              </div>
                            </td>
                            <td className="py-2.5 text-xs text-slate-600">{it.reason}</td>
                            {seesMoney && (
                              <td className="py-2.5 text-right font-semibold tabular-nums">
                                {it.unitPrice !== null ? fmtMoney(it.unitPrice) : '—'}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {quoteRes.status === 'DE_XUAT' && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                    <span className="text-xs text-slate-500">
                      {selectedOrderId
                        ? canApplyOrder
                          ? 'Chọn các hạng mục phù hợp rồi bấm Duyệt để ghi vào lệnh sửa chữa.'
                          : 'Tài khoản của bạn chỉ xem đề xuất kỹ thuật; Cố vấn dịch vụ sẽ duyệt ghi vào đơn.'
                        : 'Chọn một Lệnh sửa chữa đang mở ở khung bên trái nếu muốn duyệt ghi trực tiếp.'}
                    </span>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => dismissSuggestion(quoteRes.id)} disabled={!!busy}>
                        <XCircle className="h-4 w-4" /> Bỏ qua
                      </Button>
                      {canApplyOrder && selectedOrderId && (
                        <Button
                          onClick={applyQuoteToOrder}
                          disabled={busy === 'apply' || checkedIndexes.length === 0}
                          data-testid="ai-apply-order-btn"
                        >
                          <CheckCircle2 className="h-4 w-4" /> Duyệt & Ghi {checkedIndexes.length} mục vào đơn
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      )}

      {/* TAB 2: TÓM TẮT LỊCH SỬ XE */}
      {tab === 'summary' && (
        <div className="grid gap-4 xl:grid-cols-5">
          <Card className="space-y-3 p-5 xl:col-span-2">
            <div className="flex items-center gap-2">
              <Car className="h-4 w-4 text-sky-600" />
              <CardTitle>Chọn xe cần tóm tắt lịch sử</CardTitle>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                value={vehSearch}
                onChange={(e) => setVehSearch(e.target.value)}
                placeholder="Tìm biển số, hãng xe…"
                aria-label="Tìm xe để tóm tắt"
                className="pl-9"
              />
            </div>
            <Field label="Danh sách xe *">
              {(id) => (
                <Select id={id} value={selectedVehicleId} onChange={(e) => setSelectedVehicleId(e.target.value)}>
                  <option value="">— Chọn xe —</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plate} · {[v.make, v.model, v.year].filter(Boolean).join(' ') || 'Chưa rõ dòng'}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button
              onClick={runVehicleSummary}
              disabled={!selectedVehicleId || busy === 'summary'}
              className="w-full justify-center"
              data-testid="ai-run-summary-btn"
            >
              {busy === 'summary' ? <Spinner /> : <Sparkles className="h-4 w-4" />}
              Tóm tắt hồ sơ kỹ thuật xe
            </Button>
          </Card>

          <Card className="space-y-3 p-5 xl:col-span-3" data-testid="ai-summary-output">
            {!summaryRes ? (
              <div className="grid min-h-[200px] place-items-center text-sm text-slate-500">
                Chọn xe bên trái để AI tổng hợp các lần vào xưởng, số ODO và hạng mục lưu ý.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-xs">
                  <Badge tone="mint">
                    <ShieldCheck className="h-3 w-3" /> Đã che PII ({summaryRes.piiMaskedCount})
                  </Badge>
                  <button
                    type="button"
                    onClick={() => setShowSumSanitized(!showSumSanitized)}
                    className="inline-flex items-center gap-1 text-indigo-700 hover:underline"
                  >
                    <Eye className="h-3.5 w-3.5" /> {showSumSanitized ? 'Ẩn ngữ cảnh' : 'Xem ngữ cảnh sạch PII'}
                  </button>
                </div>
                <pre className="whitespace-pre-wrap rounded-2xl bg-slate-50 p-4 font-sans text-sm leading-relaxed text-slate-800">
                  {summaryRes.responseText}
                </pre>
                {showSumSanitized && (
                  <pre className="max-h-48 overflow-auto rounded-xl bg-slate-900 p-3 font-mono text-xs text-emerald-300">
                    {summaryRes.sanitizedContext}
                  </pre>
                )}
              </>
            )}
          </Card>
        </div>
      )}

      {/* TAB 3: HỎI ĐÁP KỸ THUẬT XƯỞNG */}
      {tab === 'tech' && (
        <div className="grid gap-4 xl:grid-cols-5">
          <Card className="space-y-3 p-5 xl:col-span-2">
            <div className="flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-emerald-600" />
              <CardTitle>Tra cứu quy trình & Chẩn đoán nhanh</CardTitle>
            </div>
            <Field label="Hãng xe (tuỳ chọn)">
              {(id) => <Input id={id} value={techMake} onChange={(e) => setTechMake(e.target.value)} placeholder="VD: Toyota, Mazda, Hyundai…" />}
            </Field>
            <Field label="Câu hỏi kỹ thuật / Mã lỗi OBD *">
              {(id) => (
                <textarea
                  id={id}
                  rows={4}
                  value={techQ}
                  onChange={(e) => setTechQ(e.target.value)}
                  placeholder="VD: Xe báo mã lỗi P0301 bỏ máy hoặc điều hoà đóng đá giàn lạnh cần kiểm tra những gì?"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                />
              )}
            </Field>
            <Button onClick={runTechQa} disabled={busy === 'tech' || techQ.trim().length < 5} className="w-full justify-center" data-testid="ai-ask-tech-btn">
              {busy === 'tech' ? <Spinner /> : <Sparkles className="h-4 w-4" />}
              Tra cứu kho tri thức
            </Button>
          </Card>

          <Card className="space-y-3 p-5 xl:col-span-3" data-testid="ai-tech-output">
            {!techRes ? (
              <div className="grid min-h-[200px] place-items-center text-sm text-slate-500">
                Đặt câu hỏi kỹ thuật để đối chiếu kho quy trình chuẩn của garage.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="mint">Đã lọc PII</Badge>
                  {techRes.citedDocCodes.map((c) => (
                    <Badge key={c} tone="sky">
                      Trích dẫn: {c}
                    </Badge>
                  ))}
                </div>
                <pre className="whitespace-pre-wrap rounded-2xl bg-slate-50 p-4 font-sans text-sm leading-relaxed text-slate-800">
                  {techRes.responseText}
                </pre>
              </>
            )}
          </Card>
        </div>
      )}

      {/* TAB 4: KHO TRI THỨC & NHẬT KÝ ĐỀ XUẤT */}
      {tab === 'knowledge' && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2" data-testid="ai-docs-list">
            {(docs ?? []).map((d) => (
              <Card key={d.id} className="space-y-2 p-5" data-testid="ai-doc-card">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold text-indigo-700">{d.code}</span>
                  <div className="flex gap-1.5">
                    <Badge tone="sky">{AI_DOC_CATEGORIES.find((c) => c.code === d.category)?.label ?? d.category}</Badge>
                    {d.make && <Badge tone="slate">{d.make}</Badge>}
                  </div>
                </div>
                <div className="font-semibold text-slate-900">{d.title}</div>
                <p className="whitespace-pre-line text-xs text-slate-600">{d.content}</p>
              </Card>
            ))}
          </div>

          {overview && overview.recentSuggestions.length > 0 && (
            <Card className="overflow-x-auto p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
                <CardTitle>Nhật ký đề xuất của Trợ lý AI gần đây</CardTitle>
                <ExportButton
                  filename="nhat-ky-tro-ly-ai"
                  sheetName="Nhật ký AI"
                  testId="export-ai-history"
                  rows={overview.recentSuggestions}
                  columns={[
                    { header: 'Thời gian', value: (s) => fmtDateTime(s.createdAt) },
                    { header: 'Loại hỗ trợ', value: (s) => AI_KIND_UI[s.kind].label },
                    { header: 'Nội dung yêu cầu (đã che PII)', value: (s) => s.promptSummary },
                    { header: 'PII đã che', value: (s) => s.piiMaskedCount },
                    { header: 'Trạng thái', value: (s) => AI_STATUS_UI[s.status].label },
                  ]}
                />
              </div>
              <table className="w-full text-left text-xs" data-testid="ai-history-table">
                <thead className="border-b border-slate-100 uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-2.5">Thời gian</th>
                    <th className="px-3 py-2.5">Loại hỗ trợ</th>
                    <th className="px-3 py-2.5">Nội dung yêu cầu (đã che PII)</th>
                    <th className="px-3 py-2.5 text-right">PII đã che</th>
                    <th className="px-5 py-2.5">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {overview.recentSuggestions.map((s) => (
                    <tr key={s.id}>
                      <td className="px-5 py-2.5 text-slate-500">{fmtDateTime(s.createdAt)}</td>
                      <td className="px-3 py-2.5">
                        <Badge tone={AI_KIND_UI[s.kind].tone}>{AI_KIND_UI[s.kind].label}</Badge>
                      </td>
                      <td className="px-3 py-2.5 font-medium text-slate-800">{s.promptSummary}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{s.piiMaskedCount}</td>
                      <td className="px-5 py-2.5">
                        <Badge tone={AI_STATUS_UI[s.status].tone}>{AI_STATUS_UI[s.status].label}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      {/* Hộp thoại thêm Quy trình kỹ thuật (ai.manage) */}
      <Dialog
        open={openDocModal}
        onClose={() => setOpenDocModal(false)}
        title="Thêm quy trình vào Kho tri thức kỹ thuật"
        wide
        footer={
          <>
            <Button variant="outline" onClick={() => setOpenDocModal(false)}>
              Huỷ
            </Button>
            <Button onClick={saveDocument} disabled={busy === 'doc'} data-testid="ai-save-doc-btn">
              Lưu vào Kho tri thức
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Mã tài liệu (IN-HOA) *">
              {(id) => <Input id={id} value={docCode} onChange={(e) => setDocCode(e.target.value)} placeholder="DOC-HOP-SO-CVT" />}
            </Field>
            <Field label="Chuyên mục *">
              {(id) => (
                <Select id={id} value={docCat} onChange={(e) => setDocCat(e.target.value as AiDocCategoryCode)}>
                  {AI_DOC_CATEGORIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Hãng xe áp dụng (tuỳ chọn)">
              {(id) => <Input id={id} value={docMake} onChange={(e) => setDocMake(e.target.value)} placeholder="Honda, Nissan…" />}
            </Field>
          </div>
          <Field label="Tiêu đề quy trình *">
            {(id) => <Input id={id} value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="Quy trình thay dầu hộp số vô cấp CVT đúng chuẩn nhiệt độ" />}
          </Field>
          <Field label="Từ khoá chẩn đoán (cách nhau bởi dấu phẩy)">
            {(id) => <Input id={id} value={docTags} onChange={(e) => setDocTags(e.target.value)} placeholder="hop so cvt, giat cuc, thay dau hop so" />}
          </Field>
          <Field label="Nội dung quy trình & thông số kỹ thuật *">
            {(id) => (
              <textarea
                id={id}
                rows={5}
                value={docContent}
                onChange={(e) => setDocContent(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
            )}
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
