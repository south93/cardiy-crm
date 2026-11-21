'use client';

import { Alert, Badge, Button, Card, Checkbox, Dialog, Field, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import { Building2, Check, Minus, Pencil, Plus, ShieldCheck } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { BranchRow, PermissionRow, RoleRow } from '@/lib/org';

type Tab = 'chi-nhanh' | 'mau-in' | 'cham-soc' | 'vai-tro' | 'nhat-ky';

// ---------------- Chăm sóc khách ----------------
const CARE_FIELDS = [
  { key: 'registrationDays', label: 'Gọi nhắc trước hạn đăng kiểm', unit: 'ngày' },
  { key: 'insuranceDays', label: 'Gọi nhắc trước hạn bảo hiểm', unit: 'ngày' },
  { key: 'maintenanceMonths', label: 'Nhắc bảo dưỡng sau lần giao xe gần nhất', unit: 'tháng' },
  { key: 'followUpDays', label: 'Gọi hỏi thăm sau khi giao xe', unit: 'ngày' },
  { key: 'maxAttempts', label: 'Không nghe máy quá … lần thì bỏ qua', unit: 'lần' },
] as const;
type CareSettings = Record<(typeof CARE_FIELDS)[number]['key'], number>;

function CareSettingsTab() {
  const [v, setV] = useState<CareSettings | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    api<CareSettings>('/care/settings').then(setV);
  }, []);
  if (!v) return <Spinner className="text-brand-600" />;
  return (
    <Card className="max-w-xl space-y-4 p-5" data-testid="care-settings">
      <p className="text-sm text-slate-600">Hệ thống tự lập danh sách khách cần gọi trong <b>Lịch gọi</b> theo các mốc dưới đây.</p>
      {CARE_FIELDS.map((f) => (
        <Field key={f.key} label={f.label}>
          {(id) => (
            <div className="flex items-center gap-2">
              <Input id={id} type="number" min={1} className="w-28" value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: Number(e.target.value) })} />
              <span className="text-sm text-slate-500">{f.unit}</span>
            </div>
          )}
        </Field>
      ))}
      <div className="flex items-center gap-3">
        <Button
          onClick={async () => {
            setMsg(null);
            try {
              setV(await api<CareSettings>('/care/settings', { method: 'PUT', body: v }));
              setMsg({ ok: true, text: 'Đã lưu' });
            } catch (err) {
              setMsg({ ok: false, text: err instanceof ApiError ? (err.errors?.[0]?.message ?? err.message) : 'Không lưu được' });
            }
          }}
          data-testid="save-care-settings"
        >
          Lưu
        </Button>
        {msg && <span className={`text-sm ${msg.ok ? 'text-mint-700' : 'text-rose-600'}`}>{msg.text}</span>}
      </div>
    </Card>
  );
}

// ---------------- Mẫu in & thanh toán ----------------
interface PrintSettings {
  displayName: string;
  hotline: string;
  email: string;
  website: string;
  bankBin: string;
  accountNo: string;
  accountName: string;
  quoteValidDays: number;
  receiveTerms: string;
  quoteNote: string;
  invoiceNote: string;
  logoFileId: string | null;
  slogan: string;
  tagline: string;
  banner: string;
  qrLink: string;
  qrCaption: string;
  warrantyTire: string;
  warrantyUnderbody: string;
  signNote: string;
  inspectionNote: string;
}
const PRINT_KEYS: (keyof PrintSettings)[] = [
  'displayName', 'hotline', 'email', 'website', 'bankBin', 'accountNo', 'accountName', 'quoteValidDays', 'receiveTerms', 'quoteNote', 'invoiceNote',
  'logoFileId', 'slogan', 'tagline', 'banner', 'qrLink', 'qrCaption', 'warrantyTire', 'warrantyUnderbody', 'signNote', 'inspectionNote',
];
const area = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100';

