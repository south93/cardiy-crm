'use client';

import { Alert, Button, Card, CardTitle, Input } from '@cardiy/ui';
import { Star } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime } from '@/lib/orders';

export interface Review {
  rating: number;
  comment: string | null;
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
}

export const Stars = ({ n, className = 'h-4 w-4' }: { n: number; className?: string }) => (
  <span className="inline-flex" aria-label={`${n} sao`}>
    {[1, 2, 3, 4, 5].map((i) => (
      <Star key={i} className={`${className} ${i <= n ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
    ))}
  </span>
);

/** Đánh giá của khách trên app; garage trả lời */
export function OrderReviewCard({ orderId, review, onSaved }: { orderId: string; review: Review; onSaved: () => void }) {
  const { can } = useAuth();
  const [reply, setReply] = useState(review.reply ?? '');
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="p-4 lg:p-5" data-testid="review-card">
      <div className="flex items-center gap-2">
        <CardTitle className="mr-auto">Khách đánh giá</CardTitle>
        <Stars n={review.rating} />
      </div>
      <p className="mt-1 text-xs text-slate-500">{fmtDateTime(review.createdAt)}</p>
      {review.comment && <p className="mt-2 text-sm">“{review.comment}”</p>}
      {review.reply && <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">Garage trả lời: {review.reply}</p>}
      {can('ro.manage') && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Trả lời khách (khách thấy trên app)" className="min-w-0 flex-1" aria-label="Trả lời đánh giá" />
          <Button
            variant="outline"
            disabled={reply.trim().length < 2}
            onClick={async () => {
              setError(null);
              try {
                await api(`/orders/${orderId}/review/reply`, { body: { reply } });
                onSaved();
              } catch (e) {
                setError(e instanceof ApiError ? e.message : 'Không lưu được');
              }
            }}
            data-testid="save-reply"
          >
            {review.reply ? 'Sửa trả lời' : 'Trả lời'}
          </Button>
        </div>
      )}
      {error && <Alert className="mt-2">{error}</Alert>}
    </Card>
  );
}
