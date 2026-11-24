import { BadRequestException, Body, Controller, Get, Global, HttpCode, Injectable, Logger, Module, Post, Put, ServiceUnavailableException } from '@nestjs/common';
import { formatPlate } from '@cardiy/shared';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import type { RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { buildTemplateData, decrypt, DEFAULT_ZALO, encrypt, EVENTS, SOURCES, zaloPhone, type Source, type ZaloEvent, type ZaloSettings } from './zalo-rules';

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number | string;
}
export interface ZaloTransport {
  refresh(appId: string, secret: string, refreshToken: string): Promise<TokenResponse>;
  send(accessToken: string, body: { phone: string; template_id: string; template_data: Record<string, string>; tracking_id: string; mode?: string }): Promise<{ msgId: string | null }>;
}

/** Gọi API Zalo thật (OAuth v4 + ZNS) */
class HttpTransport implements ZaloTransport {
  constructor(private readonly config: AppConfig) {}
  async refresh(appId: string, secret: string, refreshToken: string) {
    const res = await fetch(this.config.get('ZALO_OAUTH_URL'), {
      method: 'POST',
      headers: { secret_key: secret, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ app_id: appId, refresh_token: refreshToken, grant_type: 'refresh_token' }),
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: number; error_name?: string; error_description?: string; message?: string };
    if (!res.ok || !j.access_token || !j.refresh_token) throw new Error(`Zalo từ chối làm mới token: ${j.error_description ?? j.error_name ?? j.message ?? res.status}`);
    return j as TokenResponse;
  }
  async send(accessToken: string, body: Parameters<ZaloTransport['send']>[1]) {
    const res = await fetch(this.config.get('ZALO_ZNS_URL'), {
      method: 'POST',
      headers: { access_token: accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: number; message?: string; data?: { msg_id?: string } };
    if (!res.ok || j.error) throw new Error(`Zalo lỗi ${j.error ?? res.status}: ${j.message ?? 'không gửi được'}`);
    return { msgId: j.data?.msg_id ?? null };
  }
}

/** Không gọi Zalo: giữ tin trong bộ nhớ (test, demo) */
export class FakeTransport implements ZaloTransport {
  readonly outbox: { phone: string; template_id: string; template_data: Record<string, string>; mode?: string }[] = [];
  private n = 0;
  async refresh(_a: string, _s: string, refreshToken: string) {
    if (refreshToken.startsWith('sai')) throw new Error('Zalo từ chối làm mới token: Invalid refresh token');
    this.n++;
    return { access_token: `fake-access-${this.n}`, refresh_token: `fake-refresh-${this.n}`, expires_in: 90_000 };
  }
  async send(_t: string, body: Parameters<ZaloTransport['send']>[1]) {
    this.outbox.push(body);
    return { msgId: `fake-${this.outbox.length}` };
  }
}

export type ZaloContext = Partial<Record<Source, string | number | null | undefined>>;
const garageName = (t: { name: string; printSettings: unknown }) => (t.printSettings as { displayName?: string } | null)?.displayName || t.name;
const vnTime = (d: Date) => d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
const vnDate = (d: Date) => d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });

