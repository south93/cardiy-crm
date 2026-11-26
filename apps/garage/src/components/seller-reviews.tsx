'use client';

import { Alert, Badge, Button, Card, CardTitle, Dialog, Field, Input, Spinner, Tabs } from '@cardiy/ui';
import { Flag, MessageSquareReply, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Stars } from '@/components/order-review-card';
import { api, ApiError } from '@/lib/api';
import { REPORT_REASONS, REPORT_STATUS, VIOLATION_ACTION } from '@/lib/market-client';
import { fmtDateTime } from '@/lib/orders';

interface SellerReviewRow {
  id: string;
  source: 'MARKET' | 'CRM';
  refCode: string;
  customerName: string;
  publicName: string;
  items: string[];
  rating: number;
  comment: string | null;
  reply: string | null;
  repliedAt: string | null;
  status: 'HIEN' | 'AN';
  reportedReason: string | null;
  reportedAt: string | null;
  moderationNote: string | null;
  moderatedAt: string | null;
  createdAt: string;
}

interface SellerReviewsRes {
  summary: {
    avg: number | null;
    count: number;
    unreplied: number;
    reported: number;
    stars: Record<string, number>;
  };
  items: SellerReviewRow[];
}

interface SellerReportRow {
  id: string;
  code: string;
  requestCode: string | null;
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
  createdAt: string;
}

interface SellerViolationRow {
  id: string;
  code: string;
  reportCode: string | null;
  offerName: string | null;
  action: string;
  reason: string;
  createdAt: string;
}

interface SellerReportsRes {
  counts: Record<string, number>;
  items: SellerReportRow[];
  violations: SellerViolationRow[];
}

/**
 * Đánh giá của khách & phản ánh từ sàn (A7.24 cho Đối tác, A3.55 cho PLG).
 * Garage trả lời đánh giá, báo cáo đánh giá sai sự thật và gửi giải trình khi sàn yêu cầu.
 */
