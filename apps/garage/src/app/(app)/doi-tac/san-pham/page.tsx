'use client';

import { OfferManager } from '@/components/offer-manager';
import { RequirePermission } from '@/components/require-permission';

/** A7.11 Sản phẩm đăng trên sàn (chọn từ danh mục chuẩn) */
export default function PartnerOffersPage() {
  return (
    <RequirePermission permission="partner.listing.manage">
      <OfferManager kind="PRODUCT" />
    </RequirePermission>
  );
}
