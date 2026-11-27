'use client';

import type { ExportColumn } from '@cardiy/shared';
import { cn, Spinner } from '@cardiy/ui';
import { ChevronDown, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { downloadTableExport, type ExportFormat } from '@/lib/export';

interface ExportButtonProps<T> {
  filename: string;
  sheetName?: string;
  columns: readonly ExportColumn<T>[] | (() => readonly ExportColumn<T>[]);
  /** Dữ liệu đã có sẵn trên màn hình (dùng cho bảng không phân trang) */
  rows?: readonly T[];
  /** Hàm tải toàn bộ dữ liệu theo bộ lọc hiện tại (dùng cho bảng có phân trang) */
  fetchRows?: () => Promise<readonly T[]>;
  disabled?: boolean;
  label?: string;
  className?: string;
  testId?: string;
}

export function ExportButton<T>({
  filename,
  sheetName,
  columns,
  rows,
  fetchRows,
  disabled = false,
  label = 'Xuất Excel',
  className,
  testId = 'export-button',
}: ExportButtonProps<T>) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isEmpty = !fetchRows && (!rows || rows.length === 0);
  const isDisabled = disabled || busy || isEmpty;

  const runExport = async (format: ExportFormat) => {
    if (isDisabled) return;
    setOpen(false);
    setBusy(true);
    setErr(null);
    try {
      const data = fetchRows ? await fetchRows() : (rows ?? []);
      const cols = typeof columns === 'function' ? columns() : columns;
      downloadTableExport({ format, filename, sheetName, columns: cols, rows: data });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Không xuất được dữ liệu');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={wrapRef} className={cn('relative inline-flex flex-col items-end', className)}>
      <div className="inline-flex items-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-xs">
        <button
          type="button"
          onClick={() => void runExport('xlsx')}
          disabled={isDisabled}
          data-testid={testId}
          title={isEmpty ? 'Không có dữ liệu để xuất' : `Xuất ${label} (.xlsx)`}
          className="inline-flex items-center gap-1.5 rounded-l-full px-3.5 py-2 text-sm font-medium transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Spinner className="h-4 w-4 text-brand-600" /> : <Download className="h-4 w-4" />}
          <span>{busy ? 'Đang xuất…' : label}</span>
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={isDisabled}
          aria-label="Chọn định dạng xuất"
          aria-haspopup="menu"
          aria-expanded={open}
          data-testid={`${testId}-menu`}
          className="inline-flex items-center rounded-r-full border-l border-slate-200 px-2 py-2 text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1.5 w-48 rounded-2xl border border-slate-100 bg-white p-1.5 text-sm shadow-card"
        >
          <button
            type="button"
            role="menuitem"
            data-testid={`${testId}-xlsx`}
            onClick={() => void runExport('xlsx')}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-slate-700 hover:bg-brand-50"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            <span>Xuất Excel (.xlsx)</span>
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid={`${testId}-csv`}
            onClick={() => void runExport('csv')}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-slate-700 hover:bg-brand-50"
          >
            <FileText className="h-4 w-4 text-sky-600" />
            <span>Xuất CSV (.csv)</span>
          </button>
        </div>
      )}
      {err && <span className="mt-1 text-xs text-rose-600">{err}</span>}
    </div>
  );
}
