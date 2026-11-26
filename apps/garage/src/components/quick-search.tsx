'use client';

import { Car, Search, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Result {
  customers: { id: string; code: string; name: string; phone: string | null }[];
  vehicles: { id: string; plate: string; make: string | null; model: string | null; ownerName: string | null }[];
}

/** Ô tìm nhanh trên thanh trên cùng: gõ SĐT, biển số hoặc tên (không cần dấu). */
export function QuickSearch() {
  const { can } = useAuth();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Result | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const enabled = can('customer.view') || can('vehicle.view');

  useEffect(() => {
    if (!enabled || q.trim().length < 2) return setRes(null);
    const t = setTimeout(async () => {
      try {
        setRes(await api<Result>(`/lookup?q=${encodeURIComponent(q.trim())}`));
        setActive(0);
      } catch {
        setRes(null);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, enabled]);

  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  if (!enabled) return null;
  const items = [
    ...(res?.vehicles ?? []).map((v) => ({ key: 'v' + v.id, href: `/xe/${v.id}`, icon: Car, title: v.plate, sub: [v.make, v.model, v.ownerName].filter(Boolean).join(' · ') })),
    ...(res?.customers ?? []).map((c) => ({ key: 'c' + c.id, href: `/khach-hang/${c.id}`, icon: UserRound, title: c.name, sub: [c.phone, c.code].filter(Boolean).join(' · ') })),
  ];
  const go = (href: string) => {
    setOpen(false);
    setQ('');
    router.push(href);
  };

  return (
    <div ref={box} className="relative hidden w-72 md:block">
      <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, items.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter' && items[active]) go(items[active].href);
          else if (e.key === 'Escape') setOpen(false);
        }}
        className="w-full rounded-full bg-white/80 py-2.5 pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand-200"
        placeholder="Biển số, SĐT, tên khách…"
        aria-label="Tìm nhanh"
        data-testid="quick-search"
      />
      {open && q.trim().length >= 2 && res && (
        <div className="absolute left-0 right-0 top-12 z-50 rounded-2xl border border-slate-100 bg-white p-1.5 shadow-card" role="listbox" data-testid="quick-search-results">
          {items.map((it, i) => (
            <button
              key={it.key}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(it.href)}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm ${i === active ? 'bg-brand-50' : ''}`}
            >
              <it.icon className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{it.title}</span>
                <span className="block truncate text-xs text-slate-500">{it.sub}</span>
              </span>
            </button>
          ))}
          {!items.length && <div className="px-3 py-3 text-sm text-slate-500">Không tìm thấy</div>}
        </div>
      )}
    </div>
  );
}
