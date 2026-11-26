import { RentalWorkspace } from '@/components/rental-workspace';
import { RequirePermission } from '@/components/require-permission';

export const metadata = { title: 'Thuê xe · Cổng đối tác' };

/** A7.22 Cổng đối tác: đội xe cho thuê, xác minh giấy tờ, ký hợp đồng + cọc, bàn giao, trả xe & quyết toán */
export default function PartnerRentalsPage() {
  return (
    <RequirePermission permission="partner.request.manage">
      <RentalWorkspace mode="PARTNER" />
    </RequirePermission>
  );
}