export function SellerReviews() {
  const [tab, setTab] = useState<'reviews' | 'reports'>('reviews');
  const [filter, setFilter] = useState<'ALL' | 'UNREPLIED' | 'REPORTED'>('ALL');
  const [reviews, setReviews] = useState<SellerReviewsRes | null>(null);
  const [reports, setReports] = useState<SellerReportsRes | null>(null);

  const [replyFor, setReplyFor] = useState<SellerReviewRow | null>(null);
  const [replyText, setReplyText] = useState('');
  const [reportFor, setReportFor] = useState<SellerReviewRow | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [explainFor, setExplainFor] = useState<SellerReportRow | null>(null);
  const [explainText, setExplainText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [rv, rp] = await Promise.all([
      api<SellerReviewsRes>(`/seller/reviews?filter=${filter}`),
      api<SellerReportsRes>('/seller/reports').catch(() => ({ counts: {}, items: [], violations: [] })),
    ]);
    setReviews(rv);
    setReports(rp);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveReply = async () => {
    if (!replyFor) return;
    setError(null);
    try {
      await api(`/seller/reviews/${replyFor.id}/reply`, { body: { reply: replyText } });
      setReplyFor(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : 'Không lưu được trả lời');
    }
  };

  const submitReportReview = async () => {
    if (!reportFor) return;
    setError(null);
    try {
      await api(`/seller/reviews/${reportFor.id}/report`, { body: { reason: reportReason } });
      setReportFor(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : 'Không gửi được báo cáo');
    }
  };

  const submitExplanation = async () => {
    if (!explainFor) return;
    setError(null);
    try {
      await api(`/seller/reports/${explainFor.id}/explain`, { body: { explanation: explainText } });
      setExplainFor(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : 'Không gửi được giải trình');
    }
  };

  const needExplain = reports?.counts.CHO_GIAI_TRINH ?? 0;
  const s = reviews?.summary;

  return (
    <div className="space-y-4">
      {needExplain > 0 && (
        <Alert tone="peach">
          Sàn đang yêu cầu gian hàng giải trình <span className="font-semibold">{needExplain} phản ánh</span> từ khách.{' '}
          <button type="button" onClick={() => setTab('reports')} className="font-semibold underline">
            Xem & giải trình ngay
          </button>
        </Alert>
      )}

      {s && (
        <Card className="grid gap-4 p-5 sm:grid-cols-[200px_1fr]" data-testid="reviews-summary">
          <div className="flex flex-col justify-center">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Điểm hiển thị trên sàn</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums" data-testid="summary-avg">
                {s.avg !== null ? s.avg.toLocaleString('vi-VN') : '—'}
              </span>
              {s.avg !== null && <Stars n={Math.round(s.avg)} />}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {s.count} đánh giá hiển thị · {s.unreplied} chưa trả lời
            </div>
          </div>
          <div className="space-y-1.5">
            {[5, 4, 3, 2, 1].map((star) => {
              const cnt = s.stars[String(star)] ?? 0;
              const pct = s.count > 0 ? Math.round((cnt / s.count) * 100) : 0;
              return (
                <div key={star} className="flex items-center gap-2 text-xs">
                  <span className="w-10 text-slate-600">{star} sao</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-8 text-right tabular-nums text-slate-500">{cnt}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Tabs
        tabs={[
          { value: 'reviews', label: `Đánh giá của khách${s ? ` (${s.count})` : ''}` },
          { value: 'reports', label: `Phản ánh & vi phạm${needExplain ? ` (${needExplain} cần giải trình)` : ''}` },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'reviews' ? (
        <div className="space-y-4">
          <Tabs
            tabs={[
              { value: 'ALL', label: 'Tất cả' },
              { value: 'UNREPLIED', label: `Chưa trả lời${s?.unreplied ? ` (${s.unreplied})` : ''}` },
              { value: 'REPORTED', label: `Đã báo cáo sàn${s?.reported ? ` (${s.reported})` : ''}` },
            ]}
            value={filter}
            onChange={setFilter}
          />
          {!reviews ? (
            <div className="grid place-items-center p-10">
              <Spinner className="h-6 w-6 text-brand-600" />
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2" data-testid="seller-review-list">
              {reviews.items.map((r) => (
                <Card key={r.id} className="p-4 text-sm" data-testid="seller-review-card">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{r.customerName}</span>
                    <Stars n={r.rating} />
                    <Badge tone={r.source === 'MARKET' ? 'sky' : 'mint'}>{r.source === 'MARKET' ? `Sàn · ${r.refCode}` : `Đơn ${r.refCode}`}</Badge>
                    {r.status === 'AN' && <Badge tone="slate">Sàn đã ẩn</Badge>}
                    {r.reportedAt && r.status === 'HIEN' && !r.moderatedAt && <Badge tone="peach">Chờ sàn xem báo cáo</Badge>}
                    <span className="ml-auto text-xs text-slate-400">{fmtDateTime(r.createdAt)}</span>
                  </div>
                  {r.items.length > 0 && <div className="mt-1 text-xs text-slate-500">Hạng mục: {r.items.join(', ')}</div>}
                  {r.comment ? <p className="mt-2 text-slate-700">“{r.comment}”</p> : <p className="mt-2 text-xs italic text-slate-400">Khách không để lại nhận xét</p>}
                  {r.reply && (
                    <div className="mt-2 rounded-xl bg-slate-50 p-2.5 text-slate-700">
                      <span className="font-medium text-slate-900">Trả lời của bạn:</span> {r.reply}
                    </div>
                  )}
                  {r.reportedReason && (
                    <p className="mt-2 text-xs text-slate-500">
                      Đã báo cáo sàn: {r.reportedReason}
                      {r.moderationNote && ` · Phản hồi sàn: ${r.moderationNote}`}
                    </p>
                  )}
                  {r.status === 'HIEN' && (
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      {r.source === 'MARKET' && (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setReportFor(r);
                            setReportReason(r.reportedReason ?? '');
                            setError(null);
                          }}
                          data-testid="open-report-review"
                        >
                          <Flag className="h-3.5 w-3.5" /> Báo cáo sàn
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => {
                          setReplyFor(r);
                          setReplyText(r.reply ?? '');
                          setError(null);
                        }}
                        data-testid="open-reply-review"
                      >
                        <MessageSquareReply className="h-3.5 w-3.5" /> {r.reply ? 'Sửa trả lời' : 'Trả lời'}
                      </Button>
                    </div>
                  )}
                </Card>
              ))}
              {!reviews.items.length && <Card className="p-10 text-center text-sm text-slate-500 lg:col-span-2">Chưa có đánh giá nào.</Card>}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <section className="space-y-3">
            <CardTitle>Phản ánh của khách gửi tới sàn</CardTitle>
            {!reports ? (
              <Spinner className="h-6 w-6 text-brand-600" />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2" data-testid="seller-report-list">
                {reports.items.map((rp) => {
                  const st = REPORT_STATUS[rp.status] ?? { label: rp.status, tone: 'slate' as const };
                  return (
                    <Card key={rp.id} className="p-4 text-sm space-y-2" data-testid="seller-report-card">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{rp.code}</span>
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {rp.requestCode && <Badge tone="sky">Yêu cầu {rp.requestCode}</Badge>}
                        <span className="ml-auto text-xs text-slate-400">{fmtDateTime(rp.createdAt)}</span>
                      </div>
                      <div className="text-xs text-slate-500">
                        Khách: <span className="font-medium text-slate-700">{rp.reporterName}</span> ({rp.reporterPhone}) · {REPORT_REASONS[rp.reason] ?? rp.reason}
                      </div>
                      <p className="text-slate-700">{rp.description}</p>
                      {rp.adminNote && (
                        <Alert tone="peach" className="text-xs">
                          <span className="font-semibold">Sàn yêu cầu giải trình:</span> {rp.adminNote}
                        </Alert>
                      )}
                      {rp.sellerExplanation && (
                        <div className="rounded-xl bg-slate-50 p-2.5 text-xs text-slate-700">
                          <span className="font-semibold">Giải trình đã gửi:</span> {rp.sellerExplanation}
                        </div>
                      )}
                      {rp.resolution && (
                        <Alert tone={rp.status === 'DA_XU_LY' ? 'rose' : 'mint'} className="text-xs">
                          <span className="font-semibold">Kết luận của sàn:</span> {rp.resolution}
                        </Alert>
                      )}
                      {rp.status === 'CHO_GIAI_TRINH' && (
                        <div className="flex justify-end pt-1">
                          <Button
                            onClick={() => {
                              setExplainFor(rp);
                              setExplainText(rp.sellerExplanation ?? '');
                              setError(null);
                            }}
                            data-testid="open-explain-dialog"
                          >
                            Gửi giải trình cho sàn
                          </Button>
                        </div>
                      )}
                    </Card>
                  );
                })}
                {!reports.items.length && <Card className="p-8 text-center text-sm text-slate-500 lg:col-span-2">Gian hàng chưa có phản ánh nào từ khách.</Card>}
              </div>
            )}
          </section>

          {reports && reports.violations.length > 0 && (
            <section className="space-y-3">
              <CardTitle className="flex items-center gap-2 text-rose-700">
                <ShieldAlert className="h-5 w-5" /> Lịch sử xử lý vi phạm từ sàn
              </CardTitle>
              <div className="space-y-2" data-testid="seller-violation-list">
                {reports.violations.map((v) => {
                  const act = VIOLATION_ACTION[v.action] ?? { label: v.action, tone: 'rose' as const };
                  return (
                    <Card key={v.id} className="p-4 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{v.code}</span>
                        <Badge tone={act.tone}>{act.label}</Badge>
                        {v.reportCode && <span className="text-xs text-slate-500">từ phản ánh {v.reportCode}</span>}
                        {v.offerName && <span className="text-xs text-slate-500">· Tin: {v.offerName}</span>}
                        <span className="ml-auto text-xs text-slate-400">{fmtDateTime(v.createdAt)}</span>
                      </div>
                      <p className="mt-1 text-slate-700">{v.reason}</p>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}

      <Dialog
        open={replyFor !== null}
        onClose={() => setReplyFor(null)}
        title={replyFor ? `Trả lời đánh giá của ${replyFor.customerName}` : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => setReplyFor(null)}>
              Huỷ
            </Button>
            <Button onClick={() => void saveReply()} disabled={replyText.trim().length < 2} data-testid="save-review-reply">
              Lưu trả lời
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          {error && <Alert>{error}</Alert>}
          <p className="text-xs text-slate-500">Câu trả lời sẽ hiển thị công khai dưới đánh giá của khách trên trang gian hàng.</p>
          <Field label="Nội dung trả lời">
            {(id) => (
              <textarea
                id={id}
                rows={3}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Cảm ơn anh/chị đã tin tưởng dịch vụ tại garage…"
                data-testid="reply-input"
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            )}
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={reportFor !== null}
        onClose={() => setReportFor(null)}
        title="Báo cáo đánh giá vi phạm lên sàn"
        footer={
          <>
            <Button variant="outline" onClick={() => setReportFor(null)}>
              Huỷ
            </Button>
            <Button onClick={() => void submitReportReview()} disabled={reportReason.trim().length < 5} data-testid="confirm-report-review">
              Gửi báo cáo
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          {error && <Alert>{error}</Alert>}
          <p className="text-xs text-slate-500">Chỉ báo cáo khi đánh giá có ngôn từ xúc phạm, quảng cáo rác hoặc cố tình bịa đặt. Bộ phận giám sát sàn sẽ kiểm tra.</p>
          <Field label="Lý do báo cáo" hint="Tối thiểu 5 ký tự">
            {(id) => (
              <Input
                id={id}
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                placeholder="VD: Ngôn từ xúc phạm, khách không sử dụng dịch vụ này…"
                data-testid="report-review-reason"
              />
            )}
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={explainFor !== null}
        onClose={() => setExplainFor(null)}
        title={explainFor ? `Giải trình phản ánh ${explainFor.code}` : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => setExplainFor(null)}>
              Huỷ
            </Button>
            <Button onClick={() => void submitExplanation()} disabled={explainText.trim().length < 5} data-testid="submit-explanation">
              Gửi giải trình
            </Button>
          </>
        }
      >
        {explainFor && (
          <div className="space-y-3 text-sm">
            {error && <Alert>{error}</Alert>}
            {explainFor.adminNote && <Alert tone="peach">Sàn yêu cầu: {explainFor.adminNote}</Alert>}
            <p className="text-xs text-slate-600">Nội dung khách phản ánh: “{explainFor.description}”</p>
            <Field label="Nội dung giải trình của garage" hint="Nêu rõ sự việc, thoả thuận với khách và phương án khắc phục">
              {(id) => (
                <textarea
                  id={id}
                  rows={4}
                  value={explainText}
                  onChange={(e) => setExplainText(e.target.value)}
                  data-testid="explain-input"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              )}
            </Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}
