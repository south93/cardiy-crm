'use client';

import { Alert, Badge, Button, Card, CardTitle, Input, Spinner } from '@cardiy/ui';
import { CheckCircle2, Eye, ShieldCheck, Sparkles, XCircle } from 'lucide-react';
import { useState } from 'react';
import type { AiSuggestionDto } from '@/lib/ai';
import { api, ApiError } from '@/lib/api';
import { fmtMoney } from '@/lib/crm';

/** Thẻ nhúng trên Hồ sơ Xe (/xe/[id] · A3.32): Tóm tắt lịch sử & sức khoẻ xe bằng AI */
export function VehicleAiSummaryCard({ vehicleId }: { vehicleId: string }) {
  const [res, setRes] = useState<AiSuggestionDto | null>(null);
  const [showSanitized, setShowSanitized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function summarize() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<AiSuggestionDto>('/ai/summarize-vehicle', { body: { vehicleId } });
      setRes(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tóm tắt được lịch sử xe');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 border-indigo-100 bg-gradient-to-br from-indigo-50/50 to-white p-4 lg:p-5" data-testid="vehicle-ai-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-indigo-600" />
          <CardTitle className="text-base">Trợ lý AI · Tóm tắt lịch sử & sức khoẻ xe</CardTitle>
        </div>
        <Button variant="outline" onClick={summarize} disabled={busy} data-testid="vehicle-ai-summarize-btn">
          {busy ? <Spinner /> : <Sparkles className="h-4 w-4 text-indigo-600" />}
          {res ? 'Phân tích lại' : 'Tóm tắt bằng AI'}
        </Button>
      </div>

      {error && <Alert>{error}</Alert>}

      {!res && !busy && (
        <p className="text-xs text-slate-500">
          Tổng hợp nhanh lịch sử sửa chữa, cảnh báo từ phiếu kiểm tra điện tử và gợi ý mốc bảo dưỡng tiếp theo (tự động che thông tin cá nhân của chủ xe).
        </p>
      )}

      {res && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5">
              <Badge tone="mint">
                <ShieldCheck className="h-3 w-3" /> Đã ẩn PII ({res.piiMaskedCount} mục che)
              </Badge>
              <Badge tone="sky">Chỉ đề xuất tham khảo</Badge>
            </div>
            <button
              type="button"
              onClick={() => setShowSanitized(!showSanitized)}
              className="inline-flex items-center gap-1 text-indigo-700 hover:underline"
              data-testid="vehicle-ai-toggle-sanitized"
            >
              <Eye className="h-3.5 w-3.5" /> {showSanitized ? 'Ẩn ngữ cảnh sạch PII' : 'Xem ngữ cảnh gửi AI'}
            </button>
          </div>

          <pre
            className="whitespace-pre-wrap rounded-2xl border border-indigo-100 bg-white p-3.5 font-sans text-sm leading-relaxed text-slate-800"
            data-testid="vehicle-ai-summary-text"
          >
            {res.responseText}
          </pre>

          {showSanitized && (
            <pre className="max-h-48 overflow-auto rounded-xl bg-slate-900 p-3 font-mono text-xs text-emerald-300" data-testid="vehicle-ai-sanitized-json">
              {res.sanitizedContext}
            </pre>
          )}
        </div>
      )}
    </Card>
  );
}

