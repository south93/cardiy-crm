'use client';

import { Alert, Badge, Button, Card, CardTitle, Field, Input, Select, Spinner } from '@cardiy/ui';
import { Plus, Send, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/orders';

type EventCode = 'OTP' | 'BOOKING_CONFIRMED' | 'QUOTE_SENT' | 'ORDER_DONE' | 'CARE_REMINDER';
interface Template {
  enabled: boolean;
  templateId: string;
  params: { name: string; source: string }[];
}
interface Settings {
  enabled: boolean;
  mode: 'development' | 'production';
  templates: Partial<Record<EventCode, Template>>;
}
interface Status {
  appConfigured: boolean;
  connected: boolean;
  lastError: string | null;
  tokenUpdatedAt: string | null;
  settings: Settings;
  events: { code: EventCode; label: string; sources: { code: string; label: string }[] }[];
}
interface Message {
  id: string;
  event: string;
  phone: string;
  templateId: string;
  status: string;
  error: string | null;
  createdAt: string;
}
const err = (e: unknown, f: string) => (e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : f);

/** Cài đặt → Zalo: kết nối OA, mẫu tin ZNS cho từng sự kiện, gửi thử, nhật ký */
export function ZaloSettingsTab() {
  const [st, setSt] = useState<Status | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [testEvent, setTestEvent] = useState<EventCode>('OTP');
  const [log, setLog] = useState<Message[]>([]);
  const load = async () => {
    const x = await api<Status>('/zalo/settings');
    setSt(x);
    setS(x.settings);
    setLog(await api<Message[]>('/zalo/messages'));
  };
  useEffect(() => {
    void load();
  }, []);
  if (!st || !s) return <Spinner className="h-6 w-6 text-brand-600" />;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: err(e, 'Không thực hiện được') });
    }
  };
  const tpl = (e: EventCode): Template => s.templates[e] ?? { enabled: false, templateId: '', params: [] };
  const setTpl = (e: EventCode, t: Template) => setS({ ...s, templates: { ...s.templates, [e]: t } });

  return (
    <div className="space-y-4" data-testid="zalo-settings">
      {msg && <Alert tone={msg.ok ? 'mint' : 'rose'}>{msg.text}</Alert>}
      <Card className="space-y-3 p-5">
        <CardTitle>Kết nối Zalo OA</CardTitle>
        {!st.appConfigured && (
          <Alert tone="peach">
            Máy chủ chưa có <b>ZALO_APP_ID</b> và <b>ZALO_APP_SECRET</b> (lấy ở developers.zalo.me → ứng dụng của OA). Thêm vào file <code>deploy/.env</code> trên VPS rồi chạy lại{' '}
            <code>deploy/update.sh</code>.
          </Alert>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="zalo-connection">
          {st.connected ? <Badge tone="mint">Đã kết nối</Badge> : <Badge tone="slate">Chưa kết nối</Badge>}
          {st.tokenUpdatedAt && <span className="text-slate-500">Token cập nhật {fmtDateTime(st.tokenUpdatedAt)}</span>}
          {st.lastError && <span className="text-rose-600">Lỗi gần nhất: {st.lastError}</span>}
        </div>
        <p className="text-sm text-slate-600">
          Lấy <b>Refresh token</b> của OA (developers.zalo.me → API Explorer, loại OA Access Token) rồi dán vào đây. Hệ thống tự làm mới và lưu token đã mã hoá.
        </p>
        <div className="flex flex-wrap gap-2">
          <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Refresh token" className="min-w-0 flex-1" aria-label="Refresh token" />
          <Button
            disabled={token.trim().length < 10 || !st.appConfigured}
            onClick={() => void run(() => api('/zalo/connect', { body: { refreshToken: token } }).then(() => setToken('')), 'Đã kết nối Zalo OA')}
            data-testid="zalo-connect"
          >
            Kết nối
          </Button>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="mr-auto">Mẫu tin ZNS</CardTitle>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> Bật gửi tin Zalo
          </label>
          <Select value={s.mode} onChange={(e) => setS({ ...s, mode: e.target.value as Settings['mode'] })} className="w-auto" aria-label="Chế độ gửi">
            <option value="development">Thử nghiệm (chỉ gửi tới SĐT quản trị OA)</option>
            <option value="production">Chính thức (gửi khách, có phí)</option>
          </Select>
        </div>
        <p className="text-sm text-slate-600">
          Mỗi sự kiện dùng một <b>mẫu ZNS đã được Zalo duyệt</b>. Nhập mã mẫu (template ID) và ghép từng tham số của mẫu với dữ liệu trong CRM. Tên tham số phải giống hệt trong mẫu.
        </p>
        {st.events.map((ev) => {
          const t = tpl(ev.code);
          return (
            <div key={ev.code} className="rounded-2xl border border-slate-200 p-4" data-testid={`zalo-event-${ev.code}`}>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 font-medium">
                  <input type="checkbox" checked={t.enabled} onChange={(e) => setTpl(ev.code, { ...t, enabled: e.target.checked })} aria-label={`Bật ${ev.label}`} />
                  {ev.label}
                </label>
                <Input
                  value={t.templateId}
                  onChange={(e) => setTpl(ev.code, { ...t, templateId: e.target.value.trim() })}
                  placeholder="Mã mẫu (template ID)"
                  className="ml-auto w-56"
                  aria-label={`Mã mẫu ${ev.label}`}
                />
              </div>
              <div className="mt-3 space-y-2">
                {t.params.map((p, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Input
                      value={p.name}
                      onChange={(e) => setTpl(ev.code, { ...t, params: t.params.map((x, k) => (k === i ? { ...x, name: e.target.value.trim() } : x)) })}
                      placeholder="Tên tham số trong mẫu"
                      className="w-48"
                      aria-label="Tên tham số"
                    />
                    <span className="text-slate-400">←</span>
                    <Select
                      value={p.source}
                      onChange={(e) => setTpl(ev.code, { ...t, params: t.params.map((x, k) => (k === i ? { ...x, source: e.target.value } : x)) })}
                      className="w-auto min-w-[14rem]"
                      aria-label="Dữ liệu"
                    >
                      {ev.sources.map((src) => (
                        <option key={src.code} value={src.code}>
                          {src.label}
                        </option>
                      ))}
                    </Select>
                    <button
                      type="button"
                      aria-label="Bỏ tham số"
                      onClick={() => setTpl(ev.code, { ...t, params: t.params.filter((_, k) => k !== i) })}
                      className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setTpl(ev.code, { ...t, params: [...t.params, { name: '', source: ev.sources[0]!.code }] })}
                  className="flex items-center gap-1 text-sm text-brand-600"
                >
                  <Plus className="h-4 w-4" /> Thêm tham số
                </button>
              </div>
            </div>
          );
        })}
        <Button onClick={() => void run(() => api('/zalo/settings', { method: 'PUT', body: s }), 'Đã lưu cài đặt Zalo')} data-testid="zalo-save">
          Lưu cài đặt Zalo
        </Button>
      </Card>

      <Card className="space-y-3 p-5">
        <CardTitle>Gửi thử</CardTitle>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Mẫu tin">
            {(id) => (
              <Select id={id} value={testEvent} onChange={(e) => setTestEvent(e.target.value as EventCode)}>
                {st.events.map((e) => (
                  <option key={e.code} value={e.code}>
                    {e.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Gửi tới SĐT">{(id) => <Input id={id} value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="SĐT quản trị OA" />}</Field>
          <Button variant="outline" disabled={testPhone.length < 9} onClick={() => void run(() => api('/zalo/test', { body: { event: testEvent, phone: testPhone } }), 'Đã gửi tin thử (dữ liệu mẫu)')}>
            <Send className="h-4 w-4" /> Gửi thử
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <CardTitle className="mb-2">Tin đã gửi gần đây</CardTitle>
        <table className="w-full text-sm" data-testid="zalo-log">
          <tbody>
            {log.map((m) => (
              <tr key={m.id} className="border-b border-slate-50 last:border-0">
                <td className="py-2 pr-2 text-slate-500">{fmtDateTime(m.createdAt)}</td>
                <td className="px-2 py-2">{st.events.find((e) => e.code === m.event)?.label ?? m.event}</td>
                <td className="px-2 py-2 font-mono text-xs">{m.phone}</td>
                <td className="px-2 py-2">{m.status === 'SENT' ? <Badge tone="mint">Đã gửi</Badge> : <Badge tone="rose">Lỗi</Badge>}</td>
                <td className="py-2 pl-2 text-xs text-rose-600">{m.error}</td>
              </tr>
            ))}
            {!log.length && (
              <tr>
                <td className="py-6 text-center text-slate-500">Chưa gửi tin nào.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
