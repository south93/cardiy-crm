'use client';

import { Badge, Card, CardTitle } from '@cardiy/ui';
import { Activity, Database, Server, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

type State = 'up' | 'down' | 'unknown';
interface Health {
  api: State;
  database: State;
  redis: State;
  version?: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function fetchHealth(): Promise<Health> {
  try {
    const res = await fetch(`${API_URL}/api/health`, { cache: 'no-store' });
    const body = (await res.json()) as { version?: string; checks?: { database?: State; redis?: State } };
    return {
      api: 'up',
      database: body.checks?.database ?? 'unknown',
      redis: body.checks?.redis ?? 'unknown',
      version: body.version,
    };
  } catch {
    return { api: 'down', database: 'unknown', redis: 'unknown' };
  }
}

const LABEL: Record<State, string> = { up: 'Hoạt động', down: 'Lỗi', unknown: 'Không rõ' };
const TONE = { up: 'mint', down: 'rose', unknown: 'slate' } as const;

/** Thẻ trạng thái hệ thống: gọi GET /api/health mỗi 30 giây. */
export function SystemStatus() {
  const [health, setHealth] = useState<Health | null>(null);

  const refresh = useCallback(async () => setHealth(await fetchHealth()), []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const rows: { key: keyof Omit<Health, 'version'>; label: string; icon: typeof Server }[] = [
    { key: 'api', label: 'Máy chủ API', icon: Server },
    { key: 'database', label: 'Cơ sở dữ liệu PostgreSQL', icon: Database },
    { key: 'redis', label: 'Bộ nhớ đệm Redis', icon: Zap },
  ];

  return (
    <Card className="p-5 lg:p-6" data-testid="system-status">
      <div className="mb-4 flex items-center justify-between">
        <CardTitle>Trạng thái hệ thống</CardTitle>
        <Activity className="h-5 w-5 text-slate-400" />
      </div>
      <ul className="space-y-2.5">
        {rows.map(({ key, label, icon: Icon }) => {
          const state: State = health ? health[key] : 'unknown';
          return (
            <li key={key} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-50">
                <Icon className="h-4 w-4 text-brand-600" />
              </span>
              <span className="flex-1 text-sm font-medium">{label}</span>
              <Badge tone={health ? TONE[state] : 'slate'}>
                <span data-testid={`status-${key}`}>{health ? LABEL[state] : 'Đang kiểm tra…'}</span>
              </Badge>
            </li>
          );
        })}
      </ul>
      {health?.version && <p className="mt-3 text-xs text-slate-500">Phiên bản API {health.version}</p>}
    </Card>
  );
}
