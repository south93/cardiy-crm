import { RentalWorkspace } from '@/components/rental-workspace';
import { RequirePermission } from '@/components/require-permission';

export const metadata = { title: 'Thuê xe' };

/** A3.60 CRM Garage PLG: quản lý đội xe cho thuê, hợp đồng thuê xe S8 và ghi nhận doanh thu vào sổ quỹ */
export default function PlgRentalsPage() {
  return (
    <RequirePermission permission="rental.view">
      <RentalWorkspace mode="GARAGE" />
    </RequirePermission>
  );
}
