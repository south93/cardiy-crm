'use client';

import { RequirePermission } from '@/components/require-permission';
import { UsedCarWorkspace } from '@/components/used-car-workspace';

/** A3.61 Xe cũ: tin đăng bán xe & chấm kiểm định tại garage PLG */
export default function GarageUsedCarPage() {
  return (
    <RequirePermission permission="used_car.appraise">
      <UsedCarWorkspace mode="GARAGE" />
    </RequirePermission>
  );
}
