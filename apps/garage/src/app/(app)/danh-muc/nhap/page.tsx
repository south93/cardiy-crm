'use client';

import { Alert, Badge, Button, Card, CardTitle, Spinner } from '@cardiy/ui';
import { CheckCircle2, ChevronLeft, Download, FileUp, Info, TriangleAlert, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { RequirePermission } from '@/components/require-permission';
import { api, apiBlob, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtMoney } from '@/lib/crm';

interface Summary {
  rows: number;
  products: number;
  newProducts: number;
  updatedProducts: number;
  services: number;
  noPrice: number;
  duplicates: number;
  skipped: number;
  groups: number;
  stock: Record<string, { items: number; qty: number }>;
  negativeZeroed: number;
  abnormalSkipped: number;
  missingBranchCodes: string[];
}
interface Issue {
  row: number;
  level: 'error' | 'warning' | 'info';
  message: string;
  value?: string;
}
interface Sample {
  code: string;
  name: string;
  kind: 'PHU_TUNG' | 'DICH_VU';
  group: string | null;
  subgroup: string | null;
  salePrice: number;
  salePriceBd: number | null;
  vatPrice: number | null;
}
interface Preview {
  id: string;
  fileName: string;
  summary: Summary;
  groups: { name: string; children: string[] }[];
  sample: Sample[];
  issues: Issue[];
  totalIssues: number;
}
interface Result {
  created: number;
  updated: number;
  newGroups: number;
  documents: { branch: string; code: string; lines: number }[];
}

const LEVEL = {
  error: { tone: 'rose' as const, label: 'Bỏ qua', icon: XCircle },
  warning: { tone: 'peach' as const, label: 'Cần xem lại', icon: TriangleAlert },
  info: { tone: 'sky' as const, label: 'Thông tin', icon: Info },
};
const n = (v: number) => v.toLocaleString('vi-VN');

function Stat({ label, value, tone = 'text-slate-800' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4">
      <div className={`text-2xl font-semibold tabular-nums ${tone}`}>{n(value)}</div>
      <div className="mt-0.5 text-xs text-slate-500">{label}</div>
    </div>
  );
}

/** Nhập danh mục sản phẩm + tồn đầu kỳ từ file Excel AppSheet (sheet "SẢN PHẨM", "BANG_GIA_3CN", "LO DATE") */
function ProductImport() {
  const { can } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [filter, setFilter] = useState<'all' | Issue['level']>('all');

  const upload = async (file: File) => {
    setError(null);
    setPreview(null);
    setResult(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      setPreview(await api<Preview>('/products/import/preview', { form }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không đọc được file');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api<Result>(`/products/import/${preview.id}/commit`, { body: {} }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Nhập dữ liệu không thành công');
    } finally {
      setBusy(false);
    }
  };
  const downloadIssues = async () => {
    if (!preview) return;
    try {
      const url = URL.createObjectURL(await apiBlob(`/products/import/${preview.id}/issues.csv`));
      const a = document.createElement('a');
      a.href = url;
      a.download = `van-de-nhap-san-pham.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Không tải được danh sách vấn đề');
    }
  };

  const s = preview?.summary;
  const issues = preview?.issues.filter((i) => filter === 'all' || i.level === filter) ?? [];
  const canCommit = can('inventory.adjust.approve');

  return (
    <div className="space-y-4" data-testid="product-import">
      <Link href="/danh-muc" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
        <ChevronLeft className="h-4 w-4" />
        Danh mục sản phẩm
      </Link>

      <Card className="p-5 lg:p-6">
        <CardTitle>Nhập sản phẩm & tồn kho từ AppSheet</CardTitle>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>
            Tải file Excel kho (Google Sheets: <b>Tệp → Tải xuống → Microsoft Excel (.xlsx)</b>). File cần sheet <b>SẢN PHẨM</b> và <b>BANG_GIA_3CN</b>; có sheet <b>LO DATE</b> thì lấy thêm giá vốn
            theo lô.
          </li>
          <li>
            Giá bán = giá Bình Phước; lưu thêm <b>giá Bình Dương</b> và <b>giá VAT</b>. Chi nhánh nào dùng bảng giá nào chọn trong <b>Cài đặt → Chi nhánh</b>.
          </li>
          <li>
            Tồn kho CN1 / CN2 / CN3 thành <b>tồn đầu kỳ</b> (mỗi chi nhánh một phiếu kiểm kê). Tồn âm đưa về 0, số bất thường (trên 10.000) không nhập.
          </li>
          <li>Hệ thống xem trước, chưa ghi gì cho tới khi bấm Xác nhận. Nhập lại file mới hơn: sản phẩm được cập nhật theo mã, tồn được đưa về đúng số trong file.</li>
        </ol>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={input}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            data-testid="product-import-file"
            onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
          />
          <Button onClick={() => input.current?.click()} disabled={busy}>
            {busy && !preview ? <Spinner /> : <FileUp className="h-4 w-4" />}
            {busy && !preview ? 'Đang đọc file…' : 'Chọn file Excel'}
          </Button>
          {preview && <span className="text-sm text-slate-500">{preview.fileName}</span>}
        </div>
      </Card>

      {error && <Alert>{error}</Alert>}

      {result && (
        <Alert tone="mint">
          <span className="flex items-center gap-2 font-medium" data-testid="product-import-result">
            <CheckCircle2 className="h-4 w-4" />
            Đã nhập {n(result.created)} sản phẩm mới, cập nhật {n(result.updated)}, tạo {n(result.newGroups)} nhóm hàng.
          </span>
          {result.documents.length > 0 && (
            <span className="mt-1 block">
              Phiếu tồn đầu kỳ:{' '}
              {result.documents.map((d, i) => (
                <span key={d.code}>
                  {i > 0 && ' · '}
                  {d.branch}: <b className="font-mono">{d.code}</b> ({n(d.lines)} mã)
                </span>
              ))}
            </span>
          )}
          <span className="mt-1 flex gap-4">
            <Link href="/danh-muc" className="underline">
              Xem danh mục
            </Link>
            <Link href="/ton-kho" className="underline">
              Xem tồn kho
            </Link>
          </span>
        </Alert>
      )}

      {preview && s && !result && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="product-import-summary">
            <Stat label="Sản phẩm nhập được" value={s.products} />
            <Stat label="Sản phẩm mới" value={s.newProducts} tone="text-mint-700" />
            <Stat label="Đã có (cập nhật theo mã)" value={s.updatedProducts} tone="text-sky-700" />
            <Stat label="Trong đó dịch vụ" value={s.services} />
            <Stat label="Chưa có giá bán (bổ sung sau)" value={s.noPrice} tone="text-peach-700" />
            <Stat label="Tồn âm → 0" value={s.negativeZeroed} tone="text-peach-700" />
            <Stat label="Tồn bất thường (không nhập)" value={s.abnormalSkipped} tone="text-rose-700" />
            <Stat label="Dòng bỏ qua (trùng / thiếu tên)" value={s.skipped + s.duplicates} tone="text-rose-700" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4 lg:p-5">
              <CardTitle className="mb-2">Tồn đầu kỳ theo chi nhánh</CardTitle>
              <table className="w-full text-sm" data-testid="product-import-stock">
                <tbody>
                  {Object.entries(s.stock)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([code, v]) => (
                      <tr key={code} className="border-b border-slate-50 last:border-0">
                        <td className="py-2 font-semibold">{code}</td>
                        <td className="py-2 text-right tabular-nums">{n(v.items)} mã</td>
                        <td className="py-2 text-right tabular-nums">{n(v.qty)} đơn vị</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Card>
            <Card className="p-4 lg:p-5">
              <CardTitle className="mb-2">Nhóm hàng ({n(s.groups)})</CardTitle>
              <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                {preview.groups.map((g) => (
                  <Badge key={g.name} tone="slate">
                    {g.name}
                    {g.children.length > 0 && <span className="text-slate-400"> · {g.children.length}</span>}
                  </Badge>
                ))}
              </div>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="px-4 pt-4 lg:px-5">
              <CardTitle>Xem trước 20 sản phẩm đầu</CardTitle>
            </div>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2 font-semibold lg:px-5">Mã</th>
                    <th className="px-2 py-2 font-semibold">Tên</th>
                    <th className="px-2 py-2 font-semibold">Nhóm</th>
                    <th className="px-2 py-2 text-right font-semibold">Giá BP</th>
                    <th className="px-2 py-2 text-right font-semibold">Giá BD</th>
                    <th className="px-4 py-2 text-right font-semibold lg:px-5">Giá VAT</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((p) => (
                    <tr key={p.code} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2 font-mono text-xs lg:px-5">{p.code}</td>
                      <td className="px-2 py-2">{p.name}</td>
                      <td className="px-2 py-2 text-xs text-slate-500">{[p.group, p.subgroup].filter(Boolean).join(' › ')}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{p.salePrice ? fmtMoney(p.salePrice) : '—'}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{p.salePriceBd ? fmtMoney(p.salePriceBd) : '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums lg:px-5">{p.vatPrice ? fmtMoney(p.vatPrice) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-4 lg:p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <CardTitle className="mr-auto">Cần xem lại ({n(preview.totalIssues)})</CardTitle>
              {(['all', 'error', 'warning', 'info'] as const).map((f) => (
                <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 text-xs ${filter === f ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  {f === 'all' ? 'Tất cả' : LEVEL[f].label}
                </button>
              ))}
              <Button variant="outline" className="px-3 py-1.5 text-xs" onClick={() => void downloadIssues()}>
                <Download className="h-3.5 w-3.5" />
                Tải đủ danh sách (Excel)
              </Button>
            </div>
            <div className="max-h-80 overflow-y-auto rounded-2xl border border-slate-100">
              <table className="w-full text-sm" data-testid="product-import-issues">
                <tbody>
                  {issues.map((i, idx) => {
                    const L = LEVEL[i.level];
                    return (
                      <tr key={idx} className="border-b border-slate-50 last:border-0">
                        <td className="w-20 px-3 py-2 text-xs text-slate-500">{i.row ? `Dòng ${i.row}` : ''}</td>
                        <td className="w-32 px-2 py-2">
                          <Badge tone={L.tone}>
                            <L.icon className="h-3 w-3" />
                            {L.label}
                          </Badge>
                        </td>
                        <td className="px-2 py-2">
                          {i.message}
                          {i.value && <span className="ml-1 font-mono text-xs text-slate-500">{i.value}</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {!issues.length && (
                    <tr>
                      <td className="p-6 text-center text-slate-500">Không có vấn đề nào</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="flex flex-wrap items-center gap-3 p-4 lg:p-5">
            <Button onClick={() => void commit()} disabled={busy || !canCommit} data-testid="product-import-commit">
              {busy && <Spinner />}
              Xác nhận nhập {n(s.products)} sản phẩm & tồn đầu kỳ
            </Button>
            <span className="text-xs text-slate-500">{canCommit ? 'Có thể mất khoảng 10–30 giây với vài nghìn mã.' : 'Cần quyền duyệt điều chỉnh tồn (Quản lý / Chủ garage) để xác nhận.'}</span>
          </Card>
        </>
      )}
    </div>
  );
}

export default function ProductImportPage() {
  return (
    <RequirePermission permission="inventory.manage">
      <ProductImport />
    </RequirePermission>
  );
}
