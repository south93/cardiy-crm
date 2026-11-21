'use client';

import { Input } from '@cardiy/ui';
import { Car, Search, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Lookup {
  customers: { id: string; code: string; name: string; phone: string | null }[];
  vehicles: {
    id: string;
    plate: string;
    make: string | null;
    model: string | null;
    ownerName: string | null;
    ownerId: string | null;
  }[];
}

/** Ô tìm khách / xe: gõ SĐT, biển số hoặc tên */
export function CustomerPicker({ onPick }: { onPick: (customerId: string, vehicleId: string | null) => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Lookup | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return setRes(null);
    const t = setTimeout(() => api<Lookup>(`/lookup?q=${encodeURIComponent(q.trim())}`).then(setRes, () => setRes(null)), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
      <Input aria-label="Tìm khách hoặc xe" className="pl-9" placeholder="Biển số, SĐT hoặc tên khách…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {res && (
        <div className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-2xl border border-slate-100 bg-white p-1.5 shadow-card" data-testid="picker-results">
          {res.vehicles.map((v) => (
            <button
              key={v.id}
              type="button"
              disabled={!v.ownerId}
              onClick={() => onPick(v.ownerId!, v.id)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              <Car className="h-4 w-4 text-sky-600" />
              <span className="font-mono font-semibold">{v.plate}</span>
              <span className="text-slate-500">{[v.make, v.model].filter(Boolean).join(' ')}</span>
              <span className="ml-auto text-slate-600">{v.ownerName ?? 'Chưa có chủ'}</span>
            </button>
          ))}
          {res.customers.map((c) => (
            <button key={c.id} type="button" onClick={() => onPick(c.id, null)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-slate-50">
              <UserPlus className="h-4 w-4 text-brand-600" />
              <span className="font-medium">{c.name}</span>
              <span className="text-slate-500">{c.phone ?? c.code}</span>
            </button>
          ))}
          {!res.vehicles.length && !res.customers.length && <div className="px-3 py-2 text-sm text-slate-500">Không tìm thấy. Bấm “Khách mới” để thêm.</div>}
        </div>
      )}
    </div>
  );
}
