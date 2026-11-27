import { buildCsv, buildXlsx, type ExportColumn } from '@cardiy/shared';
import { api } from './api';
import type { Paged } from './crm';

export type ExportFormat = 'xlsx' | 'csv';

function todayVnSlug(): string {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Tạo và tải xuống file Excel (.xlsx) hoặc CSV (.csv) từ danh sách dòng & định nghĩa cột. */
export function downloadTableExport<T>({
  format,
  filename,
  sheetName,
  columns,
  rows,
}: {
  format: ExportFormat;
  filename: string;
  sheetName?: string;
  columns: readonly ExportColumn<T>[];
  rows: readonly T[];
}): void {
  const base = `${filename}-${todayVnSlug()}`;
  if (format === 'csv') {
    const csv = buildCsv(columns, rows);
    triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${base}.csv`);
    return;
  }
  const bytes = buildXlsx(sheetName ?? filename, columns, rows);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  triggerDownload(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${base}.xlsx`,
  );
}

/** Tải toàn bộ các trang của API phân trang `Paged<T>` theo bộ lọc hiện hành (tối đa 10.000 dòng). */
export async function fetchAllPages<T>(
  buildPath: (page: number, pageSize: number) => string,
  pageSize = 100,
  maxPages = 100,
): Promise<T[]> {
  const first = await api<Paged<T>>(buildPath(1, pageSize));
  const totalPages = Math.min(maxPages, Math.max(1, Math.ceil(first.total / pageSize)));
  if (totalPages <= 1) return first.items;

  const all = [...first.items];
  for (let start = 2; start <= totalPages; start += 4) {
    const batch: Promise<Paged<T>>[] = [];
    for (let p = start; p < start + 4 && p <= totalPages; p++) {
      batch.push(api<Paged<T>>(buildPath(p, pageSize)));
    }
    const pages = await Promise.all(batch);
    for (const pg of pages) all.push(...pg.items);
  }
  return all;
}

/** Tải nhiều trang theo con trỏ `nextBefore` (dùng cho nhật ký thao tác). */
export async function fetchAllCursor<T>(
  fetchPage: (before?: number) => Promise<{ items: T[]; nextBefore: number | null }>,
  maxPages = 20,
): Promise<T[]> {
  const all: T[] = [];
  let before: number | undefined;
  for (let i = 0; i < maxPages; i++) {
    const res = await fetchPage(before);
    all.push(...res.items);
    if (!res.nextBefore || !res.items.length) break;
    before = res.nextBefore;
  }
  return all;
}
