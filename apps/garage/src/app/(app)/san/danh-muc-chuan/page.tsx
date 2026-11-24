'use client';

import { Alert, Badge, Button, Card, Checkbox, Dialog, Field, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import { ImagePlus, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { fmtDate } from '@/lib/crm';
import { uploadImage, type CatalogCategory, type CatalogItem, type CatalogKind } from '@/lib/marketplace';

const errMsg = (e: unknown, d: string) => (e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : d);
type ItemForm = {
  id: string | null;
  code: string;
  name: string;
  categoryId: string;
  brand: string;
  unit: string;
  description: string;
  specs: { label: string; value: string }[];
  image: { id: string; url: string | null } | null;
  active: boolean;
  proposalId?: string;
};
const emptyItem = (): ItemForm => ({ id: null, code: '', name: '', categoryId: '', brand: '', unit: '', description: '', specs: [], image: null, active: true });

/** Danh sách nhóm hiển thị dạng "Cha › Con" */
function catLabel(cats: CatalogCategory[], c: CatalogCategory) {
  const p = c.parentId ? cats.find((x) => x.id === c.parentId) : null;
  return p ? `${p.name} › ${c.name}` : c.name;
}

function ItemDialog({ kind, cats, form, onClose, onSaved }: { kind: CatalogKind; cats: CatalogCategory[]; form: ItemForm | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<ItemForm | null>(form);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => (setF(form), setError(null)), [form]);
  if (!f) return null;
  const set = (k: keyof ItemForm) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setError(null);
    const body = {
      kind,
      code: f.code,
      name: f.name,
      categoryId: f.categoryId || null,
      brand: f.brand,
      unit: f.unit,
      description: f.description,
      specs: f.specs.filter((s) => s.label.trim() && s.value.trim()),
      imageFileId: f.image?.id ?? null,
      active: f.active,
    };
    try {
      if (f.proposalId) await api(`/platform/catalog/proposals/${f.proposalId}/accept`, { body });
      else await api(f.id ? `/platform/catalog/items/${f.id}` : '/platform/catalog/items', { method: f.id ? 'PUT' : 'POST', body });
      onSaved();
    } catch (e) {
      setError(errMsg(e, 'Không lưu được'));
    }
  };
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={f.id ? 'Sửa mục danh mục chuẩn' : f.proposalId ? 'Tạo từ đề xuất của garage' : kind === 'PRODUCT' ? 'Thêm sản phẩm chuẩn (SKU)' : 'Thêm dịch vụ chuẩn'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => void save()} data-testid="save-catalog-item">
            Lưu
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {error && <Alert className="sm:col-span-2">{error}</Alert>}
        <Field label={kind === 'PRODUCT' ? 'Mã SKU' : 'Mã dịch vụ'} hint="Chữ, số, . _ / - (tự viết hoa)">
          {(id) => <Input id={id} value={f.code} onChange={set('code')} placeholder={kind === 'PRODUCT' ? 'LOP-MICH-2055516-PS4' : 'DV-BD-CAP1'} />}
        </Field>
        <Field label="Nhóm">
          {(id) => (
            <Select id={id} value={f.categoryId} onChange={set('categoryId')}>
              <option value="">— Chưa xếp nhóm —</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {catLabel(cats, c)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Tên" className="sm:col-span-2">
          {(id) => <Input id={id} value={f.name} onChange={set('name')} />}
        </Field>
        {kind === 'PRODUCT' && (
          <>
            <Field label="Thương hiệu">{(id) => <Input id={id} value={f.brand} onChange={set('brand')} />}</Field>
            <Field label="Đơn vị">{(id) => <Input id={id} value={f.unit} onChange={set('unit')} placeholder="Lốp, Can, Bình…" />}</Field>
          </>
        )}
        <div className="sm:col-span-2">
          <div className="mb-1.5 text-sm font-medium text-slate-700">Thông số (khách lọc / so sánh theo đây)</div>
          <div className="space-y-2">
            {f.specs.map((s, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={s.label}
                  onChange={(e) => setF({ ...f, specs: f.specs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                  placeholder="Kích cỡ"
                  aria-label={`Tên thông số ${i + 1}`}
                  className="w-40"
                />
                <Input
                  value={s.value}
                  onChange={(e) => setF({ ...f, specs: f.specs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
                  placeholder="205/55R16"
                  aria-label={`Giá trị thông số ${i + 1}`}
                />
                <button type="button" aria-label="Bỏ thông số" onClick={() => setF({ ...f, specs: f.specs.filter((_, j) => j !== i) })} className="px-2 text-slate-400 hover:text-rose-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button variant="ghost" onClick={() => setF({ ...f, specs: [...f.specs, { label: '', value: '' }] })}>
              <Plus className="h-4 w-4" /> Thêm thông số
            </Button>
          </div>
        </div>
        <Field label="Mô tả" className="sm:col-span-2">
          {(id) => <textarea id={id} rows={3} value={f.description} onChange={set('description')} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />}
        </Field>
        <div className="flex items-end gap-3">
          <div className="relative grid h-20 w-20 place-items-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {f.image?.url ? <img src={f.image.url} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5 text-slate-400" />}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label="Ảnh mẫu"
              className="absolute inset-0 cursor-pointer opacity-0"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) setF({ ...f, image: await uploadImage(file) });
              }}
            />
          </div>
          {f.image && (
            <Button variant="ghost" onClick={() => setF({ ...f, image: null })}>
              <X className="h-4 w-4" /> Bỏ ảnh
            </Button>
          )}
        </div>
        <div className="flex items-end pb-2">
          <Checkbox label="Đang dùng (garage chọn được khi đăng tin)" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
        </div>
      </div>
    </Dialog>
  );
}

function Items({ kind }: { kind: CatalogKind }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [rows, setRows] = useState<CatalogItem[] | null>(null);
  const [cats, setCats] = useState<CatalogCategory[]>([]);
  const [edit, setEdit] = useState<ItemForm | null>(null);
  const load = useCallback(
    () => api<CatalogItem[]>(`/platform/catalog/items?kind=${kind}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}${cat ? `&categoryId=${cat}` : ''}`).then(setRows),
    [kind, q, cat],
  );
  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  useEffect(() => void api<CatalogCategory[]>(`/platform/catalog/categories?kind=${kind}`).then(setCats), [kind]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full md:w-72">
          <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tên, mã, thương hiệu, thông số…" className="rounded-full bg-white/80 pl-10" aria-label="Tìm trong danh mục" />
        </div>
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="w-56" aria-label="Lọc theo nhóm">
          <option value="">Mọi nhóm</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {catLabel(cats, c)}
            </option>
          ))}
        </Select>
        <div className="flex-1" />
        <Button onClick={() => setEdit(emptyItem())} data-testid="add-catalog-item">
          <Plus className="h-4 w-4" />
          {kind === 'PRODUCT' ? 'Thêm SKU' : 'Thêm dịch vụ chuẩn'}
        </Button>
      </div>
      <Card className="overflow-x-auto">
        {!rows ? (
          <div className="grid place-items-center p-10">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="catalog-table">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-semibold">{kind === 'PRODUCT' ? 'Sản phẩm' : 'Dịch vụ'}</th>
                <th className="px-3 py-3 font-semibold">Nhóm</th>
                <th className="px-3 py-3 font-semibold">Thông số</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className={`border-b border-slate-50 last:border-0 ${i.active ? '' : 'opacity-50'}`} data-testid="catalog-row">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {i.imageUrl ? <img src={i.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <span className="h-10 w-10 rounded-lg bg-slate-100" />}
                      <div>
                        <div className="font-medium">{i.name}</div>
                        <div className="text-xs text-slate-500">
                          {i.code}
                          {i.brand && ` · ${i.brand}`}
                          {!i.active && ' · ngừng dùng'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-600">{i.category ?? '—'}</td>
                  <td className="px-3 py-3 text-xs text-slate-600">{i.specs.map((s) => `${s.label}: ${s.value}`).join(' · ') || '—'}</td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      aria-label={`Sửa ${i.name}`}
                      onClick={() =>
                        setEdit({
                          id: i.id,
                          code: i.code,
                          name: i.name,
                          categoryId: i.categoryId ?? '',
                          brand: i.brand ?? '',
                          unit: i.unit ?? '',
                          description: i.description ?? '',
                          specs: i.specs,
                          image: i.imageFileId ? { id: i.imageFileId, url: i.imageUrl } : null,
                          active: i.active,
                        })
                      }
                      className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center text-slate-500">
                    Chưa có mục nào.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>
      <ItemDialog kind={kind} cats={cats} form={edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), void load())} />
    </div>
  );
}

function Categories() {
  const [kind, setKind] = useState<CatalogKind>('PRODUCT');
  const [rows, setRows] = useState<CatalogCategory[] | null>(null);
  const [edit, setEdit] = useState<{ id: string | null; name: string; parentId: string; sortOrder: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<CatalogCategory[]>(`/platform/catalog/categories?kind=${kind}`).then(setRows), [kind]);
  useEffect(() => void load(), [load]);
  const save = async () => {
    if (!edit) return;
    try {
      await api(edit.id ? `/platform/catalog/categories/${edit.id}` : '/platform/catalog/categories', {
        method: edit.id ? 'PUT' : 'POST',
        body: { kind, name: edit.name, parentId: edit.parentId || null, sortOrder: Number(edit.sortOrder) || 0 },
      });
      setEdit(null);
      await load();
    } catch (e) {
      setError(errMsg(e, 'Không lưu được'));
    }
  };
  const roots = (rows ?? []).filter((c) => !c.parentId);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Tabs
          tabs={[
            { value: 'PRODUCT', label: 'Nhóm sản phẩm' },
            { value: 'SERVICE', label: 'Nhóm dịch vụ' },
          ]}
          value={kind}
          onChange={setKind}
        />
        <div className="flex-1" />
        <Button onClick={() => (setEdit({ id: null, name: '', parentId: '', sortOrder: '0' }), setError(null))} data-testid="add-category">
          <Plus className="h-4 w-4" /> Thêm nhóm
        </Button>
      </div>
      <Card className="divide-y divide-slate-100" data-testid="category-list">
        {roots.map((r) => (
          <div key={r.id} className="px-5 py-3">
            {[r, ...(rows ?? []).filter((c) => c.parentId === r.id)].map((c) => (
              <div key={c.id} className={`flex items-center gap-2 py-1 text-sm ${c.parentId ? 'pl-6 text-slate-600' : 'font-medium'}`}>
                <span className="flex-1">
                  {c.parentId && '└ '}
                  {c.name} <span className="text-xs font-normal text-slate-400">· {c.items} mục</span>
                </span>
                <button
                  type="button"
                  aria-label={`Sửa nhóm ${c.name}`}
                  onClick={() => (setEdit({ id: c.id, name: c.name, parentId: c.parentId ?? '', sortOrder: String(c.sortOrder) }), setError(null))}
                  className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ))}
        {rows && !rows.length && <div className="p-8 text-center text-sm text-slate-500">Chưa có nhóm.</div>}
      </Card>
      <Dialog
        open={edit !== null}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Sửa nhóm' : 'Thêm nhóm'}
        footer={
          <>
            <Button variant="outline" onClick={() => setEdit(null)}>
              Huỷ
            </Button>
            <Button onClick={() => void save()}>Lưu</Button>
          </>
        }
      >
        {edit && (
          <div className="grid gap-4 sm:grid-cols-2">
            {error && <Alert className="sm:col-span-2">{error}</Alert>}
            <Field label="Tên nhóm" className="sm:col-span-2">
              {(id) => <Input id={id} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus />}
            </Field>
            <Field label="Thuộc nhóm">
              {(id) => (
                <Select id={id} value={edit.parentId} onChange={(e) => setEdit({ ...edit, parentId: e.target.value })}>
                  <option value="">— Nhóm gốc —</option>
                  {roots
                    .filter((r) => r.id !== edit.id)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <Field label="Thứ tự">{(id) => <Input id={id} inputMode="numeric" value={edit.sortOrder} onChange={(e) => setEdit({ ...edit, sortOrder: e.target.value })} />}</Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}

interface Proposal {
  id: string;
  kind: CatalogKind;
  name: string;
  brand: string | null;
  note: string | null;
  status: 'CHO_XU_LY' | 'DA_TAO' | 'TU_CHOI';
  reviewNote: string | null;
  createdAt: string;
  garage: string;
}
const PROPOSAL: Record<Proposal['status'], { label: string; tone: 'sky' | 'mint' | 'rose' }> = {
  CHO_XU_LY: { label: 'Chờ xử lý', tone: 'sky' },
  DA_TAO: { label: 'Đã thêm', tone: 'mint' },
  TU_CHOI: { label: 'Từ chối', tone: 'rose' },
};

function Proposals() {
  const [status, setStatus] = useState('CHO_XU_LY');
  const [rows, setRows] = useState<Proposal[] | null>(null);
  const [create, setCreate] = useState<{ kind: CatalogKind; form: ItemForm } | null>(null);
  const [cats, setCats] = useState<CatalogCategory[]>([]);
  const load = useCallback(() => api<Proposal[]>(`/platform/catalog/proposals${status ? `?status=${status}` : ''}`).then(setRows), [status]);
  useEffect(() => void load(), [load]);
  const reject = async (p: Proposal) => {
    const note = prompt('Lý do không thêm (garage sẽ thấy):');
    if (!note) return;
    try {
      await api(`/platform/catalog/proposals/${p.id}/reject`, { body: { note } });
    } catch (e) {
      alert(errMsg(e, 'Không thực hiện được'));
    }
    await load();
  };
  const startCreate = async (p: Proposal) => {
    setCats(await api<CatalogCategory[]>(`/platform/catalog/categories?kind=${p.kind}`));
    setCreate({ kind: p.kind, form: { ...emptyItem(), name: p.name, brand: p.brand ?? '', description: p.note ?? '', proposalId: p.id } });
  };
  return (
    <div className="space-y-4">
      <Tabs
        tabs={[
          { value: 'CHO_XU_LY', label: 'Chờ xử lý' },
          { value: 'DA_TAO', label: 'Đã thêm' },
          { value: 'TU_CHOI', label: 'Từ chối' },
          { value: '', label: 'Tất cả' },
        ]}
        value={status}
        onChange={setStatus}
      />
      <Card className="overflow-x-auto">
        {!rows ? (
          <div className="grid place-items-center p-10">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="proposal-table">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-semibold">Đề xuất</th>
                <th className="px-3 py-3 font-semibold">Garage</th>
                <th className="px-3 py-3 font-semibold">Trạng thái</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-slate-500">
                      {p.kind === 'PRODUCT' ? 'Sản phẩm' : 'Dịch vụ'}
                      {p.brand && ` · ${p.brand}`}
                      {p.note && ` · ${p.note}`}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-600">
                    {p.garage}
                    <div className="text-xs text-slate-400">{fmtDate(p.createdAt)}</div>
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={PROPOSAL[p.status].tone}>{PROPOSAL[p.status].label}</Badge>
                    {p.reviewNote && <div className="text-xs text-slate-500">{p.reviewNote}</div>}
                  </td>
                  <td className="px-3 py-3">
                    {p.status === 'CHO_XU_LY' && (
                      <div className="flex justify-end gap-1">
                        <Button onClick={() => void startCreate(p)}>Tạo mục</Button>
                        <Button variant="ghost" onClick={() => void reject(p)}>
                          Từ chối
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center text-slate-500">
                    Không có đề xuất.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>
      {create && <ItemDialog kind={create.kind} cats={cats} form={create.form} onClose={() => setCreate(null)} onSaved={() => (setCreate(null), void load())} />}
    </div>
  );
}

function Catalog() {
  const [tab, setTab] = useState<'PRODUCT' | 'SERVICE' | 'cats' | 'proposals'>('PRODUCT');
  return (
    <div className="space-y-4">
      <Tabs
        tabs={[
          { value: 'PRODUCT', label: 'Sản phẩm chuẩn (SKU)' },
          { value: 'SERVICE', label: 'Dịch vụ chuẩn' },
          { value: 'cats', label: 'Nhóm' },
          { value: 'proposals', label: 'Đề xuất từ garage' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'PRODUCT' || tab === 'SERVICE' ? <Items key={tab} kind={tab} /> : tab === 'cats' ? <Categories /> : <Proposals />}
    </div>
  );
}

/** A6.20–A6.24 Danh mục chuẩn của sàn */
export default function PlatformCatalogPage() {
  return (
    <RequirePermission permission="platform.catalog.manage">
      <Catalog />
    </RequirePermission>
  );
}
