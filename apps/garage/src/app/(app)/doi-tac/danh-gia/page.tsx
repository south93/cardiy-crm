'use client';

import { RequirePermission } from '@/components/require-permission';
import { SellerReviews } from '@/components/seller-reviews';

/** A7.24 Đánh giá & phản ánh của gian hàng đối tác */
export default function Page() {
  return (
    <RequirePermission permission="partner.review.reply">
      <SellerReviews />
    </RequirePermission>
  );
}
