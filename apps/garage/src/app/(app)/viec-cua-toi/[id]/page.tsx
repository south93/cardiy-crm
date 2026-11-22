'use client';

import {
  FINAL_CHECK_ITEMS,
  INSPECTION_LEVEL_LABEL,
  INSPECTION_LEVELS,
  INSPECTION_REQUESTS,
  inspectionSummary,
  SAFETY_ITEMS,
  TYRE_POSITIONS,
  UNDER_FRONT_ITEMS,
  UNDER_REAR_ITEMS,
  WIPER_ITEMS,
  type InspectionData,
  type InspectionLevel,
  type TyreCheck,
  type TyrePosition,
} from '@cardiy/shared';
import { Alert, Button, Card, CardTitle, Input, Spinner } from '@cardiy/ui';
import { ArrowLeft, CheckCheck, Printer, Save } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/orders';

interface Order {
  id: string;
  code: string;
  status: string;
  request: string | null;
  customer: { name: string };
  vehicle: { plate: string; make: string | null; model: string | null; tireSize: string | null } | null;
}
interface Inspection {
  data: InspectionData;
  inspector: string | null;
  completedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  editable: boolean;
}

const TONE: Record<InspectionLevel, string> = {
  TOT: 'border-emerald-500 bg-emerald-500 text-white',
  CHU_Y: 'border-amber-500 bg-amber-500 text-white',
  THAY_THE: 'border-rose-600 bg-rose-600 text-white',
};
const SHORT: Record<InspectionLevel, string> = { TOT: 'Tốt', CHU_Y: 'Chú ý', THAY_THE: 'Thay' };

