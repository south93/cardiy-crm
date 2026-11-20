'use client';

import { Alert, Badge, Button, Card, CardTitle, Spinner } from '@cardiy/ui';
import { CheckCircle2, ChevronLeft, Download, FileUp, Info, TriangleAlert, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { RequirePermission } from '@/components/require-permission';
import { api, apiBlob, ApiError } from '@/lib/api';
import type { BranchRow } from '@/lib/org';

interface Summary {
  rows: number;
  newCustomers: number;
  existingCustomers: number;
  mergedRows: number;
  customersWithoutPhone: number;
  newVehicles: number;
  partialPlates: number;
  updatedVehicles: number;
  skippedRows: number;
  errors: number;
  warnings: number;
  missingBranchCodes: string[];
}
interface Issue { row: number; level: 'error' | 'warning' | 'info'; message: string; value?: string }
interface Preview { id: string; kind: 'CUSTOMERS' | 'VEHICLES'; fileName: string; summary: Summary; issues: Issue[]; totalIssues: number }
interface Result { customers: number; vehicles: number; updatedVehicles: number; createdBranches: number }

const LEVEL = {
  error: { tone: 'rose' as const, label: 'Bỏ qua', icon: XCircle },
  warning: { tone: 'peach' as const, label: 'Cần xem lại', icon: TriangleAlert },
  info: { tone: 'sky' as const, label: 'Thông tin', icon: Info },
};

function Stat({ label, value, tone = 'text-slate-800' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4">
      <div className={`text-2xl font-semibold ${tone}`}>{value.toLocaleString('vi-VN')}</div>
      <div className="mt-0.5 text-xs text-slate-500">{label}</div>
    </div>
  );
}

function ImportWizard() {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  /** Mã chi nhánh lạ trong file → '' (tạo mới) hoặc id chi nhánh đã có (gộp) */
  const [branchMap, setBranchMap] = useState<Record<string, string>>({});
  const [branches, setBranches] = useState<BranchRow[]>([]);
  useEffect(() => {
    api<BranchRow[]>('/branches').then(setBranches, () => setBranches([]));
  }, []);
  const [filter, setFilter] = useState<'all' | Issue['level']>('all');
  const [result, setResult] = useState<Result | null>(null);

  const upload = async (file: File) => {
    setError(null);
    setPreview(null);
    setResult(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      setBranchMap({});
      setPreview(await api<Preview>('/imports/preview', { form }));
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
      setResult(await api<Result>(`/imports/${preview.id}/commit`, {
          body: { createMissingBranches: true, branchMap: Object.fromEntries(Object.entries(branchMap).filter(([, v]) => v)) },
        }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Nhập dữ liệu không thành công');
    } finally {
      setBusy(false);
    }
  };

  const downloadIssues = async () => {
    if (!preview) return;
    let blob: Blob;
    try {
      blob = await apiBlob(`/imports/${preview.id}/issues.csv`);
    } catch {
      return setError('Không tải được danh sách vấn đề');
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `van-de-nhap-${preview.fileName.replace(/\.csv$/i, '')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const s = preview?.summary;
  const issues = preview?.issues.filter((i) => filter === 'all' || i.level === filter) ?? [];

  return (
    <div className="space-y-4" data-testid="import-wizard">
      <Link href="/khach-hang" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
        <ChevronLeft className="h-4 w-4" />
        Khách hàng
      </Link>

      <Card className="p-5 lg:p-6">
        <CardTitle>Nhập dữ liệu từ AppSheet</CardTitle>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>Trên Google Sheets của AppSheet: <b>Tệp → Tải xuống → CSV</b> (hoặc Excel: Lưu thành <b>CSV UTF-8</b>).</li>
          <li>Tải file <b>khách hàng</b> trước, sau đó (nếu có) file <b>xe</b> để bổ sung hãng, dòng, đời, VIN, số km.</li>
          <li>Hệ thống <b>xem trước</b>: chưa ghi gì cho tới khi bạn bấm Xác nhận. Nhập lại cùng file không tạo trùng.</li>
        </ol>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input ref={input} type="file" accept=".csv,text/csv" hidden data-testid="import-file" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          <Button onClick={() => input.current?.click()} disabled={busy}>
            {busy && !preview ? <Spinner /> : <FileUp className="h-4 w-4" />}
            Chọn file CSV
          </Button>
          {preview && <span className="text-sm text-slate-500">{preview.fileName} · {preview.kind === 'CUSTOMERS' ? 'File khách hàng' : 'File xe'}</span>}
        </div>
      </Card>

      {error && <Alert>{error}</Alert>}

      {result && (
        <Alert tone="mint">
          <span className="flex items-center gap-2 font-medium" data-testid="import-result">
            <CheckCircle2 className="h-4 w-4" />
            Đã nhập {result.customers.toLocaleString('vi-VN')} khách, {result.vehicles.toLocaleString('vi-VN')} xe
            {result.updatedVehicles ? `, bổ sung ${result.updatedVehicles.toLocaleString('vi-VN')} xe` : ''}
            {result.createdBranches ? `, tạo ${result.createdBranches} chi nhánh (vào Cài đặt để đổi tên)` : ''}.
          </span>
          <Link href="/khach-hang" className="mt-1 inline-block underline">Xem danh sách khách hàng</Link>
        </Alert>
      )}

      {preview && s && !result && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="import-summary">
            <Stat label="Dòng trong file" value={s.rows} />
            <Stat label="Khách mới" value={s.newCustomers} tone="text-mint-700" />
            <Stat label="Xe mới" value={s.newVehicles} tone="text-mint-700" />
            <Stat label="Khách đã có (bổ sung xe)" value={s.existingCustomers} tone="text-sky-700" />
            <Stat label="Dòng gộp do trùng SĐT" value={s.mergedRows} />
            <Stat label="Khách không SĐT (theo biển số)" value={s.customersWithoutPhone} tone="text-peach-700" />
            <Stat label="Biển số cần xem lại" value={s.partialPlates} tone="text-peach-700" />
            <Stat label="Dòng bỏ qua" value={s.skippedRows} tone="text-rose-700" />
          </div>

          <Card className="p-4 lg:p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <CardTitle className="mr-auto">Vấn đề phát hiện ({preview.totalIssues.toLocaleString('vi-VN')})</CardTitle>
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
            <div className="max-h-96 overflow-y-auto rounded-2xl border border-slate-100">
              <table className="w-full text-sm" data-testid="import-issues">
                <tbody>
                  {issues.map((i, idx) => {
                    const L = LEVEL[i.level];
                    return (
                      <tr key={idx} className="border-b border-slate-50 last:border-0">
                        <td className="w-20 px-3 py-2 text-xs text-slate-500">Dòng {i.row}</td>
                        <td className="w-32 px-2 py-2"><Badge tone={L.tone}><L.icon className="h-3 w-3" />{L.label}</Badge></td>
                        <td className="px-2 py-2">{i.message}</td>
                      </tr>
                    );
                  })}
                  {!issues.length && <tr><td className="p-6 text-center text-slate-500">Không có vấn đề nào</td></tr>}
                </tbody>
              </table>
            </div>
            {preview.totalIssues > preview.issues.length && <p className="mt-2 text-xs text-slate-500">Đang hiện {preview.issues.length} vấn đề đầu tiên. Tải danh sách đủ để xem hết.</p>}
          </Card>

          <Card className="space-y-3 p-4 lg:p-5">
            {s.missingBranchCodes.length > 0 && (
              <div className="space-y-2" data-testid="branch-map">
                <div className="text-sm font-medium text-slate-700">Mã chi nhánh trong file chưa có trên hệ thống</div>
                {s.missingBranchCodes.map((code) => (
                  <label key={code} className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="w-14 font-semibold">{code}</span>
                    <select
                      aria-label={`Chi nhánh cho ${code}`}
                      className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm"
                      value={branchMap[code] ?? ''}
                      onChange={(e) => setBranchMap((m) => ({ ...m, [code]: e.target.value }))}
                    >
                      <option value="">Tạo chi nhánh mới “{code}” (đổi tên sau trong Cài đặt)</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          Gộp vào {b.code} · {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void commit()} disabled={busy || (!s.newCustomers && !s.newVehicles && !s.updatedVehicles)} data-testid="import-commit">
                {busy && <Spinner />}
                Xác nhận nhập {s.newCustomers.toLocaleString('vi-VN')} khách, {s.newVehicles.toLocaleString('vi-VN')} xe
              </Button>
              <span className="text-xs text-slate-500">Dòng "Bỏ qua" sẽ không được nhập. Dòng "Cần xem lại" vẫn nhập, bạn sửa sau.</span>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

export default function ImportPage() {
  return (
    <RequirePermission permission="data.import">
      <ImportWizard />
    </RequirePermission>
  );
}
