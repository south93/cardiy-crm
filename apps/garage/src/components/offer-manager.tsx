'use client';

import { Alert, Badge, Button, Card, Checkbox, Dialog, Field, Input, Spinner, Tabs } from '@cardiy/ui';
import { Eye, EyeOff, ImagePlus, Lightbulb, Pencil, Plus, Search, Send, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ProductPicker } from '@/components/product-picker';
import { api, ApiError } from '@/lib/api';
import { fmtMoney } from '@/lib/crm';
import { OFFER_STATUS, uploadImage, type CatalogItem, type CatalogKind, type Offer, type OfferStatus } from '@/lib/marketplace';
import { moneyInput, parseMoney } from '@/lib/orders';

const errMsg = (e: unknown, d: string) => (e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : d);
const area = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm';

interface Draft {
  id: string | null;
  status: OfferStatus | null;
  item: CatalogItem | null;
  product: { id: string; code: string; name: string } | null;
  manualStock: string;
  branchIds: string[];
  price: string;
  listPrice: string;
  priceFrom: boolean;
  installIncluded: boolean;
  mfgYear: string;
  durationMinutes: string;
  note: string;
  images: { id: string; url: string | null }[];
}
const blank = (): Draft => ({
  id: null,
  status: null,
  item: null,
  product: null,
  manualStock: '',
  branchIds: [],
  price: '',
  listPrice: '',
  priceFrom: false,
  installIncluded: false,
  mfgYear: '',
  durationMinutes: '',
  note: '',
  images: [],
});
const fromOffer = (o: Offer): Draft => ({
  id: o.id,
  status: o.status,
  item: o.catalogItem,
  product: o.product,
  manualStock: o.manualStock != null ? String(o.manualStock) : '',
  branchIds: o.branchIds,
  price: moneyInput(o.price),
  listPrice: o.listPrice ? moneyInput(o.listPrice) : '',
  priceFrom: o.priceFrom,
  installIncluded: o.installIncluded,
  mfgYear: o.mfgYear ? String(o.mfgYear) : '',
  durationMinutes: o.durationMinutes ? String(o.durationMinutes) : '',
  note: o.note ?? '',
  images: o.images,
});

/** Chọn sản phẩm / dịch vụ trong danh mục chuẩn; không thấy thì đề xuất sàn thêm */
function CatalogPicker({ kind, onPick }: { kind: CatalogKind; onPick: (i: CatalogItem) => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<CatalogItem[] | null>(null);
  const [propose, setPropose] = useState<{ name: string; brand: string; note: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => void api<CatalogItem[]>(`/catalog/items?kind=${kind}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`).then(setRows), 250);
    return () => clearTimeout(t);
  }, [q, kind]);
  const send = async () => {
    if (!propose) return;
    setErr(null);
    try {
      await api('/catalog/proposals', { body: { kind, ...propose } });
      setMsg('Đã gửi đề xuất. Sàn thêm vào danh mục chuẩn xong thì bạn chọn được ở đây.');
      setPropose(null);
    } catch (e) {
      setErr(errMsg(e, 'Không gửi được'));
    }
  };
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={kind === 'PRODUCT' ? 'Tìm theo tên, mã, kích cỡ (vd: 205/55R16 michelin)…' : 'Tìm dịch vụ…'}
          className="pl-10"
          aria-label="Tìm trong danh mục chuẩn"
          autoFocus
        />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-100" data-testid="catalog-results">
        {!rows ? (
          <div className="p-4 text-center">
            <Spinner />
          </div>
        ) : (
          rows.map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() => onPick(i)}
              className="flex w-full items-center gap-3 border-b border-slate-50 px-3 py-2 text-left text-sm last:border-0 hover:bg-brand-50"
              data-testid="catalog-option"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium">{i.name}</div>
                <div className="truncate text-xs text-slate-500">
                  {i.code}
                  {i.brand && ` · ${i.brand}`}
                  {i.category && ` · ${i.category}`}
                </div>
              </div>
            </button>
          ))
        )}
        {rows && !rows.length && <div className="p-4 text-center text-sm text-slate-500">Không tìm thấy trong danh mục chuẩn.</div>}
      </div>
      {msg && <Alert tone="mint">{msg}</Alert>}
      {propose ? (
        <div className="space-y-2 rounded-xl bg-slate-50 p-3">
          {err && <Alert>{err}</Alert>}
          <div className="grid gap-2 sm:grid-cols-2">
            <Input value={propose.name} onChange={(e) => setPropose({ ...propose, name: e.target.value })} placeholder="Tên sản phẩm / dịch vụ cần thêm" aria-label="Tên đề xuất" />
            <Input value={propose.brand} onChange={(e) => setPropose({ ...propose, brand: e.target.value })} placeholder="Thương hiệu" aria-label="Thương hiệu đề xuất" />
          </div>
          <Input value={propose.note} onChange={(e) => setPropose({ ...propose, note: e.target.value })} placeholder="Thông số, ghi chú cho sàn" aria-label="Ghi chú đề xuất" />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPropose(null)}>
              Huỷ
            </Button>
            <Button variant="outline" onClick={() => void send()} disabled={propose.name.trim().length < 2} data-testid="send-proposal">
              Gửi đề xuất
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => (setPropose({ name: q, brand: '', note: '' }), setMsg(null))}
          className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
        >
          <Lightbulb className="h-4 w-4" /> Không thấy? Đề xuất sàn thêm vào danh mục
        </button>
      )}
    </div>
  );
}

