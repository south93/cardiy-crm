'use client';

import { Alert, Badge, Button, Card, Checkbox, Dialog, Field, Input, Select, Spinner } from '@cardiy/ui';
import { normalizeVnPhone } from '@cardiy/shared';
import { KeyRound, Lock, Pencil, Plus, ShieldCheck, Unlock, UserRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ALL_BRANCHES, type BranchRow, type RoleRow, type StaffRow } from '@/lib/org';

interface Assignment {
  roleId: string;
  branchId: string | null;
}

function StaffForm({
  roles,
  branches,
  initial,
  onSubmit,
  onCancel,
  isEdit,
}: {
  roles: RoleRow[];
  branches: BranchRow[];
  initial?: { fullName: string; phone: string; title: string; roles: Assignment[] };
  onSubmit: (v: { fullName: string; phone: string; title: string; roles: Assignment[] }) => Promise<void>;
  onCancel: () => void;
  isEdit?: boolean;
}) {
  const { me } = useAuth();
  const allScope = !!me?.roles.some((r) => r.branchId === null);
  const [fullName, setFullName] = useState(initial?.fullName ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [roleIds, setRoleIds] = useState<string[]>([...new Set(initial?.roles.map((r) => r.roleId) ?? [])]);
  const [branch, setBranch] = useState<string>(() => {
    const b = initial?.roles[0]?.branchId;
    return b === undefined ? (allScope ? ALL_BRANCHES : (branches[0]?.id ?? '')) : (b ?? ALL_BRANCHES);
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isEdit && !normalizeVnPhone(phone)) return setError('Số điện thoại không hợp lệ');
    if (!roleIds.length) return setError('Chọn ít nhất một vai trò');
    setBusy(true);
    try {
      const branchId = branch === ALL_BRANCHES ? null : branch;
      await onSubmit({ fullName, phone, title, roles: roleIds.map((roleId) => ({ roleId, branchId })) });
    } catch (err) {
      setError(err instanceof ApiError ? (err.errors?.[0]?.message ?? err.message) : 'Không lưu được');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" id="staff-form">
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Họ và tên">{(id) => <Input id={id} name="fullName" required value={fullName} onChange={(e) => setFullName(e.target.value)} />}</Field>
        <Field label="Số điện thoại (dùng để đăng nhập)">
          {(id) => <Input id={id} name="phone" inputMode="tel" required disabled={isEdit} value={phone} onChange={(e) => setPhone(e.target.value)} />}
        </Field>
        <Field label="Chức danh" hint="Không bắt buộc, VD: KTV máy gầm">
          {(id) => <Input id={id} name="title" value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field label="Làm việc tại">
          {(id) => (
            <Select id={id} name="branch" value={branch} onChange={(e) => setBranch(e.target.value)}>
              {allScope && <option value={ALL_BRANCHES}>Mọi chi nhánh</option>}
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-700">Vai trò</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {roles.map((r) => (
            <Checkbox
              key={r.id}
              name="role"
              value={r.code}
              disabled={!r.grantable}
              checked={roleIds.includes(r.id)}
              onChange={(e) => setRoleIds((ids) => (e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id)))}
              label={
                <span>
                  {r.name}
                  {!r.isSystem && <span className="ml-1 text-xs text-lav-700">(tuỳ chỉnh)</span>}
                  {!r.grantable && <span className="block text-xs text-slate-400">Vượt quyền của bạn</span>}
                </span>
              }
            />
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>
          Huỷ
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />}
          {isEdit ? 'Lưu thay đổi' : 'Thêm nhân viên'}
        </Button>
      </div>
    </form>
  );
}

function TempPasswordNotice({ name, phone, password, onClose }: { name: string; phone: string; password: string; onClose: () => void }) {
  return (
    <div className="space-y-4" data-testid="temp-password">
      <Alert tone="mint">Đã tạo tài khoản cho {name}.</Alert>
      <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm">
        <div>
          Số điện thoại: <b>{phone}</b>
        </div>
        <div className="mt-1">
          Mật khẩu tạm: <b className="font-mono text-base tracking-wider" data-testid="temp-password-value">{password}</b>
        </div>
      </div>
      <p className="text-sm text-slate-600">Gửi thông tin này cho nhân viên. Mật khẩu tạm chỉ hiện <b>một lần</b>; nhân viên phải đổi mật khẩu ở lần đăng nhập đầu.</p>
      <div className="flex justify-end">
        <Button onClick={onClose}>Đã ghi lại</Button>
      </div>
    </div>
  );
}

export default function StaffPage() {
  const { can } = useAuth();
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [dialog, setDialog] = useState<{ kind: 'create' } | { kind: 'edit'; row: StaffRow } | { kind: 'temp'; name: string; phone: string; password: string } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'mint' | 'rose'; text: string } | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const [s, r, b] = await Promise.all([api<StaffRow[]>('/staff'), api<RoleRow[]>('/roles'), api<BranchRow[]>('/branches')]);
    setStaff(s);
    setRoles(r);
    setBranches(b);
  }, []);
  useEffect(() => {
    if (can('staff.view')) void load();
  }, [can, load]);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (staff ?? []).filter((s) => !k || s.fullName.toLowerCase().includes(k) || s.phone.includes(k.replace(/\D/g, '') || '§'));
  }, [staff, q]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setNotice(null);
    try {
      await fn();
      setNotice({ tone: 'mint', text: ok });
      await load();
    } catch (e) {
      setNotice({ tone: 'rose', text: e instanceof ApiError ? e.message : 'Thao tác không thành công' });
    }
  };

  return (
    <RequirePermission permission="staff.view">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input placeholder="Tìm tên hoặc số điện thoại…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs rounded-full bg-white/80" aria-label="Tìm nhân viên" />
          <div className="flex-1" />
          {can('staff.manage') && (
            <Button onClick={() => setDialog({ kind: 'create' })} data-testid="add-staff">
              <Plus className="h-4 w-4" />
              Thêm nhân viên
            </Button>
          )}
        </div>
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

        <Card className="overflow-hidden">
          {!staff ? (
            <div className="grid place-items-center p-10">
              <Spinner className="h-6 w-6 text-brand-600" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="staff-table">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3 font-semibold">Nhân viên</th>
                    <th className="px-3 py-3 font-semibold">Vai trò</th>
                    <th className="px-3 py-3 font-semibold">Chi nhánh</th>
                    <th className="px-3 py-3 font-semibold">Trạng thái</th>
                    <th className="px-3 py-3 font-semibold">Đăng nhập gần nhất</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.membershipId} className="border-b border-slate-50 last:border-0 hover:bg-white/60" data-testid="staff-row" data-phone={s.phone}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sky-100 text-sky-700">
                            <UserRound className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <div className="font-medium">
                              {s.fullName} {s.isSelf && <span className="text-xs text-slate-400">(bạn)</span>}
                            </div>
                            <div className="text-xs text-slate-500">
                              {s.phone}
                              {s.title ? ` · ${s.title}` : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {[...new Set(s.roles.map((r) => r.name))].map((n) => (
                            <Badge key={n} tone="brand">
                              {n}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{[...new Set(s.roles.map((r) => r.branchName ?? 'Mọi chi nhánh'))].join(', ')}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {s.status === 'ACTIVE' ? <Badge tone="mint">Hoạt động</Badge> : <Badge tone="rose">Đã khoá</Badge>}
                          {s.mustChangePassword && <Badge tone="peach">Chờ đổi mật khẩu</Badge>}
                          {s.totpEnabled && (
                            <Badge tone="sky">
                              <ShieldCheck className="h-3 w-3" />
                              2FA
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-slate-500">{s.lastLoginAt ? new Date(s.lastLoginAt).toLocaleString('vi-VN') : 'Chưa đăng nhập'}</td>
                      <td className="px-5 py-3">
                        {s.canManage && can('staff.manage') && (
                          <div className="flex justify-end gap-1">
                            <button type="button" title="Sửa" aria-label={`Sửa ${s.fullName}`} className="rounded-full p-2 text-slate-500 hover:bg-brand-50" onClick={() => setDialog({ kind: 'edit', row: s })}>
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              title="Đặt lại mật khẩu"
                              aria-label={`Đặt lại mật khẩu ${s.fullName}`}
                              className="rounded-full p-2 text-slate-500 hover:bg-brand-50"
                              onClick={() =>
                                window.confirm(`Đặt lại mật khẩu cho ${s.fullName}? Mọi thiết bị của họ sẽ bị đăng xuất.`) &&
                                void act(async () => {
                                  const r = await api<{ tempPassword: string }>(`/staff/${s.membershipId}/reset-password`, { method: 'POST' });
                                  setDialog({ kind: 'temp', name: s.fullName, phone: s.phone, password: r.tempPassword });
                                }, `Đã đặt lại mật khẩu cho ${s.fullName}`)
                              }
                            >
                              <KeyRound className="h-4 w-4" />
                            </button>
                            {s.status === 'ACTIVE' ? (
                              <button
                                type="button"
                                title="Khoá tài khoản"
                                aria-label={`Khoá ${s.fullName}`}
                                className="rounded-full p-2 text-rose-700 hover:bg-rose-100"
                                onClick={() => window.confirm(`Khoá tài khoản ${s.fullName}? Họ sẽ bị đăng xuất ngay.`) && void act(() => api(`/staff/${s.membershipId}/lock`, { method: 'POST' }), `Đã khoá ${s.fullName}`)}
                              >
                                <Lock className="h-4 w-4" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                title="Mở khoá"
                                aria-label={`Mở khoá ${s.fullName}`}
                                className="rounded-full p-2 text-mint-700 hover:bg-mint-100"
                                onClick={() => void act(() => api(`/staff/${s.membershipId}/unlock`, { method: 'POST' }), `Đã mở khoá ${s.fullName}`)}
                              >
                                <Unlock className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!filtered.length && (
                    <tr>
                      <td colSpan={6} className="px-5 py-10 text-center text-slate-500">
                        Không có nhân viên phù hợp
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Dialog open={dialog?.kind === 'create'} onClose={() => setDialog(null)} title="Thêm nhân viên" wide>
        {dialog?.kind === 'create' && (
          <StaffForm
            roles={roles}
            branches={branches}
            onCancel={() => setDialog(null)}
            onSubmit={async (v) => {
              const r = await api<{ tempPassword: string | null; existingAccount: boolean }>('/staff', {
                body: { fullName: v.fullName, phone: v.phone, title: v.title || undefined, roles: v.roles },
              });
              await load();
              if (r.tempPassword) setDialog({ kind: 'temp', name: v.fullName, phone: normalizeVnPhone(v.phone) ?? v.phone, password: r.tempPassword });
              else {
                setDialog(null);
                setNotice({ tone: 'mint', text: `${v.fullName} đã có tài khoản CARDIY: thêm vào garage, đăng nhập bằng mật khẩu hiện có.` });
              }
            }}
          />
        )}
      </Dialog>
      <Dialog open={dialog?.kind === 'edit'} onClose={() => setDialog(null)} title="Sửa nhân viên" wide>
        {dialog?.kind === 'edit' && (
          <StaffForm
            isEdit
            roles={roles}
            branches={branches}
            initial={{ fullName: dialog.row.fullName, phone: dialog.row.phone, title: dialog.row.title ?? '', roles: dialog.row.roles.map((r) => ({ roleId: r.roleId, branchId: r.branchId })) }}
            onCancel={() => setDialog(null)}
            onSubmit={async (v) => {
              await api(`/staff/${dialog.row.membershipId}`, { method: 'PATCH', body: { fullName: v.fullName, title: v.title || null, roles: v.roles } });
              setDialog(null);
              setNotice({ tone: 'mint', text: `Đã cập nhật ${v.fullName}` });
              await load();
            }}
          />
        )}
      </Dialog>
      <Dialog open={dialog?.kind === 'temp'} onClose={() => setDialog(null)} title="Thông tin đăng nhập">
        {dialog?.kind === 'temp' && <TempPasswordNotice name={dialog.name} phone={dialog.phone} password={dialog.password} onClose={() => setDialog(null)} />}
      </Dialog>
    </RequirePermission>
  );
}
