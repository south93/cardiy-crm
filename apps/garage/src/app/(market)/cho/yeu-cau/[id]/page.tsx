'use client';

import { Alert, Badge, Button, Spinner } from '@cardiy/ui';
import { Copy } from 'lucide-react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { mapHref, money, zaloHref } from '@/lib/market';
import { marketGet, marketPost, REQ_STATUS } from '@/lib/market-client';

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
}

function Track() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const t = sp.get('t') ?? '';
  const [r, setR] = useState<Tracked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => marketGet<Tracked>(`/requests/${id}?t=${encodeURIComponent(t)}`).then(setR, (e) => setError(e instanceof ApiError ? e.message : 'Không tải được')), [id, t]);
  useEffect(() => void load(), [load]);
  if (error) return <Alert>{error}</Alert>;
  if (!r)
    return (
      <div className="grid place-items-center p-16">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  const st = REQ_STATUS[r.status] ?? { label: r.status, tone: 'slate' as const };
  const when = new Date(r.scheduledAt).toLocaleString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
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
      {(r.status === 'CHO_XAC_NHAN' || r.status === 'DA_XAC_NHAN') && (
        <Button variant="outline" onClick={() => void cancel()} data-testid="cancel-request">
          Huỷ yêu cầu
        </Button>
      )}
    </div>
  );
}

/** Theo dõi yêu cầu qua link (mã bí mật) — không cần đăng nhập */
export default function TrackPage() {
  return (
    <Suspense>
      <Track />
    </Suspense>
  );
}
