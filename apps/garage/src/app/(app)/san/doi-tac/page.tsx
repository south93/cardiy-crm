'use client';

import { Alert, Badge, Button, Card, Dialog, Field, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import { ExternalLink, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ExportButton } from '@/components/export-button';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/crm';
import { APP_STATUS, dmy, docKindLabel, PARTNER_STATUS, planPrice, type AppDoc, type AppStatus, type PublicApplication } from '@/lib/partners';

interface AppRow {
  id: string;
  code: string;
  status: AppStatus;
  garageName: string;
  phone: string;
  province: string | null;
  plan: string | null;
  documents: number;
  createdAt: string;
}
interface AppDetail extends PublicApplication {
  id: string;
  reviewedBy: string | null;
  tenantId: string | null;
  documents: (AppDoc & { size: number })[];
}
interface PlanRow {
  id: string;
  name: string;
  monthlyFee: number;
  billingMonths: number;
  active: boolean;
}
interface PartnerRow {
  id: string;
  name: string;
  taxCode: string | null;
  status: string;
  createdAt: string;
  account: { phone: string; fullName: string } | null;
  plan: { name: string; monthlyFee: number; billingMonths: number; paidThrough: string } | null;
  unpaid: number;
  maxOverdueDays: number;
}
const today = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const errMsg = (e: unknown, d: string) => (e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : d);

function Applications() {
  const [status, setStatus] = useState<string>('CHO_DUYET');
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ counts: Record<string, number>; items: AppRow[] } | null>(null);
  const [open, setOpen] = useState<AppDetail | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [mode, setMode] = useState<'view' | 'info' | 'reject' | 'approve'>('view');
  const [note, setNote] = useState('');
  const [planId, setPlanId] = useState('');
  const [start, setStart] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ phone: string; tempPassword: string | null; invoice: { code: string; amount: number; dueDate: string } } | null>(null);

  const load = useCallback(() => api<typeof data>(`/platform/applications?${new URLSearchParams({ ...(status ? { status } : {}), ...(q.trim() ? { q: q.trim() } : {}) })}`).then(setData), [status, q]);
  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  useEffect(() => {
    // Danh sách gói: cần quyền phí; không có thì dùng gói công khai
    api<PlanRow[]>('/platform/plans')
      .catch(() => api<PlanRow[]>('/public/plans').then((r) => r.map((p) => ({ ...p, active: true }))))
      .then((r) => setPlans(r.filter((p) => p.active)))
      .catch(() => setPlans([]));
  }, []);

  const show = async (id: string) => {
    const d = await api<AppDetail>(`/platform/applications/${id}`);
    setOpen(d);
    setMode('view');
    setNote('');
    setError(null);
    setPlanId(d.planId ?? '');
    setStart(today());
  };
  const act = async () => {
    if (!open) return;
    setError(null);
    try {
      if (mode === 'approve') {
        const r = await api<NonNullable<typeof result>>(`/platform/applications/${open.id}/approve`, { body: { planId, startDate: start, note: note || null } });
        setResult(r);
        setOpen(null);
      } else {
        await api(`/platform/applications/${open.id}/${mode === 'info' ? 'request-info' : 'reject'}`, { body: { note } });
        setOpen(null);
      }
      await load();
    } catch (e) {
      setError(errMsg(e, 'Không thực hiện được'));
    }
  };

  const tabs = (['CHO_DUYET', 'CAN_BO_SUNG', 'DA_DUYET', 'TU_CHOI'] as AppStatus[]).map((s) => ({
    value: s as string,
    label: `${APP_STATUS[s].label}${data?.counts[s] ? ` (${data.counts[s]})` : ''}`,
  }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs tabs={[...tabs, { value: '', label: 'Tất cả' }]} value={status} onChange={setStatus} />
        <div className="relative w-full md:w-64">
          <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mã hồ sơ, tên, SĐT, MST…" className="rounded-full bg-white/80 pl-10" aria-label="Tìm hồ sơ" />
        </div>
        <div className="flex-1" />
        <ExportButton
          filename="ho-so-dang-ky-doi-tac"
          sheetName="Hồ sơ đối tác"
          testId="export-applications"
          rows={data?.items ?? []}
          columns={[
            { header: 'Mã hồ sơ', value: (r) => r.code },
            { header: 'Tên garage', value: (r) => r.garageName },
            { header: 'Số điện thoại', value: (r) => r.phone },
            { header: 'Tỉnh / thành', value: (r) => r.province ?? '' },
            { header: 'Gói đăng ký', value: (r) => r.plan ?? '' },
            { header: 'Số giấy tờ', value: (r) => r.documents },
            { header: 'Trạng thái', value: (r) => APP_STATUS[r.status].label },
            { header: 'Ngày nộp', value: (r) => fmtDate(r.createdAt) },
          ]}
        />
        <a href="/dang-ky-doi-tac" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
          Trang đăng ký công khai <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      <Card className="overflow-x-auto">
        {!data ? (
          <div className="grid place-items-center p-10">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="application-table">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-semibold">Hồ sơ</th>
                <th className="px-3 py-3 font-semibold">Liên hệ</th>
                <th className="px-3 py-3 font-semibold">Gói</th>
                <th className="px-3 py-3 font-semibold">Giấy tờ</th>
                <th className="px-3 py-3 font-semibold">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id} onClick={() => void show(r.id)} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50/60" data-testid="application-row">
                  <td className="px-5 py-3">
                    <div className="font-medium">{r.garageName}</div>
                    <div className="text-xs text-slate-500">
                      {r.code} · {fmtDate(r.createdAt)}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-600">
                    {r.phone}
                    {r.province && <div className="text-xs text-slate-500">{r.province}</div>}
                  </td>
                  <td className="px-3 py-3">{r.plan ?? '—'}</td>
                  <td className="px-3 py-3">{r.documents} file</td>
                  <td className="px-3 py-3">
                    <Badge tone={APP_STATUS[r.status].tone}>{APP_STATUS[r.status].label}</Badge>
                  </td>
                </tr>
              ))}
              {!data.items.length && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-slate-500">
                    Không có hồ sơ.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>

      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        wide
        title={open ? `Hồ sơ ${open.code} · ${open.garageName}` : ''}
        footer={
          open &&
          (mode === 'view' ? (
            open.status === 'CHO_DUYET' || open.status === 'CAN_BO_SUNG' ? (
              <>
                <Button variant="outline" onClick={() => setMode('reject')}>
                  Từ chối
                </Button>
                {open.status === 'CHO_DUYET' && (
                  <Button variant="outline" onClick={() => setMode('info')} data-testid="request-info">
                    Yêu cầu bổ sung
                  </Button>
                )}
                {open.status === 'CHO_DUYET' && (
                  <Button onClick={() => setMode('approve')} data-testid="approve">
                    Duyệt
                  </Button>
                )}
              </>
            ) : (
              <Button variant="outline" onClick={() => setOpen(null)}>
                Đóng
              </Button>
            )
          ) : (
            <>
              <Button variant="outline" onClick={() => setMode('view')}>
                Quay lại
              </Button>
              <Button onClick={() => void act()} data-testid="confirm-action" disabled={mode === 'approve' ? !planId : note.trim().length < 3}>
                {mode === 'approve' ? 'Duyệt & tạo tài khoản' : mode === 'info' ? 'Gửi yêu cầu bổ sung' : 'Từ chối hồ sơ'}
              </Button>
            </>
          ))
        }
      >
        {open && (
          <div className="space-y-4 text-sm">
            {error && <Alert>{error}</Alert>}
            {mode === 'view' && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={APP_STATUS[open.status].tone}>{APP_STATUS[open.status].label}</Badge>
                  <span className="text-slate-500">Nộp {fmtDate(open.createdAt)}</span>
                  {open.reviewedBy && <span className="text-slate-500">· Xử lý bởi {open.reviewedBy}</span>}
                </div>
                {open.reviewNote && <Alert tone="peach">Ghi chú: {open.reviewNote}</Alert>}
                <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  {[
                    ['Mã số thuế', open.taxCode],
                    ['Tỉnh / thành', open.province],
                    ['Địa chỉ', open.address],
                    ['Người đại diện', open.representative],
                    ['Số điện thoại', open.phone],
                    ['Email', open.email],
                    ['Gói đăng ký', open.plan ? `${open.plan.name} · ${planPrice(open.plan.monthlyFee, open.plan.billingMonths)}` : null],
                    ['Ghi chú', open.note],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-slate-500">{k}</dt>
                      <dd className="font-medium">{v || '—'}</dd>
                    </div>
                  ))}
                </dl>
                <div>
                  <div className="mb-1 font-semibold">Giấy tờ ({open.documents.length})</div>
                  <ul className="space-y-1" data-testid="review-documents">
                    {open.documents.map((d) => (
                      <li key={d.fileId}>
                        <span className="text-slate-500">{docKindLabel(d.kind)}:</span>{' '}
                        {d.url ? (
                          <a href={d.url} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                            {d.name}
                          </a>
                        ) : (
                          d.name
                        )}
                      </li>
                    ))}
                    {!open.documents.length && <li className="text-slate-500">Chưa có giấy tờ.</li>}
                  </ul>
                </div>
              </>
            )}
            {(mode === 'info' || mode === 'reject') && (
              <Field label={mode === 'info' ? 'Cần bổ sung gì? (người nộp sẽ thấy)' : 'Lý do từ chối (người nộp sẽ thấy)'}>
                {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} autoFocus data-testid="review-note-input" />}
              </Field>
            )}
            {mode === 'approve' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Gói" hint="Giá chốt theo gói tại thời điểm duyệt">
                  {(id) => (
                    <Select id={id} value={planId} onChange={(e) => setPlanId(e.target.value)} data-testid="approve-plan">
                      <option value="">— Chọn gói —</option>
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {planPrice(p.monthlyFee, p.billingMonths)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Ngày bắt đầu tính phí">{(id) => <Input id={id} type="date" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
                <Field label="Ghi chú nội bộ" className="sm:col-span-2">
                  {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
                </Field>
                <p className="text-xs text-slate-500 sm:col-span-2">
                  Duyệt sẽ tạo đối tác ở trạng thái &quot;Đang thiết lập&quot;, tài khoản đăng nhập bằng SĐT {open.phone} và hoá đơn phí kỳ đầu (hạn 7 ngày). Đối tác chuyển &quot;Hoạt động&quot; khi
                  kỳ đầu được ghi nhận đã thanh toán.
                </p>
              </div>
            )}
          </div>
        )}
      </Dialog>

      <Dialog open={result !== null} onClose={() => setResult(null)} title="Đã duyệt đối tác" footer={<Button onClick={() => setResult(null)}>Xong</Button>}>
        {result && (
          <div className="space-y-3 text-sm" data-testid="approve-result">
            <p>
              Tài khoản đăng nhập: <span className="font-semibold">{result.phone}</span>
            </p>
            {result.tempPassword ? (
              <Alert tone="mint">
                Mật khẩu tạm:{' '}
                <span className="font-mono text-base font-bold" data-testid="temp-password">
                  {result.tempPassword}
                </span>
                <div className="mt-1 text-xs">Chỉ hiện một lần. Gửi cho đối tác qua Zalo / điện thoại; lần đầu đăng nhập phải đổi mật khẩu.</div>
              </Alert>
            ) : (
              <Alert tone="sky">SĐT này đã có tài khoản: đối tác dùng mật khẩu hiện tại, chọn không gian đối tác sau khi đăng nhập.</Alert>
            )}
            <p>
              Hoá đơn kỳ đầu {result.invoice.code}: <span className="font-semibold">{fmtMoney(result.invoice.amount)}</span>, hạn {dmy(String(result.invoice.dueDate))}.
            </p>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function Partners() {
  const [rows, setRows] = useState<PartnerRow[] | null>(null);
  const [status, setStatus] = useState('');
  const [change, setChange] = useState<{ p: PartnerRow; to: string } | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<PartnerRow[]>(`/platform/partners${status ? `?status=${status}` : ''}`).then(setRows), [status]);
  useEffect(() => void load(), [load]);
  const apply = async () => {
    if (!change) return;
    try {
      await api(`/platform/partners/${change.p.id}/status`, { body: { status: change.to, note: note || null } });
      setChange(null);
      await load();
    } catch (e) {
      setError(errMsg(e, 'Không đổi được trạng thái'));
    }
  };
  const actions = (s: string) => (s === 'HOAT_DONG' ? ['TAM_KHOA', 'CHAM_DUT'] : s === 'TAM_KHOA' ? ['HOAT_DONG', 'CHAM_DUT'] : s === 'DANG_THIET_LAP' ? ['HOAT_DONG', 'TAM_KHOA', 'CHAM_DUT'] : []);
  const verb: Record<string, string> = { HOAT_DONG: 'Mở hoạt động', TAM_KHOA: 'Tạm khoá', CHAM_DUT: 'Chấm dứt' };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs tabs={[{ value: '', label: 'Tất cả' }, ...Object.entries(PARTNER_STATUS).map(([value, s]) => ({ value, label: s.label }))]} value={status} onChange={setStatus} />
        <div className="flex-1" />
        <ExportButton
          filename="danh-sach-doi-tac"
          sheetName="Đối tác"
          testId="export-partners"
          rows={rows ?? []}
          columns={[
            { header: 'Tên đối tác', value: (p) => p.name },
            { header: 'Mã số thuế', value: (p) => p.taxCode ?? '' },
            { header: 'Tài khoản', value: (p) => p.account?.fullName ?? '' },
            { header: 'SĐT tài khoản', value: (p) => p.account?.phone ?? '' },
            { header: 'Gói', value: (p) => p.plan?.name ?? '' },
            { header: 'Hoá đơn tới', value: (p) => (p.plan ? dmy(p.plan.paidThrough) : '') },
            { header: 'Chưa nộp', value: (p) => p.unpaid },
            { header: 'Quá hạn (ngày)', value: (p) => p.maxOverdueDays },
            { header: 'Trạng thái', value: (p) => PARTNER_STATUS[p.status]?.label ?? p.status },
            { header: 'Ngày tham gia', value: (p) => fmtDate(p.createdAt) },
          ]}
        />
      </div>
      <Card className="overflow-x-auto">
        {!rows ? (
          <div className="grid place-items-center p-10">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="partner-table">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-semibold">Đối tác</th>
                <th className="px-3 py-3 font-semibold">Tài khoản</th>
                <th className="px-3 py-3 font-semibold">Gói</th>
                <th className="px-3 py-3 text-right font-semibold">Chưa nộp</th>
                <th className="px-3 py-3 font-semibold">Trạng thái</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 last:border-0" data-testid="partner-row">
                  <td className="px-5 py-3">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-slate-500">
                      {p.taxCode ? `MST ${p.taxCode} · ` : ''}từ {fmtDate(p.createdAt)}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-600">{p.account ? `${p.account.fullName} · ${p.account.phone}` : '—'}</td>
                  <td className="px-3 py-3">
                    {p.plan ? (
                      <>
                        {p.plan.name}
                        <div className="text-xs text-slate-500">Đã lập hoá đơn tới {dmy(p.plan.paidThrough)}</div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {p.unpaid ? <span className="font-semibold text-rose-600">{fmtMoney(p.unpaid)}</span> : '—'}
                    {p.maxOverdueDays > 0 && <div className="text-xs text-rose-600">quá hạn {p.maxOverdueDays} ngày</div>}
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={PARTNER_STATUS[p.status]?.tone ?? 'slate'}>{PARTNER_STATUS[p.status]?.label ?? p.status}</Badge>
                  </td>
                  <td className="px-3 py-3">
                    <Select
                      value=""
                      aria-label={`Đổi trạng thái ${p.name}`}
                      onChange={(e) => e.target.value && (setChange({ p, to: e.target.value }), setNote(''), setError(null))}
                      className="w-36"
                      disabled={!actions(p.status).length}
                    >
                      <option value="">Thao tác…</option>
                      {actions(p.status).map((a) => (
                        <option key={a} value={a}>
                          {verb[a]}
                        </option>
                      ))}
                    </Select>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-slate-500">
                    Chưa có đối tác.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>
      <Dialog
        open={change !== null}
        onClose={() => setChange(null)}
        title={change ? `${verb[change.to]}: ${change.p.name}` : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => setChange(null)}>
              Huỷ
            </Button>
            <Button onClick={() => void apply()} data-testid="confirm-status">
              Xác nhận
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          {error && <Alert>{error}</Alert>}
          {change?.to === 'TAM_KHOA' && <p>Đối tác không đăng nhập được cho tới khi mở lại.</p>}
          {change?.to === 'CHAM_DUT' && <Alert>Chấm dứt là vĩnh viễn: gói dừng tính phí, tài khoản không đăng nhập được nữa.</Alert>}
          <Field label="Ghi chú">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        </div>
      </Dialog>
    </div>
  );
}

function PartnersAdmin() {
  const [tab, setTab] = useState<'apps' | 'partners'>('apps');
  return (
    <div className="space-y-4">
      <Tabs
        tabs={[
          { value: 'apps', label: 'Hồ sơ đăng ký' },
          { value: 'partners', label: 'Đối tác' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'apps' ? <Applications /> : <Partners />}
    </div>
  );
}

/** A6.10 Đối tác garage: duyệt hồ sơ, khoá / mở đối tác */
export default function PlatformPartnersPage() {
  return (
    <RequirePermission permission="platform.partner.review">
      <PartnersAdmin />
    </RequirePermission>
  );
}
