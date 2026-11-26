'use client';

import { Alert, Badge, Button, Card, Dialog, Field, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import { FileCode2, Plus, Send } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  CAMPAIGN_CHANNEL_UI,
  type CampaignChannelCode,
  type MarketingCampaignItem,
  type NotificationTemplateItem,
} from '@/lib/marketing';
import { fmtDateTime } from '@/lib/orders';

/** A6.63 Quản trị sàn: Mẫu thông báo chuẩn & Chiến dịch thông báo toàn sàn */
export default function PlatformNotificationsPage() {
  return (
    <RequirePermission permission="platform.report.view">
      <PlatformNotificationsBody />
    </RequirePermission>
  );
}

function PlatformNotificationsBody() {
  const { can } = useAuth();
  const canWrite = can('platform.content.manage');

  const [tab, setTab] = useState<'templates' | 'campaigns'>('templates');
  const [templates, setTemplates] = useState<NotificationTemplateItem[] | null>(null);
  const [campaigns, setCampaigns] = useState<MarketingCampaignItem[] | null>(null);

  const [openTpl, setOpenTpl] = useState(false);
  const [tplCode, setTplCode] = useState('');
  const [tplName, setTplName] = useState('');
  const [tplChannel, setTplChannel] = useState<'PUSH' | 'ZNS' | 'SMS' | 'EMAIL'>('PUSH');
  const [tplTitle, setTplTitle] = useState('');
  const [tplBody, setTplBody] = useState('');

  const [openCamp, setOpenCamp] = useState(false);
  const [campName, setCampName] = useState('');
  const [campChannel, setCampChannel] = useState<CampaignChannelCode>('APP_PUSH');
  const [campTitle, setCampTitle] = useState('');
  const [campBody, setCampBody] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([
        api<NotificationTemplateItem[]>('/platform/notifications/templates'),
        api<MarketingCampaignItem[]>('/platform/notifications/campaigns'),
      ]);
      setTemplates(t);
      setCampaigns(c);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được dữ liệu thông báo sàn');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveTemplate() {
    setBusy(true);
    setError(null);
    try {
      await api('/platform/notifications/templates', {
        body: {
          code: tplCode.toUpperCase(),
          name: tplName,
          channel: tplChannel,
          title: tplTitle,
          body: tplBody,
          active: true,
        },
      });
      setOpenTpl(false);
      setTplCode('');
      setTplName('');
      setTplTitle('');
      setTplBody('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Lưu mẫu thông báo thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function sendPlatformCampaign() {
    setBusy(true);
    setError(null);
    try {
      await api('/platform/notifications/campaigns/send', {
        body: {
          name: campName,
          channel: campChannel,
          title: campTitle,
          bodyTemplate: campBody,
        },
      });
      setOpenCamp(false);
      setCampName('');
      setCampTitle('');
      setCampBody('');
      setTab('campaigns');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Phát hành thông báo sàn thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="platform-notifications-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          tabs={[
            { value: 'templates', label: `Mẫu thông báo chuẩn${templates ? ` (${templates.length})` : ''}` },
            { value: 'campaigns', label: `Chiến dịch toàn sàn${campaigns ? ` (${campaigns.length})` : ''}` },
          ]}
          value={tab}
          onChange={setTab}
        />

        {canWrite && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpenTpl(true)} data-testid="platform-new-template-btn">
              <Plus className="h-4 w-4" /> Thêm mẫu tin
            </Button>
            <Button onClick={() => setOpenCamp(true)} data-testid="platform-send-campaign-btn">
              <Send className="h-4 w-4" /> Gửi chiến dịch toàn sàn
            </Button>
          </div>
        )}
      </div>

      {error && <Alert>{error}</Alert>}

      {tab === 'templates' ? (
        !templates ? (
          <Spinner className="h-6 w-6 text-brand-600" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2" data-testid="platform-templates-list">
            {templates.map((t) => (
              <Card key={t.id} className="space-y-2 p-5" data-testid="platform-template-card">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-brand-700">
                    <FileCode2 className="h-3.5 w-3.5" /> {t.code}
                  </span>
                  <div className="flex gap-1.5">
                    <Badge tone="sky">{t.channel}</Badge>
                    <Badge tone={t.active ? 'mint' : 'slate'}>{t.active ? 'Đang dùng' : 'Tạm ngưng'}</Badge>
                  </div>
                </div>
                <div className="font-semibold text-slate-900">{t.name}</div>
                <div className="text-xs font-medium text-slate-700">{t.title}</div>
                <p className="text-xs text-slate-500">{t.body}</p>
              </Card>
            ))}
          </div>
        )
      ) : !campaigns ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : !campaigns.length ? (
        <Card className="p-8 text-center text-sm text-slate-500">Chưa có chiến dịch thông báo toàn sàn nào.</Card>
      ) : (
        <ul className="space-y-3" data-testid="platform-campaigns-list">
          {campaigns.map((c) => (
            <li key={c.id}>
              <Card className="space-y-1.5 p-5" data-testid="platform-campaign-card">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-slate-500">{c.code}</span>
                  <Badge tone="mint">{c.statusLabel}</Badge>
                  <Badge tone={CAMPAIGN_CHANNEL_UI[c.channel].tone}>{c.channelLabel}</Badge>
                </div>
                <div className="font-semibold text-slate-900">{c.name}</div>
                <div className="text-xs text-slate-600">
                  Chủ xe trên sàn: <b>{c.totalMatched}</b> · Đã gửi (có đồng ý): <b className="text-emerald-700">{c.sentCount}</b> · Bỏ qua (chưa đồng ý):{' '}
                  <b className="text-amber-700">{c.skippedNoConsent}</b>
                  {c.sentAt ? ` · ${fmtDateTime(c.sentAt)}` : ''}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={openTpl}
        onClose={() => setOpenTpl(false)}
        title="Thêm mẫu thông báo chuẩn cấp sàn"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpenTpl(false)}>
              Huỷ
            </Button>
            <Button onClick={saveTemplate} disabled={busy} data-testid="platform-save-template-btn">
              Lưu mẫu tin
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Mã mẫu (IN_HOA) *">
              {(id) => <Input id={id} value={tplCode} onChange={(e) => setTplCode(e.target.value)} placeholder="TPL_KHUYEN_MAI_HE" />}
            </Field>
            <Field label="Kênh *">
              {(id) => (
                <Select id={id} value={tplChannel} onChange={(e) => setTplChannel(e.target.value as typeof tplChannel)}>
                  <option value="PUSH">PUSH (App chủ xe)</option>
                  <option value="ZNS">ZNS (Zalo)</option>
                  <option value="SMS">SMS</option>
                  <option value="EMAIL">EMAIL</option>
                </Select>
              )}
            </Field>
          </div>
          <Field label="Tên mẫu hiển thị *">
            {(id) => <Input id={id} value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="Thông báo chiến dịch an toàn mùa mưa" />}
          </Field>
          <Field label="Tiêu đề mẫu *">
            {(id) => <Input id={id} value={tplTitle} onChange={(e) => setTplTitle(e.target.value)} placeholder="Chào {{ten_khach}}, ưu đãi mới trên CARDIY" />}
          </Field>
          <Field label="Nội dung mẫu *">
            {(id) => (
              <textarea
                id={id}
                rows={4}
                value={tplBody}
                onChange={(e) => setTplBody(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
            )}
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={openCamp}
        onClose={() => setOpenCamp(false)}
        title="Phát hành chiến dịch thông báo toàn sàn"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpenCamp(false)}>
              Huỷ
            </Button>
            <Button onClick={sendPlatformCampaign} disabled={busy} data-testid="platform-confirm-send-btn">
              Phát hành ngay
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Tên chiến dịch *">
            {(id) => <Input id={id} value={campName} onChange={(e) => setCampName(e.target.value)} placeholder="VD: Thông báo chương trình kiểm tra lốp toàn quốc" />}
          </Field>
          <Field label="Kênh gửi *">
            {(id) => (
              <Select id={id} value={campChannel} onChange={(e) => setCampChannel(e.target.value as CampaignChannelCode)}>
                <option value="APP_PUSH">App chủ xe</option>
                <option value="ZALO_ZNS">Zalo ZNS</option>
              </Select>
            )}
          </Field>
          <Field label="Tiêu đề *">
            {(id) => <Input id={id} value={campTitle} onChange={(e) => setCampTitle(e.target.value)} placeholder="Chào {{ten_khach}}, tuần lễ chăm xe an toàn!" />}
          </Field>
          <Field label="Nội dung *">
            {(id) => (
              <textarea
                id={id}
                rows={4}
                value={campBody}
                onChange={(e) => setCampBody(e.target.value)}
                placeholder="Nội dung gửi tới các chủ xe đã bật đồng ý nhận tin…"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
            )}
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
