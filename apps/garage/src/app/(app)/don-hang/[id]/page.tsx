'use client';

import type { PermissionCode } from '@cardiy/shared';
import { Alert, Badge, Button, Card, CardTitle, Dialog, Field, Input, Select, Spinner } from '@cardiy/ui';
import { Ban, Car, ClipboardCheck, Printer, CheckCircle2, ChevronLeft, CircleDollarSign, Pencil, Play, RotateCcw, Truck, Undo2, User } from 'lucide-react';
import Link from 'next/link';
import { OrderQuoteCard } from '@/components/order-quote-card';
import { OrderReviewCard, type Review } from '@/components/order-review-card';
import { useParams } from 'next/navigation';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { OrderItemsEditor } from '@/components/order-items';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtKm, fmtMoney } from '@/lib/crm';
import { draftsToPayload, fmtDateTime, METHODS, methodLabel, moneyInput, parseMoney, PAYMENT_STATE, STATUS, type ItemDraft, type ItemKind, type OrderStatus, type PaymentMethod, type PaymentState } from '@/lib/orders';

interface Order {
  id: string;
  code: string;
  status: OrderStatus;
  branch: { id: string; code: string; name: string };
  customer: { id: string; code: string; name: string; phone: string | null };
  vehicle: { id: string; plate: string; make: string | null; model: string | null; year: number | null } | null;
  odometerKm: number | null;
  request: string | null;
  note: string | null;
  advisor: { id: string; name: string } | null;
  createdBy: string | null;
  technician: { id: string; name: string } | null;
  receivedAt: string;
  promisedAt: string | null;
  completedAt: string | null;
  deliveredAt: string | null;
  cancelReason: string | null;
  editable: boolean;
  review: Review | null;
  items: { id: string; kind: ItemKind; productId: string | null; name: string; unit: string | null; quantity: string; unitPrice: number | null; discount: number | null; amount: number | null; vatRate: number; section: string | null }[];
  subtotal: number | null;
  vatTotal: number | null;
  insuranceAmount: number | null;
  customerPays: number | null;
  orderDiscount: number | null;
  total: number | null;
  paid: number | null;
  due: number | null;
  paymentState: PaymentState | null;
  payments: { id: string; amount: number; method: PaymentMethod; note: string | null; paidAt: string; by: string | null; voidedAt: string | null; voidReason: string | null }[];
  history: { from: OrderStatus | null; to: OrderStatus; note: string | null; at: string; by: string | null }[];
}

/** Nút chuyển trạng thái (khớp luật ở API: apps/api/src/orders/order-rules.ts) */
const ACTIONS: { from: OrderStatus; to: OrderStatus; label: string; icon: typeof Play; anyOf: PermissionCode[]; variant?: 'outline' }[] = [
  { from: 'TIEP_NHAN', to: 'DANG_SUA', label: 'Bắt đầu sửa', icon: Play, anyOf: ['ro.manage', 'ro.task.update'] },
  { from: 'DANG_SUA', to: 'HOAN_THANH', label: 'Báo hoàn thành', icon: CheckCircle2, anyOf: ['ro.manage', 'ro.task.update'] },
  { from: 'HOAN_THANH', to: 'DA_GIAO', label: 'Giao xe', icon: Truck, anyOf: ['ro.manage'] },
  { from: 'DANG_SUA', to: 'TIEP_NHAN', label: 'Trả về tiếp nhận', icon: Undo2, anyOf: ['ro.manage'], variant: 'outline' },
  { from: 'HOAN_THANH', to: 'DANG_SUA', label: 'Mở lại để sửa', icon: RotateCcw, anyOf: ['ro.manage'], variant: 'outline' },
];

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : fallback);

