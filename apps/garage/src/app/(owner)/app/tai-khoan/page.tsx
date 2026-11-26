'use client';

import { Alert, Badge, Button, Card, CardTitle, Spinner } from '@cardiy/ui';
import { Award, Download, LogOut, ShieldCheck, Store, TicketPercent } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/crm';
import { TIER_UI, type OwnerLoyaltyResponse, type OwnerPrivacyResponse } from '@/lib/marketing';
import { fmtDateTime, methodLabel, type PaymentMethod } from '@/lib/orders';
import { ownerApi, useOwner } from '@/lib/owner';

interface Pay {
  id: string;
  amount: number;
  method: PaymentMethod;
  paidAt: string;
  order: { id: string; code: string; branch: string; plate: string | null };
}

/** A2.07 Điểm thưởng & Voucher ưu đãi của chủ xe tại các garage */
function LoyaltyAndVouchers() {
  const [data, setData] = useState<OwnerLoyaltyResponse | null>(null);
  useEffect(() => {
    ownerApi<OwnerLoyaltyResponse>('/loyalty')
      .then(setData)
      .catch(() => null);
  }, []);
  if (!data) return null;

  return (
    <Card className="space-y-3 p-4" data-testid="owner-loyalty-card">
      <div className="flex items-center gap-2">
        <Award className="h-4 w-4 text-amber-600" />
        <CardTitle className="text-base">Điểm thưởng & Voucher ưu đãi</CardTitle>
      </div>

      {data.wallets.length > 0 && (
        <ul className="space-y-2 text-sm">
          {data.wallets.map((w) => {
            const tUi = TIER_UI[w.tier];
            return (
              <li key={w.customerId} className="rounded-xl bg-amber-50/70 p-3" data-testid="owner-loyalty-wallet">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{w.garageName}</span>
                  <Badge tone={tUi.tone}>{w.tierLabel}</Badge>
                </div>
                <div className="mt-1 text-lg font-bold text-amber-700 tabular-nums">{w.balance.toLocaleString('vi-VN')} điểm</div>
                {w.recentTransactions.length > 0 && (
                  <div className="mt-1.5 space-y-0.5 border-t border-amber-200/60 pt-1.5 text-xs text-slate-600">
                    {w.recentTransactions.slice(0, 3).map((tx) => (
                      <div key={tx.id} className="flex justify-between gap-2">
                        <span className="truncate">{tx.note ?? tx.type}</span>
                        <b className={tx.points >= 0 ? 'text-emerald-700' : 'text-rose-600'}>
                          {tx.points >= 0 ? `+${tx.points}` : tx.points}
                        </b>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {data.vouchers.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center gap-1 text-xs font-semibold text-slate-600">
            <TicketPercent className="h-3.5 w-3.5 text-rose-500" /> Voucher đang mở của garage
          </div>
          <ul className="space-y-1.5 text-xs">
            {data.vouchers.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-rose-200 bg-rose-50/40 px-3 py-2">
                <div>
                  <b className="font-mono text-rose-700">{v.code}</b> · {v.title}
                  <div className="text-slate-500">
                    {v.garageName} · HSD {fmtDate(v.endsAt)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/** A2.13 Đồng ý nhận tin khuyến mại & Xuất dữ liệu cá nhân (Nghị định 13/2023) */
function PrivacyAndData() {
  const [privacy, setPrivacy] = useState<OwnerPrivacyResponse | null>(null);
  const [exportedAt, setExportedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ownerApi<OwnerPrivacyResponse>('/privacy')
      .then(setPrivacy)
      .catch(() => null);
  }, []);

  async function toggleConsent(granted: boolean) {
    const prev = privacy;
    setPrivacy((p) => (p ? { ...p, marketingConsent: granted } : p));
    setBusy(true);
    setError(null);
    try {
      const next = await ownerApi<OwnerPrivacyResponse>('/privacy/consent', {
        method: 'PUT',
        body: { granted, channel: 'ALL' },
      });
      setPrivacy(next);
    } catch (e) {
      setPrivacy(prev);
      setError(e instanceof ApiError ? e.message : 'Cập nhật đồng ý thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function exportMyData() {
    setBusy(true);
    setError(null);
    try {
      const dump = await ownerApi<{ exportedAt: string }>('/privacy/export');
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cardiy-du-lieu-ca-nhan.json`;
      a.click();
      URL.revokeObjectURL(url);
      setExportedAt(dump.exportedAt);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không xuất được dữ liệu');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 p-4" data-testid="owner-privacy-card">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-emerald-600" />
        <CardTitle className="text-base">Quyền riêng tư & Dữ liệu cá nhân</CardTitle>
      </div>
      {error && <Alert>{error}</Alert>}
      {privacy && (
        <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm">
          <span>
            <span className="block font-medium text-slate-900">Đồng ý nhận tin chăm sóc & khuyến mại</span>
            <span className="block text-xs text-slate-500">
              Nhận ưu đãi bảo dưỡng, voucher từ garage và sàn CARDIY. Bạn có thể tắt bất cứ lúc nào.
            </span>
          </span>
          <input
            type="checkbox"
            checked={privacy.marketingConsent}
            disabled={busy}
            onChange={(e) => toggleConsent(e.target.checked)}
            className="mt-1 h-4 w-4 accent-brand-600"
            data-testid="owner-consent-toggle"
          />
        </label>
      )}
      <Button variant="outline" className="w-full justify-center text-xs" onClick={exportMyData} disabled={busy} data-testid="owner-export-data-btn">
        <Download className="h-4 w-4" /> Xuất toàn bộ dữ liệu cá nhân (JSON)
      </Button>
      {exportedAt && (
        <p className="text-center text-xs text-emerald-700" data-testid="owner-export-done">
          Đã tải xuống bản sao dữ liệu lúc {fmtDateTime(exportedAt)}
        </p>
      )}
    </Card>
  );
}

/** Lịch sử thanh toán tại các garage */
function Payments() {
  const [rows, setRows] = useState<Pay[] | null>(null);
  useEffect(() => {
    ownerApi<Pay[]>('/payments').then(setRows);
  }, []);
  return (
    <Card className="p-4" data-testid="payment-history">
      <CardTitle className="mb-2 text-base">Lịch sử thanh toán</CardTitle>
      {!rows ? (
        <Spinner className="h-5 w-5 text-brand-600" />
      ) : !rows.length ? (
        <p className="text-sm text-slate-500">Chưa có khoản thanh toán nào.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.map((p) => (
            <li key={p.id}>
              <Link href={`/app/don/${p.order.id}`} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-medium">{p.order.code}</span>
                  {p.order.plate && <span className="font-mono text-xs text-slate-500"> · {p.order.plate}</span>}
                  <span className="block text-xs text-slate-500">
                    {fmtDateTime(p.paidAt)} · {methodLabel(p.method)} · {p.order.branch}
                  </span>
                </span>
                <span className="font-semibold tabular-nums">{fmtMoney(p.amount)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function OwnerAccountPage() {
  const { me, signOut } = useOwner();
  const router = useRouter();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Tài khoản</h1>
      <Card className="p-4">
        <div className="text-lg font-semibold">{me?.name}</div>
        <div className="text-sm text-slate-500">{me?.phone}</div>
      </Card>
      <LoyaltyAndVouchers />
      <Card className="p-4">
        <CardTitle className="mb-2 text-base">Garage của tôi</CardTitle>
        <ul className="space-y-2 text-sm">
          {me?.garages.map((g, i) => (
            <li key={i} className="flex items-center gap-2">
              <Store className="h-4 w-4 text-slate-400" /> {g.garage}
              <span className="text-slate-500">· hồ sơ {g.customerName}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Payments />
      <PrivacyAndData />
      <Button
        variant="outline"
        className="w-full justify-center"
        onClick={async () => {
          await signOut();
          router.replace('/app/dang-nhap');
        }}
        data-testid="owner-logout"
      >
        <LogOut className="h-4 w-4" /> Đăng xuất
      </Button>
    </div>
  );
}
