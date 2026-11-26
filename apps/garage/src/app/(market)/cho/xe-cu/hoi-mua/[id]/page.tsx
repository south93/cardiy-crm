'use client';

import { Alert, Badge, Button, Card, Input, Spinner } from '@cardiy/ui';
import { ArrowLeft, CalendarCheck2, Send, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/orders';
import { fmtCarPrice, publicUsedCarGet, publicUsedCarPost, VIEWING_STATUS_UI, type UsedCarThreadItem } from '@/lib/used-cars';

export default function PublicUsedCarInquiryPage() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const token = sp.get('t') ?? '';

  const [thread, setThread] = useState<UsedCarThreadItem | null>(null);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setError('Thiếu mã theo dõi cuộc trò chuyện.');
      return;
    }
    try {
      const res = await publicUsedCarGet<UsedCarThreadItem>(`/inquiries/${id}?token=${encodeURIComponent(token)}`);
      setThread(res);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được cuộc trò chuyện');
    }
  }, [id, token]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 12_000);
    return () => clearInterval(timer);
  }, [load]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setBusy(true);
    try {
      const upd = await publicUsedCarPost<UsedCarThreadItem>(`/inquiries/${id}/messages`, {
        token,
        content,
      });
      setThread(upd);
      setContent('');
    } catch (ex) {
      setError(ex instanceof ApiError ? ex.message : 'Gửi tin nhắn thất bại');
    } finally {
      setBusy(false);
    }
  }

  if (error && !thread) return <Alert>{error}</Alert>;
  if (!thread) return <Spinner className="h-6 w-6 text-brand-600" />;

  const vst = VIEWING_STATUS_UI[thread.viewingStatus] ?? VIEWING_STATUS_UI.NONE;

  return (
    <div className="mx-auto max-w-2xl space-y-4" data-testid="public-used-car-thread">
      <Link href={`/cho/xe-cu/${thread.listing.id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Xem lại tin đăng xe
      </Link>

      <Card className="p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-slate-500">{thread.listing.code}</span>
              {thread.listing.hasVerifiedBadge && (
                <Badge tone="mint">
                  <ShieldCheck className="h-3 w-3" /> Đã kiểm định
                </Badge>
              )}
            </div>
            <h1 className="mt-1 text-lg font-bold text-slate-900">{thread.listing.title}</h1>
            <div className="text-sm text-slate-600">
              Giá: <b className="text-emerald-700">{fmtCarPrice(thread.listing.price)}</b> · Người bán: {thread.listing.contactName} ({thread.listing.contactPhone})
            </div>
          </div>

          <div data-testid="used-car-viewing-status">
            <Badge tone={vst.tone}>{vst.label}</Badge>
          </div>
        </div>

        {thread.viewingAt && (
          <div className="flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-2.5 text-sm text-slate-700">
            <CalendarCheck2 className="h-4 w-4 text-brand-600" />
            <span>
              Lịch hẹn xem xe: <b>{fmtDateTime(thread.viewingAt)}</b>
            </span>
          </div>
        )}
      </Card>

      {error && <Alert>{error}</Alert>}

      <Card className="p-5 space-y-4">
        <div className="max-h-96 space-y-2.5 overflow-y-auto" data-testid="public-thread-messages">
          {thread.messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-2xl px-4 py-2.5 text-sm ${m.senderRole === 'BUYER' ? 'ml-8 bg-brand-600 text-white' : 'mr-8 bg-slate-100 text-slate-800'}`}
            >
              <div className={`text-xs font-medium ${m.senderRole === 'BUYER' ? 'text-brand-100' : 'text-slate-500'}`}>
                {m.senderName} · {fmtDateTime(m.createdAt)}
              </div>
              <div className="mt-0.5">{m.content}</div>
            </div>
          ))}
        </div>

        <form onSubmit={send} className="flex gap-2 border-t border-slate-100 pt-3">
          <Input value={content} onChange={(e) => setContent(e.target.value)} placeholder="Nhắn thêm cho người bán…" aria-label="Tin nhắn" />
          <Button type="submit" disabled={busy} data-testid="public-thread-send">
            <Send className="h-4 w-4" /> Gửi
          </Button>
        </form>
      </Card>
    </div>
  );
}
