'use client';

import { Alert, Badge, Button, Card, CardTitle, Select, Spinner } from '@cardiy/ui';
import { Copy, FileText, Paperclip, Send, Trash2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { fieldErrors, PartnerApplicationFields } from '@/components/partner-application-form';
import { api, ApiError } from '@/lib/api';
import { fmtDate } from '@/lib/crm';
import { APP_STATUS, DOC_KINDS, docKindLabel, fromForm, toForm, type ApplicationForm, type PublicApplication, type PublicPlan } from '@/lib/partners';

const STATUS_TEXT: Record<string, string> = {
  CHO_DUYET: 'Sàn đang xem hồ sơ. Bạn vẫn có thể bổ sung giấy tờ trong lúc chờ.',
  CAN_BO_SUNG: 'Sàn cần bạn bổ sung thông tin. Sửa hồ sơ / tải thêm giấy tờ rồi bấm "Gửi lại".',
  TU_CHOI: 'Hồ sơ chưa được chấp nhận.',
  DA_DUYET: 'Hồ sơ đã được duyệt. Sàn sẽ gửi mật khẩu đăng nhập tạm qua số điện thoại đã đăng ký; đăng nhập để hoàn tất gian hàng và nộp phí kỳ đầu.',
};

function Tracking() {
  const sp = useSearchParams();
  const code = sp.get('ma') ?? '';
  const token = sp.get('t') ?? '';
  const q = `?t=${encodeURIComponent(token)}`;
  const [app, setApp] = useState<PublicApplication | null>(null);
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [form, setForm] = useState<ApplicationForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [kind, setKind] = useState('GPKD');
  const [uploading, setUploading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const a = await api<PublicApplication>(`/public/partner-applications/${encodeURIComponent(code)}${q}`, { retry: false });
      setApp(a);
      setForm(toForm(a));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Không tải được hồ sơ');
    }
  }, [code, q]);
  useEffect(() => {
    void load();
    api<PublicPlan[]>('/public/plans', { retry: false })
      .then(setPlans)
      .catch(() => undefined);
  }, [load]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api(`/public/partner-applications/${code}/files${q}&kind=${kind}`, { form: fd, retry: false });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được file');
    } finally {
      setUploading(false);
    }
  };
  const remove = async (fileId: string) => {
    await api(`/public/partner-applications/${code}/files/${fileId}/remove${q}`, { method: 'POST', retry: false });
    await load();
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setError(null);
    setErrors({});
    try {
      const a = await api<PublicApplication>(`/public/partner-applications/${code}${q}`, { method: 'PUT', body: fromForm(form), retry: false });
      setApp(a);
      setMsg(app?.status === 'CAN_BO_SUNG' ? 'Đã gửi lại hồ sơ cho sàn.' : 'Đã lưu thay đổi.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không lưu được');
      if (err instanceof ApiError) setErrors(fieldErrors(err.errors));
    }
  };

  if (loadError) return <Alert>{loadError}</Alert>;
  if (!app || !form)
    return (
      <div className="grid place-items-center p-16">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  const st = APP_STATUS[app.status];
  const link = typeof window !== 'undefined' ? window.location.href.replace(/&moi=1/, '') : '';

  return (
    <div className="space-y-5">
      {sp.get('moi') && (
        <Alert tone="mint">
          <div className="font-semibold">Đã gửi hồ sơ {app.code}.</div>
          Lưu lại link trang này để theo dõi và bổ sung hồ sơ (không cần mật khẩu).
          <button type="button" onClick={() => void navigator.clipboard?.writeText(link)} className="ml-2 inline-flex items-center gap-1 font-medium underline">
            <Copy className="h-3.5 w-3.5" /> Sao chép link
          </button>
        </Alert>
      )}
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold">Hồ sơ {app.code}</h1>
          <span data-testid="application-status">
            <Badge tone={st.tone}>{st.label}</Badge>
          </span>
          <span className="text-sm text-slate-500">Nộp ngày {fmtDate(app.createdAt)}</span>
        </div>
        <p className="mt-2 text-sm text-slate-600">{STATUS_TEXT[app.status]}</p>
        {app.reviewNote && (
          <Alert tone={app.status === 'TU_CHOI' ? 'rose' : 'peach'} className="mt-3">
            <span className="font-semibold">Ghi chú của sàn:</span> <span data-testid="review-note">{app.reviewNote}</span>
          </Alert>
        )}
      </Card>

      <Card className="p-5">
        <CardTitle>Giấy tờ</CardTitle>
        <ul className="mt-3 divide-y divide-slate-100" data-testid="documents">
          {app.documents.map((d) => (
            <li key={d.fileId} className="flex items-center gap-3 py-2 text-sm">
              <FileText className="h-4 w-4 text-slate-400" />
              <div className="min-w-0 flex-1 sm:flex sm:gap-3">
                <div className="text-xs text-slate-500 sm:w-44 sm:shrink-0 sm:text-sm">{docKindLabel(d.kind)}</div>
                <div className="truncate">{d.name}</div>
              </div>
              {app.editable && (
                <button
                  type="button"
                  onClick={() => void remove(d.fileId)}
                  aria-label={`Xoá ${d.name}`}
                  className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
          {!app.documents.length && <li className="py-3 text-sm text-slate-500">Chưa có giấy tờ. Nên có giấy phép kinh doanh, CCCD người đại diện và vài ảnh garage.</li>}
        </ul>
        {app.editable && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-56" aria-label="Loại giấy tờ">
              {DOC_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50">
              {uploading ? <Spinner /> : <Paperclip className="h-4 w-4" />}
              Tải file (ảnh / PDF)
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="sr-only"
                data-testid="doc-upload"
                onChange={(e) => (void upload(e.target.files?.[0]), (e.target.value = ''))}
              />
            </label>
          </div>
        )}
      </Card>

      {app.editable ? (
        <Card className="p-5">
          <form onSubmit={save} className="space-y-5">
            <CardTitle>Thông tin garage</CardTitle>
            {error && <Alert>{error}</Alert>}
            {msg && <Alert tone="mint">{msg}</Alert>}
            <PartnerApplicationFields v={form} onChange={(f) => (setForm(f), setMsg(null))} plans={plans} errors={errors} />
            <div className="flex justify-end">
              <Button type="submit" data-testid="resubmit">
                <Send className="h-4 w-4" />
                {app.status === 'CAN_BO_SUNG' ? 'Gửi lại cho sàn' : 'Lưu thay đổi'}
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <Card className="p-5 text-sm">
          <CardTitle>Thông tin garage</CardTitle>
          <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Tên garage</dt>
              <dd className="font-medium">{app.garageName}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Gói</dt>
              <dd className="font-medium">{app.plan?.name ?? '—'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-slate-500">Địa chỉ</dt>
              <dd>{app.address}</dd>
            </div>
          </dl>
        </Card>
      )}
    </div>
  );
}

/** A1.21 Theo dõi / bổ sung hồ sơ đối tác (qua link có mã bí mật) */
export default function ApplicationTrackingPage() {
  return (
    <Suspense>
      <Tracking />
    </Suspense>
  );
}
