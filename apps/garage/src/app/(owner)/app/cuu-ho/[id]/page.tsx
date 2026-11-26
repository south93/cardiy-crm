'use client';

import { Alert, Spinner } from '@cardiy/ui';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { SosTrackerView } from '@/components/sos-tracker-view';
import { ApiError } from '@/lib/api';
import { ownerApi } from '@/lib/owner';
import type { SosDetail } from '@/lib/sos';

export default function OwnerSosDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SosDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await ownerApi<SosDetail>(`/sos/${id}`));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được ca cứu hộ');
    }
  }, [id]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="space-y-3">
      <Link href="/app/cuu-ho" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Quay lại Cứu hộ SOS
      </Link>
      {error ? (
        <Alert>{error}</Alert>
      ) : !data ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : (
        <SosTrackerView
          data={data}
          ownerMode
          onCancel={async (reason) => {
            await ownerApi(`/sos/${id}/cancel`, { body: { reason } });
            await load();
          }}
          onReview={async (rating, comment) => {
            await ownerApi(`/sos/${id}/review`, { body: { rating, comment } });
            await load();
          }}
        />
      )}
    </div>
  );
}
