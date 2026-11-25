'use client';

import { LocateFixed } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

/** Lấy vị trí trình duyệt → thêm lat/lng vào đường dẫn để máy chủ tính khoảng cách và xếp gần nhất */
export function NearMe({ label = 'Gần tôi nhất' }: { label?: string }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [state, setState] = useState<'idle' | 'busy' | 'denied'>('idle');
  const active = sp.get('lat') && sp.get('sort') === 'gan';
  return (
    <button
      type="button"
      data-testid="near-me"
      onClick={() => {
        if (!navigator.geolocation) return setState('denied');
        setState('busy');
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const p = new URLSearchParams(sp.toString());
            p.set('lat', pos.coords.latitude.toFixed(4));
            p.set('lng', pos.coords.longitude.toFixed(4));
            p.set('sort', 'gan');
            setState('idle');
            router.replace(`${path}?${p.toString()}`);
          },
          () => setState('denied'),
          { timeout: 10_000, maximumAge: 300_000 },
        );
      }}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium ${active ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-700 hover:border-brand-200'}`}
    >
      <LocateFixed className="h-4 w-4" />
      {state === 'busy' ? 'Đang lấy vị trí…' : state === 'denied' ? 'Chưa được phép lấy vị trí' : label}
    </button>
  );
}
