'use client';

import { Alert, Spinner } from '@cardiy/ui';
import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { RentalContractView } from '@/components/rental-contract-view';
import { ApiError } from '@/lib/api';
import { publicRentalGet, publicRentalPost, type RentalContractDetail } from '@/lib/rentals';

export default function PublicRentalContractPage() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const token = sp.get('t') ?? '';
  const [data, setData] = useState<RentalContractDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setError('Thiếu mã bí mật trong đường dẫn theo dõi hợp đồng thuê xe.');
      return;
    }
    try {
      setData(await publicRentalGet<RentalContractDetail>(`/contracts/${id}?token=${encodeURIComponent(token)}`));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được hợp đồng thuê xe');
    }
  }, [id, token]);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 10_000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return <Alert>{error}</Alert>;
  if (!data)
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );

  return (
    <div className="mx-auto max-w-4xl">
      <RentalContractView
        data={data}
        onCancel={async (reason) => {
          await publicRentalPost(`/contracts/${id}/cancel`, { token, reason });
          await load();
        }}
      />
    </div>
  );
}
