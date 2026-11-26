'use client';

import { useEffect, useRef } from 'react';
import { marketPost } from '@/lib/market-client';

/** Ghi nhận lượt xem gian hàng hoặc tin đăng từ trình duyệt thật (không đếm prefetch / bot SSR) */
export function ViewTracker({ tenantId, offerIds }: { tenantId?: string; offerIds?: string[] }) {
  const sent = useRef(false);
  const key = `${tenantId ?? ''}|${(offerIds ?? []).join(',')}`;
  useEffect(() => {
    if (sent.current) return;
    if (!tenantId && !(offerIds && offerIds.length)) return;
    sent.current = true;
    void marketPost('/views', {
      ...(tenantId ? { tenantId } : {}),
      ...(offerIds?.length ? { offerIds } : {}),
    }).catch(() => undefined);
  }, [key, tenantId, offerIds]);
  return null;
}
