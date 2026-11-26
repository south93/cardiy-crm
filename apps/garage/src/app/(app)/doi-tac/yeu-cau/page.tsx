'use client';

import { RequirePermission } from '@/components/require-permission';
import { SellerRequests } from '@/components/seller-requests';

/** A7.20 Yêu cầu đặt hàng & đặt lịch từ sàn */
export default function Page() {
  return (
    <RequirePermission permission="partner.request.manage">
      <SellerRequests />
    </RequirePermission>
  );
}
