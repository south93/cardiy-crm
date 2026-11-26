'use client';

import { RequirePermission } from '@/components/require-permission';
import { SellerRequests } from '@/components/seller-requests';

/** A3.51 Yêu cầu từ sàn gửi tới PLG */
export default function Page() {
  return (
    <RequirePermission permission="order_request.manage">
      <SellerRequests />
    </RequirePermission>
  );
}
