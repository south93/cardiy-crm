import { RequirePermission } from '@/components/require-permission';
import { SosWorkspace } from '@/components/sos-workspace';

export const metadata = { title: 'Cứu hộ SOS · Cổng đối tác' };

/** A7.21 Cổng đối tác: nhận ca cứu hộ, cập nhật vị trí GPS, chốt giá, thu tiền trực tiếp */
export default function PartnerSosPage() {
  return (
    <RequirePermission permission="partner.request.manage">
      <SosWorkspace mode="PARTNER" />
    </RequirePermission>
  );
}
