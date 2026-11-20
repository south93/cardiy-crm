'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3 text-sm text-slate-500">
      <span data-testid="pager-text">
        {from.toLocaleString('vi-VN')}–{to.toLocaleString('vi-VN')} / {total.toLocaleString('vi-VN')}
      </span>
      <div className="flex items-center gap-1">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-white disabled:opacity-40" aria-label="Trang trước">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="px-2">
          Trang {page} / {pages}
        </span>
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className="grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-white disabled:opacity-40" aria-label="Trang sau">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
