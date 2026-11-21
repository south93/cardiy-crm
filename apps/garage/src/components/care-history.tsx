'use client';

import { Badge, Card, CardTitle } from '@cardiy/ui';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { fmtDay, KINDS, outcomeLabel, type CallOutcome, type CareKind } from '@/lib/care';
import { fmtDateTime } from '@/lib/orders';

interface Item {
  id: string;
  kind: CareKind;
  title: string;
  status: string;
  dueDate: string;
  calls: { outcome: CallOutcome; note: string | null; at: string; by: string | null }[];
}

/** Lịch sử chăm sóc khách trên hồ sơ khách */
export function CareHistory({ customerId }: { customerId: string }) {
  const [rows, setRows] = useState<Item[] | null>(null);
  useEffect(() => {
    api<Item[]>(`/care/customers/${customerId}`).then(setRows, () => setRows([]));
  }, [customerId]);
  if (!rows?.length) return null;
  return (
    <Card className="p-4 lg:p-5" data-testid="care-history">
      <CardTitle className="mb-3">Chăm sóc khách</CardTitle>
      <ul className="space-y-3 text-sm">
        {rows.slice(0, 8).map((t) => (
          <li key={t.id}>
            <div className="flex items-center gap-2">
              <Badge tone={KINDS[t.kind].tone}>{KINDS[t.kind].label}</Badge>
              <span className="text-xs text-slate-500">{fmtDay(t.dueDate)}</span>
              {t.status === 'XONG' || t.status === 'BO_QUA' ? null : <Badge tone="peach">Cần gọi</Badge>}
            </div>
            {t.calls.slice(0, 2).map((c, i) => (
              <div key={i} className="mt-1 text-xs text-slate-600">
                {fmtDateTime(c.at)} · {outcomeLabel(c.outcome)}
                {c.by && ` · ${c.by}`}
                {c.note && ` — ${c.note}`}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </Card>
  );
}
