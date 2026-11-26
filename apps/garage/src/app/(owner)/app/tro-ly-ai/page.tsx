'use client';

import { Alert, Badge, Button, Card, Input, Spinner } from '@cardiy/ui';
import { ArrowLeft, CalendarCheck2, CheckCircle2, Eye, Send, ShieldCheck, Sparkles, Store, Wrench, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  fmtSlotVn,
  type ChatbotMessageDto,
  type ChatbotProposalDto,
  type OwnerChatbotSessionDto,
} from '@/lib/chatbot';
import { money } from '@/lib/market';
import { ownerApi } from '@/lib/owner';

const OWNER_STARTERS = [
  { label: 'Xe tôi sắp tới mốc bảo dưỡng cần làm gì?', booking: false },
  { label: 'Tra cứu giá dầu nhớt 5W-30 trên sàn', booking: false },
  { label: 'Đề xuất khung giờ đặt lịch bảo dưỡng tuần này', booking: true },
];

/** A2 · Chatbot AI đặt lịch & Tư vấn chủ xe trên App chủ xe (/app/tro-ly-ai) */
export default function OwnerChatbotPage() {
  const [session, setSession] = useState<OwnerChatbotSessionDto | null>(null);
  const [vehicleId, setVehicleId] = useState<string>('');
  const [input, setInput] = useState('');
  const [wantBooking, setWantBooking] = useState(false);
  const [selectedSlotByProp, setSelectedSlotByProp] = useState<Record<string, string>>({});
  const [openSanitizedId, setOpenSanitizedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await ownerApi<OwnerChatbotSessionDto>('/chatbot/session');
      setSession(s);
      setVehicleId((prev) => prev || s.selectedVehicleId || s.vehicles[0]?.id || '');
      const defaults: Record<string, string> = {};
      for (const m of s.messages) {
        if (m.proposal?.suggestedSlots[0]) defaults[m.proposal.id] = m.proposal.suggestedSlots[0];
      }
      setSelectedSlotByProp((prev) => ({ ...defaults, ...prev }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được Trợ lý AI chủ xe');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function ask(customText?: string, forceBooking?: boolean) {
    const q = (customText ?? input).trim();
    if (q.length < 2) return;
    setBusy('ask');
    setError(null);
    try {
      const res = await ownerApi<{ message: ChatbotMessageDto; proposal: ChatbotProposalDto | null }>('/chatbot/ask', {
        body: {
          message: q,
          vehicleId: vehicleId || null,
          wantBooking: forceBooking ?? wantBooking,
        },
      });
      if (!customText) setInput('');
      if (res.proposal?.suggestedSlots[0]) {
        const firstSlot = res.proposal.suggestedSlots[0];
        setSelectedSlotByProp((prev) => ({ ...prev, [res.proposal!.id]: firstSlot }));
      }
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gửi câu hỏi tư vấn thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function confirmBooking(proposalId: string) {
    const slot = selectedSlotByProp[proposalId];
    if (!slot) {
      setError('Chọn khung giờ hẹn trước khi xác nhận');
      return;
    }
    setBusy(`confirm:${proposalId}`);
    setError(null);
    try {
      await ownerApi(`/chatbot/proposals/${proposalId}/confirm-booking`, {
        body: { scheduledAt: slot },
      });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tạo được lịch hẹn');
    } finally {
      setBusy(null);
    }
  }

  async function dismissProposal(proposalId: string) {
    setBusy(`dismiss:${proposalId}`);
    setError(null);
    try {
      await ownerApi(`/chatbot/proposals/${proposalId}/dismiss`, { body: {} });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Thao tác thất bại');
    } finally {
      setBusy(null);
    }
  }

  if (!session) return <Spinner className="h-6 w-6 text-brand-600" />;

  return (
    <div className="space-y-4" data-testid="owner-chatbot-page">
      <div className="flex items-center justify-between gap-2">
        <Link href="/app" className="flex items-center gap-1 text-sm text-slate-500">
          <ArrowLeft className="h-4 w-4" /> Xe của tôi
        </Link>
        <Badge tone="mint">
          <ShieldCheck className="h-3 w-3" /> Bảo mật PII
        </Badge>
      </div>

      <div className="rounded-2xl bg-gradient-to-r from-indigo-600 to-brand-700 p-4 text-white shadow-sm">
        <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-100">
          <Sparkles className="h-3.5 w-3.5" /> Trợ lý AI chủ xe CARDIY
        </div>
        <h1 className="mt-1 text-lg font-bold">Tư vấn bảo dưỡng & Đặt lịch nhanh</h1>
        <p className="mt-0.5 text-xs text-indigo-100">
          AI đề xuất hạng mục theo km xe của bạn và tìm khung giờ trống — chỉ khi bạn bấm Xác nhận mới tạo lịch hẹn thật.
        </p>
      </div>

      {session.vehicles.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-slate-600">Xe đang chọn để tư vấn:</div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {session.vehicles.map((v) => {
              const active = vehicleId === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVehicleId(v.id)}
                  className={`shrink-0 rounded-xl border px-3 py-2 text-left text-xs ${
                    active ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-700'
                  }`}
                  data-testid="owner-ai-vehicle-pill"
                >
                  <div className="font-mono font-bold">{v.plate}</div>
                  <div className="opacity-85">
                    {[v.make, v.model].filter(Boolean).join(' ') || 'Xe của tôi'}
                    {v.odometerKm !== null ? ` · ${v.odometerKm.toLocaleString('vi-VN')} km` : ''}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {OWNER_STARTERS.map((s, idx) => (
          <button
            key={idx}
            type="button"
            disabled={!!busy}
            onClick={() => void ask(s.label, s.booking)}
            className="shrink-0 rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
            data-testid="owner-ai-starter"
          >
            {s.label}
          </button>
        ))}
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="space-y-3" data-testid="owner-chatbot-thread">
        {session.messages.length === 0 ? (
          <Card className="p-5 text-center text-xs text-slate-500">
            Chọn câu hỏi gợi ý phía trên hoặc nhập thắc mắc về bảo dưỡng, giá phụ tùng/dịch vụ và lịch hẹn của xe bạn.
          </Card>
        ) : (
          session.messages.map((m) =>
            m.role === 'USER' ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-brand-600 px-3.5 py-2 text-sm text-white">
                  {m.content}
                </div>
              </div>
            ) : (
              <Card key={m.id} className="space-y-3 border-indigo-100 p-3.5" data-testid="owner-ai-reply">
                <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge tone="mint">Đã ẩn PII ({m.piiMaskedCount})</Badge>
                    {m.citedDocCodes.map((c) => (
                      <Badge key={c} tone="sky">
                        {c}
                      </Badge>
                    ))}
                  </div>
                  {m.sanitizedContext && (
                    <button
                      type="button"
                      onClick={() => setOpenSanitizedId(openSanitizedId === m.id ? null : m.id)}
                      className="inline-flex items-center gap-1 text-indigo-700 hover:underline"
                      data-testid="owner-ai-toggle-sanitized"
                    >
                      <Eye className="h-3 w-3" /> {openSanitizedId === m.id ? 'Ẩn' : 'Ngữ cảnh sạch PII'}
                    </button>
                  )}
                </div>

                <p className="whitespace-pre-line text-xs leading-relaxed text-slate-800">{m.content}</p>

                {openSanitizedId === m.id && m.sanitizedContext && (
                  <pre
                    className="max-h-36 overflow-auto rounded-xl bg-slate-900 p-2.5 font-mono text-[11px] text-emerald-300"
                    data-testid="owner-ai-sanitized-json"
                  >
                    {m.sanitizedContext}
                  </pre>
                )}

                {m.maintenancePlan && (
                  <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-3" data-testid="owner-ai-maint-card">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                      <Wrench className="h-3.5 w-3.5 text-brand-600" /> {m.maintenancePlan.tierLabel}
                    </div>
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] text-slate-700">
                      {m.maintenancePlan.checklist.map((c, idx) => (
                        <li key={idx}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {m.matchedOffers.length > 0 && (
                  <div className="space-y-1.5" data-testid="owner-ai-offers">
                    <div className="text-[11px] font-semibold uppercase text-slate-500">Giá tham khảo trên Sàn</div>
                    {m.matchedOffers.map((o) => (
                      <div key={o.offerId} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 text-xs">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-900">{o.name}</div>
                          <div className="flex items-center gap-1 text-[11px] text-slate-500">
                            <Store className="h-3 w-3 shrink-0" /> {o.shopName}
                          </div>
                        </div>
                        <div className="shrink-0 text-right font-bold text-brand-700">
                          {o.priceFrom ? 'Từ ' : ''}
                          {money(o.price)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {m.proposal && (
                  <div className="space-y-2.5 rounded-xl border border-amber-200 bg-amber-50/60 p-3" data-testid="owner-ai-proposal-card">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[11px] font-semibold uppercase text-amber-800">Đề xuất khung giờ hẹn</div>
                        <div className="text-xs font-bold text-slate-900">{m.proposal.serviceName}</div>
                        <div className="text-[11px] text-slate-600">
                          {[m.proposal.shopName, m.proposal.branchName, m.proposal.vehicleLabel].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      {m.proposal.status === 'DE_XUAT' && <Badge tone="peach">Chưa đặt</Badge>}
                      {m.proposal.status === 'DA_XAC_NHAN' && <Badge tone="mint">Đã đặt lịch</Badge>}
                      {m.proposal.status === 'DA_HUY' && <Badge tone="slate">Đã bỏ qua</Badge>}
                    </div>

                    {m.proposal.status === 'DE_XUAT' && (
                      <>
                        <div className="grid grid-cols-2 gap-1.5">
                          {m.proposal.suggestedSlots.map((sl) => {
                            const on = selectedSlotByProp[m.proposal!.id] === sl;
                            return (
                              <button
                                key={sl}
                                type="button"
                                onClick={() => setSelectedSlotByProp({ ...selectedSlotByProp, [m.proposal!.id]: sl })}
                                className={`rounded-xl border px-2.5 py-2 text-[11px] font-medium ${
                                  on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-700'
                                }`}
                                data-testid="owner-ai-slot-btn"
                              >
                                {fmtSlotVn(sl)}
                              </button>
                            );
                          })}
                        </div>

                        <div className="flex justify-end gap-2 pt-1">
                          <Button
                            variant="outline"
                            onClick={() => void dismissProposal(m.proposal!.id)}
                            disabled={!!busy}
                            data-testid="owner-ai-dismiss-btn"
                          >
                            <XCircle className="h-3.5 w-3.5" /> Bỏ qua
                          </Button>
                          <Button
                            onClick={() => void confirmBooking(m.proposal!.id)}
                            disabled={!!busy}
                            data-testid="owner-ai-confirm-booking-btn"
                          >
                            {busy === `confirm:${m.proposal.id}` ? <Spinner /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                            Xác nhận đặt lịch hẹn
                          </Button>
                        </div>
                      </>
                    )}

                    {m.proposal.status === 'DA_XAC_NHAN' && (
                      <div
                        className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-900"
                        data-testid="owner-ai-booking-confirmed"
                      >
                        <span className="flex items-center gap-1.5 font-semibold">
                          <CalendarCheck2 className="h-4 w-4 text-emerald-600" /> Đã tạo lịch hẹn {m.proposal.bookingCode}
                        </span>
                        <Link href="/app/lich-hen" className="font-semibold text-brand-700 underline">
                          Xem lịch hẹn
                        </Link>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            ),
          )
        )}
      </div>

      <Card className="space-y-2 p-3">
        <label className="inline-flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={wantBooking}
            onChange={(e) => setWantBooking(e.target.checked)}
            data-testid="owner-ai-want-booking"
          />
          Gợi ý luôn khung giờ hẹn trống tại chi nhánh
        </label>
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void ask();
              }
            }}
            placeholder="Nhập câu hỏi bảo dưỡng, giá dịch vụ hoặc đặt lịch…"
            aria-label="Hỏi Trợ lý AI chủ xe"
            data-testid="owner-ai-input"
          />
          <Button onClick={() => void ask()} disabled={busy === 'ask' || input.trim().length < 2} data-testid="owner-ai-send-btn">
            {busy === 'ask' ? <Spinner /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </Card>
    </div>
  );
}
