'use client';

import { Alert, Badge, Button, Card, Checkbox, Dialog, Field, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import { CalendarPlus, Pencil, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { fmtMoney } from '@/lib/crm';
import { moneyInput, parseMoney } from '@/lib/orders';
import { dmy, INVOICE_STATUS, PARTNER_STATUS, planPrice, type Invoice } from '@/lib/partners';

interface Plan {
  id: string;
  code: string;
  name: string;
  monthlyFee: number;
  billingMonths: number;
  description: string | null;
  features: string[];
  active: boolean;
  sortOrder: number;
  partners: number;
}
interface InvoiceList {
  summary: { unpaid: number; overdue: number; overdueCount: number; suspendAfterDays: number };
  items: Invoice[];
}
const errMsg = (e: unknown, d: string) => (e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : d);

function Invoices() {
  const [filter, setFilter] = useState('DA_PHAT_HANH');
  const [data, setData] = useState<InvoiceList | null>(null);
  const [pay, setPay] = useState<Invoice | null>(null);
  const [voiding, setVoiding] = useState<Invoice | null>(null);
  const [form, setForm] = useState({ method: 'CK', note: '', paidAt: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => api<InvoiceList>(`/platform/invoices?${filter === 'QUA_HAN' ? 'overdue=1' : filter ? `status=${filter}` : ''}`).then(setData), [filter]);
  useEffect(() => void load(), [load]);

  const issue = async () => {
    const r = await api<{ issued: number }>('/platform/invoices/issue-due', { method: 'POST' });
    setMsg(r.issued ? `Đã phát hành ${r.issued} hoá đơn kỳ tới.` : 'Không có gói nào tới kỳ lập hoá đơn.');
    await load();
  };
  const confirmPay = async () => {
    if (!pay) return;
    try {
      const r = await api<{ activated: boolean }>(`/platform/invoices/${pay.id}/pay`, { body: { method: form.method, note: form.note || null, paidAt: form.paidAt || null } });
      setMsg(`Đã ghi nhận ${pay.code} đã thanh toán.${r.activated ? ` ${pay.partner} chuyển sang Hoạt động.` : ''}`);
      setPay(null);
      await load();
    } catch (e) {
      setError(errMsg(e, 'Không ghi nhận được'));
    }
  };
  const confirmVoid = async () => {
    if (!voiding) return;
    try {
      await api(`/platform/invoices/${voiding.id}/void`, { body: { note: form.note } });
      setVoiding(null);
      await load();
    } catch (e) {
      setError(errMsg(e, 'Không huỷ được'));
    }
  };

  return (
    <div className="space-y-4">
      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="p-4">
            <div className="text-xs text-slate-500">Chưa thu</div>
            <div className="mt-1 text-xl font-bold tabular-nums" data-testid="fee-unpaid">
              {fmtMoney(data.summary.unpaid)}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-slate-500">Quá hạn</div>
            <div className="mt-1 text-xl font-bold tabular-nums text-rose-600">{fmtMoney(data.summary.overdue)}</div>
            <div className="text-xs text-slate-500">{data.summary.overdueCount} hoá đơn</div>
          </Card>
          <Card className="p-4 text-xs text-slate-600">Quá hạn trên {data.summary.suspendAfterDays} ngày: cân nhắc tạm khoá đối tác ở trang Đối tác garage. Hệ thống không tự khoá.</Card>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          tabs={[
            { value: 'DA_PHAT_HANH', label: 'Chưa thanh toán' },
            { value: 'QUA_HAN', label: 'Quá hạn' },
            { value: 'DA_THANH_TOAN', label: 'Đã thanh toán' },
            { value: '', label: 'Tất cả' },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <div className="flex-1" />
        <Button variant="outline" onClick={() => void issue()} data-testid="issue-due">
          <CalendarPlus className="h-4 w-4" />
          Phát hành kỳ tới
        </Button>
      </div>
      {msg && <Alert tone="mint">{msg}</Alert>}
      <Card className="overflow-x-auto">
        {!data ? (
          <div className="grid place-items-center p-10">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="invoice-table">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-semibold">Hoá đơn</th>
                <th className="px-3 py-3 font-semibold">Đối tác</th>
                <th className="px-3 py-3 font-semibold">Kỳ</th>
                <th className="px-3 py-3 text-right font-semibold">Số tiền</th>
                <th className="px-3 py-3 font-semibold">Hạn / trạng thái</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id} className="border-b border-slate-50 last:border-0" data-testid="invoice-row">
                  <td className="px-5 py-3">
                    <div className="font-medium">{i.code}</div>
                    <div className="text-xs text-slate-500">{i.plan}</div>
                  </td>
                  <td className="px-3 py-3">
                    {i.partner}
                    {i.partnerStatus && i.partnerStatus !== 'HOAT_DONG' && <div className="text-xs text-slate-500">{PARTNER_STATUS[i.partnerStatus]?.label}</div>}
                  </td>
                  <td className="px-3 py-3 text-slate-600">
                    {dmy(i.periodFrom)} – {dmy(i.periodTo)}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">{fmtMoney(i.amount)}</td>
                  <td className="px-3 py-3">
                    <Badge tone={i.overdueDays ? 'rose' : INVOICE_STATUS[i.status]!.tone}>{i.overdueDays ? `Quá hạn ${i.overdueDays} ngày` : INVOICE_STATUS[i.status]!.label}</Badge>
                    <div className="mt-0.5 text-xs text-slate-500">{i.status === 'DA_THANH_TOAN' ? `Thu ${i.paidMethod === 'TM' ? 'tiền mặt' : 'chuyển khoản'}` : `Hạn ${dmy(i.dueDate)}`}</div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    {i.status === 'DA_PHAT_HANH' && (
                      <div className="flex justify-end gap-1">
                        <Button onClick={() => (setPay(i), setForm({ method: 'CK', note: '', paidAt: '' }), setError(null))} data-testid="pay-invoice">
                          Đã thu
                        </Button>
                        <Button variant="ghost" onClick={() => (setVoiding(i), setForm({ method: 'CK', note: '', paidAt: '' }), setError(null))}>
                          Huỷ
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!data.items.length && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-slate-500">
                    Không có hoá đơn.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>
      <Dialog
        open={pay !== null}
        onClose={() => setPay(null)}
        title={pay ? `Ghi nhận thanh toán ${pay.code}` : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => setPay(null)}>
              Huỷ
            </Button>
            <Button onClick={() => void confirmPay()} data-testid="confirm-pay">
              Ghi nhận {pay && fmtMoney(pay.amount)}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {error && <Alert className="sm:col-span-2">{error}</Alert>}
          <Field label="Hình thức">
            {(id) => (
              <Select id={id} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                <option value="CK">Chuyển khoản</option>
                <option value="TM">Tiền mặt</option>
              </Select>
            )}
          </Field>
          <Field label="Ngày thu" hint="Để trống = hôm nay">
            {(id) => <Input id={id} type="date" value={form.paidAt} onChange={(e) => setForm({ ...form, paidAt: e.target.value })} />}
          </Field>
          <Field label="Ghi chú (số UNC, người nộp…)" className="sm:col-span-2">
            {(id) => <Input id={id} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />}
          </Field>
        </div>
      </Dialog>
      <Dialog
        open={voiding !== null}
        onClose={() => setVoiding(null)}
        title={voiding ? `Huỷ hoá đơn ${voiding.code}` : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => setVoiding(null)}>
              Đóng
            </Button>
            <Button onClick={() => void confirmVoid()} disabled={form.note.trim().length < 3}>
              Huỷ hoá đơn
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <Alert>{error}</Alert>}
          <Field label="Lý do huỷ">{(id) => <Input id={id} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} autoFocus />}</Field>
        </div>
      </Dialog>
    </div>
  );
}

const emptyPlan = { code: '', name: '', monthlyFee: '', billingMonths: '1', description: '', features: '', active: true, sortOrder: '0' };
function Plans() {
  const [rows, setRows] = useState<Plan[] | null>(null);
  const [edit, setEdit] = useState<{ id: string | null; v: typeof emptyPlan } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<Plan[]>('/platform/plans').then(setRows), []);
  useEffect(() => void load(), [load]);
  const save = async () => {
    if (!edit) return;
    setError(null);
    const v = edit.v;
    try {
      await api(edit.id ? `/platform/plans/${edit.id}` : '/platform/plans', {
        method: edit.id ? 'PUT' : 'POST',
        body: {
          code: v.code,
          name: v.name,
          monthlyFee: parseMoney(v.monthlyFee),
          billingMonths: Number(v.billingMonths),
          description: v.description || null,
          features: v.features
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
          active: v.active,
          sortOrder: Number(v.sortOrder) || 0,
        },
      });
      setEdit(null);
      await load();
    } catch (e) {
      setError(errMsg(e, 'Không lưu được gói'));
    }
  };
  const set = (k: keyof typeof emptyPlan) => (e: { target: { value: string } }) => edit && setEdit({ ...edit, v: { ...edit.v, [k]: e.target.value } });
  return (
    <div className="space-y-4">
      <div className="flex items-center">
        <p className="flex-1 text-sm text-slate-500">Đổi giá chỉ áp dụng cho đối tác duyệt sau; đối tác đang dùng giữ giá lúc được duyệt.</p>
        <Button onClick={() => (setEdit({ id: null, v: emptyPlan }), setError(null))} data-testid="add-plan">
          <Plus className="h-4 w-4" />
          Thêm gói
        </Button>
      </div>
      {!rows ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="plan-list">
          {rows.map((p) => (
            <Card key={p.id} className={`p-5 ${p.active ? '' : 'opacity-60'}`}>
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-xs text-slate-500">
                    {p.code} · {p.partners} đối tác đang dùng{p.active ? '' : ' · Ngừng bán'}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Sửa ${p.name}`}
                  onClick={() => (
                    setEdit({
                      id: p.id,
                      v: {
                        code: p.code,
                        name: p.name,
                        monthlyFee: moneyInput(p.monthlyFee),
                        billingMonths: String(p.billingMonths),
                        description: p.description ?? '',
                        features: p.features.join('\n'),
                        active: p.active,
                        sortOrder: String(p.sortOrder),
                      },
                    }),
                    setError(null)
                  )}
                  className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 text-lg font-bold tabular-nums text-brand-700">{planPrice(p.monthlyFee, p.billingMonths)}</div>
              {p.billingMonths > 1 && <div className="text-xs text-slate-500">{fmtMoney(p.monthlyFee)} / tháng</div>}
              {p.features.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                  {p.features.map((f) => (
                    <li key={f}>• {f}</li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
          {!rows.length && <Card className="p-8 text-center text-sm text-slate-500 md:col-span-2">Chưa có gói. Thêm gói để đối tác chọn khi đăng ký.</Card>}
        </div>
      )}
      <Dialog
        open={edit !== null}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Sửa gói' : 'Thêm gói'}
        footer={
          <>
            <Button variant="outline" onClick={() => setEdit(null)}>
              Huỷ
            </Button>
            <Button onClick={() => void save()} data-testid="save-plan">
              Lưu
            </Button>
          </>
        }
      >
        {edit && (
          <div className="grid gap-4 sm:grid-cols-2">
            {error && <Alert className="sm:col-span-2">{error}</Alert>}
            <Field label="Mã gói">{(id) => <Input id={id} value={edit.v.code} onChange={set('code')} placeholder="CO_BAN" />}</Field>
            <Field label="Tên gói">{(id) => <Input id={id} value={edit.v.name} onChange={set('name')} />}</Field>
            <Field label="Phí mỗi tháng">
              {(id) => <Input id={id} inputMode="numeric" value={edit.v.monthlyFee} onChange={(e) => setEdit({ ...edit, v: { ...edit.v, monthlyFee: moneyInput(parseMoney(e.target.value)) } })} />}
            </Field>
            <Field label="Chu kỳ thu (tháng)">
              {(id) => (
                <Select id={id} value={edit.v.billingMonths} onChange={set('billingMonths')}>
                  {[1, 3, 6, 12].map((m) => (
                    <option key={m} value={m}>
                      {m === 1 ? 'Hằng tháng' : `${m} tháng`}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Mô tả ngắn" className="sm:col-span-2">
              {(id) => <Input id={id} value={edit.v.description} onChange={set('description')} />}
            </Field>
            <Field label="Quyền lợi (mỗi dòng một ý)" className="sm:col-span-2">
              {(id) => <textarea id={id} rows={4} value={edit.v.features} onChange={set('features')} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" />}
            </Field>
            <Field label="Thứ tự hiển thị">{(id) => <Input id={id} inputMode="numeric" value={edit.v.sortOrder} onChange={set('sortOrder')} />}</Field>
            <div className="flex items-end pb-2">
              <Checkbox label="Đang bán (hiện trên trang đăng ký)" checked={edit.v.active} onChange={(e) => setEdit({ ...edit, v: { ...edit.v, active: e.target.checked } })} />
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function FeeBank() {
  const [v, setV] = useState<{ bankBin: string; accountNo: string; accountName: string; banks: { bin: string; name: string }[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void api<NonNullable<typeof v>>('/platform/fee-bank').then(setV), []);
  if (!v) return <Spinner className="h-6 w-6 text-brand-600" />;
  const save = async () => {
    setError(null);
    try {
      setV(await api<NonNullable<typeof v>>('/platform/fee-bank', { method: 'PUT', body: { bankBin: v.bankBin, accountNo: v.accountNo, accountName: v.accountName } }));
      setMsg('Đã lưu. Đối tác thấy tài khoản này và mã QR ở trang Phí & hoá đơn khi còn phí chưa nộp.');
    } catch (e) {
      setError(errMsg(e, 'Không lưu được'));
    }
  };
  return (
    <Card className="max-w-2xl space-y-4 p-5">
      <p className="text-sm text-slate-600">
        Tài khoản ngân hàng sàn nhận phí đối tác. Đối tác quét mã VietQR (đã điền sẵn số tiền và nội dung là mã hoá đơn) rồi Kế toán sàn bấm &quot;Đã thu&quot; khi tiền về.
      </p>
      {error && <Alert>{error}</Alert>}
      {msg && <Alert tone="mint">{msg}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ngân hàng" className="sm:col-span-2">
          {(id) => (
            <Select id={id} value={v.bankBin} onChange={(e) => (setV({ ...v, bankBin: e.target.value }), setMsg(null))} data-testid="fee-bank">
              <option value="">— Chọn ngân hàng —</option>
              {v.banks.map((b) => (
                <option key={b.bin} value={b.bin}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Số tài khoản">{(id) => <Input id={id} value={v.accountNo} onChange={(e) => (setV({ ...v, accountNo: e.target.value }), setMsg(null))} />}</Field>
        <Field label="Tên chủ tài khoản">{(id) => <Input id={id} value={v.accountName} onChange={(e) => (setV({ ...v, accountName: e.target.value }), setMsg(null))} />}</Field>
      </div>
      <div className="flex justify-end">
        <Button onClick={() => void save()}>Lưu</Button>
      </div>
    </Card>
  );
}

function Fees() {
  const [tab, setTab] = useState<'inv' | 'plans' | 'bank'>('inv');
  return (
    <div className="space-y-4">
      <Tabs
        tabs={[
          { value: 'inv', label: 'Hoá đơn phí' },
          { value: 'plans', label: 'Gói đối tác' },
          { value: 'bank', label: 'Tài khoản nhận phí' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'inv' ? <Invoices /> : tab === 'plans' ? <Plans /> : <FeeBank />}
    </div>
  );
}

/** A6.50 Phí đối tác: gói, hoá đơn phí, ghi nhận thanh toán */
export default function PlatformFeesPage() {
  return (
    <RequirePermission permission="platform.fee.manage">
      <Fees />
    </RequirePermission>
  );
}
