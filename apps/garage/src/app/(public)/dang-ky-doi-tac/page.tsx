'use client';

import { Alert, Button, Card, Spinner } from '@cardiy/ui';
import { Send } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { fieldErrors, PartnerApplicationFields } from '@/components/partner-application-form';
import { api, ApiError } from '@/lib/api';
import { emptyApplication, fromForm, type PublicPlan } from '@/lib/partners';

/** A1.20 Đăng ký làm đối tác garage (công khai) */
export default function PartnerSignupPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<PublicPlan[] | null>(null);
  const [v, setV] = useState(emptyApplication);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    api<PublicPlan[]>('/public/plans', { retry: false })
      .then(setPlans)
      .catch(() => setPlans([]));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const r = await api<{ code: string; token: string }>('/public/partner-applications', { body: fromForm(v), retry: false });
      router.push(`/dang-ky-doi-tac/ho-so?ma=${r.code}&t=${encodeURIComponent(r.token)}&moi=1`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không gửi được hồ sơ, vui lòng thử lại');
      if (err instanceof ApiError) setErrors(fieldErrors(err.errors));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Đăng ký làm đối tác garage</h1>
        <p className="mt-1 text-sm text-slate-600">Đưa garage của bạn lên sàn CARDIY để khách tìm thấy, đặt lịch và mua dịch vụ. Sàn sẽ liên hệ trong 1–2 ngày làm việc sau khi nhận hồ sơ.</p>
      </div>
      <Card className="p-5 md:p-6">
        {!plans ? (
          <div className="grid place-items-center p-10">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5" data-testid="partner-signup">
            {error && <Alert>{error}</Alert>}
            <PartnerApplicationFields v={v} onChange={setV} plans={plans} errors={errors} />
            <p className="text-xs text-slate-500">Sau khi gửi, bạn sẽ nhận link theo dõi hồ sơ để tải giấy phép kinh doanh, CCCD người đại diện và ảnh garage.</p>
            <div className="flex justify-end">
              <Button type="submit" disabled={busy} data-testid="submit-application">
                {busy ? <Spinner /> : <Send className="h-4 w-4" />}
                Gửi hồ sơ
              </Button>
            </div>
          </form>
        )}
      </Card>
      <p className="text-center text-sm text-slate-500">
        Đã là đối tác?{' '}
        <Link href="/dang-nhap" className="font-medium text-brand-700 hover:underline">
          Đăng nhập
        </Link>
      </p>
    </div>
  );
}
