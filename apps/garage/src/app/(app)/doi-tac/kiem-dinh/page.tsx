'use client';

import { RequirePermission } from '@/components/require-permission';
import { UsedCarWorkspace } from '@/components/used-car-workspace';

/** A7.23 Kiểm định xe cũ & đăng bán xe cũ trên Cổng đối tác */
export default function PartnerUsedCarPage() {
  return (
    <RequirePermission permission="partner.request.manage">
      <UsedCarWorkspace mode="PARTNER" />
    </RequirePermission>
  );
}
