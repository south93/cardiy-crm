'use client';

import { RequirePermission } from '@/components/require-permission';
import { SellerStats } from '@/components/seller-stats';

/** A3.57 Kênh người bán PLG: thống kê gian hàng trên sàn */
export default function Page() {
  return (
    <RequirePermission permission="shop.manage">
      <SellerStats />
    </RequirePermission>
  );
}
