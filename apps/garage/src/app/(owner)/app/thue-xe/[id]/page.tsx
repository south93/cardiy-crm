'use client';

import { Alert, Spinner } from '@cardiy/ui';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { RentalContractView } from '@/components/rental-contract-view';
import { ApiError } from '@/lib/api';
import { ownerApi } from '@/lib/owner';
import type { RentalContractDetail } from '@/lib/rentals';

export default function OwnerRentalContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<RentalContractDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await ownerApi<RentalContractDetail>(`/rentals/contracts/${id}`));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được hợp đồng thuê xe');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <Link href="/app/thue-xe" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Quay lại Thuê xe
      </Link>
      {error ? (
        <Alert>{error}</Alert>
      ) : !data ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : (
        <RentalContractView
          data={data}
          onCancel={async (reason) => {
            await ownerApi(`/rentals/contracts/${id}/cancel`, { body: { reason } });
            await load();
          }}
        />
      )}
    </div>
  );
}