function PrintSettingsTab() {
  const [v, setV] = useState<PrintSettings | null>(null);
  const [banks, setBanks] = useState<{ bin: string; name: string }[]>([]);
  const [tenantName, setTenantName] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<PrintSettings & { banks: { bin: string; name: string }[]; tenantName: string }>('/print-settings').then((r) => {
      setBanks(r.banks);
      setTenantName(r.tenantName);
      setV(Object.fromEntries(PRINT_KEYS.map((k) => [k, r[k] ?? (k === 'logoFileId' ? null : '')])) as unknown as PrintSettings);
      if (r.logoFileId) api<{ url: string }>(`/files/${r.logoFileId}`).then((f) => setLogoUrl(f.url), () => setLogoUrl(null));
    });
  }, []);
  const uploadLogo = async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    try {
      const f = await api<{ id: string; url: string }>('/files', { form });
      setV((x) => (x ? { ...x, logoFileId: f.id } : x));
      setLogoUrl(f.url);
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Không tải được logo' });
    }
  };
  if (!v) return <Spinner className="text-brand-600" />;
  const set = (k: keyof PrintSettings) => (e: { target: { value: string } }) => setV({ ...v, [k]: k === 'quoteValidDays' ? Number(e.target.value) : e.target.value });
  const custom = v.bankBin !== '' && !banks.some((b) => b.bin === v.bankBin);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api('/print-settings', { method: 'PUT', body: v });
      setMsg({ ok: true, text: 'Đã lưu. Phiếu in từ giờ dùng thông tin này.' });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? (err.errors?.[0]?.message ?? err.message) : 'Không lưu được' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="grid gap-4 xl:grid-cols-2" data-testid="print-settings">
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <h3 className="font-semibold sm:col-span-2">Thông tin in trên phiếu</h3>
        <Field label="Tên hiển thị trên phiếu" hint={`Để trống thì dùng "${tenantName}"`} className="sm:col-span-2">
          {(id) => <Input id={id} value={v.displayName} onChange={set('displayName')} />}
        </Field>
        <Field label="Hotline">{(id) => <Input id={id} value={v.hotline} onChange={set('hotline')} />}</Field>
        <Field label="Email">{(id) => <Input id={id} value={v.email} onChange={set('email')} />}</Field>
        <Field label="Website / Fanpage" className="sm:col-span-2">
          {(id) => <Input id={id} value={v.website} onChange={set('website')} />}
        </Field>
        <p className="text-xs text-slate-500 sm:col-span-2">Địa chỉ và số điện thoại lấy theo chi nhánh của đơn (sửa ở tab Chi nhánh).</p>
        <div className="sm:col-span-2">
          <div className="mb-1.5 text-sm font-medium text-slate-700">Logo trên phiếu</div>
          <div className="flex items-center gap-3">
            <div className="grid h-14 w-44 place-items-center rounded-xl border border-dashed border-slate-300 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {logoUrl ? <img src={logoUrl} alt="Logo" className="max-h-12 max-w-40 object-contain" data-testid="logo-preview" /> : <span className="text-xs text-slate-400">Chưa có logo</span>}
            </div>
            <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden data-testid="logo-input" onChange={(e) => e.target.files?.[0] && void uploadLogo(e.target.files[0])} />
            <Button type="button" variant="outline" onClick={() => logoInput.current?.click()}>
              Chọn ảnh
            </Button>
            {v.logoFileId && (
              <button type="button" className="text-xs text-rose-600 hover:underline" onClick={() => (setV({ ...v, logoFileId: null }), setLogoUrl(null))}>
                Bỏ logo
              </button>
            )}
          </div>
        </div>
        <Field label="Khẩu hiệu (dòng lớn)" className="sm:col-span-2">{(id) => <Input id={id} value={v.slogan} onChange={set('slogan')} />}</Field>
        <Field label="Dòng phụ dưới khẩu hiệu" className="sm:col-span-2">{(id) => <Input id={id} value={v.tagline} onChange={set('tagline')} />}</Field>
        <Field label="Dải chữ cuối phiếu" className="sm:col-span-2">{(id) => <Input id={id} value={v.banner} onChange={set('banner')} />}</Field>
        <Field label="Link mã QR góc phiếu" hint="VD: link Zalo OA / trợ lý; để trống thì không in QR">{(id) => <Input id={id} value={v.qrLink} onChange={set('qrLink')} placeholder="https://…" />}</Field>
        <Field label="Chữ dưới mã QR">{(id) => <Input id={id} value={v.qrCaption} onChange={set('qrCaption')} />}</Field>
      </Card>
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <h3 className="font-semibold sm:col-span-2">Tài khoản nhận chuyển khoản (VietQR trên hoá đơn)</h3>
        <Field label="Ngân hàng">
          {(id) => (
            <Select id={id} value={custom ? 'khac' : v.bankBin} onChange={(e) => setV({ ...v, bankBin: e.target.value === 'khac' ? '000000' : e.target.value })}>
              <option value="">— Chưa cài —</option>
              {banks.map((b) => (
                <option key={b.bin} value={b.bin}>
                  {b.name}
                </option>
              ))}
              <option value="khac">Ngân hàng khác (nhập mã BIN)</option>
            </Select>
          )}
        </Field>
        {custom ? (
          <Field label="Mã BIN ngân hàng" hint="6 chữ số, xem trên trang của ngân hàng / NAPAS">
            {(id) => <Input id={id} value={v.bankBin === '000000' ? '' : v.bankBin} onChange={(e) => setV({ ...v, bankBin: e.target.value.replace(/\D/g, '').slice(0, 6) || '000000' })} />}
          </Field>
        ) : (
          <div />
        )}
        <Field label="Số tài khoản">{(id) => <Input id={id} value={v.accountNo} onChange={set('accountNo')} inputMode="numeric" />}</Field>
        <Field label="Chủ tài khoản">{(id) => <Input id={id} value={v.accountName} onChange={set('accountName')} placeholder="VD: CONG TY TNHH PLG" />}</Field>
        <p className="text-xs text-slate-500 sm:col-span-2">Khách quét mã trên hoá đơn bằng app ngân hàng: số tiền còn phải thu và nội dung (mã đơn + biển số) được điền sẵn. Tiền vào thẳng tài khoản này.</p>
      </Card>
      <Card className="grid gap-4 p-5 xl:col-span-2">
        <h3 className="font-semibold">Ghi chú in cuối phiếu</h3>
        <div className="grid gap-4 lg:grid-cols-3">
          <Field label="Phiếu dịch vụ — bảo hành lốp">{(id) => <textarea id={id} rows={9} className={area} value={v.warrantyTire} onChange={set('warrantyTire')} />}</Field>
          <Field label="Phiếu dịch vụ — bảo hành gầm">{(id) => <textarea id={id} rows={9} className={area} value={v.warrantyUnderbody} onChange={set('warrantyUnderbody')} />}</Field>
          <Field label="Hoá đơn (chính sách bảo hành)">{(id) => <textarea id={id} rows={9} className={area} value={v.invoiceNote} onChange={set('invoiceNote')} />}</Field>
          <Field label="Dòng cuối phiếu (dưới chữ ký)" className="lg:col-span-3">{(id) => <Input id={id} value={v.signNote} onChange={set('signNote')} />}</Field>
          <Field label="Phiếu kiểm tra xe — đoạn bảo mật thông tin (trang 2)" hint="{hotline} sẽ thay bằng số hotline" className="lg:col-span-3">
            {(id) => <textarea id={id} rows={4} className={area} value={v.inspectionNote} onChange={set('inspectionNote')} />}
          </Field>
          <p className="text-xs text-slate-500 lg:col-span-3">Cách viết: dòng bắt đầu bằng <code>## </code> là tiêu đề, <code>– </code> là gạch đầu dòng, <code>&gt; </code> là ô công thức, <code>**chữ**</code> in đậm.</p>
        </div>
        <Field label="Báo giá có hiệu lực (ngày)" className="max-w-xs">
          {(id) => <Input id={id} type="number" min={1} max={90} value={v.quoteValidDays} onChange={set('quoteValidDays')} />}
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy} data-testid="save-print-settings">
            {busy && <Spinner />}
            Lưu
          </Button>
          {msg && <span className={`text-sm ${msg.ok ? 'text-mint-700' : 'text-rose-600'}`}>{msg.text}</span>}
        </div>
      </Card>
    </form>
  );
}

