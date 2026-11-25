'use client';

import { RequirePermission } from '@/components/require-permission';
import { SellerReviews } from '@/components/seller-reviews';

/** A3.55 Kênh người bán PLG: đánh giá & phản ánh từ sàn */
export default function Page() {
  return (
    <RequirePermission permission="order_request.manage">
      <SellerReviews />
    </RequirePermission>
  );
}
