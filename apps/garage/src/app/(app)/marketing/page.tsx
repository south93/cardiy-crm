'use client';

import { Alert, Badge, Button, Card, CardTitle, Dialog, Field, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import { Award, CheckCircle2, Eye, Filter, Gift, Megaphone, Plus, Search, Send, Settings, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ExportButton } from '@/components/export-button';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { fmtMoney } from '@/lib/crm';
import {
  CAMPAIGN_CHANNEL_UI,
  CAMPAIGN_STATUS_UI,
  CUSTOMER_SOURCES,
  DELIVERY_STATUS_UI,
  TIER_UI,
  type CampaignChannelCode,
  type CustomerSegmentItem,
  type CustomerTierCode,
  type LoyaltyConfigDto,
  type LoyaltyCustomerItem,
  type MarketingCampaignDetail,
  type MarketingCampaignItem,
  type SegmentPreviewResult,
} from '@/lib/marketing';
import { fmtDateTime } from '@/lib/orders';

interface OverviewRes {
  kpis: {
    totalCustomers: number;
    consentedCustomers: number;
    pointsCirculating: number;
    segmentsCount: number;
    campaignsSent: number;
  };
  vouchers: { id: string; code: string; title: string; kind: string; value: number }[];
}

/** A3.62 · M35 Marketing CRM PLG: Phân khúc khách hàng, Chiến dịch & Tích điểm thưởng */
export default function GarageMarketingPage() {
  return (
    <RequirePermission permission="marketing.manage">
      <GarageMarketingBody />
    </RequirePermission>
  );
}

function GarageMarketingBody() {
  const [tab, setTab] = useState<'segments' | 'campaigns' | 'loyalty'>('segments');
  const [overview, setOverview] = useState<OverviewRes | null>(null);
  const [segments, setSegments] = useState<CustomerSegmentItem[] | null>(null);
  const [campaigns, setCampaigns] = useState<MarketingCampaignItem[] | null>(null);
  const [loyaltyCfg, setLoyaltyCfg] = useState<LoyaltyConfigDto | null>(null);
  const [loyaltyCustomers, setLoyaltyCustomers] = useState<LoyaltyCustomerItem[] | null>(null);
  const [custQ, setCustQ] = useState('');

  // Tạo phân khúc
  const [openSegment, setOpenSegment] = useState(false);
  const [segName, setSegName] = useState('');
  const [segDesc, setSegDesc] = useState('');
  const [segTiers, setSegTiers] = useState<CustomerTierCode[]>([]);
  const [segSources, setSegSources] = useState<string[]>([]);
  const [segMinSpent, setSegMinSpent] = useState('');
  const [segInactiveDays, setSegInactiveDays] = useState('');
  const [segExpiringDays, setSegExpiringDays] = useState('');
  const [previewData, setPreviewData] = useState<SegmentPreviewResult | null>(null);

  // Tạo & xem chi tiết chiến dịch
  const [openCampaign, setOpenCampaign] = useState(false);
  const [campName, setCampName] = useState('');
  const [campChannel, setCampChannel] = useState<CampaignChannelCode>('APP_PUSH');
  const [campSegId, setCampSegId] = useState('');
  const [campVoucherId, setCampVoucherId] = useState('');
  const [campTitle, setCampTitle] = useState('Ưu đãi chăm sóc xe dành riêng cho {{ten_khach}}');
  const [campBody, setCampBody] = useState(
    'Chào {{ten_khach}} ({{hang_the}}, hiện có {{diem_thuong}} điểm), {{ten_garage}} gửi tặng ưu đãi {{ma_voucher}} cho lần bảo dưỡng tiếp theo!',
  );
  const [campaignDetail, setCampaignDetail] = useState<MarketingCampaignDetail | null>(null);

  // Điều chỉnh / Đổi điểm thưởng
  const [adjustTarget, setAdjustTarget] = useState<LoyaltyCustomerItem | null>(null);
  const [adjType, setAdjType] = useState<'REDEEM' | 'ADJUST'>('REDEEM');
  const [adjPoints, setAdjPoints] = useState('20');
  const [adjNote, setAdjNote] = useState('');
  const [openCfgModal, setOpenCfgModal] = useState(false);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const qs = custQ.trim() ? `?q=${encodeURIComponent(custQ.trim())}` : '';
      const [ov, segs, camps, cfg, lCusts] = await Promise.all([
        api<OverviewRes>('/marketing/overview'),
        api<CustomerSegmentItem[]>('/marketing/segments'),
        api<MarketingCampaignItem[]>('/marketing/campaigns'),
        api<LoyaltyConfigDto>('/marketing/loyalty/config'),
        api<LoyaltyCustomerItem[]>(`/marketing/loyalty/customers${qs}`),
      ]);
      setOverview(ov);
      setSegments(segs);
      setCampaigns(camps);
      setLoyaltyCfg(cfg);
      setLoyaltyCustomers(lCusts);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được dữ liệu Marketing');
    }
  }, [custQ]);

  useEffect(() => {
    const t = setTimeout(() => void loadAll(), custQ ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadAll, custQ]);

  function buildRulesPayload() {
    return {
      tiers: segTiers,
      sources: segSources,
      minSpent: segMinSpent.trim() ? Number(segMinSpent) : null,
      inactiveDays: segInactiveDays.trim() ? Number(segInactiveDays) : null,
      expiringWithinDays: segExpiringDays.trim() ? Number(segExpiringDays) : null,
    };
  }

  async function runPreview() {
    setBusy('preview');
    setError(null);
    try {
      const p = await api<SegmentPreviewResult>('/marketing/segments/preview', { body: buildRulesPayload() });
      setPreviewData(p);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Xem trước phân khúc thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function saveSegment() {
    setBusy('segment');
    setError(null);
    try {
      await api('/marketing/segments', {
        body: {
          name: segName,
          description: segDesc || null,
          rules: buildRulesPayload(),
        },
      });
      setOpenSegment(false);
      setSegName('');
      setSegDesc('');
      setPreviewData(null);
      await loadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Lưu phân khúc thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function createCampaign() {
    setBusy('campaign');
    setError(null);
    try {
      await api('/marketing/campaigns', {
        body: {
          name: campName,
          channel: campChannel,
          segmentId: campSegId || null,
          voucherId: campVoucherId || null,
          title: campTitle,
          bodyTemplate: campBody,
        },
      });
      setOpenCampaign(false);
      setCampName('');
      await loadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Tạo chiến dịch thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function sendCampaign(id: string) {
    setBusy(id);
    setError(null);
    try {
      const detail = await api<MarketingCampaignDetail>(`/marketing/campaigns/${id}/send`, { body: {} });
      setCampaignDetail(detail);
      await loadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Phát hành chiến dịch thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function viewCampaignDetail(id: string) {
    setBusy(id);
    try {
      const detail = await api<MarketingCampaignDetail>(`/marketing/campaigns/${id}`);
      setCampaignDetail(detail);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được chi tiết chiến dịch');
    } finally {
      setBusy(null);
    }
  }

  async function submitAdjustLoyalty() {
    if (!adjustTarget) return;
    setBusy('adjust');
    setError(null);
    try {
      await api('/marketing/loyalty/adjust', {
        body: {
          customerId: adjustTarget.id,
          type: adjType,
          points: Number(adjPoints),
          note: adjNote,
        },
      });
      setAdjustTarget(null);
      setAdjNote('');
      await loadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Điều chỉnh điểm thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function saveLoyaltyConfig() {
    if (!loyaltyCfg) return;
    setBusy('cfg');
    setError(null);
    try {
      await api('/marketing/loyalty/config', { method: 'PUT', body: loyaltyCfg });
      setOpenCfgModal(false);
      await loadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Lưu cấu hình tích điểm thất bại');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4" data-testid="garage-marketing-page">
      {overview && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="marketing-kpis">
          <Card className="p-4 sm:p-5">
            <div className="flex items-center justify-between text-sm font-medium text-slate-700">
              <span>Tổng tệp khách hàng</span>
              <Users className="h-4 w-4 text-sky-600" />
            </div>
            <div className="mt-2.5 text-2xl font-bold tabular-nums">{overview.kpis.totalCustomers}</div>
            <div className="mt-1 text-xs text-slate-500">{overview.kpis.segmentsCount} phân khúc đang lưu</div>
          </Card>

          <Card className="p-4 sm:p-5" data-testid="kpi-consented-customers">
            <div className="flex items-center justify-between text-sm font-medium text-slate-700">
              <span>Đã đồng ý nhận tin</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="mt-2.5 text-2xl font-bold tabular-nums text-emerald-700">{overview.kpis.consentedCustomers}</div>
            <div className="mt-1 text-xs text-slate-500">Tuân thủ Nghị định 13/2023 về dữ liệu cá nhân</div>
          </Card>

          <Card className="p-4 sm:p-5" data-testid="kpi-loyalty-points">
            <div className="flex items-center justify-between text-sm font-medium text-slate-700">
              <span>Điểm thưởng lưu hành</span>
              <Award className="h-4 w-4 text-amber-600" />
            </div>
            <div className="mt-2.5 text-2xl font-bold tabular-nums text-amber-700">
              {overview.kpis.pointsCirculating.toLocaleString('vi-VN')} điểm
            </div>
            <div className="mt-1 text-xs text-slate-500">Tự động cộng khi lệnh sửa chữa chuyển Đã giao</div>
          </Card>

          <Card className="p-4 sm:p-5">
            <div className="flex items-center justify-between text-sm font-medium text-slate-700">
              <span>Chiến dịch đã phát hành</span>
              <Megaphone className="h-4 w-4 text-brand-600" />
            </div>
            <div className="mt-2.5 text-2xl font-bold tabular-nums">{overview.kpis.campaignsSent}</div>
            <div className="mt-1 text-xs text-slate-500">Chỉ gửi tới tập khách đã đồng ý nhận tin</div>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          tabs={[
            { value: 'segments', label: `Phân khúc khách hàng${segments ? ` (${segments.length})` : ''}` },
            { value: 'campaigns', label: `Chiến dịch chăm sóc${campaigns ? ` (${campaigns.length})` : ''}` },
            { value: 'loyalty', label: 'Tích điểm & Hạng thành viên' },
          ]}
          value={tab}
          onChange={setTab}
        />

        <div className="flex flex-wrap gap-2">
          {tab === 'segments' && (
            <Button
              onClick={() => {
                setPreviewData(null);
                setOpenSegment(true);
              }}
              data-testid="segment-new-btn"
            >
              <Filter className="h-4 w-4" /> Tạo phân khúc
            </Button>
          )}
          {tab === 'campaigns' && (
            <Button onClick={() => setOpenCampaign(true)} data-testid="campaign-new-btn">
              <Plus className="h-4 w-4" /> Tạo chiến dịch
            </Button>
          )}
          {tab === 'loyalty' && (
            <Button variant="outline" onClick={() => setOpenCfgModal(true)} data-testid="loyalty-config-btn">
              <Settings className="h-4 w-4" /> Quy tắc tích điểm
            </Button>
          )}
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      {/* TAB 1: PHÂN KHÚC KHÁCH HÀNG */}
      {tab === 'segments' && (
        <div className="space-y-3">
          {!segments ? (
            <Spinner className="h-6 w-6 text-brand-600" />
          ) : !segments.length ? (
            <Card className="p-8 text-center text-sm text-slate-500">Chưa có phân khúc khách hàng nào.</Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2" data-testid="segment-list">
              {segments.map((s) => (
                <Card key={s.id} className="space-y-2.5 p-5" data-testid="segment-card">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-slate-500">{s.code}</span>
                    <div className="flex items-center gap-1.5">
                      <Badge tone="sky">{s.totalMatched} khách khớp</Badge>
                      <Badge tone="mint">{s.consentedCount} đồng ý nhận tin</Badge>
                    </div>
                  </div>
                  <div className="font-semibold text-slate-900">{s.name}</div>
                  {s.description && <p className="text-xs text-slate-600">{s.description}</p>}
                  <div className="flex flex-wrap gap-1.5 text-xs text-slate-500">
                    {s.rules.tiers?.length ? <Badge tone="slate">Hạng: {s.rules.tiers.join(', ')}</Badge> : null}
                    {s.rules.minSpent ? <Badge tone="slate">Chi tiêu ≥ {fmtMoney(s.rules.minSpent)}</Badge> : null}
                    {s.rules.inactiveDays ? <Badge tone="slate">Vắng ≥ {s.rules.inactiveDays} ngày</Badge> : null}
                    {s.rules.expiringWithinDays ? <Badge tone="slate">Hết ĐK/BH ≤ {s.rules.expiringWithinDays} ngày</Badge> : null}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: CHIẾN DỊCH MARKETING */}
      {tab === 'campaigns' && (
        <div className="space-y-3">
          {!campaigns ? (
            <Spinner className="h-6 w-6 text-brand-600" />
          ) : !campaigns.length ? (
            <Card className="p-8 text-center text-sm text-slate-500">Chưa có chiến dịch nào. Bấm &quot;Tạo chiến dịch&quot; để khởi tạo.</Card>
          ) : (
            <ul className="space-y-3" data-testid="campaign-list">
              {campaigns.map((c) => {
                const st = CAMPAIGN_STATUS_UI[c.status];
                const ch = CAMPAIGN_CHANNEL_UI[c.channel];
                return (
                  <li key={c.id}>
                    <Card className="flex flex-wrap items-start justify-between gap-4 p-5" data-testid="campaign-card">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-slate-500">{c.code}</span>
                          <Badge tone={st.tone}>{st.label}</Badge>
                          <Badge tone={ch.tone}>{ch.label}</Badge>
                          <Badge tone="slate">Phân khúc: {c.segmentName}</Badge>
                        </div>
                        <h3 className="text-base font-semibold text-slate-900">{c.name}</h3>
                        <p className="text-xs font-medium text-slate-700">{c.title}</p>
                        <p className="line-clamp-2 text-xs text-slate-500">{c.bodyTemplate}</p>
                        {c.status === 'HOAN_THANH' && (
                          <div className="text-xs text-slate-600" data-testid="campaign-stats-line">
                            Tập khớp: <b>{c.totalMatched}</b> · Đã gửi thành công: <b className="text-emerald-700">{c.sentCount}</b> · Bỏ qua chưa đồng ý nhận tin:{' '}
                            <b className="text-amber-700">{c.skippedNoConsent}</b>
                            {c.sentAt ? ` · Phát hành lúc ${fmtDateTime(c.sentAt)}` : ''}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {c.status === 'NHAP' && (
                          <Button onClick={() => sendCampaign(c.id)} disabled={busy === c.id} data-testid="campaign-send-btn">
                            <Send className="h-4 w-4" /> Phát hành ngay
                          </Button>
                        )}
                        {c.status === 'HOAN_THANH' && (
                          <Button variant="outline" onClick={() => viewCampaignDetail(c.id)} disabled={busy === c.id} data-testid="campaign-detail-btn">
                            <Eye className="h-4 w-4" /> Nhật ký gửi ({c.totalMatched})
                          </Button>
                        )}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* TAB 3: TÍCH ĐIỂM & HẠNG THÀNH VIÊN */}
      {tab === 'loyalty' && (
        <div className="space-y-4">
          {loyaltyCfg && (
            <Card className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-amber-50/70 to-orange-50/60 p-4 text-sm">
              <div>
                <b>Quy tắc hiện hành:</b> {loyaltyCfg.enabled ? 'Đang bật' : 'Tạm tắt'} · Mỗi{' '}
                <b>{fmtMoney(loyaltyCfg.vndPerPoint)}</b> đơn đã giao tích <b>+1 điểm</b> (1 điểm ≈ {fmtMoney(loyaltyCfg.pointValueVnd)}) · Ngưỡng lên hạng: Bạc{' '}
                <b>{loyaltyCfg.silverPoints}</b>đ, Vàng <b>{loyaltyCfg.goldPoints}</b>đ, Kim cương <b>{loyaltyCfg.diamondPoints}</b>đ.
              </div>
            </Card>
          )}

          <Card className="overflow-x-auto p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
              <CardTitle>Sổ điểm thưởng & Hạng hội viên khách hàng</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-64">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    value={custQ}
                    onChange={(e) => setCustQ(e.target.value)}
                    placeholder="Tìm tên, SĐT, mã KH…"
                    aria-label="Tìm khách tích điểm"
                    className="rounded-full pl-9"
                  />
                </div>
                <ExportButton
                  filename="so-diem-thuong-khach-hang"
                  sheetName="Điểm thưởng"
                  testId="export-loyalty"
                  rows={loyaltyCustomers ?? []}
                  columns={[
                    { header: 'Mã KH', value: (c) => c.code },
                    { header: 'Khách hàng', value: (c) => c.name },
                    { header: 'Số điện thoại', value: (c) => c.phone ?? '' },
                    { header: 'Hạng thẻ', value: (c) => TIER_UI[c.tier].label },
                    { header: 'Nhận tin KM', value: (c) => (c.marketingConsent ? 'Đã đồng ý' : 'Chưa đồng ý') },
                    { header: 'Tổng điểm tích luỹ', value: (c) => c.lifetimeEarned },
                    { header: 'Số dư khả dụng', value: (c) => c.balance },
                  ]}
                />
              </div>
            </div>

            <table className="w-full text-left text-sm" data-testid="loyalty-customers-table">
              <thead className="border-b border-slate-100 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3">Khách hàng</th>
                  <th className="px-3 py-3">Hạng thẻ</th>
                  <th className="px-3 py-3">Nhận tin KM</th>
                  <th className="px-3 py-3 text-right">Tổng điểm tích luỹ</th>
                  <th className="px-3 py-3 text-right">Số dư khả dụng</th>
                  <th className="px-5 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(loyaltyCustomers ?? []).map((c) => {
                  const tUi = TIER_UI[c.tier];
                  return (
                    <tr key={c.id} data-testid="loyalty-customer-row">
                      <td className="px-5 py-3">
                        <div className="font-semibold text-slate-900">{c.name}</div>
                        <div className="text-xs text-slate-500">
                          {c.code} · {c.phone ?? 'Chưa lưu SĐT'}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={tUi.tone}>{tUi.label}</Badge>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={c.marketingConsent ? 'mint' : 'slate'}>
                          {c.marketingConsent ? 'Đã đồng ý' : 'Chưa đồng ý'}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-600">{c.lifetimeEarned.toLocaleString('vi-VN')}</td>
                      <td className="px-3 py-3 text-right font-bold text-amber-700 tabular-nums">{c.balance.toLocaleString('vi-VN')} điểm</td>
                      <td className="px-5 py-3 text-right">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setAdjustTarget(c);
                            setAdjType('REDEEM');
                            setAdjPoints('10');
                            setAdjNote('');
                          }}
                          data-testid="loyalty-open-adjust-btn"
                        >
                          <Gift className="h-4 w-4" /> Đổi / Điều chỉnh
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* Hộp thoại tạo Phân khúc */}
      <Dialog
        open={openSegment}
        onClose={() => setOpenSegment(false)}
        title="Tạo phân khúc khách hàng động"
        wide
        footer={
          <>
            <Button variant="outline" onClick={runPreview} disabled={busy === 'preview'} data-testid="segment-preview-btn">
              <Eye className="h-4 w-4" /> Xem trước tập khách
            </Button>
            <Button onClick={saveSegment} disabled={busy === 'segment'} data-testid="segment-save-btn">
              Lưu phân khúc
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Tên phân khúc *">
            {(id) => <Input id={id} value={segName} onChange={(e) => setSegName(e.target.value)} placeholder="VD: Khách hạng Vàng chi tiêu trên 5 triệu" />}
          </Field>
          <Field label="Mô tả mục đích">
            {(id) => <Input id={id} value={segDesc} onChange={(e) => setSegDesc(e.target.value)} placeholder="Dùng cho chiến dịch tri ân quý 4…" />}
          </Field>

          <div>
            <div className="mb-1 text-xs font-medium text-slate-700">Lọc theo Hạng thẻ (không chọn = mọi hạng)</div>
            <div className="flex flex-wrap gap-2">
              {(['THUONG', 'BAC', 'VANG', 'KIM_CUONG'] as const).map((tr) => {
                const checked = segTiers.includes(tr);
                return (
                  <label key={tr} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1 text-xs">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setSegTiers(checked ? segTiers.filter((x) => x !== tr) : [...segTiers, tr])}
                    />
                    {TIER_UI[tr].label}
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs font-medium text-slate-700">Lọc theo Nguồn khách (tuỳ chọn)</div>
            <div className="flex flex-wrap gap-2">
              {CUSTOMER_SOURCES.map((src) => {
                const checked = segSources.includes(src.code);
                return (
                  <label key={src.code} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1 text-xs">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setSegSources(checked ? segSources.filter((x) => x !== src.code) : [...segSources, src.code])}
                    />
                    {src.label}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Chi tiêu tối thiểu (đồng)">
              {(id) => <Input id={id} type="number" value={segMinSpent} onChange={(e) => setSegMinSpent(e.target.value)} placeholder="VD: 2000000" />}
            </Field>
            <Field label="Chưa quay lại từ (ngày)">
              {(id) => <Input id={id} type="number" value={segInactiveDays} onChange={(e) => setSegInactiveDays(e.target.value)} placeholder="VD: 90" />}
            </Field>
            <Field label="Sắp hết ĐK/BH trong (ngày)">
              {(id) => <Input id={id} type="number" value={segExpiringDays} onChange={(e) => setSegExpiringDays(e.target.value)} placeholder="VD: 30" />}
            </Field>
          </div>

          {previewData && (
            <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 text-xs" data-testid="segment-preview-box">
              <div className="font-semibold text-slate-900">
                Kết quả xem trước: {previewData.totalMatched} khách khớp điều kiện ·{' '}
                <span className="text-emerald-700">{previewData.consentedCount} đủ điều kiện nhận tin</span> ·{' '}
                <span className="text-amber-700">{previewData.unconsentedCount} chưa đồng ý nhận tin</span>
              </div>
              {previewData.sampleCustomers.length > 0 && (
                <ul className="mt-2 space-y-1 text-slate-700">
                  {previewData.sampleCustomers.slice(0, 5).map((c) => (
                    <li key={c.id}>
                      • {c.name} ({c.code} · {c.tierLabel}) — {c.marketingConsent ? 'Đã đồng ý nhận tin' : 'Chưa đồng ý'}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </Dialog>

      {/* Hộp thoại tạo Chiến dịch */}
      <Dialog
        open={openCampaign}
        onClose={() => setOpenCampaign(false)}
        title="Tạo chiến dịch chăm sóc & khuyến mại"
        wide
        footer={
          <>
            <Button variant="outline" onClick={() => setOpenCampaign(false)}>
              Huỷ
            </Button>
            <Button onClick={createCampaign} disabled={busy === 'campaign'} data-testid="campaign-save-btn">
              Lưu chiến dịch nháp
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Tên chiến dịch *">
            {(id) => <Input id={id} value={campName} onChange={(e) => setCampName(e.target.value)} placeholder="VD: Tri ân khách hàng kiểm tra phanh mùa mưa" />}
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Kênh gửi *">
              {(id) => (
                <Select id={id} value={campChannel} onChange={(e) => setCampChannel(e.target.value as CampaignChannelCode)}>
                  <option value="APP_PUSH">Thông báo App chủ xe</option>
                  <option value="ZALO_ZNS">Zalo ZNS</option>
                  <option value="SMS">Tin nhắn SMS</option>
                </Select>
              )}
            </Field>
            <Field label="Phân khúc khách hàng">
              {(id) => (
                <Select id={id} value={campSegId} onChange={(e) => setCampSegId(e.target.value)}>
                  <option value="">Toàn bộ khách hàng</option>
                  {(segments ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} · {s.name} ({s.consentedCount} đồng ý)
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Đính kèm Voucher (tuỳ chọn)">
              {(id) => (
                <Select id={id} value={campVoucherId} onChange={(e) => setCampVoucherId(e.target.value)}>
                  <option value="">Không đính kèm</option>
                  {(overview?.vouchers ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.code} · {v.title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Tiêu đề thông báo *">
            {(id) => <Input id={id} value={campTitle} onChange={(e) => setCampTitle(e.target.value)} />}
          </Field>
          <Field label="Nội dung mẫu * (biến hỗ trợ: {{ten_khach}}, {{hang_the}}, {{diem_thuong}}, {{ma_voucher}}, {{ten_garage}})">
            {(id) => (
              <textarea
                id={id}
                rows={4}
                value={campBody}
                onChange={(e) => setCampBody(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
            )}
          </Field>
          <p className="text-xs text-slate-500">
            Hệ thống tự động kiểm tra cờ đồng ý nhận tin của từng khách lúc bấm Phát hành: chỉ khách đã đồng ý mới nhận thông báo.
          </p>
        </div>
      </Dialog>

      {/* Hộp thoại Nhật ký gửi Chiến dịch */}
      <Dialog
        open={!!campaignDetail}
        onClose={() => setCampaignDetail(null)}
        title={campaignDetail ? `Kết quả phát hành ${campaignDetail.code}` : 'Kết quả'}
        wide
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            {campaignDetail && (
              <ExportButton
                filename={`nhat-ky-chien-dich-${campaignDetail.code}`}
                sheetName={campaignDetail.code}
                testId="export-campaign-deliveries"
                rows={campaignDetail.deliveries}
                columns={[
                  { header: 'Khách hàng', value: (d) => d.recipientName },
                  { header: 'Số điện thoại', value: (d) => d.phone ?? '' },
                  { header: 'Trạng thái', value: (d) => DELIVERY_STATUS_UI[d.status].label },
                  { header: 'Nội dung / Lý do', value: (d) => d.renderedBody ?? d.reason ?? '' },
                ]}
              />
            )}
            <Button variant="outline" onClick={() => setCampaignDetail(null)}>
              Đóng
            </Button>
          </div>
        }
      >
        {campaignDetail && (
          <div className="space-y-3" data-testid="campaign-delivery-modal">
            <div className="rounded-xl bg-slate-50 p-3 text-xs">
              Tổng tập khách khớp: <b>{campaignDetail.totalMatched}</b> · Đã gửi: <b className="text-emerald-700">{campaignDetail.sentCount}</b> · Bỏ qua do chưa đồng ý nhận tin:{' '}
              <b className="text-amber-700">{campaignDetail.skippedNoConsent}</b>
            </div>
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-100 uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Khách hàng</th>
                    <th className="py-2">Trạng thái</th>
                    <th className="py-2">Nội dung / Lý do</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {campaignDetail.deliveries.map((d) => {
                    const st = DELIVERY_STATUS_UI[d.status];
                    return (
                      <tr key={d.id}>
                        <td className="py-2 font-medium">
                          {d.recipientName}
                          {d.phone ? ` (${d.phone})` : ''}
                        </td>
                        <td className="py-2">
                          <Badge tone={st.tone}>{st.label}</Badge>
                        </td>
                        <td className="py-2 text-slate-600">{d.renderedBody ?? d.reason ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Dialog>

      {/* Hộp thoại Đổi / Điều chỉnh điểm */}
      <Dialog
        open={!!adjustTarget}
        onClose={() => setAdjustTarget(null)}
        title={adjustTarget ? `Điểm thưởng · ${adjustTarget.name} (dư ${adjustTarget.balance} điểm)` : 'Điểm thưởng'}
        footer={
          <>
            <Button variant="outline" onClick={() => setAdjustTarget(null)}>
              Huỷ
            </Button>
            <Button onClick={submitAdjustLoyalty} disabled={busy === 'adjust'} data-testid="loyalty-adjust-submit">
              Xác nhận ghi sổ điểm
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Nghiệp vụ *">
            {(id) => (
              <Select id={id} value={adjType} onChange={(e) => setAdjType(e.target.value as 'REDEEM' | 'ADJUST')}>
                <option value="REDEEM">Đổi điểm nhận ưu đãi tại quầy (trừ điểm)</option>
                <option value="ADJUST">Điều chỉnh cộng / trừ điểm thủ công</option>
              </Select>
            )}
          </Field>
          <Field label={adjType === 'REDEEM' ? 'Số điểm quy đổi *' : 'Số điểm điều chỉnh (+/-) *'}>
            {(id) => <Input id={id} type="number" value={adjPoints} onChange={(e) => setAdjPoints(e.target.value)} />}
          </Field>
          <Field label="Ghi chú giao dịch *">
            {(id) => <Input id={id} value={adjNote} onChange={(e) => setAdjNote(e.target.value)} placeholder="VD: Đổi 20 điểm tặng gói rửa xe bọt tuyết" />}
          </Field>
        </div>
      </Dialog>

      {/* Hộp thoại Cấu hình tích điểm */}
      <Dialog
        open={openCfgModal && !!loyaltyCfg}
        onClose={() => setOpenCfgModal(false)}
        title="Quy tắc tích điểm & Ngưỡng nâng hạng"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpenCfgModal(false)}>
              Huỷ
            </Button>
            <Button onClick={saveLoyaltyConfig} disabled={busy === 'cfg'}>
              Lưu cấu hình
            </Button>
          </>
        }
      >
        {loyaltyCfg && (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={loyaltyCfg.enabled}
                onChange={(e) => setLoyaltyCfg({ ...loyaltyCfg, enabled: e.target.checked })}
              />
              Bật tự động tích điểm khi giao xe
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Giá trị đơn để tích 1 điểm (đồng)">
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    value={loyaltyCfg.vndPerPoint}
                    onChange={(e) => setLoyaltyCfg({ ...loyaltyCfg, vndPerPoint: Number(e.target.value) })}
                  />
                )}
              </Field>
              <Field label="Giá trị quy đổi 1 điểm (đồng)">
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    value={loyaltyCfg.pointValueVnd}
                    onChange={(e) => setLoyaltyCfg({ ...loyaltyCfg, pointValueVnd: Number(e.target.value) })}
                  />
                )}
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Mốc Hạng Bạc">
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    value={loyaltyCfg.silverPoints}
                    onChange={(e) => setLoyaltyCfg({ ...loyaltyCfg, silverPoints: Number(e.target.value) })}
                  />
                )}
              </Field>
              <Field label="Mốc Hạng Vàng">
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    value={loyaltyCfg.goldPoints}
                    onChange={(e) => setLoyaltyCfg({ ...loyaltyCfg, goldPoints: Number(e.target.value) })}
                  />
                )}
              </Field>
              <Field label="Mốc Kim cương">
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    value={loyaltyCfg.diamondPoints}
                    onChange={(e) => setLoyaltyCfg({ ...loyaltyCfg, diamondPoints: Number(e.target.value) })}
                  />
                )}
              </Field>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
