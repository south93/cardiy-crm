'use client';

import { Alert, Badge, Button, Card, Input, Spinner } from '@cardiy/ui';
import { ArrowLeft, Send } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/orders';
import { ownerApi } from '@/lib/owner';
import { fmtCarPrice, VIEWING_STATUS_UI, type UsedCarThreadItem } from '@/lib/used-cars';

export default function OwnerUsedCarThreadPage() {
  const { id } = useParams<{ id: string }>();
  const [thread, setThread] = useState<UsedCarThreadItem | null>(null);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await ownerApi<UsedCarThreadItem>(`/used-cars/threads/${id}`);
      setThread(res);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được cuộc trò chuyện');
    }
  }, [id]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 12_000);
    return () => clearInterval(t);
  }, [load]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setBusy(true);
    try {
      const upd = await ownerApi<UsedCarThreadItem>(`/used-cars/threads/${id}/messages`, { body: { content } });
      setThread(upd);
      setContent('');
    } catch (ex) {
      setError(ex instanceof ApiError ? ex.message : 'Gửi thất bại');
    } finally {
      setBusy(false);
    }
  }

  if (error && !thread) return <Alert>{error}</Alert>;
  if (!thread) return <Spinner className="h-6 w-6 text-brand-600" />;

  const vst = VIEWING_STATUS_UI[thread.viewingStatus] ?? VIEWING_STATUS_UI.NONE;

  return (
    <div className="space-y-4">
      <Link href="/app/xe-cu" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Quay lại Xe cũ
      </Link>

      <Card className="p-4 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-bold text-slate-900">{thread.listing.title}</div>
            <div className="text-xs text-emerald-700 font-semibold">{fmtCarPrice(thread.listing.price)}</div>
            {thread.viewingAt && <div className="text-xs text-slate-600">Giờ hẹn xem: {fmtDateTime(thread.viewingAt)}</div>}
          </div>
          <Badge tone={vst.tone}>{vst.label}</Badge>
        </div>

        {thread.myRole === 'SELLER' && thread.viewingStatus === 'CHO_XAC_NHAN' && (
          <div className="flex gap-2 pt-1">
            <Button
              onClick={async () => {
                setThread(await ownerApi<UsedCarThreadItem>(`/used-cars/threads/${id}/viewing`, { body: { status: 'DA_XAC_NHAN' } }));
              }}
              data-testid="owner-confirm-viewing"
            >
              Xác nhận lịch xem xe
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                setThread(await ownerApi<UsedCarThreadItem>(`/used-cars/threads/${id}/viewing`, { body: { status: 'TU_CHOI' } }));
              }}
            >
              Từ chối
            </Button>
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="max-h-80 space-y-2 overflow-y-auto" data-testid="owner-thread-messages">
          {thread.messages.map((m) => {
            const mine = m.senderRole === thread.myRole;
            return (
              <div
                key={m.id}
                className={`rounded-2xl px-3.5 py-2 text-sm ${mine ? 'ml-6 bg-brand-600 text-white' : 'mr-6 bg-slate-100 text-slate-800'}`}
              >
                <div className={`text-xs ${mine ? 'text-brand-100' : 'text-slate-500'}`}>
                  {m.senderName} · {fmtDateTime(m.createdAt)}
                </div>
                <div>{m.content}</div>
              </div>
            );
          })}
        </div>

        <form onSubmit={send} className="flex gap-2 border-t border-slate-100 pt-2">
          <Input value={content} onChange={(e) => setContent(e.target.value)} placeholder="Nhập tin nhắn…" />
          <Button type="submit" disabled={busy}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </Card>
    </div>
  );
}
