import { RequirePermission } from '@/components/require-permission';
import { SosWorkspace } from '@/components/sos-workspace';

export const metadata = { title: 'Đội cứu hộ' };

/** A5.01–A5.03 App Đội cứu hộ PLG: xuất phát, dẫn đường & gửi GPS, ảnh hiện trường, kéo về xưởng tạo RO */
export default function PlgRescueCrewPage() {
  return (
    <RequirePermission permission="sos.handle">
      <div className="mx-auto max-w-3xl">
        <SosWorkspace mode="CREW" />
      </div>
    </RequirePermission>
  );
}
