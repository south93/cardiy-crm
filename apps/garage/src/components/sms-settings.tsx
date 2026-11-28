'use client';

import { Alert, Badge, Button, Card, CardTitle, Checkbox, Field, Input, Select, Spinner } from '@cardiy/ui';
import { Send } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ExportButton } from '@/components/export-button';
import { api, ApiError } from '@/lib/api';
import type { SmsMessageRow, SmsProviderCode, SmsSettingsResponse } from '@/lib/fleet';
import { fmtDateTime } from '@/lib/orders';

const area =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100';

const errText = (e: unknown, fallback: string) =>
  e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : fallback;

/** Cài đặt → SMS Brandname: cấu hình cổng nhà mạng (eSMS / SpeedSMS / VietGuys / Webhook), mẫu tin nhắc lịch & nhật ký gửi */
export function SmsSettingsTab() {
  const [cfg, setCfg] = useState<SmsSettingsResponse | null>(null);
  const [secretInput, setSecretInput] = useState('');
  const [testPhone, setTestPhone] = useState('');
  const [logs, setLogs] = useState<SmsMessageRow[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [settings, messages] = await Promise.all([
      api<SmsSettingsResponse>('/sms/settings'),
      api<SmsMessageRow[]>('/sms/messages'),
    ]);
    setCfg(settings);
    setSecretInput('');
    setLogs(messages);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!cfg) return <Spinner className="h-6 w-6 text-brand-600" />;

  const selectedProvider = cfg.providers.find((p) => p.code === cfg.provider);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const saved = await api<SmsSettingsResponse>('/sms/settings', {
        method: 'PUT',
        body: {
          enabled: cfg.enabled,
          provider: cfg.provider,
          mode: cfg.mode,
          endpointUrl: cfg.endpointUrl || null,
          brandname: cfg.brandname || null,
          apiKey: cfg.apiKey || null,
          apiSecret: secretInput.trim() || null,
          templateText: cfg.templateText,
        },
      });
      setCfg(saved);
      setSecretInput('');
      setMsg({ ok: true, text: 'Đã lưu cấu hình cổng SMS Brandname.' });
    } catch (e) {
      setMsg({ ok: false, text: errText(e, 'Không lưu được cấu hình SMS') });
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ status: string; content?: string; error?: string }>('/sms/test', {
        body: { phone: testPhone },
      });
      if (res.status === 'SENT' || res.status === 'SIMULATED') {
        setMsg({
          ok: true,
          text:
            res.status === 'SIMULATED'
              ? `Đã chạy giả lập SMS thành công: "${res.content ?? ''}"`
              : `Đã gửi SMS thật tới ${testPhone}`,
        });
      } else {
        setMsg({ ok: false, text: res.error ?? 'Không gửi được tin thử' });
      }
      setLogs(await api<SmsMessageRow[]>('/sms/messages'));
    } catch (e) {
      setMsg({ ok: false, text: errText(e, 'Không gửi được tin SMS thử') });
    } finally {
      setBusy(false);
    }
  };

  const appendVar = (code: string) => {
    const token = `{${code}}`;
    setCfg({
      ...cfg,
      templateText: cfg.templateText.endsWith(' ') || !cfg.templateText ? `${cfg.templateText}${token}` : `${cfg.templateText} ${token}`,
    });
  };

  return (
    <div className="space-y-4" data-testid="sms-settings">
      {msg && <Alert tone={msg.ok ? 'mint' : 'rose'}>{msg.text}</Alert>}

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Cổng tin nhắn SMS Brandname</CardTitle>
            <p className="mt-0.5 text-sm text-slate-600">
              Dùng gửi tin nhắc hạn đăng kiểm, bảo hiểm, phù hiệu xe, bảo dưỡng định kỳ (hoặc tự động dự phòng khi khách không nhận được Zalo ZNS).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Checkbox
              checked={cfg.enabled}
              onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
              label={<span className="font-medium">Bật kênh gửi SMS</span>}
            />
            <Select
              value={cfg.mode}
              onChange={(e) => setCfg({ ...cfg, mode: e.target.value as 'development' | 'production' })}
              className="w-auto"
              aria-label="Chế độ vận hành SMS"
            >
              <option value="development">Thử nghiệm (giả lập, không tốn cước)</option>
              <option value="production">Chính thức (gửi qua nhà mạng)</option>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nhà cung cấp cổng SMS">
            {(id) => (
              <Select
                id={id}
                value={cfg.provider}
                onChange={(e) => setCfg({ ...cfg, provider: e.target.value as SmsProviderCode })}
              >
                {cfg.providers.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Tên định danh (Brandname)" hint="VD: PHILONGAUTO, CARDIY">
            {(id) => (
              <Input
                id={id}
                value={cfg.brandname}
                onChange={(e) => setCfg({ ...cfg, brandname: e.target.value })}
                placeholder="Tên Brandname đã đăng ký"
              />
            )}
          </Field>
          <Field label={cfg.provider === 'VIETGUYS' ? 'Tài khoản (Username / API Key)' : 'API Key'}>
            {(id) => (
              <Input
                id={id}
                value={cfg.apiKey}
                onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value.trim() })}
                placeholder="Nhập API Key từ nhà cung cấp"
              />
            )}
          </Field>
          <Field
            label="Secret Key / Mật khẩu API"
            hint={cfg.secretConfigured ? 'Khoá bí mật đã mã hoá trên hệ thống' : 'Mã hoá AES-256 khi lưu, không hiển thị lại'}
          >
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="off"
                value={secretInput}
                onChange={(e) => setSecretInput(e.target.value)}
                placeholder={cfg.secretConfigured ? 'Đã lưu — để trống nếu không đổi' : 'Nhập Secret Key / Bearer Token'}
              />
            )}
          </Field>
          <Field
            label="Endpoint URL tuỳ chỉnh"
            hint={
              selectedProvider?.defaultUrl
                ? `Mặc định: ${selectedProvider.defaultUrl}`
                : 'Nhập URL nhận POST JSON của tổng đài nội bộ / Webhook'
            }
            className="sm:col-span-2"
          >
            {(id) => (
              <Input
                id={id}
                value={cfg.endpointUrl}
                onChange={(e) => setCfg({ ...cfg, endpointUrl: e.target.value.trim() })}
                placeholder={selectedProvider?.defaultUrl || 'https://sms-gateway.ten-mien.vn/webhook'}
              />
            )}
          </Field>
        </div>

        <div className="space-y-2">
          <Field
            label="Mẫu nội dung SMS nhắc lịch chuẩn"
            hint="Khuyến nghị viết tiếng Việt không dấu (≤ 160 ký tự/bản tin tiêu chuẩn) để tối ưu cước nhà mạng"
          >
            {(id) => (
              <textarea
                id={id}
                rows={3}
                className={area}
                value={cfg.templateText}
                onChange={(e) => setCfg({ ...cfg, templateText: e.target.value })}
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-500">Chèn biến tự động:</span>
            {cfg.variables.map((v) => (
              <button
                key={v.code}
                type="button"
                onClick={() => appendVar(v.code)}
                className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-[11px] text-slate-700 hover:border-brand-300 hover:bg-brand-50"
                title={v.label}
              >
                {`{${v.code}}`} · <span className="font-sans text-slate-500">{v.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={() => void save()} disabled={busy} data-testid="sms-save">
            {busy && <Spinner />}
            Lưu cấu hình SMS
          </Button>
          <span className="text-xs text-slate-500">
            Bạn có thể lưu cấu hình sẵn ở chế độ <b>Thử nghiệm</b> và điền API Key nhà mạng bất kỳ lúc nào.
          </span>
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <CardTitle>Gửi tin SMS thử nghiệm</CardTitle>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Số điện thoại nhận tin thử" className="w-64">
            {(id) => (
              <Input
                id={id}
                inputMode="tel"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="VD: 0909123456"
              />
            )}
          </Field>
          <Button
            variant="outline"
            disabled={busy || testPhone.trim().length < 9}
            onClick={() => void sendTest()}
            data-testid="sms-test-send"
          >
            <Send className="h-4 w-4" />
            Gửi SMS thử
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Nhật ký tin nhắn SMS gần đây</CardTitle>
          <ExportButton
            filename="nhat-ky-tin-nhan-sms"
            sheetName="Nhật ký SMS"
            testId="export-sms-messages"
            rows={logs}
            columns={[
              { header: 'Thời gian', value: (m) => fmtDateTime(m.createdAt) },
              { header: 'Sự kiện', value: (m) => m.event },
              { header: 'SĐT nhận', value: (m) => m.phone },
              { header: 'Cổng', value: (m) => m.provider },
              { header: 'Trạng thái', value: (m) => m.status },
              { header: 'Nội dung', value: (m) => m.content },
              { header: 'Lỗi', value: (m) => m.error ?? '' },
            ]}
          />
        </div>
        {!logs.length ? (
          <p className="text-sm text-slate-500">Chưa có bản tin SMS nào được gửi.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="sms-log">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                  <th className="py-2 pr-3">Thời gian</th>
                  <th className="py-2 pr-3">SĐT</th>
                  <th className="py-2 pr-3">Cổng</th>
                  <th className="py-2 pr-3">Trạng thái</th>
                  <th className="py-2">Nội dung / Chi tiết</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((m) => (
                  <tr key={m.id} className="border-b border-slate-50 align-top">
                    <td className="whitespace-nowrap py-2 pr-3 text-slate-500">{fmtDateTime(m.createdAt)}</td>
                    <td className="py-2 pr-3 font-mono">{m.phone}</td>
                    <td className="py-2 pr-3">{m.provider}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={m.status === 'SENT' ? 'mint' : m.status === 'SIMULATED' ? 'sky' : 'rose'}>
                        {m.status === 'SENT' ? 'Đã gửi' : m.status === 'SIMULATED' ? 'Giả lập' : m.status}
                      </Badge>
                    </td>
                    <td className="max-w-lg py-2 text-xs text-slate-600">
                      <div>{m.content}</div>
                      {m.error && <div className="mt-0.5 text-rose-600">{m.error}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
