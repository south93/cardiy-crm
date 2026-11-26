'use client';

import { Alert, Badge, Button, Card, Spinner } from '@cardiy/ui';
import { ArrowLeft, Award, Bell, CheckCheck, Megaphone } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import type { OwnerNotificationItem } from '@/lib/marketing';
import { fmtDateTime } from '@/lib/orders';
import { ownerApi } from '@/lib/owner';

/** A2.12 Hộp thư thông báo trên App chủ xe (/app/thong-bao) */
export default function OwnerNotificationsPage() {
  const [data, setData] = useState<{ unreadCount: number; items: OwnerNotificationItem[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await ownerApi<{ unreadCount: number; items: OwnerNotificationItem[] }>('/notifications');
      setData(res);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được thông báo');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markAllRead() {
    setBusy(true);
    try {
      await ownerApi('/notifications/read-all', { body: {} });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Thao tác thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="owner-notifications-page">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link href="/app" className="text-slate-500 hover:text-brand-700">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-xl font-semibold">Thông báo của tôi</h1>
        </div>
        {data && data.unreadCount > 0 && (
          <Button variant="outline" onClick={markAllRead} disabled={busy} data-testid="owner-mark-read-btn">
            <CheckCheck className="h-4 w-4" /> Đã đọc hết
          </Button>
        )}
      </div>

      {error && <Alert>{error}</Alert>}

      {!data ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : !data.items.length ? (
        <Card className="p-8 text-center text-sm text-slate-500">
          <Bell className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          Chưa có thông báo nào.
        </Card>
      ) : (
        <ul className="space-y-2.5" data-testid="owner-notifications-list">
          {data.items.map((n) => (
            <li key={n.id}>
              <Card
                className={`space-y-1.5 p-4 ${!n.readAt ? 'border-brand-300 bg-brand-50/30' : ''}`}
                data-testid="owner-notification-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {n.kind === 'LOYALTY' ? (
                      <Badge tone="peach">
                        <Award className="h-3 w-3" /> Điểm thưởng
                      </Badge>
                    ) : (
                      <Badge tone="sky">
                        <Megaphone className="h-3 w-3" /> Ưu đãi & Chăm sóc
                      </Badge>
                    )}
                    {!n.readAt && <span className="h-2 w-2 rounded-full bg-brand-600" aria-label="Chưa đọc" />}
                  </div>
                  <span className="text-xs text-slate-400">{fmtDateTime(n.createdAt)}</span>
                </div>
                <div className="font-semibold text-slate-900">{n.title}</div>
                <p className="whitespace-pre-line text-sm text-slate-600">{n.body}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
