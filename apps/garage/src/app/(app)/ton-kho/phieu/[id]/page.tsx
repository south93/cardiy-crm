'use client';

import { Badge, Card, Spinner } from '@cardiy/ui';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RequirePermission } from '@/components/require-permission';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/crm';
import { DOC_TYPES, fmtMfg, fmtQty, type DocType } from '@/lib/inventory';
import { fmtDateTime } from '@/lib/orders';

interface Doc {
  id: string;
  code: string;
  type: DocType;
  branch: { code: string; name: string } | null;
  toBranch: { code: string; name: string } | null;
  supplier: { id: string; name: string; phone: string | null } | null;
  refNo: string | null;
  note: string | null;
  total: number | null;
  createdBy: string | null;
  createdAt: string;
  lines: { product: { id: string; code: string; name: string; unit: string | null; category: string | null; mfgMonth: number | null; mfgYear: number | null }; quantity: number; delta: number; balance: number; unitCost: number | null; note: string | null }[];
}

function DocDetail() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Doc | null>(null);
  useEffect(() => {
    api<Doc>(`/stock-documents/${id}`).then(setD);
  }, [id]);
  if (!d) return <Spinner className="h-6 w-6 text-brand-600" />;
  return (
    <div className="space-y-4" data-testid="doc-detail">
      <Link href="/ton-kho?tab=phieu" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
        <ChevronLeft className="h-4 w-4" />
        Phiếu kho
      </Link>
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold" data-testid="doc-code">
            {d.code}
          </h2>
          <Badge tone={DOC_TYPES[d.type].tone}>{DOC_TYPES[d.type].label}</Badge>
        </div>
        <div className="mt-1 text-sm text-slate-500">
          {d.type === 'CHUYEN' ? `${d.branch?.name} → ${d.toBranch?.name}` : d.branch?.name} · {fmtDateTime(d.createdAt)}
          {d.createdBy && ` · ${d.createdBy}`}
        </div>
        {(d.supplier || d.refNo || d.note) && (
          <div className="mt-2 text-sm">
            {d.supplier && <span>Nhà cung cấp: <b>{d.supplier.name}</b> </span>}
            {d.refNo && <span>· Hoá đơn: {d.refNo} </span>}
            {d.note && <div className="text-slate-600">{d.note}</div>}
          </div>
        )}
      </Card>
      <Card className="overflow-x-auto p-4 lg:p-5">
        <table className="w-full text-sm" data-testid="doc-detail-lines">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
              <th className="py-2 font-medium">Mã hàng</th>
              <th className="py-2 font-medium">Tên hàng</th>
              <th className="py-2 font-medium">Nhóm hàng</th>
              <th className="py-2 text-right font-medium">{d.type === 'DIEU_CHINH' ? 'Chênh lệch' : 'Số lượng'}</th>
              {d.type === 'NHAP' && <th className="py-2 text-right font-medium">Giá nhập</th>}
              {d.type === 'NHAP' && <th className="py-2 text-right font-medium">Thành tiền</th>}
              <th className="py-2 text-right font-medium">{d.type === 'CHUYEN' ? 'Tồn kho chuyển sau phiếu' : 'Tồn sau phiếu'}</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.product.id} className="border-b border-slate-50 last:border-0">
                <td className="py-2 pr-2 font-mono text-xs">{l.product.code}</td>
                <td className="py-2 pr-2">
                  <Link href={`/danh-muc/${l.product.id}`} className="font-medium hover:text-brand-600">
                    {l.product.name}
                  </Link>
                  {fmtMfg(l.product.mfgMonth, l.product.mfgYear) && <div className="text-xs text-slate-500">SX {fmtMfg(l.product.mfgMonth, l.product.mfgYear)}</div>}
                </td>
                <td className="py-2 pr-2 text-slate-600">{l.product.category ?? '—'}</td>
                <td className={`py-2 text-right tabular-nums ${d.type === 'DIEU_CHINH' ? (l.delta < 0 ? 'text-rose-600' : 'text-mint-700') : ''}`}>
                  {d.type === 'DIEU_CHINH' && l.delta > 0 ? '+' : ''}
                  {fmtQty(d.type === 'DIEU_CHINH' ? l.delta : l.quantity)} {l.product.unit}
                </td>
                {d.type === 'NHAP' && <td className="py-2 text-right tabular-nums">{l.unitCost === null ? '—' : fmtMoney(l.unitCost)}</td>}
                {d.type === 'NHAP' && <td className="py-2 text-right tabular-nums">{l.unitCost === null ? '—' : fmtMoney(Math.round(l.quantity * l.unitCost))}</td>}
                <td className="py-2 text-right tabular-nums">{fmtQty(l.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {d.type === 'NHAP' && d.total !== null && <div className="mt-3 text-right text-base font-semibold">Tổng tiền nhập: {fmtMoney(d.total)}</div>}
      </Card>
    </div>
  );
}

export default function DocPage() {
  return (
    <RequirePermission permission="inventory.view">
      <DocDetail />
    </RequirePermission>
  );
}
