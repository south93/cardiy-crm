'use client';

import { Alert, Button, Dialog, Field, Input, Select } from '@cardiy/ui';
import { Flag } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { marketPost, REPORT_REASONS } from '@/lib/market-client';

/** Nút gửi phản ánh gian hàng trực tiếp từ trang công khai /cho/garage/[slug] */
export function ShopReportButton({ slug, shopName }: { slug: string; shopName: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('THONG_TIN_SAI');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [doneCode, setDoneCode] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const r = await marketPost<{ code: string }>(`/shops/${encodeURIComponent(slug)}/reports`, {
        name,
        phone,
        reason,
        description,
      });
      setDoneCode(r.code);
      setOpen(false);
      setDescription('');
    } catch (e) {
      setError(e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : 'Không gửi được phản ánh');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2">
      {doneCode && (
        <Alert tone="mint" className="text-xs">
          Sàn đã tiếp nhận phản ánh <span className="font-semibold">{doneCode}</span> và sẽ kiểm tra gian hàng này.
        </Alert>
      )}
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-rose-600"
        data-testid="report-shop-button"
      >
        <Flag className="h-3.5 w-3.5" /> Phản ánh gian hàng với sàn
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Phản ánh gian hàng: ${shopName}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Huỷ
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={submitting || name.trim().length < 2 || phone.trim().length < 9 || description.trim().length < 10}
              data-testid="submit-shop-report"
            >
              Gửi phản ánh
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          {error && <Alert>{error}</Alert>}
          <p className="text-xs text-slate-500">
            Sàn CARDIY tiếp nhận phản ánh khi gian hàng đăng giá ảo, thông tin sai lệch hoặc vi phạm cam kết. Nếu bạn đã đặt yêu cầu, hãy gửi phản ánh từ link theo dõi yêu cầu để sàn đối chiếu nhanh hơn.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Họ tên của bạn">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            <Field label="Số điện thoại">{(id) => <Input id={id} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}</Field>
          </div>
          <Field label="Lý do phản ánh">
            {(id) => (
              <Select id={id} value={reason} onChange={(e) => setReason(e.target.value)}>
                {Object.entries(REPORT_REASONS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Nội dung chi tiết" hint="Tối thiểu 10 ký tự">
            {(id) => (
              <textarea
                id={id}
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Mô tả rõ sự việc để sàn kiểm tra và yêu cầu garage giải trình…"
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            )}
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