function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const [o, setO] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<ItemDraft[]>([]);
  const [discount, setDiscount] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState({ amount: '', method: 'TIEN_MAT' as PaymentMethod, note: '' });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [debtOpen, setDebtOpen] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [techs, setTechs] = useState<{ id: string; name: string; roles: string[] }[]>([]);

  const load = useCallback(async () => setO(await api<Order>(`/orders/${id}`)), [id]);
  const reload = useCallback(() => void load(), [load]);
  useEffect(() => void load(), [load]);
  const branchId = o?.branch.id;
  const canManage = can('ro.manage');
  useEffect(() => {
    if (!branchId || !canManage) return;
    api<{ id: string; name: string; roles: string[] }[]>(`/orders/staff-options?branchId=${branchId}`).then((r) => setTechs(r.filter((x) => x.roles.includes('KTV'))), () => setTechs([]));
  }, [branchId, canManage]);

  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      return true;
    } catch (e) {
      setError(errMsg(e, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!o) return <Spinner className="h-6 w-6 text-brand-600" />;

  const anyOf = (ps: PermissionCode[]) => ps.some((p) => can(p));
  const actions = ACTIONS.filter((a) => a.from === o.status && anyOf(a.anyOf));
  const canEdit = o.editable && can('ro.manage');
  const seesMoney = o.total !== null;

  const move = async (to: OrderStatus) => {
    if (to === 'DA_GIAO' && (o.due ?? 0) > 0) return setDebtOpen(true);
    await run(() => api(`/orders/${o.id}/status`, { body: { to } }), 'Không đổi được trạng thái');
  };

  const startEdit = () => {
    setRows(o.items.map((i) => ({ key: i.id, productId: i.productId, kind: i.kind, name: i.name, unit: i.unit ?? '', quantity: i.quantity.replace(/\.0+$/, ''), unitPrice: moneyInput(i.unitPrice ?? 0), discount: moneyInput(i.discount ?? 0), vatRate: String(i.vatRate), section: i.section ?? '' })));
    setDiscount(moneyInput(o.orderDiscount ?? 0));
    setEditing(true);
  };
  const saveItems = async () => {
    const ok = await run(async () => {
      await api(`/orders/${o.id}/items`, { method: 'PUT', body: { items: draftsToPayload(rows) } });
      if (parseMoney(discount) !== o.orderDiscount) await api(`/orders/${o.id}`, { method: 'PATCH', body: { orderDiscount: parseMoney(discount) } });
    }, 'Không lưu được hạng mục');
    if (ok) setEditing(false);
  };

  return (
    <div className="space-y-4" data-testid="order-detail">
      <Link href={o.status === 'DA_GIAO' || o.status === 'HUY' ? '/don-hoan-thanh' : '/don-dang-xu-ly'} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
        <ChevronLeft className="h-4 w-4" />
        {o.status === 'DA_GIAO' || o.status === 'HUY' ? 'Đơn hoàn thành' : 'Đơn đang xử lý'}
      </Link>

      <Card className="flex flex-wrap items-start gap-4 p-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold" data-testid="order-code">
              {o.code}
            </h2>
            <span data-testid="order-status">
              <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
            </span>
            {o.paymentState && o.status !== 'HUY' && <Badge tone={PAYMENT_STATE[o.paymentState].tone}>{PAYMENT_STATE[o.paymentState].label}</Badge>}
          </div>
          <div className="mt-1 text-sm text-slate-500">
            {o.branch.name} · Nhận xe {fmtDateTime(o.receivedAt)}
            {o.createdBy && ` · Người tạo: ${o.createdBy}`}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <Link href={`/khach-hang/${o.customer.id}`} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 hover:bg-slate-100">
              <User className="h-4 w-4 text-brand-600" />
              <span className="font-medium">{o.customer.name}</span>
              <span className="text-slate-500">{o.customer.phone}</span>
            </Link>
            {o.vehicle ? (
              <Link href={`/xe/${o.vehicle.id}`} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 hover:bg-slate-100">
                <Car className="h-4 w-4 text-sky-600" />
                <span className="font-mono font-semibold">{o.vehicle.plate}</span>
                <span className="text-slate-500">{[o.vehicle.make, o.vehicle.model, o.vehicle.year].filter(Boolean).join(' ')}</span>
                {o.odometerKm !== null && <span className="text-slate-500">· {fmtKm(o.odometerKm)}</span>}
              </Link>
            ) : (
              <span className="rounded-xl bg-slate-50 px-3 py-2 text-slate-500">Bán lẻ (không có xe)</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Button key={a.to} variant={a.variant} disabled={busy} onClick={() => void move(a.to)} data-testid={`to-${a.to}`}>
              <a.icon className="h-4 w-4" />
              {a.label}
            </Button>
          ))}
          {anyOf(['ro.task.update', 'ro.manage']) && (
            <Link href={`/viec-cua-toi/${o.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50" data-testid="open-inspection">
              <ClipboardCheck className="h-3.5 w-3.5" />
              Nhập phiếu kiểm tra
            </Link>
          )}
          <div className="flex gap-1 rounded-full bg-slate-50 p-1" aria-label="In phiếu">
            {[
              { form: 'kiem-tra', label: 'Phiếu kiểm tra xe', money: false },
              { form: 'bao-gia', label: 'Phiếu dịch vụ', money: true },
              { form: 'hoa-don', label: 'Hoá đơn', money: true },
            ]
              .filter((f) => !f.money || seesMoney)
              .map((f) => (
                <a key={f.form} href={`/in/${f.form}/${o.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-slate-700 hover:bg-white" data-testid={`print-${f.form}`}>
                  <Printer className="h-3.5 w-3.5" />
                  {f.label}
                </a>
              ))}
          </div>
          {o.editable && can('ro.approve') && (
            <Button variant="outline" onClick={() => setCancelOpen(true)} data-testid="cancel-order">
              <Ban className="h-4 w-4" />
              Huỷ đơn
            </Button>
          )}
        </div>
      </Card>

      {error && <Alert>{error}</Alert>}
      {o.status === 'HUY' && <Alert tone="peach">Đơn đã huỷ: {o.cancelReason}</Alert>}

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card className="p-4 lg:p-5">
            <div className="flex items-center justify-between">
              <CardTitle>Hạng mục</CardTitle>
              {canEdit && !editing && (
                <Button variant="outline" onClick={startEdit} data-testid="edit-items">
                  <Pencil className="h-4 w-4" />
                  Sửa hạng mục
                </Button>
              )}
            </div>
            {editing ? (
              <div className="mt-3 space-y-3">
                <OrderItemsEditor rows={rows} onChange={setRows} orderDiscount={discount} onDiscountChange={setDiscount} make={o.vehicle?.make} branchId={o.branch.id} />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setEditing(false)}>
                    Huỷ
                  </Button>
                  <Button onClick={() => void saveItems()} disabled={busy} data-testid="save-items">
                    {busy && <Spinner />}
                    Lưu hạng mục
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm" data-testid="item-table">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                      <th className="py-2 font-medium">Hạng mục</th>
                      <th className="py-2 text-right font-medium">SL</th>
                      {seesMoney && <th className="py-2 text-right font-medium">Đơn giá</th>}
                      {seesMoney && <th className="py-2 text-right font-medium">Thành tiền</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {o.items.map((i, k) => (
                      <Fragment key={i.id}>
                      {i.section && i.section !== o.items[k - 1]?.section && (
                        <tr>
                          <td colSpan={4} className="pt-3 text-xs font-semibold uppercase tracking-wide text-brand-700">
                            {i.section}
                          </td>
                        </tr>
                      )}
                      <tr className="border-b border-slate-50 last:border-0">
                        <td className="py-2.5">
                          <div className="font-medium">{i.name}</div>
                          <div className="text-xs text-slate-500">{i.kind === 'DICH_VU' ? 'Dịch vụ' : 'Phụ tùng'}</div>
                        </td>
                        <td className="py-2.5 text-right tabular-nums">
                          {Number(i.quantity).toLocaleString('vi-VN')} {i.unit}
                        </td>
                        {seesMoney && <td className="py-2.5 text-right tabular-nums">{fmtMoney(i.unitPrice ?? 0)}</td>}
                        {seesMoney && (
                          <td className="py-2.5 text-right tabular-nums">
                            {fmtMoney(i.amount ?? 0)}
                            {!!i.discount && <div className="text-xs text-mint-700">−{fmtMoney(i.discount)}</div>}
                            {!!i.vatRate && <div className="text-xs text-slate-500">VAT {i.vatRate}%</div>}
                          </td>
                        )}
                      </tr>
                      </Fragment>
                    ))}
                    {!o.items.length && (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-slate-500">
                          Chưa có hạng mục
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {seesMoney && (
                  <dl className="ml-auto mt-3 w-full max-w-xs space-y-1 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Tổng tiền</dt>
                      <dd className="tabular-nums">{fmtMoney(o.subtotal ?? 0)}</dd>
                    </div>
                    {!!o.orderDiscount && (
                      <div className="flex justify-between">
                        <dt className="text-slate-500">Chiết khấu</dt>
                        <dd className="tabular-nums text-mint-700">−{fmtMoney(o.orderDiscount)}</dd>
                      </div>
                    )}
                    {!!o.vatTotal && (
                      <div className="flex justify-between">
                        <dt className="text-slate-500">Thuế VAT</dt>
                        <dd className="tabular-nums">{fmtMoney(o.vatTotal)}</dd>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-slate-100 pt-1.5 text-base font-semibold">
                      <dt>Tổng cộng</dt>
                      <dd className="tabular-nums" data-testid="order-total">
                        {fmtMoney(o.total ?? 0)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">Trong đó – Bảo hiểm TT</dt>
                      <dd>
                        {canEdit ? (
                          <Input
                            key={o.insuranceAmount}
                            aria-label="Bảo hiểm thanh toán"
                            inputMode="numeric"
                            className="h-9 w-32 text-right"
                            defaultValue={moneyInput(o.insuranceAmount ?? 0)}
                            onBlur={(e) => {
                              const v = parseMoney(e.target.value);
                              if (v !== o.insuranceAmount) void run(() => api(`/orders/${o.id}`, { method: 'PATCH', body: { insuranceAmount: v } }), 'Không lưu được phần bảo hiểm');
                            }}
                          />
                        ) : (
                          <span className="tabular-nums">{fmtMoney(o.insuranceAmount ?? 0)}</span>
                        )}
                      </dd>
                    </div>
                    {!!o.insuranceAmount && (
                      <div className="flex justify-between font-medium">
                        <dt>Khách hàng thanh toán</dt>
                        <dd className="tabular-nums" data-testid="customer-pays">
                          {fmtMoney(o.customerPays ?? 0)}
                        </dd>
                      </div>
                    )}
                  </dl>
                )}
              </div>
            )}
          </Card>

          <OrderQuoteCard orderId={o.id} editable={o.editable} itemCount={o.items.length} version={`${o.total}:${o.items.length}`} onAnswered={reload} />
          {o.review && <OrderReviewCard orderId={o.id} review={o.review} onSaved={reload} />}

          <Card className="p-4 lg:p-5">
            <CardTitle>Thông tin tiếp nhận</CardTitle>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-500">Khách yêu cầu</dt>
                <dd className="whitespace-pre-line">{o.request ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Kỹ thuật viên</dt>
                <dd>
                  {canEdit ? (
                    <Select
                      aria-label="Kỹ thuật viên"
                      className="mt-1"
                      value={o.technician?.id ?? ''}
                      onChange={(e) => void run(() => api(`/orders/${o.id}`, { method: 'PATCH', body: { technicianId: e.target.value || null } }), 'Không giao được việc')}
                    >
                      <option value="">— Chưa giao —</option>
                      {techs.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    (o.technician?.name ?? 'Chưa giao')
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Hẹn giao</dt>
                <dd>{fmtDateTime(o.promisedAt)}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-500">Ghi chú</dt>
                <dd>
                  {canEdit ? (
                    <Input
                      key={o.note ?? ''}
                      aria-label="Ghi chú đơn"
                      className="mt-1"
                      defaultValue={o.note ?? ''}
                      placeholder="VD: Mai khách lấy"
                      onBlur={(e) => {
                        if (e.target.value.trim() !== (o.note ?? '')) void run(() => api(`/orders/${o.id}`, { method: 'PATCH', body: { note: e.target.value } }), 'Không lưu được ghi chú');
                      }}
                    />
                  ) : (
                    <span className="whitespace-pre-line">{o.note ?? '—'}</span>
                  )}
                </dd>
              </div>
            </dl>
          </Card>
        </div>

        <div className="space-y-4">
          {seesMoney && (
            <Card className="p-4 lg:p-5" data-testid="payment-card">
              <div className="flex items-center justify-between">
                <CardTitle>Thanh toán</CardTitle>
                {can('payment.collect') && o.status !== 'HUY' && (o.due ?? 0) > 0 && (
                  <Button
                    onClick={() => {
                      setPay({ amount: moneyInput(o.due ?? 0), method: 'TIEN_MAT', note: '' });
                      setPayOpen(true);
                    }}
                    data-testid="collect"
                  >
                    <CircleDollarSign className="h-4 w-4" />
                    Thu tiền
                  </Button>
                )}
              </div>
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Tổng cộng</dt>
                  <dd className="tabular-nums">{fmtMoney(o.total ?? 0)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Đã thanh toán</dt>
                  <dd className="tabular-nums text-mint-700" data-testid="paid">
                    {fmtMoney(o.paid ?? 0)}
                  </dd>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-1.5 font-semibold">
                  <dt>Còn phải thu</dt>
                  <dd className={`tabular-nums ${(o.due ?? 0) > 0 ? 'text-rose-600' : ''}`} data-testid="due">
                    {fmtMoney(o.due ?? 0)}
                  </dd>
                </div>
              </dl>
              {o.payments.length > 0 && (
                <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm" data-testid="payment-list">
                  {o.payments.map((p) => (
                    <li key={p.id} className={`flex items-start justify-between gap-2 ${p.voidedAt ? 'text-slate-400 line-through' : ''}`}>
                      <div>
                        <div className="font-medium">
                          {fmtMoney(p.amount)} · {methodLabel(p.method)}
                        </div>
                        <div className="text-xs text-slate-500 no-underline">
                          {fmtDateTime(p.paidAt)}
                          {p.by && ` · ${p.by}`}
                          {p.note && ` · ${p.note}`}
                          {p.voidedAt && ` · Đã huỷ: ${p.voidReason}`}
                        </div>
                      </div>
                      {!p.voidedAt && can('payment.collect') && (o.status !== 'DA_GIAO' || can('ro.approve')) && (
                        <button type="button" onClick={() => (setVoiding(p.id), setReason(''))} className="shrink-0 text-xs text-rose-600 hover:underline">
                          Huỷ phiếu
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card className="p-4 lg:p-5">
            <CardTitle>Lịch sử</CardTitle>
            <ol className="mt-3 space-y-3 border-l-2 border-slate-100 pl-4 text-sm" data-testid="order-history">
              {o.history.map((h, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500" />
                  <div className="font-medium">{STATUS[h.to].label}</div>
                  <div className="text-xs text-slate-500">
                    {fmtDateTime(h.at)}
                    {h.by && ` · ${h.by}`}
                  </div>
                  {h.note && <div className="text-xs text-slate-600">{h.note}</div>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <Dialog
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title="Thu tiền"
        footer={
          <>
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              Huỷ
            </Button>
            <Button
              disabled={busy || !parseMoney(pay.amount)}
              data-testid="save-payment"
              onClick={async () => {
                const ok = await run(() => api(`/orders/${o.id}/payments`, { body: { amount: parseMoney(pay.amount), method: pay.method, note: pay.note || null } }), 'Không ghi được phiếu thu');
                if (ok) setPayOpen(false);
              }}
            >
              Ghi phiếu thu
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          {error && payOpen && <Alert>{error}</Alert>}
          <Field label="Số tiền" hint={`Còn phải thu ${fmtMoney(o.due ?? 0)}`}>
            {(fid) => <Input id={fid} inputMode="numeric" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: moneyInput(parseMoney(e.target.value)) })} />}
          </Field>
          <Field label="Hình thức">
            {(fid) => (
              <Select id={fid} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value as PaymentMethod })}>
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Ghi chú">{(fid) => <Input id={fid} value={pay.note} placeholder="VD: CK Vietcombank" onChange={(e) => setPay({ ...pay, note: e.target.value })} />}</Field>
        </div>
      </Dialog>

      <Dialog
        open={debtOpen}
        onClose={() => setDebtOpen(false)}
        title="Giao xe khi khách còn nợ"
        footer={
          <>
            <Button variant="outline" onClick={() => setDebtOpen(false)}>
              Quay lại thu tiền
            </Button>
            <Button
              disabled={busy}
              data-testid="confirm-debt"
              onClick={async () => {
                const ok = await run(() => api(`/orders/${o.id}/status`, { body: { to: 'DA_GIAO', allowDebt: true } }), 'Không giao xe được');
                if (ok) setDebtOpen(false);
              }}
            >
              Giao xe, ghi công nợ
            </Button>
          </>
        }
      >
        <p className="text-sm">
          Khách còn nợ <b>{fmtMoney(o.due ?? 0)}</b>. Số này sẽ được ghi vào công nợ của khách <b>{o.customer.name}</b>.
        </p>
      </Dialog>

      <Dialog
        open={cancelOpen || voiding !== null}
        onClose={() => (setCancelOpen(false), setVoiding(null))}
        title={voiding ? 'Huỷ phiếu thu' : 'Huỷ đơn'}
        footer={
          <>
            <Button variant="outline" onClick={() => (setCancelOpen(false), setVoiding(null))}>
              Đóng
            </Button>
            <Button
              disabled={busy || reason.trim().length < 3}
              data-testid="confirm-cancel"
              onClick={async () => {
                const ok = voiding
                  ? await run(() => api(`/orders/${o.id}/payments/${voiding}/void`, { body: { reason } }), 'Không huỷ được phiếu thu')
                  : await run(() => api(`/orders/${o.id}/status`, { body: { to: 'HUY', reason } }), 'Không huỷ được đơn');
                if (ok) {
                  setCancelOpen(false);
                  setVoiding(null);
                }
              }}
            >
              Xác nhận huỷ
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          {error && (cancelOpen || voiding) && <Alert>{error}</Alert>}
          <Field label="Lý do">{(fid) => <Input id={fid} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}</Field>
          {!voiding && <p className="text-sm text-slate-500">Đơn đã huỷ không mở lại được.</p>}
        </div>
      </Dialog>
    </div>
  );
}

export default function OrderPage() {
  return (
    <RequirePermission permission="ro.view">
      <OrderDetail />
    </RequirePermission>
  );
}
