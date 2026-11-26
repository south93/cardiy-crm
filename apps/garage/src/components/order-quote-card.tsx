'use client';

import { Alert, Badge, Button, Card, CardTitle, Input, Spinner, type Tone } from '@cardiy/ui';
import { Check, Send, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtMoney } from '@/lib/crm';
import { fmtDateTime } from '@/lib/orders';

export type QuoteStatus = 'CHO_DUYET' | 'DA_DUYET' | 'DUYET_MOT_PHAN' | 'TU_CHOI' | 'HET_HIEU_LUC';
export const QUOTE_STATUS: Record<QuoteStatus, { label: string; tone: Tone }> = {
  CHO_DUYET: { label: 'Chờ khách duyệt', tone: 'peach' },
  DA_DUYET: { label: 'Khách đã đồng ý', tone: 'mint' },
  DUYET_MOT_PHAN: { label: 'Khách đồng ý một phần', tone: 'sky' },
  TU_CHOI: { label: 'Khách từ chối', tone: 'rose' },
  HET_HIEU_LUC: { label: 'Báo giá cũ (đã sửa)', tone: 'slate' },
};
interface Quote {
  id: string;
  status: QuoteStatus;
  items: { itemId: string; name: string; quantity: number; amount: number }[];
  total: number;
  message: string | null;
  sentAt: string;
  respondedAt: string | null;
  approvedIds: string[];
  customerNote: string | null;
  applied: boolean;
}

/** Gửi hạng mục cho khách duyệt trên app chủ xe; xem câu trả lời của khách */
export function OrderQuoteCard({ orderId, editable, itemCount, version, onAnswered }: { orderId: string; editable: boolean; itemCount: number; version: string; onAnswered: () => void }) {
  const { can } = useAuth();
  const [data, setData] = useState<{ customerHasApp: boolean; quotes: Quote[] } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = useRef<string | null>(null);
  const load = useCallback(async () => {
    const d = await api<{ customerHasApp: boolean; quotes: Quote[] }>(`/orders/${orderId}/quotes`);
    setData(d);
    // Khách vừa trả lời → tải lại đơn (hạng mục bị từ chối đã được bỏ)
    const key = d.quotes[0] ? `${d.quotes[0].id}:${d.quotes[0].status}` : null;
    if (last.current && key !== last.current && d.quotes[0]?.respondedAt) onAnswered();
    last.current = key;
  }, [orderId, onAnswered]);
  useEffect(() => {
    void load();
  }, [load, version]);
  const q = data?.quotes[0];
  // Đang chờ khách: tự kiểm tra lại mỗi 20 giây
  useEffect(() => {
    if (q?.status !== 'CHO_DUYET') return;
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), 20_000);
    return () => clearInterval(t);
  }, [q?.status, load]);

  if (!data) return null;
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/orders/${orderId}/quotes`, { body: { message: message.trim() || null } });
      setMessage('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không gửi được báo giá');
    } finally {
      setBusy(false);
    }
  };
  const answered = q && q.respondedAt;
  return (
    <Card className="p-4 lg:p-5" data-testid="quote-card">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <CardTitle className="mr-auto">Khách duyệt báo giá</CardTitle>
        {q && (
          <span data-testid="quote-status">
            <Badge tone={QUOTE_STATUS[q.status].tone}>{QUOTE_STATUS[q.status].label}</Badge>
          </span>
        )}
      </div>
      {!data.customerHasApp && <p className="mb-2 text-sm text-amber-700">Khách chưa dùng app chủ xe: vào hồ sơ khách → “Mời dùng app” để khách duyệt trên điện thoại.</p>}
      {q && (
        <div className="space-y-2 text-sm">
          <p className="text-slate-500">
            Gửi lúc {fmtDateTime(q.sentAt)} · {fmtMoney(q.total)}
            {q.message && <span className="block text-slate-600">Lời nhắn: {q.message}</span>}
          </p>
          {answered && (
            <>
              <ul className="space-y-1" data-testid="quote-lines">
                {q.items.map((l) => {
                  const ok = q.approvedIds.includes(l.itemId);
                  return (
                    <li key={l.itemId} className={`flex items-center gap-2 ${ok ? '' : 'text-slate-400 line-through'}`}>
                      {ok ? <Check className="h-4 w-4 text-emerald-600" /> : <X className="h-4 w-4 text-rose-500" />}
                      <span className="flex-1">{l.name}</span>
                      <span className="tabular-nums">{fmtMoney(l.amount)}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-slate-500">Khách trả lời lúc {fmtDateTime(q.respondedAt)}</p>
              {q.customerNote && <p className="rounded-xl bg-slate-50 px-3 py-2">Khách ghi chú: {q.customerNote}</p>}
              {!q.applied && q.status !== 'DA_DUYET' && <Alert tone="peach">Đơn đã thu tiền nên chưa tự bỏ các hạng mục khách từ chối — cần sửa đơn / hoàn tiền thủ công.</Alert>}
            </>
          )}
        </div>
      )}
      {editable && can('ro.manage') && itemCount > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Lời nhắn cho khách (VD: má phanh mòn 80%)" className="min-w-0 flex-1" aria-label="Lời nhắn báo giá" />
          <Button variant={q?.status === 'CHO_DUYET' ? 'outline' : 'primary'} onClick={() => void send()} disabled={busy} data-testid="send-quote">
            {busy ? <Spinner /> : <Send className="h-4 w-4" />}
            {q?.status === 'CHO_DUYET' ? 'Gửi lại bản mới' : 'Gửi khách duyệt'}
          </Button>
        </div>
      )}
      {error && <Alert className="mt-2">{error}</Alert>}
    </Card>
  );
}
