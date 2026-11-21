'use client';

import { Alert, Badge, Button, Card, Dialog, Field, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import { HandCoins, Minus, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CustomerPicker } from '@/components/customer-picker';
import { Pager } from '@/components/pager';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCurrentBranch } from '@/lib/branch';
import { fmtDate, fmtMoney } from '@/lib/crm';
import { fmtDateTime, methodLabel, METHODS, moneyInput, parseMoney, type PaymentMethod } from '@/lib/orders';

interface Row {
  id: string;
  source: 'ORDER' | 'ENTRY';
  code: string;
  type: 'THU' | 'CHI';
  category: string;
  amount: number;
  method: PaymentMethod;
  party: string | null;
  customerId: string | null;
  orderId: string | null;
  branch: string;
  note: string | null;
  at: string;
  by: string | null;
  voided: boolean;
  voidReason: string | null;
}
interface Book {
  opening: number;
  thu: number;
  chi: number;
  closing: number;
  byMethod: Record<PaymentMethod, { opening: number; thu: number; chi: number; closing: number }>;
  rows: Row[];
}
interface Categories {
  THU: { code: string; label: string }[];
  CHI: { code: string; label: string }[];
}
interface DebtRow {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  openingLeft: number;
  orderDebt: number;
  debt: number;
  orders: number;
  oldest: string | null;
}
interface DebtDetail {
  customer: { id: string; code: string; name: string; phone: string | null };
  openingLeft: number;
  orders: { id: string; code: string; branch: string; total: number; paid: number; due: number; date: string | null }[];
  total: number;
}

const errMsg = (e: unknown, f: string) => (e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : f);
const dayStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const CASH_METHODS = METHODS.filter((m) => m.value !== 'BAO_HIEM');

