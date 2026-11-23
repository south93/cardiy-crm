'use client';

import { Alert, Badge, Button, Card, CardTitle, Dialog } from '@cardiy/ui';
import { Copy, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/crm';

interface AppStatus {
  canInvite: boolean;
  linked: { since: string; lastLoginAt: string | null } | null;
  invite: { createdAt: string; expiresAt: string } | null;
}

/** Hồ sơ khách: mời khách dùng app chủ xe (link + QR gửi Zalo / cho quét tại quầy) */
export function CustomerAppCard({ customerId, hasPhone }: { customerId: string; hasPhone: boolean }) {
  const { can } = useAuth();
  const [st, setSt] = useState<AppStatus | null>(null);
  const [inv, setInv] = useState<{ url: string; qrDataUrl: string; expiresAt: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const load = useCallback(() => api<AppStatus>(`/customers/${customerId}/app`).then(setSt), [customerId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function invite() {
    setErr(null);
    try {
      setInv(await api(`/customers/${customerId}/app/invite`, { body: {} }));
      setCopied(false);
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Không tạo được link mời');
    }
  }
  async function unlink() {
    if (!confirm('Gỡ liên kết app? Khách sẽ không xem được xe của hồ sơ này nữa.')) return;
    await api(`/customers/${customerId}/app/unlink`, { body: {} });
    await load();
  }
  const manage = can('customer.manage');
  if (!st) return null;
  return (
    <Card className="p-4 lg:p-5" data-testid="customer-app">
      <CardTitle className="mb-2 flex items-center gap-2">
        <Smartphone className="h-4 w-4" /> App chủ xe
      </CardTitle>
      {st.linked ? (
        <div className="space-y-2 text-sm">
          <Badge tone="mint">Đã kích hoạt {fmtDate(st.linked.since)}</Badge>
          <p className="text-slate-500">{st.linked.lastLoginAt ? `Lần vào app gần nhất: ${fmtDate(st.linked.lastLoginAt)}` : 'Chưa vào app lần nào'}</p>
          {manage && (
            <button type="button" onClick={unlink} className="text-xs text-rose-600 hover:underline">
              Gỡ liên kết
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="text-slate-600">Khách xem xe, lịch sử sửa chữa và đơn đang làm trên điện thoại.</p>
          {st.invite && <p className="text-xs text-slate-500">Đã gửi link mời, hết hạn {fmtDate(st.invite.expiresAt)}</p>}
          {!hasPhone && <p className="text-xs text-amber-700">Cần có số điện thoại của khách để mời.</p>}
          {manage && hasPhone && (
            <Button variant="outline" onClick={invite} data-testid="app-invite">
              {st.invite ? 'Tạo link mới' : 'Mời dùng app'}
            </Button>
          )}
          {err && <Alert>{err}</Alert>}
        </div>
      )}
      <Dialog open={!!inv} onClose={() => setInv(null)} title="Mời khách dùng app">
        {inv && (
          <div className="space-y-3 text-center text-sm" data-testid="invite-dialog">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={inv.qrDataUrl} alt="Mã QR kích hoạt app" className="mx-auto h-56 w-56" />
            <p className="text-slate-600">Cho khách quét mã, hoặc gửi link qua Zalo. Link dùng một lần, hết hạn {fmtDate(inv.expiresAt)}.</p>
            <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-2 text-left">
              <code className="min-w-0 flex-1 truncate text-xs" data-testid="invite-url">
                {inv.url}
              </code>
              <Button
                variant="outline"
                className="shrink-0"
                onClick={async () => {
                  const text = `Garage gửi bạn link xem xe và lịch sử sửa chữa: ${inv.url}`;
                  await navigator.clipboard?.writeText(text).catch(() => null);
                  setCopied(true);
                }}
              >
                <Copy className="h-4 w-4" /> {copied ? 'Đã chép' : 'Chép tin nhắn'}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </Card>
  );
}
