'use client';

import { RequirePermission } from '@/components/require-permission';
import { ShopProfile } from '@/components/shop-profile';

/** A7.10 Hồ sơ gian hàng của đối tác */
export default function PartnerShopPage() {
  return (
    <RequirePermission permission="partner.shop.manage">
      <ShopProfile />
    </RequirePermission>
  );
}