@Injectable()
export class ZaloService {
  private readonly logger = new Logger(ZaloService.name);
  readonly transport: ZaloTransport;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
  ) {
    this.transport = config.get('ZALO_TRANSPORT') === 'fake' ? new FakeTransport() : new HttpTransport(config);
  }

  private get secret() {
    return this.config.get('JWT_SECRET');
  }
  /** Ứng dụng Zalo: nhập trong CRM (ưu tiên) hoặc ZALO_APP_ID / ZALO_APP_SECRET của máy chủ */
  private async app(tenantId: string): Promise<{ id: string; secret: string; source: 'crm' | 'server' } | null> {
    const row = await this.prisma.zaloToken.findUnique({ where: { tenantId }, select: { appId: true, appSecretEnc: true } });
    if (row?.appId && row.appSecretEnc) return { id: row.appId, secret: decrypt(row.appSecretEnc, this.secret), source: 'crm' };
    const id = this.config.get('ZALO_APP_ID');
    const secret = this.config.get('ZALO_APP_SECRET');
    if (id && secret) return { id, secret, source: 'server' };
    if (this.config.get('ZALO_TRANSPORT') === 'fake') return { id: 'fake-app', secret: 'fake-secret', source: 'server' };
    return null;
  }

  /** Lưu App ID + Secret key nhập trong CRM (secret mã hoá, không bao giờ trả về). Đổi ứng dụng thì phải kết nối lại OA. */
  async saveApp(tenantId: string, appId: string, appSecret?: string | null) {
    const row = await this.prisma.zaloToken.findUnique({ where: { tenantId } });
    if (!appSecret && !row?.appSecretEnc) throw new BadRequestException('Nhập Secret key của ứng dụng Zalo');
    const changed = row?.appId !== appId;
    const data = {
      appId,
      ...(appSecret ? { appSecretEnc: encrypt(appSecret, this.secret) } : {}),
      // Đổi ứng dụng: token của ứng dụng cũ không dùng được nữa
      ...(changed ? { refreshTokenEnc: null, accessTokenEnc: null, accessExpiresAt: null, lastError: null } : {}),
    };
    await this.prisma.zaloToken.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
    return this.status(tenantId);
  }

  async removeApp(tenantId: string) {
    await this.prisma.zaloToken.updateMany({ where: { tenantId }, data: { appId: null, appSecretEnc: null, refreshTokenEnc: null, accessTokenEnc: null, accessExpiresAt: null } });
    return this.status(tenantId);
  }

  async settings(tenantId: string): Promise<ZaloSettings> {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { zaloSettings: true } });
    return { ...DEFAULT_ZALO, ...((t.zaloSettings as Partial<ZaloSettings> | null) ?? {}) };
  }

  async status(tenantId: string) {
    const [settings, token, app] = await Promise.all([this.settings(tenantId), this.prisma.zaloToken.findUnique({ where: { tenantId } }), this.app(tenantId)]);
    return {
      appConfigured: !!app,
      appSource: app?.source ?? null,
      appId: app?.source === 'crm' ? app.id : null,
      connected: !!token?.refreshTokenEnc,
      lastError: token?.lastError ?? null,
      tokenUpdatedAt: token?.updatedAt ?? null,
      settings,
      events: Object.entries(EVENTS).map(([code, e]) => ({ code, label: e.label, sources: e.sources.map((s) => ({ code: s, label: SOURCES[s] })) })),
    };
  }

  async saveSettings(tenantId: string, s: ZaloSettings) {
    for (const [ev, t] of Object.entries(s.templates)) {
      const allowed = EVENTS[ev as ZaloEvent].sources as readonly string[];
      if (t?.params.some((p) => !allowed.includes(p.source))) throw new BadRequestException(`Mẫu "${EVENTS[ev as ZaloEvent].label}": có tham số dùng dữ liệu không thuộc sự kiện này`);
      if (t?.enabled && !t.templateId) throw new BadRequestException(`Mẫu "${EVENTS[ev as ZaloEvent].label}": cần nhập mã mẫu ZNS (template ID)`);
    }
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { zaloSettings: s as unknown as Prisma.InputJsonValue } });
    return this.status(tenantId);
  }

  /** Lưu refresh token lấy từ trang quản trị Zalo; làm mới thử ngay để kiểm tra */
  async connect(tenantId: string, refreshToken: string) {
    const app = await this.app(tenantId);
    if (!app) throw new BadRequestException('Nhập App ID và Secret key của ứng dụng Zalo trước (mục "Ứng dụng Zalo" bên trên)');
    let t: TokenResponse;
    try {
      t = await this.transport.refresh(app.id, app.secret, refreshToken.trim());
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    await this.saveTokens(tenantId, t);
    return this.status(tenantId);
  }

  private async saveTokens(tenantId: string, t: TokenResponse) {
    const data = {
      refreshTokenEnc: encrypt(t.refresh_token, this.secret),
      accessTokenEnc: encrypt(t.access_token, this.secret),
      accessExpiresAt: new Date(Date.now() + Number(t.expires_in) * 1000),
      lastError: null,
    };
    await this.prisma.zaloToken.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
  }

  /** Access token còn hạn; hết hạn thì làm mới (khoá Redis: refresh token chỉ dùng được một lần) */
  private async accessToken(tenantId: string): Promise<string> {
    const app = await this.app(tenantId);
    if (!app) throw new Error('Chưa cấu hình ứng dụng Zalo');
    for (let attempt = 0; attempt < 20; attempt++) {
      const tok = await this.prisma.zaloToken.findUnique({ where: { tenantId } });
      if (!tok?.refreshTokenEnc) throw new Error('Chưa kết nối Zalo OA');
      if (tok.accessTokenEnc && tok.accessExpiresAt && tok.accessExpiresAt.getTime() > Date.now() + 5 * 60_000) return decrypt(tok.accessTokenEnc, this.secret);
      const lock = await this.redis.client.set(`zalo:refresh:${tenantId}`, '1', 'EX', 30, 'NX');
      if (lock) {
        try {
          const t = await this.transport.refresh(app.id, app.secret, decrypt(tok.refreshTokenEnc!, this.secret));
          await this.saveTokens(tenantId, t);
          return t.access_token;
        } catch (e) {
          await this.prisma.zaloToken.update({ where: { tenantId }, data: { lastError: (e as Error).message.slice(0, 300) } });
          throw e;
        } finally {
          await this.redis.client.del(`zalo:refresh:${tenantId}`);
        }
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('Đang làm mới token Zalo, thử lại sau');
  }

  /**
   * Gửi tin theo sự kiện. Không bật / chưa có mẫu → bỏ qua. Không ném lỗi (lỗi ghi vào nhật ký),
   * trừ khi strict (OTP: phải báo cho người dùng biết là không gửi được).
   */
  async send(tenantId: string, event: ZaloEvent, phoneRaw: string | null | undefined, ctx: ZaloContext, opts: { refId?: string | null; strict?: boolean; ignoreEnabled?: boolean } = {}) {
    const fail = (msg: string) => {
      if (opts.strict) throw new ServiceUnavailableException(msg);
      return { status: 'SKIPPED' as const, error: msg };
    };
    const s = await this.settings(tenantId);
    const tpl = s.templates[event];
    if (!opts.ignoreEnabled && (!s.enabled || !tpl?.enabled)) return fail('Garage chưa bật gửi tin Zalo cho sự kiện này');
    if (!tpl?.templateId) return fail('Chưa cấu hình mẫu tin Zalo cho sự kiện này');
    const phone = zaloPhone(phoneRaw);
    if (!phone) return fail('Khách chưa có số điện thoại hợp lệ');
    const { data, missing } = buildTemplateData(tpl.params, ctx);
    const log = (status: string, error?: string, msgId?: string | null) =>
      this.prisma.zaloMessage.create({ data: { tenantId, event, phone, templateId: tpl.templateId, status, error: error?.slice(0, 500) ?? null, msgId: msgId ?? null, refId: opts.refId ?? null } });
    if (missing.length) {
      await log('FAILED', `Thiếu dữ liệu: ${missing.join(', ')}`);
      return fail(`Thiếu dữ liệu cho mẫu tin: ${missing.join(', ')}`);
    }
    try {
      const token = await this.accessToken(tenantId);
      const r = await this.transport.send(token, {
        phone,
        template_id: tpl.templateId,
        template_data: data,
        tracking_id: `${event}-${Date.now()}`,
        ...(s.mode === 'development' ? { mode: 'development' } : {}),
      });
      await log('SENT', undefined, r.msgId);
      return { status: 'SENT' as const, msgId: r.msgId };
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.warn(`Gửi Zalo ${event} lỗi: ${msg}`);
      await log('FAILED', msg);
      if (opts.strict) throw new ServiceUnavailableException(`Không gửi được tin Zalo: ${msg}`);
      return { status: 'FAILED' as const, error: msg };
    }
  }

  /** Gửi không chờ (sau khi lưu dữ liệu): lỗi chỉ ghi nhật ký, không làm hỏng thao tác của nhân viên */
  notify(tenantId: string, event: ZaloEvent, build: () => Promise<{ phone: string | null; ctx: ZaloContext; refId?: string } | null>) {
    void (async () => {
      try {
        const s = await this.settings(tenantId);
        if (!s.enabled || !s.templates[event]?.enabled) return;
        const x = await build();
        if (x) await this.send(tenantId, event, x.phone, x.ctx, { refId: x.refId });
      } catch (e) {
        this.logger.warn(`Zalo ${event}: ${(e as Error).message}`);
      }
    })();
  }

  async messages(tenantId: string) {
    return this.prisma.zaloMessage.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  // ---------------- Dữ liệu ghép vào mẫu ----------------

  appLink() {
    return `${this.config.get('CORS_ORIGINS').split(',')[0]!.trim().replace(/\/$/, '')}/app`;
  }
  async garage(tenantId: string) {
    return garageName(await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, printSettings: true } }));
  }

  async orderContext(orderId: string) {
    const o = await this.prisma.repairOrder.findUnique({ where: { id: orderId }, include: { customer: true, vehicle: true, branch: true } });
    if (!o) return null;
    return {
      phone: o.customer.phone,
      refId: o.id,
      ctx: {
        customer_name: o.customer.name,
        plate: o.vehicle ? formatPlate(o.vehicle.plateNo) : null,
        order_code: o.code,
        order_total: Number(o.total),
        amount_due: Math.max(0, Number(o.total) - Number(o.paid)),
        branch_name: o.branch.name,
        branch_address: o.branch.address,
        branch_phone: o.branch.phone,
        garage_name: await this.garage(o.tenantId),
        app_link: this.appLink(),
      } satisfies ZaloContext,
    };
  }

  async bookingContext(bookingId: string) {
    const b = await this.prisma.booking.findUnique({ where: { id: bookingId }, include: { customer: true, vehicle: true, branch: true } });
    if (!b) return null;
    return {
      phone: b.customer.phone,
      refId: b.id,
      ctx: {
        customer_name: b.customer.name,
        plate: b.vehicle ? formatPlate(b.vehicle.plateNo) : null,
        booking_code: b.code,
        booking_time: vnTime(b.scheduledAt),
        booking_date: vnDate(b.scheduledAt),
        branch_name: b.branch.name,
        branch_address: b.branch.address,
        branch_phone: b.branch.phone,
        garage_name: await this.garage(b.tenantId),
      } satisfies ZaloContext,
    };
  }

  async careContext(taskId: string) {
    const t = await this.prisma.careTask.findUnique({ where: { id: taskId }, include: { customer: true } });
    if (!t) return null;
    const [branch, vehicle] = await Promise.all([
      t.branchId ? this.prisma.branch.findUnique({ where: { id: t.branchId } }) : null,
      t.vehicleId ? this.prisma.vehicle.findUnique({ where: { id: t.vehicleId } }) : null,
    ]);
    return {
      phone: t.customer.phone,
      refId: t.id,
      ctx: {
        customer_name: t.customer.name,
        plate: vehicle ? formatPlate(vehicle.plateNo) : null,
        vehicle: vehicle ? [vehicle.make, vehicle.model].filter(Boolean).join(' ') || null : null,
        care_title: t.title,
        due_date: vnDate(t.eventDate ?? t.dueDate),
        branch_name: branch?.name ?? null,
        branch_phone: branch?.phone ?? null,
        garage_name: await this.garage(t.tenantId),
        app_link: this.appLink(),
      } satisfies ZaloContext,
    };
  }
}

