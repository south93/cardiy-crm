'use client';

import { RequirePermission } from '@/components/require-permission';
import { VoucherManager } from '@/components/voucher-manager';

/** A7.13 Voucher của đối tác */
export default function Page() {
  return (
    <RequirePermission permission="partner.promotion.manage">
      <VoucherManager />
    </RequirePermission>
  );
}
