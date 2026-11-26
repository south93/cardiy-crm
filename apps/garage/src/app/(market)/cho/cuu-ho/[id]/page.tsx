'use client';

import { Alert, Spinner } from '@cardiy/ui';
import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { SosTrackerView } from '@/components/sos-tracker-view';
import { ApiError } from '@/lib/api';
import { publicSosGet, publicSosPost, type SosDetail } from '@/lib/sos';

export default function PublicSosTrackPage() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const token = sp.get('t') ?? '';
  const [data, setData] = useState<SosDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setError('Thiếu mã bí mật trong đường dẫn theo dõi cứu hộ.');
      return;
    }
    try {
      const res = await publicSosGet<SosDetail>(`/${id}?token=${encodeURIComponent(token)}`);
      setData(res);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được thông tin ca cứu hộ');
    }
  }, [id, token]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5000);
    return () => clearInterval(timer);
  }, [load]);

  if (error) return <Alert>{error}</Alert>;
  if (!data)
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );

  return (
    <div className="mx-auto max-w-3xl">
      <SosTrackerView
        data={data}
        onCancel={async (reason) => {
          await publicSosPost(`/${id}/cancel`, { token, reason });
          await load();
        }}
        onReview={async (rating, comment) => {
          await publicSosPost(`/${id}/review`, { token, rating, comment });
          await load();
        }}
      />
    </div>
  );
}
