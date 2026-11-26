'use client';

import { Alert, Badge, Button, Dialog, Field, Input, Select, Spinner } from '@cardiy/ui';
import { Copy, Flag, Star } from 'lucide-react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { mapHref, money, zaloHref } from '@/lib/market';
import { marketGet, marketPost, REPORT_REASONS, REPORT_STATUS, REQ_STATUS } from '@/lib/market-client';

interface TrackedReview {
  id: string;
  rating: number;
  comment: string | null;
  reply: string | null;
  repliedAt: string | null;
  status: 'HIEN' | 'AN';
  createdAt: string;
}

interface TrackedReport {
  id: string;
  code: string;
  reason: string;
  description: string;
  status: string;
  adminNote: string | null;
  sellerExplanation: string | null;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

interface Tracked {
  id: string;
  code: string;
  status: string;
  customerName: string;
  phone: string;
  plateNo: string | null;
  note: string | null;
  scheduledAt: string;
  voucherCode: string | null;
  subtotal: number;
  discount: number;
  estimatedTotal: number;
  finalTotal: number | null;
  sellerNote: string | null;
  expiresAt: string;
  createdAt: string;
  items: { name: string; quantity: number; amount: number; kind: string }[];
  shop: { name: string; slug: string; phone: string | null; address: string | null; lat: number | null; lng: number | null } | null;
  review: TrackedReview | null;
  reports: TrackedReport[];
}

function ReviewBox({
  requestId,
  token,
  review,
  onSaved,
}: {
  requestId: string;
  token: string;
  review: TrackedReview | null;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(!review);
  const [rating, setRating] = useState(review?.rating ?? 5);
  const [comment, setComment] = useState(review?.comment ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEditing(!review);
    setRating(review?.rating ?? 5);
    setComment(review?.comment ?? '');
  }, [review]);

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      await marketPost(`/requests/${requestId}/review?t=${encodeURIComponent(token)}`, {
        rating,
        comment: comment.trim() || null,
      });
      await onSaved();
      setEditing(false);
    } catch (e) {
      setError(e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : 'Không gửi được đánh giá');
    } finally {
      setSaving(false);
    }
  };

  if (review?.status === 'AN') {
    return (
      <div className="rounded-2xl border border-slate-200/70 bg-white p-5 text-sm" data-testid="customer-review-box">
        <h2 className="font-semibold">Đánh giá dịch vụ</h2>
        <Alert tone="peach" className="mt-2">
          Đánh giá của bạn đã bị ẩn do vi phạm quy định cộng đồng của sàn.
        </Alert>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-5 text-sm" data-testid="customer-review-box">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Đánh giá trải nghiệm tại garage</h2>
        {review && !editing && !review.reply && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs font-medium text-brand-700 hover:underline"
            data-testid="edit-review"
          >
            Sửa đánh giá
          </button>
        )}
      </div>

      {review && !editing ? (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-1" aria-label={`Đã đánh giá ${review.rating} sao`}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Star key={i} className={`h-4 w-4 ${i <= review.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
            ))}
            <span className="ml-1 text-xs text-emerald-700 font-medium">Đã gửi đánh giá</span>
          </div>
          {review.comment && <p className="text-slate-700">“{review.comment}”</p>}
          {review.reply && (
            <div className="rounded-xl bg-slate-50 p-3 text-slate-700" data-testid="seller-reply">
              <span className="font-medium text-slate-900">Garage trả lời:</span> {review.reply}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {error && <Alert>{error}</Alert>}
          <div>
            <div className="mb-1 text-xs text-slate-500">Mức độ hài lòng</div>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  aria-label={`Chọn ${n} sao`}
                  data-testid={`star-${n}`}
                  className="rounded-lg p-1 hover:bg-amber-50"
                >
                  <Star className={`h-6 w-6 ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
                </button>
              ))}
              <span className="ml-2 text-xs font-medium text-slate-600">{rating} / 5 sao</span>
            </div>
          </div>
          <Field label="Nhận xét (không bắt buộc)">
            {(id) => (
              <Input
                id={id}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Chất lượng sản phẩm, tay nghề kỹ thuật, giá thực tế…"
                data-testid="review-comment"
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void submit()} disabled={saving} data-testid="submit-review">
              {review ? 'Cập nhật đánh giá' : 'Gửi đánh giá'}
            </Button>
            {review && (
              <Button variant="outline" onClick={() => setEditing(false)}>
                Huỷ
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ReportSection({
  requestId,
  token,
  reports,
  onSubmitted,
}: {
  requestId: string;
  token: string;
  reports: TrackedReport[];
  onSubmitted: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('SAI_GIA');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const hasOpen = reports.some((x) => ['MOI', 'CHO_GIAI_TRINH', 'DA_GIAI_TRINH'].includes(x.status));

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await marketPost(`/requests/${requestId}/reports?t=${encodeURIComponent(token)}`, {
        reason,
        description,
      });
      setOpen(false);
      setDescription('');
      await onSubmitted();
    } catch (e) {
      setError(e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : 'Không gửi được phản ánh');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-5 text-sm space-y-3" data-testid="customer-report-box">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Phản ánh với sàn CARDIY</h2>
          <p className="text-xs text-slate-500">Nếu garage thu sai giá chốt, hàng không đúng mô tả hoặc vi phạm cam kết, sàn sẽ tiếp nhận và xử lý.</p>
        </div>
        {!hasOpen && (
          <Button
            variant="outline"
            onClick={() => {
              setError(null);
              setOpen(true);
            }}
            data-testid="open-report-dialog"
          >
            <Flag className="h-4 w-4 text-rose-600" /> Gửi phản ánh
          </Button>
        )}
      </div>

      {reports.length > 0 && (
        <div className="space-y-2.5 pt-1" data-testid="tracked-reports">
          {reports.map((rp) => {
            const st = REPORT_STATUS[rp.status] ?? { label: rp.status, tone: 'slate' as const };
            return (
              <div key={rp.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{rp.code}</span>
                  <Badge tone={st.tone}>{st.label}</Badge>
                  <span className="text-xs text-slate-500">{REPORT_REASONS[rp.reason] ?? rp.reason}</span>
                </div>
                <p className="text-slate-700">{rp.description}</p>
                {rp.sellerExplanation && (
                  <p className="rounded-lg bg-white px-2.5 py-1.5 text-xs text-slate-600">
                    <span className="font-medium text-slate-800">Giải trình từ garage:</span> {rp.sellerExplanation}
                  </p>
                )}
                {rp.resolution && (
                  <div data-testid="report-resolution">
                    <Alert tone={rp.status === 'DA_XU_LY' ? 'mint' : 'sky'} className="text-xs">
                      <span className="font-semibold">Kết luận của sàn:</span> {rp.resolution}
                    </Alert>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Gửi phản ánh tới sàn CARDIY"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Huỷ
            </Button>
            <Button onClick={() => void submit()} disabled={submitting || description.trim().length < 10} data-testid="submit-report">
              Gửi phản ánh
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          {error && <Alert>{error}</Alert>}
          <Field label="Vấn đề gặp phải">
            {(id) => (
              <Select id={id} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="report-reason">
                {Object.entries(REPORT_REASONS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Mô tả chi tiết sự việc" hint="Tối thiểu 10 ký tự">
            {(id) => (
              <textarea
                id={id}
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Nêu rõ giá thoả thuận, tình trạng thực tế khi đến garage…"
                data-testid="report-description"
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            )}
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

function Track() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const t = sp.get('t') ?? '';
  const [r, setR] = useState<Tracked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () => marketGet<Tracked>(`/requests/${id}?t=${encodeURIComponent(t)}`).then(setR, (e) => setError(e instanceof ApiError ? e.message : 'Không tải được')),
    [id, t],
  );
  useEffect(() => void load(), [load]);
  if (error) return <Alert>{error}</Alert>;
  if (!r)
    return (
      <div className="grid place-items-center p-16">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  const st = REQ_STATUS[r.status] ?? { label: r.status, tone: 'slate' as const };
  const when = new Date(r.scheduledAt).toLocaleString('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
  const cancel = async () => {
    if (!confirm('Huỷ yêu cầu này?')) return;
    await marketPost(`/requests/${id}/cancel?t=${encodeURIComponent(t)}`).catch(() => undefined);
    await load();
  };
  const link = typeof window !== 'undefined' ? window.location.href.replace(/&moi=1/, '') : '';
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {sp.get('moi') && (
        <Alert tone="mint">
          <div className="font-semibold">Đã gửi yêu cầu {r.code} tới garage.</div>
          Garage sẽ gọi lại xác nhận trong 24 giờ. Lưu link trang này để xem trạng thái hoặc huỷ.
          <button type="button" onClick={() => void navigator.clipboard?.writeText(link)} className="ml-2 inline-flex items-center gap-1 font-medium underline">
            <Copy className="h-3.5 w-3.5" /> Sao chép link
          </button>
        </Alert>
      )}
      <div className="rounded-2xl border border-slate-200/70 bg-white p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold">Yêu cầu {r.code}</h1>
          <span data-testid="request-status">
            <Badge tone={st.tone}>{st.label}</Badge>
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Hẹn: <span className="font-medium">{when}</span>
        </p>
        {r.sellerNote && (
          <Alert tone={r.status === 'TU_CHOI' ? 'rose' : 'sky'} className="mt-3">
            Garage: {r.sellerNote}
          </Alert>
        )}
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {r.items.map((i, k) => (
            <li key={k} className="flex justify-between py-2">
              <span>
                {i.name} {i.kind === 'PRODUCT' && `× ${i.quantity}`}
              </span>
              <span>{money(i.amount)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-2 space-y-1 text-sm">
          {r.discount > 0 && (
            <div className="flex justify-between text-emerald-700">
              <dt>Voucher {r.voucherCode}</dt>
              <dd>−{money(r.discount)}</dd>
            </div>
          )}
          <div className="flex justify-between font-bold">
            <dt>{r.finalTotal !== null ? 'Giá garage chốt' : 'Tạm tính'}</dt>
            <dd data-testid="tracked-total">{money(r.finalTotal ?? r.estimatedTotal)}</dd>
          </div>
        </dl>
      </div>
      {r.shop && (
        <div className="rounded-2xl border border-slate-200/70 bg-white p-5 text-sm">
          <Link href={`/cho/garage/${r.shop.slug}`} className="font-semibold text-brand-700">
            {r.shop.name}
          </Link>
          {r.shop.address && <p className="text-slate-600">{r.shop.address}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {r.shop.phone && (
              <a href={`tel:${r.shop.phone}`} className="rounded-full border border-slate-200 px-4 py-2 font-medium">
                Gọi garage
              </a>
            )}
            {r.shop.phone && (
              <a href={zaloHref(r.shop.phone)} target="_blank" rel="noreferrer" className="rounded-full border border-slate-200 px-4 py-2 font-medium">
                Zalo
              </a>
            )}
            <a href={mapHref({ ...r.shop })} target="_blank" rel="noreferrer" className="rounded-full border border-slate-200 px-4 py-2 font-medium">
              Chỉ đường
            </a>
          </div>
          <p className="mt-2 text-xs text-slate-500">Thanh toán trực tiếp cho garage. Sàn CARDIY không thu tiền.</p>
        </div>
      )}
      {r.status === 'HOAN_THANH' && <ReviewBox requestId={r.id} token={t} review={r.review ?? null} onSaved={load} />}
      {(r.status === 'CHO_XAC_NHAN' || r.status === 'DA_XAC_NHAN') && (
        <Button variant="outline" onClick={() => void cancel()} data-testid="cancel-request">
          Huỷ yêu cầu
        </Button>
      )}
      <ReportSection requestId={r.id} token={t} reports={r.reports ?? []} onSubmitted={load} />
    </div>
  );
}

/** Theo dõi yêu cầu qua link (mã bí mật) — không cần đăng nhập: xem trạng thái, đánh giá sau khi mua, gửi phản ánh */
export default function TrackPage() {
  return (
    <Suspense>
      <Track />
    </Suspense>
  );
}
