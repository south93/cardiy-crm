'use client';

import { Alert, Badge, Button, Card, Dialog, Field, Input, Spinner, Tabs } from '@cardiy/ui';
import { useCallback, useEffect, useState } from 'react';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/orders';
import { fmtMoney } from '@/lib/crm';
import { OFFER_STATUS, type Offer, type OfferStatus } from '@/lib/marketplace';

function Moderation() {
  const [status, setStatus] = useState<OfferStatus>('CHO_DUYET');
  const [data, setData] = useState<{ counts: Record<string, number>; items: Offer[] } | null>(null);
  const [act, setAct] = useState<{ o: Offer; to: 'reject' | 'takedown' } | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<NonNullable<typeof data>>(`/platform/offers?status=${status}`).then(setData), [status]);
  useEffect(() => void load(), [load]);

  const approve = async (o: Offer) => {
    await api(`/platform/offers/${o.id}/approve`, { method: 'POST' });
    await load();
  };
  const confirm = async () => {
    if (!act) return;
    try {
      await api(`/platform/offers/${act.o.id}/${act.to}`, { body: { note } });
      setAct(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : 'Không thực hiện được');
    }
  };

  return (
    <div className="space-y-4">
      <Tabs
        tabs={(['CHO_DUYET', 'DANG_BAN', 'BI_TU_CHOI', 'BI_GO'] as OfferStatus[]).map((s) => ({ value: s, label: `${OFFER_STATUS[s].label}${data?.counts[s] ? ` (${data.counts[s]})` : ''}` }))}
        value={status}
        onChange={setStatus}
      />
      {!data ? (
        <div className="grid place-items-center p-10">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2" data-testid="moderation-list">
          {data.items.map((o) => (
            <Card key={o.id} className="p-4" data-testid="moderation-card">
              <div className="flex gap-3">
                <div className="flex shrink-0 gap-1">
                  {o.images.slice(0, 2).map((img) =>
                    img.url ? (
                      <a key={img.id} href={img.url} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img.url} alt="" className="h-20 w-20 rounded-xl object-cover" />
                      </a>
                    ) : null,
                  )}
                  {!o.images.length && <span className="grid h-20 w-20 place-items-center rounded-xl bg-slate-100 text-xs text-slate-400">Không ảnh</span>}
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{o.catalogItem.name}</span>
                    <Badge tone={OFFER_STATUS[o.status].tone}>{OFFER_STATUS[o.status].label}</Badge>
                  </div>
                  <div className="text-xs text-slate-500">
                    {o.catalogItem.code} · {o.kind === 'PRODUCT' ? 'Sản phẩm' : 'Dịch vụ'} · {o.seller}
                  </div>
                  <div className="mt-1">
                    <span className="font-semibold tabular-nums">
                      {o.priceFrom && 'Từ '}
                      {fmtMoney(o.price)}
                    </span>
                    {o.listPrice && <span className="ml-2 text-xs text-slate-400 line-through">{fmtMoney(o.listPrice)}</span>}
                    {o.stock !== null && <span className="ml-2 text-xs text-slate-500">· còn {o.stock}</span>}
                    {o.installIncluded && <span className="ml-2 text-xs text-slate-500">· gồm lắp đặt</span>}
                  </div>
                  {o.note && <p className="mt-1 line-clamp-3 text-slate-600">{o.note}</p>}
                  {o.reviewNote && <p className="mt-1 text-xs text-rose-600">Ghi chú: {o.reviewNote}</p>}
                  <div className="mt-1 text-xs text-slate-400">Gửi {fmtDateTime(o.submittedAt)}</div>
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                {o.status === 'CHO_DUYET' && (
                  <>
                    <Button variant="outline" onClick={() => (setAct({ o, to: 'reject' }), setNote(''), setError(null))}>
                      Từ chối
                    </Button>
                    <Button onClick={() => void approve(o)} data-testid="approve-offer">
                      Duyệt
                    </Button>
                  </>
                )}
                {(o.status === 'DANG_BAN' || o.status === 'TAM_AN') && (
                  <Button variant="outline" onClick={() => (setAct({ o, to: 'takedown' }), setNote(''), setError(null))}>
                    Gỡ tin
                  </Button>
                )}
              </div>
            </Card>
          ))}
          {!data.items.length && <Card className="p-10 text-center text-sm text-slate-500 lg:col-span-2">Không có tin nào.</Card>}
        </div>
      )}
      <Dialog
        open={act !== null}
        onClose={() => setAct(null)}
        title={act ? `${act.to === 'reject' ? 'Từ chối' : 'Gỡ'} tin: ${act.o.catalogItem.name}` : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => setAct(null)}>
              Huỷ
            </Button>
            <Button onClick={() => void confirm()} disabled={note.trim().length < 3} data-testid="confirm-moderation">
              Xác nhận
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <Alert>{error}</Alert>}
          {act?.to === 'takedown' && <Alert>Tin bị gỡ không hiện lại được; garage cần đăng tin mới.</Alert>}
          <Field label="Lý do (garage sẽ thấy)">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} autoFocus data-testid="moderation-note" />}</Field>
        </div>
      </Dialog>
    </div>
  );
}

/** A6.30 Kiểm duyệt tin đăng sản phẩm / dịch vụ của đối tác */
export default function OfferModerationPage() {
  return (
    <RequirePermission permission="platform.partner.review">
      <Moderation />
    </RequirePermission>
  );
}
