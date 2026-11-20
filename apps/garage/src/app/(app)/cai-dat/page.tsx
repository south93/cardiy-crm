'use client';

import { Alert, Badge, Button, Card, Checkbox, Dialog, Field, Input, Spinner, Tabs } from '@cardiy/ui';
import { Building2, Check, Minus, Pencil, Plus, ShieldCheck } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { BranchRow, PermissionRow, RoleRow } from '@/lib/org';

type Tab = 'chi-nhanh' | 'vai-tro' | 'nhat-ky';

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
    ...(can('staff.view') ? [{ value: 'vai-tro' as const, label: 'Vai trò & quyền' }] : []),
    ...(can('audit.view') ? [{ value: 'nhat-ky' as const, label: 'Nhật ký thao tác' }] : []),
  ];
  const [tab, setTab] = useState<Tab>('chi-nhanh');
  return (
    <RequirePermission permission="audit.view">
      <div className="space-y-4">
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
        {tab === 'chi-nhanh' && <BranchesTab />}
        {tab === 'vai-tro' && <RolesTab />}
        {tab === 'nhat-ky' && <AuditTab />}
      </div>
    </RequirePermission>
  );
}