/** Ba nút Tốt / Chú ý / Thay; bấm lại nút đang chọn để bỏ chọn */
function Tri({ label, value, onChange, disabled }: { label: string; value?: InspectionLevel | null; onChange: (v: InspectionLevel | null) => void; disabled?: boolean }) {
  return (
    <span className="inline-flex shrink-0 gap-1" role="group" aria-label={label}>
      {INSPECTION_LEVELS.map((l) => (
        <button
          key={l}
          type="button"
          disabled={disabled}
          aria-pressed={value === l}
          aria-label={`${label}: ${INSPECTION_LEVEL_LABEL[l]}`}
          onClick={() => onChange(value === l ? null : l)}
          className={`min-w-[52px] rounded-lg border px-2 py-2 text-xs font-semibold transition disabled:opacity-60 ${value === l ? TONE[l] : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
        >
          {SHORT[l]}
        </button>
      ))}
    </span>
  );
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-0">
      <span className="min-w-0 text-sm">{label}</span>
      {children}
    </div>
  );
}

function Section({ title, children, onAllGood, disabled, testid }: { title: string; children: ReactNode; onAllGood?: () => void; disabled?: boolean; testid?: string }) {
  return (
    <Card className="p-4 sm:p-5" data-testid={testid}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {onAllGood && !disabled && (
          <button type="button" onClick={onAllGood} className="flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
            <CheckCheck className="h-3.5 w-3.5" /> Còn lại đều tốt
          </button>
        )}
      </div>
      {children}
    </Card>
  );
}

const numIn = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));

export default function InspectionPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [ins, setIns] = useState<Inspection | null>(null);
  const [d, setD] = useState<InspectionData>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'rose' | 'mint'; text: string } | null>(null);

  useEffect(() => {
    api<Order>(`/orders/${id}`).then(setOrder);
    api<Inspection>(`/orders/${id}/inspection`).then((x) => {
      setIns(x);
      setD(x.data ?? {});
    });
  }, [id]);
  // Rời trang khi chưa lưu thì hỏi lại
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  if (!order || !ins) return <Spinner className="h-6 w-6 text-brand-600" />;
  const ro = !ins.editable;
  const set = (patch: Partial<InspectionData>) => {
    setD((x) => ({ ...x, ...patch }));
    setDirty(true);
    setMsg(null);
  };
  const setMap = <K extends 'wiper' | 'safety'>(k: K, item: string, v: InspectionLevel | null) => {
    const m: Record<string, InspectionLevel> = { ...(d[k] ?? {}) };
    if (v) m[item] = v;
    else delete m[item];
    set({ [k]: m });
  };
  const setUnder = (k: 'underFront' | 'underRear', item: string, side: 'L' | 'R', v: InspectionLevel | null) => {
    const m = { ...(d[k] ?? {}) };
    m[item] = { ...(m[item] ?? {}), [side]: v };
    set({ [k]: m });
  };
  const setTyre = (pos: TyrePosition, patch: Partial<TyreCheck>) => set({ tyres: { ...(d.tyres ?? {}), [pos]: { ...(d.tyres?.[pos] ?? {}), ...patch } } });
  const allGood = (k: 'wiper' | 'safety', items: readonly string[]) => set({ [k]: Object.fromEntries(items.map((i) => [i, d[k]?.[i] ?? 'TOT'])) });
  const allGoodUnder = (k: 'underFront' | 'underRear', items: readonly string[]) => set({ [k]: Object.fromEntries(items.map((i) => [i, { L: d[k]?.[i]?.L ?? 'TOT', R: d[k]?.[i]?.R ?? 'TOT' }])) });

  async function save(complete: boolean) {
    setSaving(true);
    setMsg(null);
    try {
      const x = await api<Inspection>(`/orders/${id}/inspection`, { method: 'PUT', body: { data: d, complete } });
      setIns(x);
      setDirty(false);
      setMsg({ tone: 'mint', text: complete ? 'Đã hoàn tất phiếu kiểm tra' : 'Đã lưu' });
    } catch (e) {
      setMsg({ tone: 'rose', text: e instanceof ApiError ? e.message : 'Không lưu được, thử lại sau' });
    } finally {
      setSaving(false);
    }
  }

  const sum = inspectionSummary(d);
  const v = order.vehicle;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Link href="/viec-cua-toi" className="flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
          <ArrowLeft className="h-4 w-4" /> Việc của tôi
        </Link>
        <Link href={`/in/kiem-tra/${id}`} target="_blank" className="flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600" data-testid="print-inspection">
          <Printer className="h-4 w-4" /> In phiếu
        </Link>
      </div>

      <Card className="p-4 sm:p-5">
        <div className="font-mono text-2xl font-bold tracking-wide" data-testid="inspection-plate">
          {v?.plate ?? '—'}
        </div>
        <div className="text-sm text-slate-500">
          {[[v?.make, v?.model].filter(Boolean).join(' '), order.customer.name].filter(Boolean).join(' · ')} · <span className="font-mono">{order.code}</span>
        </div>
        {order.request && <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">Khách yêu cầu: {order.request}</p>}
        <p className="mt-2 text-xs text-slate-500" data-testid="inspection-state">
          {ins.completedAt
            ? `Đã hoàn tất ${fmtDateTime(ins.completedAt)}${ins.inspector ? ` · KTV ${ins.inspector}` : ''}`
            : ins.updatedAt
              ? `Lưu nháp ${fmtDateTime(ins.updatedAt)}${ins.updatedBy ? ` · ${ins.updatedBy}` : ''}`
              : 'Chưa kiểm tra'}
          {ro && ' · Chỉ xem (đơn đã khoá hoặc do KTV khác phụ trách)'}
        </p>
      </Card>

      <Section title="Yêu cầu của khách" disabled={ro}>
        <div className="flex flex-wrap gap-2">
          {INSPECTION_REQUESTS.map((r) => {
            const on = d.requests?.includes(r);
            return (
              <button
                key={r}
                type="button"
                disabled={ro}
                aria-pressed={on}
                onClick={() => set({ requests: on ? d.requests!.filter((x) => x !== r) : [...(d.requests ?? []), r] })}
                className={`rounded-full border px-3.5 py-2 text-sm ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-600'}`}
              >
                {r}
              </button>
            );
          })}
        </div>
        <label className="mt-3 block text-sm">
          <span className="text-slate-600">Cấp bảo dưỡng</span>
          <Input value={d.maintenanceLevel ?? ''} disabled={ro} onChange={(e) => set({ maintenanceLevel: e.target.value || null })} placeholder="VD: 10.000 km" className="mt-1" />
        </label>
      </Section>

      <Section title="Lốp xe" disabled={ro} testid="tyres">
        <p className="mb-2 text-xs text-slate-500">Thay theo 3 năm / 60.000 km{v?.tireSize ? ` · size xe: ${v.tireSize}` : ''}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {TYRE_POSITIONS.map((p) => {
            const t = d.tyres?.[p.key] ?? {};
            return (
              <div key={p.key} className="rounded-xl border border-slate-200 p-3">
                <div className="mb-1 text-sm font-semibold text-brand-700">◎ {p.label}</div>
                <Row label="Mòn / lão hoá / xì / phù">
                  <Tri label={`Lốp ${p.label} mòn`} value={t.wear} disabled={ro} onChange={(x) => setTyre(p.key, { wear: x })} />
                </Row>
                <Row label="Hư hỏng van">
                  <Tri label={`Lốp ${p.label} van`} value={t.valve} disabled={ro} onChange={(x) => setTyre(p.key, { valve: x })} />
                </Row>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <label className="col-span-3">
                    Hãng / quy cách
                    <Input value={t.brand ?? ''} disabled={ro} onChange={(e) => setTyre(p.key, { brand: e.target.value || null })} className="mt-0.5" />
                  </label>
                  <label>
                    Áp suất (bar)
                    <Input
                      inputMode="decimal"
                      value={t.pressure ?? ''}
                      disabled={ro}
                      onChange={(e) => setTyre(p.key, { pressure: numIn(e.target.value) })}
                      className="mt-0.5"
                      aria-label={`Áp suất lốp ${p.label}`}
                    />
                  </label>
                  <label>
                    Gai (mm)
                    <Input
                      inputMode="decimal"
                      value={t.tread ?? ''}
                      disabled={ro}
                      onChange={(e) => setTyre(p.key, { tread: numIn(e.target.value) })}
                      className="mt-0.5"
                      aria-label={`Độ sâu gai lốp ${p.label}`}
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          Áp suất lốp dự phòng (bar)
          <Input inputMode="decimal" value={d.sparePressure ?? ''} disabled={ro} onChange={(e) => set({ sparePressure: numIn(e.target.value) })} className="w-24" />
        </label>
      </Section>

      <Section title="Gạt mưa & thân vỏ" disabled={ro} onAllGood={() => allGood('wiper', WIPER_ITEMS)}>
        {WIPER_ITEMS.map((i) => (
          <Row key={i} label={i}>
            <Tri label={i} value={d.wiper?.[i]} disabled={ro} onChange={(x) => setMap('wiper', i, x)} />
          </Row>
        ))}
        <label className="mt-2 block text-sm">
          <span className="text-slate-600">Thân vỏ: móp lõm, trầy xước, đá văng, sơn lại (ghi vị trí)</span>
          <textarea
            value={d.bodyNote ?? ''}
            disabled={ro}
            onChange={(e) => set({ bodyNote: e.target.value || null })}
            rows={2}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
      </Section>

      <Section title="Kiểm tra an toàn xe" disabled={ro} onAllGood={() => allGood('safety', SAFETY_ITEMS)} testid="safety">
        {SAFETY_ITEMS.map((i) => (
          <Row key={i} label={i}>
            <Tri label={i} value={d.safety?.[i]} disabled={ro} onChange={(x) => setMap('safety', i, x)} />
          </Row>
        ))}
      </Section>

      {(
        [
          ['underFront', 'Gầm trước', UNDER_FRONT_ITEMS],
          ['underRear', 'Gầm sau', UNDER_REAR_ITEMS],
        ] as const
      ).map(([k, title, items]) => (
        <Section key={k} title={title} disabled={ro} onAllGood={() => allGoodUnder(k, items)} testid={k}>
          {items.map((i) => (
            <div key={i} className="border-b border-slate-100 py-2 last:border-0">
              <div className="text-sm">{i}</div>
              <div className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {(['L', 'R'] as const).map((side) => (
                  <div key={side} className="flex items-center gap-2">
                    <span className="w-9 text-xs text-slate-500">{side === 'L' ? 'Trái' : 'Phải'}</span>
                    <Tri label={`${title} ${i} ${side === 'L' ? 'trái' : 'phải'}`} value={d[k]?.[i]?.[side]} disabled={ro} onChange={(x) => setUnder(k, i, side, x)} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </Section>
      ))}

      <Section title="Khuyến nghị & đề xuất" disabled={ro}>
        <label className="block text-sm">
          <span className="text-slate-600">Khuyến nghị của kỹ thuật viên</span>
          <textarea
            value={d.recommendation ?? ''}
            disabled={ro}
            onChange={(e) => set({ recommendation: e.target.value || null })}
            rows={3}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            aria-label="Khuyến nghị"
          />
        </label>
        <label className="mt-2 block text-sm">
          <span className="text-slate-600">Hạng mục đề xuất từ kiểm tra an toàn</span>
          <textarea
            value={d.suggestions ?? ''}
            disabled={ro}
            onChange={(e) => set({ suggestions: e.target.value || null })}
            rows={3}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
      </Section>

      <Section title="Kiểm tra cuối (trước khi giao xe)" disabled={ro}>
        {FINAL_CHECK_ITEMS.map((i) => {
          const val = d.final?.[i];
          const pick = (x: boolean) => {
            const m = { ...(d.final ?? {}) };
            if (val === x) delete m[i];
            else m[i] = x;
            set({ final: m });
          };
          return (
            <Row key={i} label={i}>
              <span className="inline-flex shrink-0 gap-1" role="group" aria-label={i}>
                <button
                  type="button"
                  disabled={ro}
                  aria-pressed={val === true}
                  onClick={() => pick(true)}
                  className={`rounded-lg border px-2.5 py-2 text-xs font-semibold ${val === true ? TONE.TOT : 'border-slate-200 bg-white text-slate-500'}`}
                >
                  Đạt
                </button>
                <button
                  type="button"
                  disabled={ro}
                  aria-pressed={val === false}
                  onClick={() => pick(false)}
                  className={`rounded-lg border px-2.5 py-2 text-xs font-semibold ${val === false ? TONE.THAY_THE : 'border-slate-200 bg-white text-slate-500'}`}
                >
                  Không đạt
                </button>
              </span>
            </Row>
          );
        })}
        <Input value={d.finalOther ?? ''} disabled={ro} onChange={(e) => set({ finalOther: e.target.value || null })} placeholder="Khác…" className="mt-2" />
      </Section>

      {/* Thanh lưu cố định dưới màn hình */}
      <div className="sticky bottom-2 z-20 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-card backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto text-sm" data-testid="inspection-summary">
            <b>{sum.checked}</b> mục đã xem
            {sum.attention > 0 && <span className="font-semibold text-amber-600"> · {sum.attention} chú ý</span>}
            {sum.replace > 0 && <span className="font-semibold text-rose-600"> · {sum.replace} cần thay</span>}
            {msg && <span className={`ml-2 ${msg.tone === 'mint' ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</span>}
          </div>
          {!ro && (
            <>
              <Button variant="outline" onClick={() => save(false)} disabled={saving || !dirty} data-testid="save-draft">
                <Save className="h-4 w-4" /> Lưu nháp
              </Button>
              <Button onClick={() => save(true)} disabled={saving} data-testid="complete-inspection">
                <CheckCheck className="h-4 w-4" /> {ins.completedAt ? 'Lưu' : 'Hoàn tất'}
              </Button>
            </>
          )}
        </div>
      </div>
      {msg?.tone === 'rose' && <Alert>{msg.text}</Alert>}
    </div>
  );
}
