import { BadRequestException, Body, Controller, Get, Global, HttpCode, Injectable, Logger, Module, Post, Put } from '@nestjs/common';
import { formatPlate, normalizeVnPhone } from '@cardiy/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import { type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { decrypt, encrypt } from '../zalo/zalo-rules';

export const SMS_PROVIDERS = [
  { code: 'ESMS', label: 'eSMS.vn (SMS Brandname phổ biến)', defaultUrl: 'https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/' },
  { code: 'SPEEDSMS', label: 'SpeedSMS.vn', defaultUrl: 'https://api.speedsms.vn/index.php/sms/send' },
  { code: 'VIETGUYS', label: 'VietGuys CloudSMS', defaultUrl: 'https://cloudsms4.vietguys.biz:4438/api/index.php' },
  { code: 'WEBHOOK', label: 'Chuẩn HTTP Webhook / Tổng đài riêng (JSON)', defaultUrl: '' },
] as const;

export type SmsProviderCode = (typeof SMS_PROVIDERS)[number]['code'];

export const SMS_TEMPLATE_VARS: readonly { code: string; label: string }[] = [
  { code: 'customer_name', label: 'Tên khách hàng' },
  { code: 'plate', label: 'Biển số xe' },
  { code: 'vehicle', label: 'Hãng & dòng xe' },
  { code: 'care_title', label: 'Nội dung nhắc hạn / bảo dưỡng' },
  { code: 'due_date', label: 'Ngày đến hạn / kỳ nhắc' },
  { code: 'branch_name', label: 'Tên chi nhánh' },
  { code: 'branch_phone', label: 'SĐT hotline chi nhánh' },
  { code: 'garage_name', label: 'Tên hiển thị Garage' },
  { code: 'app_link', label: 'Đường dẫn App chủ xe' },
];

export const DEFAULT_SMS_TEMPLATE =
  '[{garage_name}] Xe {plate}: {care_title} (moc {due_date}). Quy khach vui long lien he {branch_phone} hoac dat lich tai {app_link}';

export interface SmsTemplateVars {
  customer_name?: string | null;
  plate?: string | null;
  vehicle?: string | null;
  care_title?: string | null;
  due_date?: string | null;
  branch_name?: string | null;
  branch_phone?: string | null;
  garage_name?: string | null;
  app_link?: string | null;
}

