import { Body, Controller, Get, HttpCode, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms';
import { ZaloService } from '../zalo/zalo';
import { AutoReminderService } from './auto-reminder';
import { CareService } from './care.service';

const KINDS = ['DANG_KIEM', 'BAO_HIEM', 'BAO_DUONG', 'HOI_THAM', 'KHAC'] as const;
const OUTCOMES = ['DA_TU_VAN', 'DAT_LICH', 'KHONG_NGHE', 'GOI_LAI_SAU', 'KHONG_CAN', 'SAI_SO'] as const;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày dạng YYYY-MM-DD');
const bool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);

const listSchema = z.object({
  view: z.enum(['hom-nay', 'sap-toi', 'da-xu-ly']).default('hom-nay'),
  kind: z.enum(KINDS).optional(),
  q: z.string().max(100).optional(),
  refresh: bool.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
const callSchema = z.object({ outcome: z.enum(OUTCOMES), note: z.string().trim().max(1000).optional().nullable(), nextAt: day.optional().nullable(), bookingId: z.string().uuid().optional().nullable() });
const createSchema = z.object({ customerId: z.string().uuid(), vehicleId: z.string().uuid().optional().nullable(), title: z.string().trim().min(3, 'Ghi nội dung cần gọi').max(200), dueDate: day });
const settingsSchema = z.object({
  registrationDays: z.coerce.number().int().min(1).max(180).optional(),
  insuranceDays: z.coerce.number().int().min(1).max(180).optional(),
  badgeDays: z.coerce.number().int().min(1).max(180).optional(),
  maintenanceMonths: z.coerce.number().int().min(1).max(24).optional(),
  followUpDays: z.coerce.number().int().min(1).max(30).optional(),
  maxAttempts: z.coerce.number().int().min(1).max(10).optional(),
  autoAppEnabled: z.boolean().optional(),
  autoZaloEnabled: z.boolean().optional(),
  autoSmsEnabled: z.boolean().optional(),
  smsFallbackWhenZaloFails: z.boolean().optional(),
  sendHourVn: z.coerce.number().int().min(0).max(23).optional(),
});

@Controller('care')
export class CareController {
  constructor(
    private readonly care: CareService,
    private readonly autoReminder: AutoReminderService,
    private readonly prisma: PrismaService,
    private readonly zalo: ZaloService,
    private readonly sms: SmsService,
  ) {}

  private async assertTaskBranch(auth: RequestAuth, id: string) {
    const t = await this.prisma.careTask.findFirst({ where: { id, tenantId: auth.tenantId } });
    if (!t || (t.branchId && auth.access.branchIds !== 'ALL' && !auth.access.branchIds.includes(t.branchId))) {
      throw new NotFoundException('Không tìm thấy việc chăm sóc');
    }
    return t;
  }

  /** Gửi tin Zalo nhắc khách (bảo dưỡng / đăng kiểm / bảo hiểm / phù hiệu) theo việc chăm sóc */
  @RequirePermissions('customer.manage')
  @Post('tasks/:id/zalo')
  @HttpCode(200)
  async sendZalo(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string) {
    await this.assertTaskBranch(auth, id);
    const x = (await this.zalo.careContext(id))!;
    return this.zalo.send(auth.tenantId, 'CARE_REMINDER', x.phone, x.ctx, { refId: id });
  }

  /** Gửi tin SMS nhắc khách theo việc chăm sóc */
  @RequirePermissions('customer.manage')
  @Post('tasks/:id/sms')
  @HttpCode(200)
  async sendSms(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string) {
    await this.assertTaskBranch(auth, id);
    return this.sms.sendCareTaskSms(auth.tenantId, id);
  }

  /** Đẩy thông báo nhắc hạn trực tiếp vào hộp thư App Chủ xe */
  @RequirePermissions('customer.manage')
  @Post('tasks/:id/app-notify')
  @HttpCode(200)
  async sendAppNotify(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string) {
    await this.assertTaskBranch(auth, id);
    return this.autoReminder.sendTaskAppNotification(auth.tenantId, id);
  }

  /** Kích hoạt quét & gửi nhắc lịch tự động ngay (App / Zalo ZNS / SMS) */
  @RequirePermissions('customer.manage')
  @Post('auto-reminders/run')
  @HttpCode(200)
  runAutoReminders(@CurrentAuth() auth: RequestAuth) {
    return this.autoReminder.runForTenant(auth.tenantId, { branchIds: auth.access.branchIds });
  }

  /** Nhật ký các lượt gửi nhắc tự động (App / Zalo / SMS) */
  @RequirePermissions('customer.view')
  @Get('auto-reminders/logs')
  reminderLogs(@CurrentAuth() auth: RequestAuth) {
    return this.autoReminder.listLogs(auth.access);
  }

  @RequirePermissions('customer.view')
  @Get('tasks')
  list(@CurrentAuth() auth: RequestAuth, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.care.list(auth.access, q);
  }

  @RequirePermissions('customer.view')
  @Get('customers/:id')
  history(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.care.history(auth.access, id);
  }

  @RequirePermissions('customer.manage')
  @Post('tasks')
  create(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(createSchema)) dto: z.infer<typeof createSchema>, @Req() req: Request) {
    return this.care.create(auth.access, dto, clientIp(req));
  }

  @RequirePermissions('customer.manage')
  @Post('tasks/:id/calls')
  @HttpCode(200)
  call(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(callSchema)) dto: z.infer<typeof callSchema>, @Req() req: Request) {
    return this.care.logCall(auth.access, id, dto, clientIp(req));
  }

  @RequirePermissions('customer.view')
  @Get('settings')
  settings(@CurrentAuth() auth: RequestAuth) {
    return this.care.settings(auth.tenantId);
  }

  @RequirePermissions('settings.manage')
  @Put('settings')
  saveSettings(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(settingsSchema)) dto: z.infer<typeof settingsSchema>, @Req() req: Request) {
    return this.care.saveSettings(auth.access, dto, clientIp(req));
  }
}

@Module({ controllers: [CareController], providers: [CareService, AutoReminderService], exports: [CareService, AutoReminderService] })
export class CareModule {}
