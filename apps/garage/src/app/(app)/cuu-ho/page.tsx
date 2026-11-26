import { RequirePermission } from '@/components/require-permission';
import { SosWorkspace } from '@/components/sos-workspace';

export const metadata = { title: 'Ca cứu hộ SOS' };

/** A3.43 CRM Garage PLG: cấu hình cứu hộ, nhận ca từ sàn, điều đội cứu hộ và tạo lệnh sửa chữa khi kéo xe về xưởng */
export default function PlgSosDispatchPage() {
  return (
    <RequirePermission permission="sos.manage">
      <SosWorkspace mode="DISPATCH" />
    </RequirePermission>
  );
}