export function renderSmsTemplate(template: string, vars: SmsTemplateVars): string {
  return template
    .replace(/\{(\w+)\}/g, (_m, key: string) => {
      const val = vars[key as keyof SmsTemplateVars];
      return val !== null && val !== undefined && String(val).trim() !== '' ? String(val).trim() : '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const saveSmsConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['ESMS', 'SPEEDSMS', 'VIETGUYS', 'WEBHOOK']).default('ESMS'),
  mode: z.enum(['development', 'production']).default('development'),
  endpointUrl: z.string().trim().max(400).optional().nullable(),
  brandname: z.string().trim().max(40).optional().nullable(),
  apiKey: z.string().trim().max(200).optional().nullable(),
  apiSecret: z.string().trim().max(300).optional().nullable(),
  templateText: z.string().trim().min(10, 'Mẫu tin SMS tối thiểu 10 ký tự').max(480).default(DEFAULT_SMS_TEMPLATE),
});

const testSmsSchema = z.object({
  phone: z.string().trim().min(9, 'Nhập số điện thoại nhận tin thử').max(20),
});

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  private appSecret() {
    return this.config.get('JWT_SECRET');
  }

  appLink() {
    return `${this.config.get('CORS_ORIGINS').split(',')[0]!.trim().replace(/\/$/, '')}/app`;
  }

  async garageName(tenantId: string): Promise<string> {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, printSettings: true } });
    return (t.printSettings as { displayName?: string } | null)?.displayName?.trim() || t.name;
  }

  async getSettings(tenantId: string) {
    const row = await this.prisma.smsConfig.findUnique({ where: { tenantId } });
    return {
      enabled: row?.enabled ?? false,
      provider: (row?.provider as SmsProviderCode | undefined) ?? 'ESMS',
      mode: (row?.mode as 'development' | 'production' | undefined) ?? 'development',
      endpointUrl: row?.endpointUrl ?? '',
      brandname: row?.brandname ?? '',
      apiKey: row?.apiKey ?? '',
      secretConfigured: Boolean(row?.apiSecretEnc),
      templateText: row?.templateText ?? DEFAULT_SMS_TEMPLATE,
      updatedAt: row?.updatedAt ?? null,
      providers: SMS_PROVIDERS,
      variables: SMS_TEMPLATE_VARS,
    };
  }

  async saveSettings(tenantId: string, actorId: string, dto: z.infer<typeof saveSmsConfigSchema>) {
    const existing = await this.prisma.smsConfig.findUnique({ where: { tenantId } });
    const nextSecretEnc =
      dto.apiSecret && dto.apiSecret.trim().length > 0
        ? encrypt(dto.apiSecret.trim(), this.appSecret())
        : (existing?.apiSecretEnc ?? null);

    if (dto.enabled && dto.mode === 'production') {
      if (dto.provider === 'WEBHOOK' && !dto.endpointUrl?.trim()) {
        throw new BadRequestException('Chế độ gửi thật qua Webhook cần nhập URL cổng nhận tin (Endpoint URL)');
      }
      if (dto.provider !== 'WEBHOOK' && !dto.apiKey?.trim()) {
        throw new BadRequestException(`Cần nhập API Key của nhà cung cấp ${dto.provider} trước khi bật chế độ gửi thật`);
      }
    }

    await this.prisma.smsConfig.upsert({
      where: { tenantId },
      create: {
        tenantId,
        enabled: dto.enabled,
        provider: dto.provider,
        mode: dto.mode,
        endpointUrl: dto.endpointUrl?.trim() || null,
        brandname: dto.brandname?.trim() || null,
        apiKey: dto.apiKey?.trim() || null,
        apiSecretEnc: nextSecretEnc,
        templateText: dto.templateText,
      },
      update: {
        enabled: dto.enabled,
        provider: dto.provider,
        mode: dto.mode,
        endpointUrl: dto.endpointUrl?.trim() || null,
        brandname: dto.brandname?.trim() || null,
        apiKey: dto.apiKey?.trim() || null,
        apiSecretEnc: nextSecretEnc,
        templateText: dto.templateText,
      },
    });

    await this.audit.log({
      tenantId,
      actorId,
      action: 'sms.settings_saved',
      entity: 'sms_config',
      entityId: tenantId,
      after: { enabled: dto.enabled, provider: dto.provider, mode: dto.mode, brandname: dto.brandname ?? null },
    });

    return this.getSettings(tenantId);
  }

  async listMessages(tenantId: string) {
    return this.prisma.smsMessage.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** Gửi tin nhắn SMS nhắc hẹn (hỗ trợ cả chế độ giả lập kiểm thử và gọi thật HTTP tới nhà mạng) */
  async send(
    tenantId: string,
    event: string,
    phoneRaw: string | null | undefined,
    vars: SmsTemplateVars,
    opts: { refId?: string | null; ignoreEnabled?: boolean } = {},
  ): Promise<{ status: 'SENT' | 'SIMULATED' | 'FAILED' | 'SKIPPED'; msgId?: string | null; error?: string; content?: string }> {
    const cfg = await this.prisma.smsConfig.findUnique({ where: { tenantId } });
    const provider = (cfg?.provider as SmsProviderCode | undefined) ?? 'ESMS';
    const mode = (cfg?.mode as 'development' | 'production' | undefined) ?? 'development';
    const templateText = cfg?.templateText ?? DEFAULT_SMS_TEMPLATE;

    if (!opts.ignoreEnabled && !cfg?.enabled) {
      return { status: 'SKIPPED', error: 'Garage chưa bật kênh gửi tin SMS trong Cài đặt' };
    }

    const normalized = phoneRaw ? normalizeVnPhone(phoneRaw) : null;
    if (!normalized) {
      return { status: 'SKIPPED', error: 'Khách hàng chưa có số điện thoại di động Việt Nam hợp lệ' };
    }

    const content = renderSmsTemplate(templateText, {
      ...vars,
      garage_name: vars.garage_name ?? (await this.garageName(tenantId)),
      app_link: vars.app_link ?? this.appLink(),
    });

    const logRow = async (status: 'SENT' | 'SIMULATED' | 'FAILED', msgId?: string | null, error?: string | null) =>
      this.prisma.smsMessage.create({
        data: {
          tenantId,
          event,
          phone: normalized,
          content,
          provider,
          status,
          msgId: msgId ?? null,
          error: error?.slice(0, 500) ?? null,
          refId: opts.refId ?? null,
        },
      });

    // Chế độ development: kiểm thử an toàn toàn bộ luồng & nội dung tin nhắn mà không tốn cước nhà mạng
    if (mode === 'development') {
      const simId = `SIM-${Date.now().toString(36).toUpperCase()}`;
      await logRow('SIMULATED', simId, null);
      return { status: 'SIMULATED', msgId: simId, content };
    }

    const secret = cfg?.apiSecretEnc ? decrypt(cfg.apiSecretEnc, this.appSecret()) : '';
    const defaultUrl = SMS_PROVIDERS.find((p) => p.code === provider)?.defaultUrl ?? '';
    const url = cfg?.endpointUrl?.trim() || defaultUrl;
    if (!url) {
      await logRow('FAILED', null, 'Chưa cấu hình Endpoint URL cho cổng SMS');
      return { status: 'FAILED', error: 'Chưa cấu hình Endpoint URL cho cổng SMS' };
    }

    try {
      const result = await this.dispatchHttp(provider, url, {
        phone: normalized,
        intlPhone: `84${normalized.slice(1)}`,
        content,
        brandname: cfg?.brandname ?? '',
        apiKey: cfg?.apiKey ?? '',
        apiSecret: secret,
        event,
        refId: opts.refId ?? null,
      });
      await logRow('SENT', result.msgId, null);
      return { status: 'SENT', msgId: result.msgId, content };
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.warn(`Gửi SMS ${event} (${provider}) thất bại: ${msg}`);
      await logRow('FAILED', null, msg);
      return { status: 'FAILED', error: msg };
    }
  }

  private async dispatchHttp(
    provider: SmsProviderCode,
    url: string,
    p: { phone: string; intlPhone: string; content: string; brandname: string; apiKey: string; apiSecret: string; event: string; refId: string | null },
  ): Promise<{ msgId: string | null }> {
    let headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let body: Record<string, unknown>;

    if (provider === 'ESMS') {
      body = {
        ApiKey: p.apiKey,
        SecretKey: p.apiSecret,
        Phone: p.phone,
        Content: p.content,
        Brandname: p.brandname,
        SmsType: '2',
      };
    } else if (provider === 'SPEEDSMS') {
      const basic = Buffer.from(`${p.apiKey}:${p.apiSecret || 'x'}`).toString('base64');
      headers = { ...headers, Authorization: `Basic ${basic}` };
      body = {
        to: [p.phone],
        content: p.content,
        sms_type: 2,
        sender: p.brandname,
      };
    } else if (provider === 'VIETGUYS') {
      body = {
        u: p.apiKey,
        pwd: p.apiSecret,
        from: p.brandname,
        phone: p.intlPhone,
        sms: p.content,
        json: 1,
      };
    } else {
      if (p.apiKey) headers['X-Api-Key'] = p.apiKey;
      if (p.apiSecret) headers.Authorization = `Bearer ${p.apiSecret}`;
      body = {
        phone: p.phone,
        intlPhone: p.intlPhone,
        brandname: p.brandname || null,
        content: p.content,
        event: p.event,
        refId: p.refId,
      };
    }

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const rawText = await res.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${rawText.slice(0, 200)}`);
    }
    if (provider === 'ESMS' && parsed && parsed.CodeResult && String(parsed.CodeResult) !== '100') {
      throw new Error(`eSMS mã ${parsed.CodeResult}: ${String(parsed.ErrorMessage ?? '')}`);
    }
    if (provider === 'SPEEDSMS' && parsed && parsed.status === 'error') {
      throw new Error(`SpeedSMS: ${String(parsed.message ?? '')}`);
    }

    const msgId = parsed ? String(parsed.SMSID ?? parsed.tranId ?? parsed.id ?? parsed.msgId ?? '') || null : null;
    return { msgId };
  }

  async sendCareTaskSms(tenantId: string, taskId: string) {
    const t = await this.prisma.careTask.findFirst({ where: { id: taskId, tenantId }, include: { customer: true } });
    if (!t) throw new BadRequestException('Không tìm thấy việc chăm sóc');
    const [branch, vehicle] = await Promise.all([
      t.branchId ? this.prisma.branch.findUnique({ where: { id: t.branchId } }) : null,
      t.vehicleId ? this.prisma.vehicle.findUnique({ where: { id: t.vehicleId } }) : null,
    ]);
    const exp = t.eventDate ?? t.dueDate;
    const dueStr = `${String(exp.getUTCDate()).padStart(2, '0')}/${String(exp.getUTCMonth() + 1).padStart(2, '0')}/${exp.getUTCFullYear()}`;
    return this.send(
      tenantId,
      'CARE_REMINDER',
      t.customer.phone,
      {
        customer_name: t.customer.name,
        plate: vehicle ? formatPlate(vehicle.plateNo) : 'xe cua quy khach',
        vehicle: vehicle ? [vehicle.make, vehicle.model].filter(Boolean).join(' ') : '',
        care_title: t.title,
        due_date: dueStr,
        branch_name: branch?.name ?? '',
        branch_phone: branch?.phone ?? '',
      },
      { refId: t.id },
    );
  }
}

@RequirePermissions('settings.manage')
@Controller('sms')
export class SmsController {
  constructor(private readonly sms: SmsService) {}

  @Get('settings')
  settings(@CurrentAuth() auth: RequestAuth) {
    return this.sms.getSettings(auth.tenantId);
  }

  @Put('settings')
  save(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(saveSmsConfigSchema)) dto: z.infer<typeof saveSmsConfigSchema>) {
    return this.sms.saveSettings(auth.tenantId, auth.userId, dto);
  }

  @Post('test')
  @HttpCode(200)
  async sendTest(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(testSmsSchema)) dto: z.infer<typeof testSmsSchema>) {
    return this.sms.send(
      auth.tenantId,
      'TEST',
      dto.phone,
      {
        customer_name: 'Anh Khach Thu',
        plate: '61A-123.45',
        vehicle: 'Toyota Camry',
        care_title: 'Thay dau nhot dong co (da chay 4.800/5.000 km)',
        due_date: '30/12/2026',
        branch_name: 'Chi nhanh chinh',
        branch_phone: '0909000111',
      },
      { ignoreEnabled: true },
    );
  }

  @Get('messages')
  messages(@CurrentAuth() auth: RequestAuth) {
    return this.sms.listMessages(auth.tenantId);
  }
}

@Global()
@Module({
  controllers: [SmsController],
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
