'use client';

import { Alert, Badge, Button, Card, Dialog, Field, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import { CalendarPlus, MessageCircle, Phone, PhoneCall, Plus, RefreshCw, Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { NewBooking } from '@/components/booking-form';
import { CustomerPicker } from '@/components/customer-picker';
import { Pager } from '@/components/pager';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCurrentBranch } from '@/lib/branch';
import { fmtDay, KINDS, OUTCOMES, outcomeLabel, type CallOutcome, type CareKind, type CareTask } from '@/lib/care';

type View = 'hom-nay' | 'sap-toi' | 'da-xu-ly';
interface Page {
  total: number;
  page: number;
  pageSize: number;
  counts: Record<'hom-nay' | 'sap-toi', number>;
  items: CareTask[];
}
const errMsg = (e: unknown, f: string) => (e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : f);
const tomorrow = () => {
  const d = new Date(Date.now() + 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function CallDialog({ t, onDone, onBook }: { t: CareTask; onDone: () => void; onBook: () => void }) {
  const [outcome, setOutcome] = useState<CallOutcome>('DA_TU_VAN');
  const [note, setNote] = useState('');
  const [nextAt, setNextAt] = useState(tomorrow());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (outcome === 'DAT_LICH') return onBook();
    setBusy(true);
    setError(null);
    try {
      await api(`/care/tasks/${t.id}/calls`, { body: { outcome, note: note || null, nextAt: outcome === 'GOI_LAI_SAU' ? nextAt : null } });
      onDone();
    } catch (e) {
      setError(errMsg(e, 'Không lưu được'));
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3" data-testid="call-dialog">
      {error && <Alert>{error}</Alert>}
      <div className="rounded-2xl bg-slate-50 p-3 text-sm">
        <div className="font-semibold">{t.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span>{t.customer.name}</span>
          {t.customer.phone && (
            <a href={`tel:${t.customer.phone}`} className="inline-flex items-center gap-1 font-semibold text-brand-600">
              <Phone className="h-3.5 w-3.5" />
              {t.customer.phone}
            </a>
          )}
          {t.vehicle && <span className="font-mono">{t.vehicle.plate}</span>}
        </div>
        {t.attempts > 0 && (
          <div className="mt-1 text-xs text-slate-500">
            Đã gọi {t.attempts} lần · lần trước: {outcomeLabel(t.lastOutcome)}
            {t.lastNote && ` — ${t.lastNote}`}
          </div>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Kết quả cuộc gọi">
        {OUTCOMES.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={outcome === o.value}
            onClick={() => setOutcome(o.value)}
            className={`rounded-xl border p-2.5 text-left text-sm ${outcome === o.value ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white hover:border-brand-200'}`}
          >
            <div className="font-medium">{o.label}</div>
            <div className="text-xs text-slate-500">{o.hint}</div>
          </button>
        ))}
      </div>
      {outcome === 'GOI_LAI_SAU' && <Field label="Gọi lại ngày">{(id) => <Input id={id} type="date" value={nextAt} onChange={(e) => setNextAt(e.target.value)} />}</Field>}
      {outcome !== 'DAT_LICH' && <Field label="Ghi chú cuộc gọi">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: khách hẹn cuối tuần qua" />}</Field>}
      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={busy} data-testid="save-call">
          {busy && <Spinner />}
          {outcome === 'DAT_LICH' ? 'Mở form đặt lịch' : 'Lưu kết quả'}
        </Button>
      </div>
    </div>
  );
}

function CallList() {
  const { can } = useAuth();
  const branchId = useCurrentBranch();
  const [view, setView] = useState<View>('hom-nay');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [calling, setCalling] = useState<CareTask | null>(null);
  const [booking, setBooking] = useState<CareTask | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTask, setNewTask] = useState<{ customerId: string; name: string; title: string; dueDate: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      const p = new URLSearchParams({ view, page: String(page), pageSize: '30' });
      if (kind) p.set('kind', kind);
      if (q.trim()) p.set('q', q.trim());
      if (refresh) p.set('refresh', 'true');
      setData(await api<Page>(`/care/tasks?${p}`));
    },
    [view, kind, q, page],
  );
  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const manage = can('customer.manage');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          tabs={[
            { value: 'hom-nay' as const, label: `Cần gọi hôm nay${data ? ` (${data.counts['hom-nay']})` : ''}` },
            { value: 'sap-toi' as const, label: `Sắp tới 7 ngày${data ? ` (${data.counts['sap-toi']})` : ''}` },
            { value: 'da-xu-ly' as const, label: 'Đã xử lý' },
          ]}
          value={view}
          onChange={(v) => (setView(v), setPage(1))}
        />
        <Select value={kind} onChange={(e) => (setKind(e.target.value), setPage(1))} className="w-auto rounded-full bg-white/80" aria-label="Lọc loại">
          <option value="">Mọi loại</option>
          {(Object.keys(KINDS) as CareKind[]).map((k) => (
            <option key={k} value={k}>
              {KINDS[k].label}
            </option>
          ))}
        </Select>
        <div className="relative w-full md:w-64">
          <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <Input value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="Tên, SĐT khách…" className="rounded-full bg-white/80 pl-10" aria-label="Tìm khách" />
        </div>
        <div className="flex-1" />
        <Button variant="outline" onClick={() => void load(true)} title="Quét lại dữ liệu xe, đơn để tạo việc gọi mới">
          <RefreshCw className="h-4 w-4" />
          Làm mới
        </Button>
        {manage && (
          <Button onClick={() => (setAdding(true), setNewTask(null))} data-testid="add-care">
            <Plus className="h-4 w-4" />
            Thêm việc gọi
          </Button>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="mint">{notice}</Alert>}

      <Card className="overflow-hidden">
        {!data ? (
          <div className="grid place-items-center p-10">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : (
          <>
            <ul className="divide-y divide-slate-50" data-testid="care-list">
              {data.items.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="care-row">
                  <Badge tone={KINDS[t.kind].tone}>{KINDS[t.kind].label}</Badge>
                  <div className="min-w-[220px] flex-1">
                    <div className="font-medium">{t.title}</div>
                    <div className="text-sm text-slate-600">
                      <Link href={`/khach-hang/${t.customer.id}`} className="hover:text-brand-600">
                        {t.customer.name}
                      </Link>
                      {t.customer.phone && (
                        <a href={`tel:${t.customer.phone}`} className="ml-2 font-medium text-brand-600">
                          {t.customer.phone}
                        </a>
                      )}
                      {t.vehicle && <span className="ml-2 font-mono text-xs">{t.vehicle.plate}</span>}
                    </div>
                    {(t.lastOutcome || t.lastNote) && (
                      <div className="text-xs text-slate-500">
                        {outcomeLabel(t.lastOutcome)}
                        {t.lastNote && ` — ${t.lastNote}`}
                        {t.attempts > 1 && ` · ${t.attempts} lần gọi`}
                      </div>
                    )}
                  </div>
                  <div className="text-right text-sm">
                    <div className={t.overdueDays > 0 && view !== 'da-xu-ly' ? 'font-semibold text-rose-600' : 'text-slate-600'}>{fmtDay(t.dueDate)}</div>
                    {t.overdueDays > 0 && view !== 'da-xu-ly' && <div className="text-xs text-rose-600">trễ {t.overdueDays} ngày</div>}
                    {view === 'da-xu-ly' && <div className="text-xs text-slate-500">{t.status === 'BO_QUA' ? 'Bỏ qua' : 'Xong'}</div>}
                  </div>
                  {manage && view !== 'da-xu-ly' && (
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setBooking(t)} title="Đặt lịch hẹn cho khách">
                        <CalendarPlus className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        title="Gửi tin nhắc qua Zalo"
                        aria-label="Gửi Zalo"
                        data-testid="send-zalo"
                        onClick={async () => {
                          setError(null);
                          try {
                            const r = await api<{ status: string; error?: string }>(`/care/tasks/${t.id}/zalo`, { body: {} });
                            setNotice(r.status === 'SENT' ? `Đã gửi tin Zalo cho ${t.customer.name}` : null);
                            if (r.status !== 'SENT') setError(r.error ?? 'Không gửi được tin Zalo');
                          } catch (e) {
                            setError(e instanceof ApiError ? e.message : 'Không gửi được tin Zalo');
                          }
                        }}
                      >
                        <MessageCircle className="h-4 w-4" />
                      </Button>
                      <Button onClick={() => setCalling(t)} data-testid="log-call">
                        <PhoneCall className="h-4 w-4" />
                        Ghi cuộc gọi
                      </Button>
                    </div>
                  )}
                </li>
              ))}
              {!data.items.length && <li className="px-5 py-12 text-center text-slate-500">{view === 'da-xu-ly' ? 'Chưa có cuộc gọi nào.' : 'Không có khách cần gọi. 🎉'}</li>}
            </ul>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <Dialog open={calling !== null} onClose={() => setCalling(null)} title="Ghi kết quả cuộc gọi" wide>
        {calling && (
          <CallDialog
            t={calling}
            onDone={() => (setCalling(null), void load())}
            onBook={() => {
              setBooking(calling);
              setCalling(null);
            }}
          />
        )}
      </Dialog>

      <Dialog open={booking !== null} onClose={() => setBooking(null)} title="Đặt lịch hẹn" wide>
        {booking && (
          <NewBooking
            branchId={booking.branchId ?? branchId}
            day={new Date()}
            customerId={booking.customer.id}
            vehicleId={booking.vehicle?.id ?? null}
            service={booking.kind === 'BAO_DUONG' ? 'Bảo dưỡng định kỳ' : booking.kind === 'DANG_KIEM' ? 'Kiểm tra trước đăng kiểm' : ''}
            onCancel={() => setBooking(null)}
            onDone={async (_w, id) => {
              try {
                await api(`/care/tasks/${booking.id}/calls`, { body: { outcome: 'DAT_LICH', bookingId: id, note: 'Khách đặt lịch' } });
              } catch (e) {
                setError(errMsg(e, 'Đã đặt lịch nhưng chưa ghi được cuộc gọi'));
              }
              setBooking(null);
              void load();
            }}
          />
        )}
      </Dialog>

      <Dialog open={adding} onClose={() => setAdding(false)} title="Thêm việc gọi">
        {adding && (
          <div className="space-y-3">
            {!newTask ? (
              <CustomerPicker onPick={async (cid) => {
                const c = await api<{ id: string; name: string }>(`/customers/${cid}`);
                setNewTask({ customerId: c.id, name: c.name, title: '', dueDate: tomorrow() });
              }} />
            ) : (
              <>
                <div className="rounded-xl bg-slate-50 p-3 text-sm font-medium">{newTask.name}</div>
                <Field label="Nội dung cần gọi">{(id) => <Input id={id} value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} placeholder="VD: Báo giá lốp mới về" autoFocus />}</Field>
                <Field label="Ngày gọi">{(id) => <Input id={id} type="date" value={newTask.dueDate} onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })} />}</Field>
                <div className="flex justify-end">
                  <Button
                    disabled={newTask.title.trim().length < 3}
                    onClick={async () => {
                      try {
                        await api('/care/tasks', { body: { customerId: newTask.customerId, title: newTask.title, dueDate: newTask.dueDate } });
                        setAdding(false);
                        void load();
                      } catch (e) {
                        setError(errMsg(e, 'Không lưu được'));
                      }
                    }}
                    data-testid="save-care"
                  >
                    Lưu
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}

export default function CallsPage() {
  return (
    <RequirePermission permission="customer.view">
      <CallList />
    </RequirePermission>
  );
}