function Stat({ label, value, tone = '' }: { label: string; value: number; tone?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone}`}>{fmtMoney(value)}</div>
    </Card>
  );
}

function EntryForm({ type, branchId, onDone }: { type: 'THU' | 'CHI'; branchId: string; onDone: () => void }) {
  const [cats, setCats] = useState<Categories | null>(null);
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('TIEN_MAT');
  const [party, setParty] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(dayStr(new Date()));
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Categories>('/finance/categories').then((c) => {
      setCats(c);
      setCategory(c[type].find((x) => x.code !== 'THU_NO_DAU_KY')?.code ?? c[type][0]!.code);
    });
  }, [type]);
  const needCustomer = category === 'THU_NO_DAU_KY';
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const today = dayStr(new Date()) === date;
      await api('/finance/entries', {
        body: { type, branchId, category, amount: parseMoney(amount), method, counterparty: party || null, note: note || null, customerId: customer?.id ?? null, occurredAt: today ? null : new Date(`${date}T12:00:00`).toISOString() },
      });
      onDone();
    } catch (e) {
      setError(errMsg(e, 'Không lưu được phiếu'));
      setBusy(false);
    }
  };
  if (!cats) return <Spinner className="text-brand-600" />;
  return (
    <div className="grid gap-4 sm:grid-cols-2" data-testid="entry-form">
      {error && <Alert className="sm:col-span-2">{error}</Alert>}
      <Field label="Khoản mục">
        {(id) => (
          <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
            {cats[type].map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Ngày">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      <Field label="Số tiền">{(id) => <Input id={id} inputMode="numeric" value={amount} onChange={(e) => setAmount(moneyInput(parseMoney(e.target.value)))} autoFocus />}</Field>
      <Field label="Hình thức">
        {(id) => (
          <Select id={id} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {CASH_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {needCustomer ? (
        <div className="sm:col-span-2">
          <div className="mb-1.5 text-sm font-medium text-slate-700">Khách hàng</div>
          {customer ? (
            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm">
              <span className="font-medium">{customer.name}</span>
              <button type="button" className="text-xs text-brand-600" onClick={() => setCustomer(null)}>
                Đổi
              </button>
            </div>
          ) : (
            <CustomerPicker onPick={async (cid) => setCustomer(await api<{ id: string; name: string }>(`/customers/${cid}`))} />
          )}
        </div>
      ) : (
        <Field label={type === 'THU' ? 'Người nộp' : 'Người nhận'} className="sm:col-span-2">
          {(id) => <Input id={id} value={party} onChange={(e) => setParty(e.target.value)} />}
        </Field>
      )}
      <Field label="Diễn giải" className="sm:col-span-2">
        {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <div className="flex justify-end sm:col-span-2">
        <Button onClick={() => void save()} disabled={busy || !parseMoney(amount) || (needCustomer && !customer)} data-testid="save-entry">
          {busy && <Spinner />}
          Lưu phiếu {type === 'THU' ? 'thu' : 'chi'}
        </Button>
      </div>
    </div>
  );
}

function CashBook({ branchId }: { branchId: string }) {
  const { can } = useAuth();
  const [preset, setPreset] = useState<'today' | '7d' | 'month' | 'custom'>('today');
  const [from, setFrom] = useState(dayStr(new Date()));
  const [to, setTo] = useState(dayStr(new Date()));
  const [method, setMethod] = useState('');
  const [book, setBook] = useState<Book | null>(null);
  const [entry, setEntry] = useState<'THU' | 'CHI' | null>(null);
  const [voiding, setVoiding] = useState<Row | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const now = new Date();
    if (preset === 'custom') return;
    const start = preset === 'today' ? now : preset === '7d' ? new Date(now.getTime() - 6 * 86_400_000) : new Date(now.getFullYear(), now.getMonth(), 1);
    setFrom(dayStr(start));
    setTo(dayStr(now));
  }, [preset]);
  const range = useMemo(() => ({ from: new Date(`${from}T00:00:00`), to: new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000) }), [from, to]);
  const load = useCallback(async () => {
    if (!branchId) return;
    const p = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString(), branchId });
    if (method) p.set('method', method);
    setBook(await api<Book>(`/finance/cashbook?${p}`));
  }, [range, branchId, method]);
  useEffect(() => void load(), [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)} className="w-auto rounded-full bg-white/80" aria-label="Khoảng thời gian">
          <option value="today">Hôm nay</option>
          <option value="7d">7 ngày gần đây</option>
          <option value="month">Tháng này</option>
          <option value="custom">Tự chọn</option>
        </Select>
        {preset === 'custom' && (
          <>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto rounded-full bg-white/80" aria-label="Từ ngày" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto rounded-full bg-white/80" aria-label="Đến ngày" />
          </>
        )}
        <Select value={method} onChange={(e) => setMethod(e.target.value)} className="w-auto rounded-full bg-white/80" aria-label="Hình thức">
          <option value="">Mọi hình thức</option>
          {METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
        <div className="flex-1" />
        {can('finance.manage') && (
          <>
            <Button onClick={() => setEntry('THU')} data-testid="new-receipt">
              <Plus className="h-4 w-4" />
              Phiếu thu
            </Button>
            <Button variant="outline" onClick={() => setEntry('CHI')} data-testid="new-payment">
              <Minus className="h-4 w-4" />
              Phiếu chi
            </Button>
          </>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
      {!book ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="cash-summary">
            <Stat label="Tồn đầu kỳ" value={book.opening} />
            <Stat label="Tổng thu" value={book.thu} tone="text-mint-700" />
            <Stat label="Tổng chi" value={book.chi} tone="text-rose-600" />
            <Stat label="Tồn cuối kỳ" value={book.closing} tone="text-brand-700" />
          </div>
          <Card className="overflow-x-auto p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="pb-2 font-medium">Hình thức</th>
                  <th className="pb-2 text-right font-medium">Tồn đầu</th>
                  <th className="pb-2 text-right font-medium">Thu</th>
                  <th className="pb-2 text-right font-medium">Chi</th>
                  <th className="pb-2 text-right font-medium">Tồn cuối</th>
                </tr>
              </thead>
              <tbody>
                {METHODS.map((m) => {
                  const x = book.byMethod[m.value];
                  if (!x.opening && !x.thu && !x.chi) return null;
                  return (
                    <tr key={m.value} className="border-t border-slate-50">
                      <td className="py-1.5">{m.label}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtMoney(x.opening)}</td>
                      <td className="py-1.5 text-right tabular-nums text-mint-700">{fmtMoney(x.thu)}</td>
                      <td className="py-1.5 text-right tabular-nums text-rose-600">{fmtMoney(x.chi)}</td>
                      <td className="py-1.5 text-right font-semibold tabular-nums">{fmtMoney(x.closing)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="cash-table">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-semibold">Thời gian</th>
                  <th className="px-3 py-3 font-semibold">Chứng từ</th>
                  <th className="px-3 py-3 font-semibold">Khoản mục · Người nộp / nhận</th>
                  <th className="px-3 py-3 font-semibold">Hình thức</th>
                  <th className="px-3 py-3 text-right font-semibold">Thu</th>
                  <th className="px-3 py-3 text-right font-semibold">Chi</th>
                  <th className="px-5 py-3 font-semibold">Người lập</th>
                </tr>
              </thead>
              <tbody>
                {book.rows.map((r) => (
                  <tr key={r.source + r.id} className={`border-b border-slate-50 last:border-0 ${r.voided ? 'text-slate-400 line-through' : ''}`} data-testid="cash-row">
                    <td className="whitespace-nowrap px-5 py-2.5 text-slate-500">{fmtDateTime(r.at)}</td>
                    <td className="px-3 py-2.5">
                      {r.orderId ? (
                        <Link href={`/don-hang/${r.orderId}`} className="font-medium text-brand-600 hover:underline">
                          {r.code}
                        </Link>
                      ) : (
                        <span className="font-medium">{r.code}</span>
                      )}
                      <span className="ml-1 text-xs text-slate-400">{r.branch}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div>{r.category}</div>
                      <div className="text-xs text-slate-500">
                        {r.party}
                        {r.note && ` · ${r.note}`}
                        {r.voided && r.voidReason && ` · Huỷ: ${r.voidReason}`}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">{methodLabel(r.method)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-mint-700">{r.type === 'THU' ? fmtMoney(r.amount) : ''}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-rose-600">{r.type === 'CHI' ? fmtMoney(r.amount) : ''}</td>
                    <td className="px-5 py-2.5 text-slate-500">
                      {r.by}
                      {r.source === 'ENTRY' && !r.voided && can('finance.manage') && (
                        <button type="button" className="ml-2 text-xs text-rose-600 no-underline hover:underline" onClick={() => (setVoiding(r), setReason(''))}>
                          Huỷ
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!book.rows.length && (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-slate-500">
                      Chưa có thu chi trong khoảng này.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}
      <Dialog open={entry !== null} onClose={() => setEntry(null)} title={entry === 'THU' ? 'Phiếu thu' : 'Phiếu chi'} wide>
        {entry && <EntryForm type={entry} branchId={branchId} onDone={() => (setEntry(null), void load())} />}
      </Dialog>
      <Dialog
        open={voiding !== null}
        onClose={() => setVoiding(null)}
        title={`Huỷ phiếu ${voiding?.code ?? ''}`}
        footer={
          <Button
            disabled={reason.trim().length < 3}
            onClick={async () => {
              try {
                await api(`/finance/entries/${voiding!.id}/void`, { body: { reason } });
                setVoiding(null);
                void load();
              } catch (e) {
                setError(errMsg(e, 'Không huỷ được'));
              }
            }}
          >
            Xác nhận huỷ
          </Button>
        }
      >
        <Field label="Lý do">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}</Field>
      </Dialog>
    </div>
  );
}

function CollectDialog({ customerId, branchId, onDone }: { customerId: string; branchId: string; onDone: () => void }) {
  const [d, setD] = useState<DebtDetail | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('TIEN_MAT');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<DebtDetail>(`/finance/debts/${customerId}`).then((x) => (setD(x), setAmount(moneyInput(x.total))));
  }, [customerId]);
  if (!d) return <Spinner className="text-brand-600" />;
  return (
    <div className="space-y-3 text-sm" data-testid="collect-dialog">
      {error && <Alert>{error}</Alert>}
      <div className="rounded-2xl bg-slate-50 p-3">
        <div className="font-semibold">{d.customer.name}</div>
        <div className="text-slate-500">{d.customer.phone}</div>
      </div>
      <table className="w-full">
        <tbody>
          {d.orders.map((o) => (
            <tr key={o.id} className="border-b border-slate-50">
              <td className="py-1.5">
                <Link href={`/don-hang/${o.id}`} className="font-medium text-brand-600">
                  {o.code}
                </Link>{' '}
                <span className="text-xs text-slate-500">
                  {o.branch} · {o.date ? fmtDate(o.date) : ''}
                </span>
              </td>
              <td className="py-1.5 text-right tabular-nums">{fmtMoney(o.due)}</td>
            </tr>
          ))}
          {d.openingLeft > 0 && (
            <tr className="border-b border-slate-50">
              <td className="py-1.5">Công nợ đầu kỳ (AppSheet)</td>
              <td className="py-1.5 text-right tabular-nums">{fmtMoney(d.openingLeft)}</td>
            </tr>
          )}
          <tr className="font-semibold">
            <td className="py-1.5">Tổng nợ</td>
            <td className="py-1.5 text-right tabular-nums text-rose-600">{fmtMoney(d.total)}</td>
          </tr>
        </tbody>
      </table>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Số tiền thu" hint="Trả đơn cũ trước, phần dư trừ công nợ đầu kỳ">
          {(id) => <Input id={id} inputMode="numeric" value={amount} onChange={(e) => setAmount(moneyInput(parseMoney(e.target.value)))} />}
        </Field>
        <Field label="Hình thức">
          {(id) => (
            <Select id={id} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {CASH_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Ghi chú" className="sm:col-span-2">
          {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </div>
      <div className="flex justify-end">
        <Button
          disabled={busy || !parseMoney(amount)}
          data-testid="save-collect"
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api(`/finance/debts/${customerId}/collect`, { body: { amount: parseMoney(amount), method, note: note || null, branchId } });
              onDone();
            } catch (e) {
              setError(errMsg(e, 'Không thu được'));
              setBusy(false);
            }
          }}
        >
          {busy && <Spinner />}
          Thu nợ
        </Button>
      </div>
    </div>
  );
}

function Debts({ branchId }: { branchId: string }) {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; totalDebt: number; page: number; pageSize: number; items: DebtRow[] } | null>(null);
  const [collect, setCollect] = useState<string | null>(null);
  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), pageSize: '30' });
    if (q.trim()) p.set('q', q.trim());
    setData(await api(`/finance/debts?${p}`));
  }, [q, page]);
  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full md:w-72">
          <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <Input value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="Tên, SĐT khách…" className="rounded-full bg-white/80 pl-10" aria-label="Tìm khách nợ" />
        </div>
        {data && (
          <span className="text-sm text-slate-600" data-testid="debt-total">
            {data.total.toLocaleString('vi-VN')} khách đang nợ · tổng <b className="text-rose-600">{fmtMoney(data.totalDebt)}</b>
          </span>
        )}
      </div>
      <Card className="overflow-hidden">
        {!data ? (
          <div className="grid place-items-center p-10">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="debt-table">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3 font-semibold">Khách hàng</th>
                    <th className="px-3 py-3 text-right font-semibold">Nợ đầu kỳ</th>
                    <th className="px-3 py-3 text-right font-semibold">Nợ đơn hàng</th>
                    <th className="px-3 py-3 text-right font-semibold">Tổng nợ</th>
                    <th className="px-3 py-3 font-semibold">Nợ từ</th>
                    <th className="w-28" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50 last:border-0" data-testid="debt-row">
                      <td className="px-5 py-3">
                        <Link href={`/khach-hang/${r.id}`} className="font-medium hover:text-brand-600">
                          {r.name}
                        </Link>
                        <div className="text-xs text-slate-500">
                          {r.phone ?? r.code}
                          {r.orders > 0 && ` · ${r.orders} đơn`}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{r.openingLeft ? fmtMoney(r.openingLeft) : '—'}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{r.orderDebt ? fmtMoney(r.orderDebt) : '—'}</td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums text-rose-600">{fmtMoney(r.debt)}</td>
                      <td className="px-3 py-3 text-slate-500">{r.oldest ? fmtDate(r.oldest) : <Badge tone="slate">Đầu kỳ</Badge>}</td>
                      <td className="px-3 py-3 text-right">
                        {can('payment.collect') && (
                          <Button variant="outline" className="whitespace-nowrap" onClick={() => setCollect(r.id)} data-testid="collect">
                            <HandCoins className="h-4 w-4" />
                            Thu nợ
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!data.items.length && (
                    <tr>
                      <td colSpan={6} className="px-5 py-12 text-center text-slate-500">
                        Không có khách đang nợ.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <Dialog open={collect !== null} onClose={() => setCollect(null)} title="Thu nợ khách" wide>
        {collect && <CollectDialog customerId={collect} branchId={branchId} onDone={() => (setCollect(null), void load())} />}
      </Dialog>
    </div>
  );
}

function Finance() {
  const { me } = useAuth();
  const current = useCurrentBranch();
  const [branch, setBranch] = useState('');
  const [tab, setTab] = useState<'so-quy' | 'cong-no'>('so-quy');
  useEffect(() => {
    if (current && !branch) setBranch(current);
  }, [current, branch]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          tabs={[
            { value: 'so-quy' as const, label: 'Sổ quỹ' },
            { value: 'cong-no' as const, label: 'Công nợ khách' },
          ]}
          value={tab}
          onChange={setTab}
        />
        {(me?.branches.length ?? 0) > 1 && (
          <Select value={branch} onChange={(e) => setBranch(e.target.value)} className="w-auto rounded-full bg-white/80" aria-label="Chi nhánh">
            {me!.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      {branch && (tab === 'so-quy' ? <CashBook branchId={branch} /> : <Debts branchId={branch} />)}
    </div>
  );
}

export default function FinancePage() {
  return (
    <RequirePermission permission="finance.view">
      <Finance />
    </RequirePermission>
  );
}
