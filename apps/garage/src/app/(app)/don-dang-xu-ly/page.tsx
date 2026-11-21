'use client';

import { OrderListView } from '@/components/order-list';
import { RequirePermission } from '@/components/require-permission';

export default function OpenOrdersPage() {
  return (
    <RequirePermission permission="ro.view">
      <OrderListView view="open" />
    </RequirePermission>
  );
}