/**
 * Tin đăng sản phẩm hoặc dịch vụ trên sàn.
 * Đối tác: nhập số lượng tồn tay, tin cần sàn duyệt. PLG (garage chủ sàn): liên kết hàng trong kho, tồn tự lấy từ chi nhánh bán, lên bán ngay.
 */
export function OfferManager({ kind, garage, branches = [] }: { kind: CatalogKind; garage?: boolean; branches?: { id: string; code: string; name: string }[] }) {
  const [status, setStatus] = useState<string>('');
  const [data, setData] = useState<{ counts: Record<string, number>; items: Offer[] } | null>(null);
  const [d, setD] = useState<Draft | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const isProduct = kind === 'PRODUCT';
  const word = isProduct ? 'sản phẩm' : 'dịch vụ';

  const load = useCallback(() => api<NonNullable<typeof data>>(`/shop/offers?kind=${kind}${status ? `&status=${status}` : ''}`).then(setData), [kind, status]);
  useEffect(() => void load(), [load]);

  const act = async (o: Offer, a: 'submit' | 'hide' | 'show' | 'delete') => {
    try {
      await api(`/shop/offers/${o.id}/${a}`, { method: 'POST' });
    } catch (e) {
      alert(errMsg(e, 'Không thực hiện được'));
    }
    await load();
  };

  const save = async (submit: boolean) => {
    if (!d?.item) return setError(`Chọn ${word} trong danh mục chuẩn`);
    setBusy(true);
    setError(null);
    const body = {
      kind,
      catalogItemId: d.item.id,
      productId: garage && isProduct ? (d.product?.id ?? null) : null,
      manualStock: isProduct && !d.product && d.manualStock !== '' ? Number(d.manualStock) : null,
      branchIds: d.branchIds,
      price: parseMoney(d.price),
      listPrice: d.listPrice ? parseMoney(d.listPrice) : null,
      priceFrom: d.priceFrom,
      installIncluded: d.installIncluded,
      mfgYear: d.mfgYear ? Number(d.mfgYear) : null,
      durationMinutes: d.durationMinutes ? Number(d.durationMinutes) : null,
      note: d.note,
      imageFileIds: d.images.map((i) => i.id),
    };
    try {
      const o = await api<Offer>(d.id ? `/shop/offers/${d.id}` : '/shop/offers', { method: d.id ? 'PUT' : 'POST', body });
      if (submit && o.status === 'NHAP') await api(`/shop/offers/${o.id}/submit`, { method: 'POST' });
      setD(null);
      await load();
    } catch (e) {
      setError(errMsg(e, 'Không lưu được'));
    } finally {
      setBusy(false);
    }
  };

  const addImage = async (file: File | undefined) => {
    if (!file || !d) return;
    setUploading(true);
    try {
      const img = await uploadImage(file);
      setD((x) => (x ? { ...x, images: [...x.images, img] } : x));
    } catch (e) {
      setError(errMsg(e, 'Không tải được ảnh'));
    } finally {
      setUploading(false);
    }
  };

  const actionsFor = (o: Offer) => (
    <div className="flex justify-end gap-1">
      {o.status === 'NHAP' && (
        <Button variant="outline" onClick={() => void act(o, 'submit')} data-testid="submit-offer">
          <Send className="h-4 w-4" />
          {garage ? 'Đăng bán' : 'Gửi duyệt'}
        </Button>
      )}
      {o.status === 'DANG_BAN' && (
        <button
          type="button"
          title="Tạm ẩn"
          aria-label={`Tạm ẩn ${o.catalogItem.name}`}
          onClick={() => void act(o, 'hide')}
          className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
        >
          <EyeOff className="h-4 w-4" />
        </button>
      )}
      {o.status === 'TAM_AN' && (
        <button
          type="button"
          title="Hiện lại"
          aria-label={`Hiện lại ${o.catalogItem.name}`}
          onClick={() => void act(o, 'show')}
          className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
        >
          <Eye className="h-4 w-4" />
        </button>
      )}
      {o.status !== 'BI_GO' && (
        <button
          type="button"
          aria-label={`Sửa ${o.catalogItem.name}`}
          onClick={() => (setD(fromOffer(o)), setPicking(false), setError(null))}
          className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
        >
          <Pencil className="h-4 w-4" />
        </button>
      )}
      {(o.status === 'NHAP' || o.status === 'BI_TU_CHOI') && (
        <button
          type="button"
          aria-label={`Xoá ${o.catalogItem.name}`}
          onClick={() => confirm('Xoá tin này?') && void act(o, 'delete')}
          className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  const tabs = (['', 'DANG_BAN', 'CHO_DUYET', 'NHAP', 'BI_TU_CHOI', 'TAM_AN', 'BI_GO'] as const)
    .filter((s) => !s || s === 'DANG_BAN' || data?.counts[s])
    .map((s) => ({ value: s as string, label: s ? `${OFFER_STATUS[s].label}${data?.counts[s] ? ` (${data.counts[s]})` : ''}` : 'Tất cả' }));
  const branchName = (ids: string[]) => (ids.length ? ids.map((id) => branches.find((b) => b.id === id)?.code ?? '?').join(', ') : 'Mọi chi nhánh');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs tabs={tabs} value={status} onChange={setStatus} />
        <div className="flex-1" />
        <Button onClick={() => (setD(blank()), setPicking(true), setError(null))} data-testid="add-offer">
          <Plus className="h-4 w-4" />
          Đăng {word}
        </Button>
      </div>
      <Card className="overflow-x-auto">
        {!data ? (
          <div className="grid place-items-center p-10">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : (
          <table className="hidden w-full text-sm md:table" data-testid="offer-table">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-semibold">{isProduct ? 'Sản phẩm' : 'Dịch vụ'}</th>
                <th className="px-3 py-3 text-right font-semibold">Giá</th>
                {isProduct && <th className="px-3 py-3 text-right font-semibold">Còn bán</th>}
                <th className="px-3 py-3 font-semibold">Trạng thái</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((o) => (
                <tr key={o.id} className="border-b border-slate-50 last:border-0" data-testid="offer-row">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {o.images[0]?.url ? <img src={o.images[0].url} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <span className="h-10 w-10 rounded-lg bg-slate-100" />}
                      <div className="min-w-0">
                        <div className="font-medium">{o.catalogItem.name}</div>
                        <div className="text-xs text-slate-500">
                          {o.catalogItem.code}
                          {o.product && ` · kho ${o.product.code}`}
                          {garage && ` · ${branchName(o.branchIds)}`}
                          {o.installIncluded && ' · gồm lắp đặt'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    <div className="font-semibold">
                      {o.priceFrom && 'Từ '}
                      {fmtMoney(o.price)}
                    </div>
                    {o.listPrice && <div className="text-xs text-slate-400 line-through">{fmtMoney(o.listPrice)}</div>}
                  </td>
                  {isProduct && (
                    <td className="px-3 py-3 text-right tabular-nums">
                      {o.stock === 0 ? <span className="font-medium text-rose-600">Hết hàng</span> : o.stock}
                      {o.product && <div className="text-xs text-slate-400">theo kho</div>}
                    </td>
                  )}
                  <td className="px-3 py-3">
                    <Badge tone={OFFER_STATUS[o.status].tone}>{OFFER_STATUS[o.status].label}</Badge>
                    {o.reviewNote && (o.status === 'BI_TU_CHOI' || o.status === 'BI_GO') && <div className="mt-0.5 max-w-56 text-xs text-rose-600">{o.reviewNote}</div>}
                  </td>
                  <td className="px-3 py-3">{actionsFor(o)}</td>
                </tr>
              ))}
              {!data.items.length && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-slate-500">
                    Chưa có tin đăng {word}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        {data && (
          <div className="divide-y divide-slate-100 md:hidden">
            {data.items.map((o) => (
              <div key={o.id} className="flex gap-3 p-4" data-testid="offer-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {o.images[0]?.url ? <img src={o.images[0].url} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" /> : <span className="h-14 w-14 shrink-0 rounded-xl bg-slate-100" />}
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-medium">{o.catalogItem.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold tabular-nums">
                      {o.priceFrom && 'Từ '}
                      {fmtMoney(o.price)}
                    </span>
                    {o.listPrice && <span className="text-xs text-slate-400 line-through">{fmtMoney(o.listPrice)}</span>}
                    {isProduct && <span className={`text-xs ${o.stock === 0 ? 'font-medium text-rose-600' : 'text-slate-500'}`}>{o.stock === 0 ? 'Hết hàng' : `Còn ${o.stock}`}</span>}
                  </div>
                  <div className="mt-1">
                    <Badge tone={OFFER_STATUS[o.status].tone}>{OFFER_STATUS[o.status].label}</Badge>
                  </div>
                  {o.reviewNote && (o.status === 'BI_TU_CHOI' || o.status === 'BI_GO') && <div className="mt-0.5 text-xs text-rose-600">{o.reviewNote}</div>}
                  <div className="mt-2">{actionsFor(o)}</div>
                </div>
              </div>
            ))}
            {!data.items.length && <div className="px-5 py-12 text-center text-sm text-slate-500">Chưa có tin đăng {word}.</div>}
          </div>
        )}
      </Card>

      <Dialog
        open={d !== null}
        onClose={() => setD(null)}
        wide
        title={d?.id ? `Sửa tin ${word}` : `Đăng ${word}`}
        footer={
          d &&
          !picking && (
            <>
              <Button variant="outline" onClick={() => setD(null)}>
                Huỷ
              </Button>
              {!d.id ? (
                <>
                  <Button variant="outline" onClick={() => void save(false)} disabled={busy}>
                    Lưu nháp
                  </Button>
                  <Button onClick={() => void save(true)} disabled={busy} data-testid="save-submit-offer">
                    {garage ? 'Lưu & đăng bán' : 'Lưu & gửi duyệt'}
                  </Button>
                </>
              ) : (
                <Button onClick={() => void save(false)} disabled={busy} data-testid="save-offer">
                  Lưu
                </Button>
              )}
            </>
          )
        }
      >
        {d &&
          (picking ? (
            <CatalogPicker kind={kind} onPick={(item) => (setD({ ...d, item }), setPicking(false))} />
          ) : (
            <div className="space-y-4">
              {error && <Alert>{error}</Alert>}
              {!garage && d.id && (d.status === 'DANG_BAN' || d.status === 'TAM_AN') && (
                <Alert tone="sky">Đổi {word}, ghi chú hoặc ảnh thì tin phải chờ sàn duyệt lại. Đổi giá, số lượng giữ nguyên tin đang bán.</Alert>
              )}
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-slate-500">{isProduct ? 'Sản phẩm chuẩn' : 'Dịch vụ chuẩn'}</div>
                  <div className="font-semibold" data-testid="picked-item">
                    {d.item?.name ?? '—'}
                  </div>
                  {d.item && (
                    <div className="text-xs text-slate-500">
                      {d.item.code}
                      {d.item.specs.map((s) => ` · ${s.label}: ${s.value}`)}
                    </div>
                  )}
                </div>
                <Button variant="outline" onClick={() => setPicking(true)}>
                  Đổi
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={isProduct ? 'Giá bán' : 'Giá'}>
                  {(id) => <Input id={id} inputMode="numeric" value={d.price} onChange={(e) => setD({ ...d, price: moneyInput(parseMoney(e.target.value)) })} data-testid="offer-price" />}
                </Field>
                <Field label="Giá niêm yết (gạch ngang)" hint="Để trống nếu không giảm giá">
                  {(id) => <Input id={id} inputMode="numeric" value={d.listPrice} onChange={(e) => setD({ ...d, listPrice: e.target.value ? moneyInput(parseMoney(e.target.value)) : '' })} />}
                </Field>
                {isProduct ? (
                  <Field label="Năm sản xuất">
                    {(id) => <Input id={id} inputMode="numeric" value={d.mfgYear} onChange={(e) => setD({ ...d, mfgYear: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="2026" />}
                  </Field>
                ) : (
                  <Field label="Thời gian làm (phút)">
                    {(id) => <Input id={id} inputMode="numeric" value={d.durationMinutes} onChange={(e) => setD({ ...d, durationMinutes: e.target.value.replace(/\D/g, '') })} placeholder="60" />}
                  </Field>
                )}
              </div>
              {isProduct ? (
                <div className="space-y-3">
                  {garage && (
                    <div>
                      <div className="mb-1.5 text-sm font-medium text-slate-700">Hàng trong kho (tồn tự cập nhật)</div>
                      {d.product ? (
                        <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
                          <span className="flex-1">
                            {d.product.code} · {d.product.name}
                          </span>
                          <button type="button" aria-label="Bỏ liên kết kho" onClick={() => setD({ ...d, product: null })} className="text-slate-400 hover:text-rose-600">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <ProductPicker
                          kind="PHU_TUNG"
                          label="Liên kết hàng trong kho"
                          placeholder="Tìm hàng trong kho để lấy tồn…"
                          onPick={(p) => setD({ ...d, product: { id: p.id, code: p.code, name: p.name } })}
                        />
                      )}
                    </div>
                  )}
                  {!d.product && (
                    <Field label="Số lượng còn bán" hint={garage ? 'Hoặc liên kết hàng trong kho ở trên để tồn tự cập nhật' : 'Cập nhật khi bán hết / nhập thêm; 0 = hiện "hết hàng"'}>
                      {(id) => (
                        <Input
                          id={id}
                          inputMode="numeric"
                          value={d.manualStock}
                          onChange={(e) => setD({ ...d, manualStock: e.target.value.replace(/\D/g, '') })}
                          className="w-40"
                          data-testid="offer-stock"
                        />
                      )}
                    </Field>
                  )}
                  <Checkbox label="Giá đã gồm công lắp đặt" checked={d.installIncluded} onChange={(e) => setD({ ...d, installIncluded: e.target.checked })} />
                </div>
              ) : (
                <Checkbox label='Giá "từ" (tuỳ dòng xe, báo giá chính xác khi xem xe)' checked={d.priceFrom} onChange={(e) => setD({ ...d, priceFrom: e.target.checked })} />
              )}
              {garage && branches.length > 1 && (
                <div>
                  <div className="mb-1.5 text-sm font-medium text-slate-700">Chi nhánh bán {isProduct && '(tồn cộng từ các chi nhánh này)'}</div>
                  <div className="flex flex-wrap gap-3">
                    {branches.map((b) => (
                      <Checkbox
                        key={b.id}
                        label={`${b.code} · ${b.name}`}
                        checked={d.branchIds.includes(b.id)}
                        onChange={(e) => setD({ ...d, branchIds: e.target.checked ? [...d.branchIds, b.id] : d.branchIds.filter((x) => x !== b.id) })}
                      />
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Không chọn = mọi chi nhánh.</p>
                </div>
              )}
              <Field label="Mô tả thêm">{(id) => <textarea id={id} rows={3} value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} className={area} />}</Field>
              <div>
                <div className="mb-1.5 text-sm font-medium text-slate-700">Ảnh ({d.images.length}/6)</div>
                <div className="flex flex-wrap gap-2">
                  {d.images.map((img) => (
                    <div key={img.id} className="relative h-20 w-20 overflow-hidden rounded-xl bg-slate-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {img.url && <img src={img.url} alt="" className="h-full w-full object-cover" />}
                      <button
                        type="button"
                        aria-label="Bỏ ảnh"
                        onClick={() => setD({ ...d, images: d.images.filter((x) => x.id !== img.id) })}
                        className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-white/90 text-slate-600"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {d.images.length < 6 && (
                    <label className="grid h-20 w-20 cursor-pointer place-items-center rounded-xl border border-dashed border-slate-300 text-slate-400 hover:bg-slate-50">
                      {uploading ? <Spinner /> : <ImagePlus className="h-5 w-5" />}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        aria-label="Thêm ảnh"
                        data-testid="offer-image"
                        onChange={(e) => (void addImage(e.target.files?.[0]), (e.target.value = ''))}
                      />
                    </label>
                  )}
                </div>
              </div>
            </div>
          ))}
      </Dialog>
    </div>
  );
}