// ---------------- Chi nhánh ----------------
function BranchesTab() {
  const { can } = useAuth();
  const [rows, setRows] = useState<BranchRow[] | null>(null);
  const [open, setOpen] = useState(false);
  /** null = thêm mới; có id = đang sửa chi nhánh đó */
  const [editing, setEditing] = useState<string | null>(null);
  const empty = { code: '', name: '', address: '', phone: '', bays: '2' };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => setRows(await api<BranchRow[]>('/branches')), []);
  useEffect(() => void load(), [load]);

  const startAdd = () => {
    setEditing(null);
    setForm(empty);
    setError(null);
    setOpen(true);
  };
  const startEdit = (b: BranchRow) => {
    setEditing(b.id);
    setForm({ code: b.code, name: b.name, address: b.address ?? '', phone: b.phone ?? '', bays: String(b.bays) });
    setError(null);
    setOpen(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const body = { ...form, bays: Number(form.bays), phone: form.phone || undefined, address: form.address || undefined };
      await api(editing ? `/branches/${editing}` : '/branches', { method: editing ? 'PATCH' : 'POST', body });
      setOpen(false);
      setForm(empty);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.errors?.[0]?.message ?? err.message) : 'Không lưu được');
    }
  };

  return (
    <div className="space-y-4">
      {can('branch.manage') && (
        <div className="flex justify-end">
          <Button onClick={startAdd}>
            <Plus className="h-4 w-4" />
            Thêm chi nhánh
          </Button>
        </div>
      )}
      {!rows ? (
        <Spinner className="text-brand-600" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="branch-list">
          {rows.map((b) => (
            <Card key={b.id} className="flex gap-4 p-5">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-sky-100 text-sky-700">
                <Building2 className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-semibold">{b.name}</div>
                <div className="text-slate-500">Mã {b.code} · {b.bays} khoang sửa</div>
                {b.address && <div className="mt-1 text-slate-600">{b.address}</div>}
                {b.phone && <div className="text-slate-600">{b.phone}</div>}
              </div>
              {can('branch.manage') && (
                <button type="button" onClick={() => startEdit(b)} aria-label={`Sửa chi nhánh ${b.code}`} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-700">
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </Card>
          ))}
        </div>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Sửa chi nhánh' : 'Thêm chi nhánh'}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Huỷ
            </Button>
            <Button type="submit" form="branch-form">
              Lưu
            </Button>
          </>
        }
      >
        <form id="branch-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          {error && <Alert className="sm:col-span-2">{error}</Alert>}
          <Field label="Mã" hint="VD: CN3">{(id) => <Input id={id} required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />}</Field>
          <Field label="Số khoang sửa">{(id) => <Input id={id} type="number" min={0} value={form.bays} onChange={(e) => setForm({ ...form, bays: e.target.value })} />}</Field>
          <Field label="Tên chi nhánh" className="sm:col-span-2">{(id) => <Input id={id} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
          <Field label="Địa chỉ" className="sm:col-span-2">{(id) => <Input id={id} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />}</Field>
          <Field label="Điện thoại">{(id) => <Input id={id} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />}</Field>
        </form>
      </Dialog>
    </div>
  );
}

// ---------------- Vai trò & quyền ----------------
function RolesTab() {
  const { can, me } = useAuth();
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  const [perms, setPerms] = useState<PermissionRow[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [r, p] = await Promise.all([api<RoleRow[]>('/roles'), api<PermissionRow[]>('/permissions')]);
    setRoles(r);
    setPerms(p);
  }, []);
  useEffect(() => void load(), [load]);

  const groups = useMemo(() => {
    const m = new Map<string, PermissionRow[]>();
    for (const p of perms) m.set(p.group, [...(m.get(p.group) ?? []), p]);
    return [...m.entries()];
  }, [perms]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api('/roles', { body: { name, permissions: picked } });
      setOpen(false);
      setName('');
      setPicked([]);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.errors?.[0]?.message ?? err.message) : 'Không lưu được');
    }
  };

  if (!roles) return <Spinner className="text-brand-600" />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-slate-500">Vai trò hệ thống theo ma trận quyền chuẩn và không sửa được. Chủ garage có thể tạo thêm vai trò tuỳ chỉnh.</p>
        {can('role.manage') && (
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            Tạo vai trò tuỳ chỉnh
          </Button>
        )}
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="role-matrix">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="sticky left-0 z-10 min-w-56 bg-white px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Quyền</th>
              {roles.map((r) => (
                <th key={r.id} className="min-w-24 px-2 py-3 text-center align-bottom">
                  <div className="text-xs font-semibold">{r.name}</div>
                  <div className="mt-1 flex justify-center gap-1">
                    {!r.isSystem && <Badge tone="lav">Tuỳ chỉnh</Badge>}
                    {r.require2fa && (
                      <Badge tone="sky">
                        <ShieldCheck className="h-3 w-3" />
                        2FA
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] font-normal text-slate-400">{r.memberCount} người</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(([group, items]) => (
              <Fragment key={group}>
                <tr className="bg-slate-50/80">
                  <td colSpan={roles.length + 1} className="sticky left-0 px-4 py-2 text-xs font-semibold text-brand-700">
                    {group}
                  </td>
                </tr>
                {items.map((p) => (
                  <tr key={p.code} className="border-b border-slate-50">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2">
                      <div>{p.label}</div>
                      <div className="font-mono text-[11px] text-slate-400">{p.code}</div>
                    </td>
                    {roles.map((r) => (
                      <td key={r.id} className="px-2 py-2 text-center">
                        {r.permissions.includes(p.code) ? <Check className="mx-auto h-4 w-4 text-mint-700" aria-label="có" /> : <Minus className="mx-auto h-4 w-4 text-slate-200" aria-label="không" />}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Card>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Tạo vai trò tuỳ chỉnh"
        wide
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Huỷ
            </Button>
            <Button type="submit" form="role-form" disabled={!name || !picked.length}>
              Tạo vai trò
            </Button>
          </>
        }
      >
        <form id="role-form" onSubmit={submit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Tên vai trò" hint="VD: Nhân viên rửa xe">{(id) => <Input id={id} required value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            {groups.map(([group, items]) => (
              <fieldset key={group} className="rounded-2xl border border-slate-100 p-3">
                <legend className="px-1 text-xs font-semibold text-brand-700">{group}</legend>
                <div className="space-y-1.5">
                  {items.map((p) => {
                    const mine = me?.permissions.includes(p.code as never);
                    return (
                      <Checkbox
                        key={p.code}
                        disabled={!mine}
                        checked={picked.includes(p.code)}
                        onChange={(e) => setPicked((x) => (e.target.checked ? [...x, p.code] : x.filter((c) => c !== p.code)))}
                        label={p.label}
                      />
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        </form>
      </Dialog>
    </div>
  );
}

// ---------------- Nhật ký thao tác ----------------
interface AuditItem {
  id: number;
  action: string;
  entity: string;
  entityId: string | null;
  actorName: string | null;
  after: unknown;
  ip: string | null;
  createdAt: string;
}

const ACTION_LABEL: Record<string, string> = {
  'auth.login': 'Đăng nhập',
  'auth.logout': 'Đăng xuất',
  'auth.login_failed': 'Đăng nhập sai',
  'auth.password_changed': 'Đổi mật khẩu',
  'auth.2fa_enabled': 'Bật xác thực 2 lớp',
  'staff.created': 'Thêm nhân viên',
  'staff.updated': 'Sửa nhân viên',
  'staff.locked': 'Khoá tài khoản',
  'staff.unlocked': 'Mở khoá tài khoản',
  'staff.password_reset': 'Đặt lại mật khẩu',
  'role.created': 'Tạo vai trò',
  'role.updated': 'Sửa vai trò',
  'role.deleted': 'Xoá vai trò',
  'branch.created': 'Thêm chi nhánh',
  'branch.updated': 'Sửa chi nhánh',
  'settings.print': 'Sửa mẫu in & tài khoản nhận tiền',
  'cash.thu': 'Lập phiếu thu',
  'cash.chi': 'Lập phiếu chi',
  'cash.voided': 'Huỷ phiếu thu / chi',
  'debt.collected': 'Thu nợ khách',
  'care.call': 'Ghi cuộc gọi chăm sóc',
  'care.created': 'Thêm việc gọi',
  'care.settings': 'Sửa mốc chăm sóc khách',
  'booking.created': 'Đặt lịch hẹn',
  'booking.updated': 'Sửa lịch hẹn',
  'booking.status': 'Đổi trạng thái lịch hẹn',
  'booking.checkin': 'Nhận xe từ lịch hẹn',
  'product.created': 'Thêm sản phẩm',
  'product.updated': 'Sửa sản phẩm',
  'product.deleted': 'Xoá sản phẩm',
  'supplier.created': 'Thêm nhà cung cấp',
  'supplier.updated': 'Sửa nhà cung cấp',
  'stock.nhap': 'Nhập hàng',
  'stock.chuyen': 'Chuyển kho',
  'stock.dieu_chinh': 'Kiểm kê, điều chỉnh tồn',
  'order.created': 'Tạo đơn',
  'order.updated': 'Sửa thông tin đơn',
  'order.items': 'Sửa hạng mục đơn',
  'order.status': 'Đổi trạng thái đơn',
  'payment.created': 'Thu tiền',
  'payment.voided': 'Huỷ phiếu thu',
  'file.uploaded': 'Tải file lên',
};

const FILTERS = [
  { value: '', label: 'Tất cả' },
  { value: 'auth.', label: 'Đăng nhập' },
  { value: 'staff.', label: 'Nhân viên' },
  { value: 'role.', label: 'Vai trò' },
  { value: 'branch.', label: 'Chi nhánh' },
  { value: 'file.', label: 'File' },
];

function AuditTab() {
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState<AuditItem[] | null>(null);
  const [next, setNext] = useState<number | null>(null);

  const load = useCallback(async (action: string, before?: number) => {
    const qs = new URLSearchParams({ limit: '30', ...(action ? { action } : {}), ...(before ? { before: String(before) } : {}) });
    const r = await api<{ items: AuditItem[]; nextBefore: number | null }>(`/audit-logs?${qs}`);
    setItems((cur) => (before ? [...(cur ?? []), ...r.items] : r.items));
    setNext(r.nextBefore);
  }, []);
  useEffect(() => {
    setItems(null);
    void load(filter);
  }, [filter, load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`rounded-full px-3.5 py-1.5 text-sm ${filter === f.value ? 'bg-brand-600 text-white' : 'bg-white/80 text-slate-600 hover:bg-white'}`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-500">Nhật ký chỉ được thêm, không ai sửa hay xoá được.</span>
      </div>
      <Card className="overflow-x-auto">
        {!items ? (
          <div className="p-8">
            <Spinner className="text-brand-600" />
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="audit-table">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-semibold">Thời gian</th>
                <th className="px-3 py-3 font-semibold">Người thực hiện</th>
                <th className="px-3 py-3 font-semibold">Thao tác</th>
                <th className="px-3 py-3 font-semibold">Chi tiết</th>
                <th className="px-5 py-3 font-semibold">IP</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-b border-slate-50 align-top last:border-0">
                  <td className="whitespace-nowrap px-5 py-2.5 text-slate-500">{new Date(i.createdAt).toLocaleString('vi-VN')}</td>
                  <td className="px-3 py-2.5">{i.actorName ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={i.action.endsWith('failed') || i.action.endsWith('locked') ? 'rose' : 'brand'}>{ACTION_LABEL[i.action] ?? i.action}</Badge>
                  </td>
                  <td className="max-w-md px-3 py-2.5">
                    {i.after ? <code className="line-clamp-2 break-all text-[11px] text-slate-500">{JSON.stringify(i.after)}</code> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{i.ip ?? '—'}</td>
                </tr>
              ))}
              {!items.length && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-slate-500">
                    Chưa có thao tác nào
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>
      {next && (
        <div className="text-center">
          <Button variant="outline" onClick={() => void load(filter, next)}>
            Xem thêm
          </Button>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { can } = useAuth();
  const tabs = [
    { value: 'chi-nhanh' as const, label: 'Chi nhánh' },
    ...(can('settings.manage') ? [{ value: 'mau-in' as const, label: 'Mẫu in & thanh toán' }, { value: 'cham-soc' as const, label: 'Chăm sóc khách' }] : []),
    ...(can('staff.view') ? [{ value: 'vai-tro' as const, label: 'Vai trò & quyền' }] : []),
    ...(can('audit.view') ? [{ value: 'nhat-ky' as const, label: 'Nhật ký thao tác' }] : []),
  ];
  const [tab, setTab] = useState<Tab>('chi-nhanh');
  return (
    <RequirePermission permission="audit.view">
      <div className="space-y-4">
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
        {tab === 'chi-nhanh' && <BranchesTab />}
        {tab === 'mau-in' && <PrintSettingsTab />}
        {tab === 'cham-soc' && <CareSettingsTab />}
        {tab === 'vai-tro' && <RolesTab />}
        {tab === 'nhat-ky' && <AuditTab />}
      </div>
    </RequirePermission>
  );
}
