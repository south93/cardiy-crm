'use client';

import { Alert, Badge, Button, Card, CardTitle, Field, Input, Spinner } from '@cardiy/ui';
import { CalendarCheck2, Car, CheckCircle2, Eye, Send, ShieldCheck, Sparkles, Store, Wrench, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  fmtSlotVn,
  getStoredChatbotToken,
  publicChatbotGet,
  publicChatbotPost,
  saveChatbotToken,
  type ChatbotMessageDto,
  type ChatbotProposalDto,
  type PublicChatbotSessionDto,
} from '@/lib/chatbot';
import { money } from '@/lib/market';

const STARTER_PROMPTS = [
  'Xe Mazda CX-5 đi 40.000 km cần bảo dưỡng những hạng mục gì?',
  'Tra cứu giá dầu nhớt 5W-30 và lốp Michelin đang bán trên sàn',
  'Cho tôi đặt lịch bảo dưỡng định kỳ tại garage trên sàn',
];

/** A1 · Trợ lý AI tư vấn bảo dưỡng, tra giá & đề xuất khung giờ đặt lịch trên Web sàn (/cho/tro-ly-ai) */
export default function MarketChatbotPage() {
  const [token, setToken] = useState<string | null>(null);
  const [make, setMake] = useState('');
  const [km, setKm] = useState('');
  const [input, setInput] = useState('');
  const [wantBooking, setWantBooking] = useState(false);
  const [messages, setMessages] = useState<ChatbotMessageDto[]>([]);
  const [openSanitizedId, setOpenSanitizedId] = useState<string | null>(null);

  // State xác nhận đặt lịch cho từng đề xuất (AI chỉ đề xuất DE_XUAT, khách xác nhận mới gửi yêu cầu thật)
  const [selectedSlotByProp, setSelectedSlotByProp] = useState<Record<string, string>>({});
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custPlate, setCustPlate] = useState('');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    try {
      const stored = getStoredChatbotToken();
      const s = await publicChatbotGet<PublicChatbotSessionDto>(stored ? `/session?token=${encodeURIComponent(stored)}` : '/session');
      saveChatbotToken(s.sessionToken);
      setToken(s.sessionToken);
      if (s.vehicleMake && !make) setMake(s.vehicleMake);
      if (s.odometerKm !== null && !km) setKm(String(s.odometerKm));
      setMessages(s.messages);
      const slotDefaults: Record<string, string> = {};
      for (const m of s.messages) {
        if (m.proposal && m.proposal.suggestedSlots[0]) {
          slotDefaults[m.proposal.id] = m.proposal.suggestedSlots[0];
        }
      }
      setSelectedSlotByProp((prev) => ({ ...slotDefaults, ...prev }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không khởi tạo được phiên tư vấn AI');
    } finally {
      setLoading(false);
    }
  }, [km, make]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  async function sendQuestion(customText?: string, customOfferId?: string, forceBooking?: boolean) {
    const q = (customText ?? input).trim();
    if (q.length < 2) return;
    setBusy('ask');
    setError(null);
    try {
      const kmVal = km.trim() ? Number(km.replace(/[.,\s]/g, '')) : null;
      const res = await publicChatbotPost<{
        sessionToken: string;
        message: ChatbotMessageDto;
        proposal: ChatbotProposalDto | null;
      }>('/ask', {
        sessionToken: token,
        message: q,
        vehicleMake: make.trim() || null,
        odometerKm: Number.isFinite(kmVal) ? kmVal : null,
        offerId: customOfferId ?? null,
        wantBooking: forceBooking ?? wantBooking,
      });
      saveChatbotToken(res.sessionToken);
      setToken(res.sessionToken);
      if (!customText) setInput('');
      if (res.proposal?.suggestedSlots[0]) {
        const firstSlot = res.proposal.suggestedSlots[0];
        setSelectedSlotByProp((prev) => ({ ...prev, [res.proposal!.id]: firstSlot }));
      }
      await loadSession();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không gửi được câu hỏi tư vấn');
    } finally {
      setBusy(null);
    }
  }

  async function confirmProposal(proposalId: string) {
    if (!token) return;
    const slot = selectedSlotByProp[proposalId];
    if (!slot) {
      setError('Vui lòng chọn một khung giờ hẹn phù hợp');
      return;
    }
    setBusy(`confirm:${proposalId}`);
    setError(null);
    try {
      await publicChatbotPost(`/proposals/${proposalId}/confirm-request`, {
        sessionToken: token,
        scheduledAt: slot,
        name: custName,
        phone: custPhone,
        plateNo: custPlate || null,
      });
      await loadSession();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không xác nhận được yêu cầu đặt lịch');
    } finally {
      setBusy(null);
    }
  }

  async function dismissProposal(proposalId: string) {
    if (!token) return;
    setBusy(`dismiss:${proposalId}`);
    setError(null);
    try {
      await publicChatbotPost(`/proposals/${proposalId}/dismiss`, { sessionToken: token });
      await loadSession();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Thao tác thất bại');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5" data-testid="market-chatbot-page">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-indigo-100 bg-gradient-to-r from-indigo-600 to-brand-700 p-6 text-white shadow-sm">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
            <Sparkles className="h-3.5 w-3.5" /> Trợ lý AI Sàn CARDIY · Hỏi đáp bảo dưỡng & Đặt lịch thông minh
          </div>
          <h1 className="text-2xl font-bold">Tư vấn theo dòng xe, tra giá sàn & gợi ý giờ hẹn</h1>
          <p className="text-sm text-indigo-100">
            Thông tin cá nhân tự động được che trước khi gửi AI. AI chỉ đề xuất khung giờ — bạn kiểm tra và bấm Xác nhận mới gửi yêu cầu tới garage.
          </p>
        </div>
        <Badge tone="mint">
          <ShieldCheck className="h-3.5 w-3.5" /> Đã bật lọc ẩn PII
        </Badge>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="grid gap-5 lg:grid-cols-12">
        {/* Cột trái: Thông tin xe tham khảo & câu hỏi mẫu */}
        <div className="space-y-4 lg:col-span-4">
          <Card className="space-y-3 p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <Car className="h-4 w-4 text-brand-600" />
              <CardTitle className="text-base">Thông tin xe của bạn (tuỳ chọn)</CardTitle>
            </div>
            <Field label="Hãng / dòng xe">
              {(id) => (
                <Input
                  id={id}
                  value={make}
                  onChange={(e) => setMake(e.target.value)}
                  placeholder="VD: Mazda CX-5, Toyota Vios…"
                  aria-label="Hãng xe tư vấn"
                />
              )}
            </Field>
            <Field label="Số km hiện tại (ODO)">
              {(id) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  value={km}
                  onChange={(e) => setKm(e.target.value)}
                  placeholder="VD: 40000"
                  aria-label="Số km tư vấn"
                />
              )}
            </Field>
          </Card>

          <Card className="space-y-2.5 p-4 sm:p-5">
            <CardTitle className="text-base">Câu hỏi thường gặp</CardTitle>
            <div className="grid gap-2">
              {STARTER_PROMPTS.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  disabled={!!busy}
                  onClick={() => void sendQuestion(p, undefined, idx === 2)}
                  className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 text-left text-xs font-medium text-slate-700 transition hover:border-brand-300 hover:bg-white"
                  data-testid="market-ai-starter"
                >
                  {p}
                </button>
              ))}
            </div>
          </Card>
        </div>

        {/* Cột phải: Luồng hội thoại & Thẻ đề xuất khung giờ */}
        <Card className="flex flex-col justify-between space-y-4 p-4 sm:p-5 lg:col-span-8">
          <div className="max-h-[620px] min-h-[320px] space-y-4 overflow-y-auto pr-1" data-testid="market-chatbot-thread">
            {loading ? (
              <div className="grid min-h-[240px] place-items-center">
                <Spinner className="h-6 w-6 text-brand-600" />
              </div>
            ) : messages.length === 0 ? (
              <div className="grid min-h-[260px] place-items-center text-center text-sm text-slate-500">
                <div className="max-w-md space-y-2">
                  <Sparkles className="mx-auto h-8 w-8 text-indigo-400" />
                  <p className="font-medium text-slate-700">Bắt đầu trò chuyện cùng Trợ lý AI</p>
                  <p className="text-xs">
                    Hỏi mốc bảo dưỡng theo số km, so sánh giá dầu nhớt / lốp / dịch vụ giữa các garage trên sàn, hoặc nhờ AI tìm khung giờ đặt lịch phù hợp.
                  </p>
                </div>
              </div>
            ) : (
              messages.map((m) =>
                m.role === 'USER' ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-brand-600 px-4 py-2.5 text-sm text-white shadow-sm">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="space-y-3 rounded-2xl border border-indigo-100 bg-slate-50/70 p-4" data-testid="market-ai-reply">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="mint">
                          <ShieldCheck className="h-3 w-3" /> Đã che PII ({m.piiMaskedCount})
                        </Badge>
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
                          className="inline-flex items-center gap-1 font-medium text-indigo-700 hover:underline"
                          data-testid="market-ai-toggle-sanitized"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          {openSanitizedId === m.id ? 'Ẩn ngữ cảnh' : 'Đối chứng ngữ cảnh sạch PII'}
                        </button>
                      )}
                    </div>

                    <p className="whitespace-pre-line text-sm leading-relaxed text-slate-800">{m.content}</p>

                    {openSanitizedId === m.id && m.sanitizedContext && (
                      <pre
                        className="max-h-44 overflow-auto rounded-xl bg-slate-900 p-3 font-mono text-xs text-emerald-300"
                        data-testid="market-ai-sanitized-json"
                      >
                        {m.sanitizedContext}
                      </pre>
                    )}

                    {/* Kế hoạch hạng mục bảo dưỡng theo mốc km */}
                    {m.maintenancePlan && (
                      <div className="rounded-2xl border border-sky-200 bg-white p-3.5" data-testid="market-ai-maint-card">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                            <Wrench className="h-4 w-4 text-brand-600" /> {m.maintenancePlan.tierLabel}
                          </div>
                          <Badge tone="sky">~{m.maintenancePlan.estimatedMinutes} phút</Badge>
                        </div>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
                          {m.maintenancePlan.checklist.map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Các sản phẩm / dịch vụ đang bán trên sàn khớp câu hỏi */}
                    {m.matchedOffers.length > 0 && (
                      <div className="space-y-2" data-testid="market-ai-offers">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Bảng giá niêm yết từ các garage trên sàn
                        </div>
                        <div className="grid gap-2.5 sm:grid-cols-2">
                          {m.matchedOffers.map((o) => (
                            <div
                              key={o.offerId}
                              className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-3 text-xs shadow-sm"
                              data-testid="market-ai-offer-card"
                            >
                              <div>
                                <div className="font-semibold text-slate-900">{o.name}</div>
                                <div className="mt-0.5 flex items-center gap-1 text-slate-500">
                                  <Store className="h-3 w-3 shrink-0" />
                                  <Link href={`/cho/garage/${o.shopSlug}`} className="hover:text-brand-700 hover:underline">
                                    {o.shopName}
                                  </Link>
                                </div>
                                <div className="mt-1.5 text-sm font-bold text-brand-700">
                                  {o.priceFrom ? 'Từ ' : ''}
                                  {money(o.price)}
                                </div>
                                <div className="mt-0.5 text-[11px] text-slate-500">
                                  {[
                                    o.installIncluded ? 'Gồm lắp đặt' : null,
                                    o.available !== null ? `Còn ${o.available}` : null,
                                    o.durationMinutes ? `~${o.durationMinutes} phút` : null,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </div>
                              </div>
                              <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
                                <button
                                  type="button"
                                  disabled={!!busy}
                                  onClick={() => void sendQuestion(`Đề xuất khung giờ đặt lịch cho ${o.name}`, o.offerId, true)}
                                  className="rounded-full bg-indigo-50 px-2.5 py-1 font-medium text-indigo-700 hover:bg-indigo-100"
                                  data-testid="market-ai-propose-offer-btn"
                                >
                                  Gợi ý giờ hẹn
                                </button>
                                <Link
                                  href={o.bookHref}
                                  className="rounded-full border border-slate-200 px-2.5 py-1 font-medium text-slate-700 hover:border-brand-300"
                                >
                                  Trang đặt hàng
                                </Link>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Thẻ Đề xuất khung giờ đặt lịch (khách xác nhận mới tạo yêu cầu YC… thật) */}
                    {m.proposal && (
                      <div
                        className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/50 p-4"
                        data-testid="market-ai-proposal-card"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-xs font-semibold uppercase text-amber-800">Đề xuất đặt lịch qua Sàn</div>
                            <div className="text-sm font-bold text-slate-900">
                              {m.proposal.serviceName} · <span className="text-brand-700">{m.proposal.shopName}</span>
                            </div>
                          </div>
                          {m.proposal.status === 'DE_XUAT' && <Badge tone="peach">Chờ bạn xác nhận</Badge>}
                          {m.proposal.status === 'DA_XAC_NHAN' && <Badge tone="mint">Đã xác nhận gửi yêu cầu</Badge>}
                          {m.proposal.status === 'DA_HUY' && <Badge tone="slate">Đã bỏ qua</Badge>}
                        </div>

                        {m.proposal.status === 'DE_XUAT' && (
                          <>
                            <div className="space-y-1.5">
                              <div className="text-xs font-medium text-slate-700">1. Chọn khung giờ mở cửa được AI đề xuất:</div>
                              <div className="flex flex-wrap gap-2">
                                {m.proposal.suggestedSlots.map((sl) => {
                                  const active = selectedSlotByProp[m.proposal!.id] === sl;
                                  return (
                                    <button
                                      key={sl}
                                      type="button"
                                      onClick={() => setSelectedSlotByProp({ ...selectedSlotByProp, [m.proposal!.id]: sl })}
                                      className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                                        active
                                          ? 'border-brand-600 bg-brand-600 text-white'
                                          : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300'
                                      }`}
                                      data-testid="market-ai-slot-btn"
                                    >
                                      {fmtSlotVn(sl)}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="grid gap-2.5 sm:grid-cols-3">
                              <Field label="Họ tên người đặt *">
                                {(id) => (
                                  <Input
                                    id={id}
                                    value={custName}
                                    onChange={(e) => setCustName(e.target.value)}
                                    placeholder="Nguyễn Văn A"
                                  />
                                )}
                              </Field>
                              <Field label="Số điện thoại liên hệ *">
                                {(id) => (
                                  <Input
                                    id={id}
                                    inputMode="tel"
                                    value={custPhone}
                                    onChange={(e) => setCustPhone(e.target.value)}
                                    placeholder="0912345678"
                                  />
                                )}
                              </Field>
                              <Field label="Biển số xe (tuỳ chọn)">
                                {(id) => (
                                  <Input
                                    id={id}
                                    value={custPlate}
                                    onChange={(e) => setCustPlate(e.target.value)}
                                    placeholder="51K-123.45"
                                  />
                                )}
                              </Field>
                            </div>

                            <div className="flex flex-wrap justify-end gap-2 pt-1">
                              <Button
                                variant="outline"
                                onClick={() => void dismissProposal(m.proposal!.id)}
                                disabled={!!busy}
                                data-testid="market-ai-dismiss-btn"
                              >
                                <XCircle className="h-4 w-4" /> Bỏ qua
                              </Button>
                              <Button
                                onClick={() => void confirmProposal(m.proposal!.id)}
                                disabled={!!busy || custName.trim().length < 2 || custPhone.trim().length < 9}
                                data-testid="market-ai-confirm-btn"
                              >
                                {busy === `confirm:${m.proposal.id}` ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />}
                                Xác nhận gửi yêu cầu đặt lịch
                              </Button>
                            </div>
                          </>
                        )}

                        {m.proposal.status === 'DA_XAC_NHAN' && (
                          <div
                            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900"
                            data-testid="market-ai-confirmed-box"
                          >
                            <div className="flex items-center gap-2 font-medium">
                              <CalendarCheck2 className="h-4 w-4 text-emerald-600" />
                              Đã tạo yêu cầu {m.proposal.orderRequestCode} · Hẹn lúc{' '}
                              {m.proposal.confirmedSlot ? fmtSlotVn(m.proposal.confirmedSlot) : ''}
                            </div>
                            {m.proposal.trackingPath && (
                              <Link
                                href={m.proposal.trackingPath}
                                className="rounded-full bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700"
                                data-testid="market-ai-track-link"
                              >
                                Xem & theo dõi yêu cầu
                              </Link>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ),
              )
            )}
          </div>

          <div className="space-y-2 border-t border-slate-100 pt-3">
            <label className="inline-flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={wantBooking}
                onChange={(e) => setWantBooking(e.target.checked)}
                data-testid="market-ai-want-booking"
              />
              Đính kèm đề xuất khung giờ đặt lịch trống tại garage
            </label>
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendQuestion();
                  }
                }}
                placeholder="Nhập câu hỏi (VD: Xe Toyota Vios 20.000 km cần làm gì, giá thay dầu bao nhiêu?)…"
                aria-label="Nhập câu hỏi tư vấn AI"
                data-testid="market-ai-input"
              />
              <Button onClick={() => void sendQuestion()} disabled={busy === 'ask' || input.trim().length < 2} data-testid="market-ai-send-btn">
                {busy === 'ask' ? <Spinner /> : <Send className="h-4 w-4" />}
                Gửi
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