const sourceCodes = Object.keys(SOURCES) as [Source, ...Source[]];
const tplSchema = z.object({
  enabled: z.boolean(),
  templateId: z
    .string()
    .trim()
    .max(40)
    .regex(/^[\w-]*$/, 'Mã mẫu chỉ gồm chữ, số'),
  params: z.array(z.object({ name: z.string().trim().min(1).max(40).regex(/^\w+$/, 'Tên tham số chỉ gồm chữ không dấu, số, _'), source: z.enum(sourceCodes) })).max(20),
});
const settingsSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['development', 'production']),
  templates: z.object(Object.fromEntries(Object.keys(EVENTS).map((e) => [e, tplSchema.optional()])) as Record<ZaloEvent, z.ZodOptional<typeof tplSchema>>),
});
const appSchema = z.object({
  appId: z
    .string()
    .trim()
    .regex(/^\d{6,25}$/, 'App ID là dãy số (xem ở developers.zalo.me)'),
  appSecret: z.string().trim().min(10, 'Secret key không hợp lệ').max(200).optional().nullable(),
});
const testSchema = z.object({ event: z.enum(Object.keys(EVENTS) as [ZaloEvent, ...ZaloEvent[]]), phone: z.string().min(9).max(20) });

/** Dữ liệu mẫu để gửi thử */
const SAMPLE: ZaloContext = {
  customer_name: 'Nguyễn Văn Thử',
  plate: '61A-123.45',
  vehicle: 'Toyota Vios',
  order_code: 'DH000123',
  order_total: 1_250_000,
  amount_due: 1_250_000,
  booking_code: 'LH000123',
  booking_time: '08:30',
  booking_date: '25/12/2026',
  branch_name: 'Chi nhánh thử',
  branch_address: 'Địa chỉ thử',
  branch_phone: '0900000000',
  care_title: 'Đến kỳ bảo dưỡng',
  due_date: '25/12/2026',
  otp: '123456',
};

