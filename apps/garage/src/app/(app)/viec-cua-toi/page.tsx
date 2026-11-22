'use client';

import { Alert, Badge, Button, Card, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import { AlarmClock, ClipboardCheck, ClipboardList, Hand, Play, Search, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { setCurrentBranch, useCurrentBranch } from '@/lib/branch';
import { fmtDateTime, STATUS, type OrderStatus } from '@/lib/orders';

interface Job {
  id: string;
  code: string;
  status: OrderStatus;
  customer: { name: string };
  vehicle: { plate: string; make: string | null; model: string | null } | null;
  request: string | null;
  technician: { id: string; name: string } | null;
  promisedAt: string | null;
  receivedAt: string;
  inspection: { completedAt: string | null; checked: number; attention: number; replace: number } | null;
}
type Scope = 'me' | 'none';

/** Màn hình chính của kỹ thuật viên: xe mình đang làm, nhận xe chưa có ai làm, mở phiếu kiểm tra. */
export default function JobsPage() {
  const { me } = useAuth();
  const branch = useCurrentBranch();
  const [scope, setScope] = useState<Scope>('me');
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ items: Job[]; counts: { me: number; none: number } } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!branch) return;
    const my = ++seq.current;
    const base = new URLSearchParams({ view: 'open', branchId: branch, pageSize: '100' });
    if (q.trim()) base.set('q', q.trim());
    const get = (t: Scope) => api<{ items: Job[]; total: number }>(`/orders?${base}&tech=${t}`);
    const [mine, none] = await Promise.all([get('me'), get('none')]);
    if (my !== seq.current) return;
    setData({ items: (scope === 'me' ? mine : none).items, counts: { me: mine.total, none: none.total } });
  }, [branch, q, scope]);

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function act(id: string, run: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await run();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không thực hiện được, thử lại sau');
    } finally {
      setBusy(null);
    }
  }
  const status = (id: string, to: OrderStatus) => act(id, () => api(`/orders/${id}/status`, { body: { to } }));
  const claim = (id: string) => act(id, () => api(`/orders/${id}/claim`, { body: {} }));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          tabs={[
            { value: 'me', label: `Việc của tôi${data ? ` (${data.counts.me})` : ''}` },
            { value: 'none', label: `Chưa có người nhận${data ? ` (${data.counts.none})` : ''}` },
          ]}
          value={scope}
          onChange={(v) => setScope(v)}
        />
        {(me?.branches.length ?? 0) > 1 && (
          <Select value={branch} onChange={(e) => setCurrentBranch(e.target.value)} className="w-auto rounded-full bg-white/80" aria-label="Chi nhánh">
            {me!.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Biển số, mã đơn…" className="rounded-full bg-white/80 pl-10" aria-label="Tìm xe" />
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      {!data ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : (
        <ul className="space-y-3" data-testid="job-list">
          {data.items.map((j) => {
            const late = j.promisedAt && new Date(j.promisedAt) < new Date() && j.status !== 'HOAN_THANH';
            const ins = j.inspection;
            return (
              <li key={j.id}>
                <Card className="p-4" data-testid="job-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-xl font-bold tracking-wide">{j.vehicle?.plate ?? 'Không có xe'}</div>
                      <div className="truncate text-sm text-slate-500">
                        {[[j.vehicle?.make, j.vehicle?.model].filter(Boolean).join(' '), j.customer.name].filter(Boolean).join(' · ')} · <span className="font-mono">{j.code}</span>
                      </div>
                    </div>
                    <Badge tone={STATUS[j.status].tone} className="shrink-0">
                      {STATUS[j.status].label}
                    </Badge>
                  </div>
                  {j.request && <p className="mt-2 line-clamp-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">{j.request}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                    {j.promisedAt && (
                      <span className={`flex items-center gap-1 ${late ? 'font-semibold text-rose-600' : ''}`}>
                        <AlarmClock className="h-3.5 w-3.5" /> Hẹn giao {fmtDateTime(j.promisedAt)}
                        {late && ' · trễ hẹn'}
                      </span>
                    )}
                    <span className="flex items-center gap-1" data-testid="job-inspection">
                      <ClipboardCheck className="h-3.5 w-3.5" />
                      {!ins ? (
                        'Chưa kiểm tra'
                      ) : (
                        <>
                          {ins.completedAt ? 'Đã kiểm tra' : 'Đang kiểm tra'}
                          {ins.attention > 0 && <span className="font-semibold text-amber-600">· {ins.attention} chú ý</span>}
                          {ins.replace > 0 && <span className="font-semibold text-rose-600">· {ins.replace} cần thay</span>}
                        </>
                      )}
                    </span>
                    {scope === 'none' && j.technician === null && <span>Chưa có KTV</span>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {scope === 'none' ? (
                      <Button onClick={() => claim(j.id)} disabled={busy === j.id} data-testid="claim">
                        <Hand className="h-4 w-4" /> Nhận việc
                      </Button>
                    ) : (
                      <>
                        {j.status === 'TIEP_NHAN' && (
                          <Button onClick={() => status(j.id, 'DANG_SUA')} disabled={busy === j.id} data-testid="start">
                            <Play className="h-4 w-4" /> Bắt đầu sửa
                          </Button>
                        )}
                        {j.status === 'DANG_SUA' && (
                          <Button onClick={() => status(j.id, 'HOAN_THANH')} disabled={busy === j.id} data-testid="finish">
                            <Wrench className="h-4 w-4" /> Báo sửa xong
                          </Button>
                        )}
                      </>
                    )}
                    <Link
                      href={`/viec-cua-toi/${j.id}`}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      data-testid="open-inspection"
                    >
                      <ClipboardList className="h-4 w-4" /> Phiếu kiểm tra
                    </Link>
                    <Link href={`/don-hang/${j.id}`} className="inline-flex items-center rounded-full px-3 py-2 text-sm text-slate-500 hover:text-brand-600">
                      Xem đơn
                    </Link>
                  </div>
                </Card>
              </li>
            );
          })}
          {!data.items.length && (
            <li>
              <Card className="p-8 text-center text-slate-500">{scope === 'me' ? 'Bạn chưa có xe nào. Sang mục "Chưa có người nhận" để nhận việc.' : 'Không có xe nào đang chờ người nhận.'}</Card>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
