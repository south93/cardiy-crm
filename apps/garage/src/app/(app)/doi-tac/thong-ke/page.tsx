'use client';

import { RequirePermission } from '@/components/require-permission';
import { SellerStats } from '@/components/seller-stats';

/** A7.30 Thống kê gian hàng đối tác: lượt xem, số yêu cầu, tỉ lệ chốt */
export default function Page() {
  return (
    <RequirePermission permission="partner.report.view">
      <SellerStats />
    </RequirePermission>
  );
}