@Controller('zalo')
export class ZaloController {
  constructor(private readonly zalo: ZaloService) {}

  @RequirePermissions('settings.manage')
  @Get('settings')
  status(@CurrentAuth() auth: RequestAuth) {
    return this.zalo.status(auth.tenantId);
  }

  @RequirePermissions('settings.manage')
  @Put('settings')
  save(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(settingsSchema)) dto: ZaloSettings) {
    return this.zalo.saveSettings(auth.tenantId, dto);
  }

  @RequirePermissions('settings.manage')
  @Put('app')
  saveApp(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(appSchema)) dto: z.infer<typeof appSchema>) {
    return this.zalo.saveApp(auth.tenantId, dto.appId, dto.appSecret);
  }

  @RequirePermissions('settings.manage')
  @Post('app/remove')
  @HttpCode(200)
  removeApp(@CurrentAuth() auth: RequestAuth) {
    return this.zalo.removeApp(auth.tenantId);
  }

  @RequirePermissions('settings.manage')
  @Post('connect')
  @HttpCode(200)
  connect(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(z.object({ refreshToken: z.string().trim().min(10).max(2000) }))) dto: { refreshToken: string }) {
    return this.zalo.connect(auth.tenantId, dto.refreshToken);
  }

  @RequirePermissions('settings.manage')
  @Post('test')
  @HttpCode(200)
  async test(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(testSchema)) dto: z.infer<typeof testSchema>) {
    return this.zalo.send(auth.tenantId, dto.event, dto.phone, { ...SAMPLE, garage_name: await this.zalo.garage(auth.tenantId), app_link: this.zalo.appLink() }, { strict: true, ignoreEnabled: true });
  }

  @RequirePermissions('settings.manage')
  @Get('messages')
  messages(@CurrentAuth() auth: RequestAuth) {
    return this.zalo.messages(auth.tenantId);
  }
}

@Global()
@Module({ controllers: [ZaloController], providers: [ZaloService], exports: [ZaloService] })
export class ZaloModule {}
