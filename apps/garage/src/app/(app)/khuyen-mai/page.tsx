'use client';

import { RequirePermission } from '@/components/require-permission';
import { VoucherManager } from '@/components/voucher-manager';

/** A3.52 Voucher của PLG trên sàn */
export default function Page() {
  return (
    <RequirePermission permission="promotion.manage">
      <VoucherManager />
    </RequirePermission>
  );
}