/** Thẻ nhúng trên Chi tiết Lệnh sửa chữa (/don-hang/[id] · A3.12): Gợi ý báo giá AI (nhân viên duyệt mới ghi vào đơn) */
export function OrderAiQuoteCard({
  orderId,
  defaultSymptoms,
  canApply,
  seesMoney,
  onApplied,
}: {
  orderId: string;
  defaultSymptoms: string;
  canApply: boolean;
  seesMoney: boolean;
  onApplied: () => Promise<void> | void;
}) {
  const [symptoms, setSymptoms] = useState(defaultSymptoms);
  const [res, setRes] = useState<AiSuggestionDto | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [showSanitized, setShowSanitized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function suggest() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<AiSuggestionDto>('/ai/suggest-quote', {
        body: {
          orderId,
          symptoms: symptoms.trim() || defaultSymptoms.trim() || 'Kiểm tra bảo dưỡng định kỳ tổng thể',
        },
      });
      setRes(r);
      setSelected(r.suggestedItems.map((_, idx) => idx));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không lấy được đề xuất báo giá AI');
    } finally {
      setBusy(false);
    }
  }

  async function applyApproved() {
    if (!res) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/ai/suggestions/${res.id}/apply-to-order`, {
        body: { orderId, selectedIndexes: selected },
      });
      setRes({ ...res, status: 'DA_AP_DUNG', appliedItemCount: selected.length });
      await onApplied();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Duyệt ghi vào đơn thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    if (!res) return;
    setBusy(true);
    try {
      await api(`/ai/suggestions/${res.id}/dismiss`, { body: {} });
      setRes({ ...res, status: 'BO_QUA' });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Thao tác thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 border-indigo-100 bg-gradient-to-br from-indigo-50/40 to-white p-4 lg:p-5" data-testid="order-ai-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-indigo-600" />
          <CardTitle className="text-base">Trợ lý AI · Chẩn đoán & Gợi ý hạng mục báo giá</CardTitle>
        </div>
        <Badge tone="peach">AI chỉ đề xuất · Người duyệt mới ghi</Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          value={symptoms}
          onChange={(e) => setSymptoms(e.target.value)}
          placeholder="Nhập triệu chứng xe (VD: phanh kêu, điều hoà kém mát, bảo dưỡng 40.000km)…"
          aria-label="Triệu chứng chẩn đoán AI"
          className="min-w-[220px] flex-1 bg-white"
        />
        <Button variant="outline" onClick={suggest} disabled={busy} data-testid="order-ai-suggest-btn">
          {busy ? <Spinner /> : <Sparkles className="h-4 w-4 text-indigo-600" />}
          Phân tích & Đề xuất
        </Button>
      </div>

      {error && <Alert>{error}</Alert>}

      {res && (
        <div className="space-y-3 rounded-2xl border border-indigo-100 bg-white p-4" data-testid="order-ai-result">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="mint">
                <ShieldCheck className="h-3 w-3" /> Đã che PII ({res.piiMaskedCount})
              </Badge>
              {res.citedDocCodes.map((c) => (
                <Badge key={c} tone="sky">
                  {c}
                </Badge>
              ))}
              {res.status === 'DA_AP_DUNG' && <Badge tone="mint">Đã duyệt ghi {res.appliedItemCount} mục vào đơn</Badge>}
              {res.status === 'BO_QUA' && <Badge tone="slate">Đã bỏ qua đề xuất</Badge>}
            </div>
            <button
              type="button"
              onClick={() => setShowSanitized(!showSanitized)}
              className="inline-flex items-center gap-1 text-indigo-700 hover:underline"
            >
              <Eye className="h-3.5 w-3.5" /> {showSanitized ? 'Ẩn ngữ cảnh' : 'Xem ngữ cảnh sạch PII'}
            </button>
          </div>

          <p className="whitespace-pre-line text-xs leading-relaxed text-slate-700">{res.responseText}</p>

          {showSanitized && (
            <pre className="max-h-40 overflow-auto rounded-xl bg-slate-900 p-3 font-mono text-xs text-emerald-300">
              {res.sanitizedContext}
            </pre>
          )}

          {res.suggestedItems.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs" data-testid="order-ai-items-table">
                <thead className="border-b border-slate-100 uppercase text-slate-500">
                  <tr>
                    {canApply && res.status === 'DE_XUAT' && <th className="py-2 pr-2">Chọn</th>}
                    <th className="py-2">Hạng mục đề xuất</th>
                    <th className="py-2">Lý do & Tồn kho</th>
                    {seesMoney && <th className="py-2 text-right">Đơn giá đề xuất</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {res.suggestedItems.map((it, idx) => {
                    const checked = selected.includes(idx);
                    return (
                      <tr key={idx} data-testid="order-ai-item-row">
                        {canApply && res.status === 'DE_XUAT' && (
                          <td className="py-2 pr-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setSelected(checked ? selected.filter((x) => x !== idx) : [...selected, idx])
                              }
                            />
                          </td>
                        )}
                        <td className="py-2 font-medium text-slate-900">
                          {it.code ? <span className="mr-1 font-mono text-slate-400">{it.code}</span> : null}
                          {it.name}
                          <span className="ml-1.5 text-slate-400">
                            ({it.quantity} {it.unit ?? 'lần'})
                          </span>
                        </td>
                        <td className="py-2 text-slate-600">{it.reason}</td>
                        {seesMoney && (
                          <td className="py-2 text-right font-semibold tabular-nums">
                            {it.unitPrice !== null ? fmtMoney(it.unitPrice) : '—'}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {res.status === 'DE_XUAT' && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
              <Button variant="outline" onClick={dismiss} disabled={busy} data-testid="order-ai-dismiss-btn">
                <XCircle className="h-4 w-4" /> Bỏ qua đề xuất
              </Button>
              {canApply && (
                <Button
                  onClick={applyApproved}
                  disabled={busy || selected.length === 0}
                  data-testid="order-ai-apply-btn"
                >
                  <CheckCircle2 className="h-4 w-4" /> Duyệt & Ghi {selected.length} mục vào đơn
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
