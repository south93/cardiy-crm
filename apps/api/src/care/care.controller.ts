import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
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
  registrationDays: z.coerce.number().int().min(1).max(120),
  insuranceDays: z.coerce.number().int().min(1).max(120),
  maintenanceMonths: z.coerce.number().int().min(1).max(24),
  followUpDays: z.coerce.number().int().min(1).max(30),
  maxAttempts: z.coerce.number().int().min(1).max(10),
});

@Controller('care')
export class CareController {
  constructor(private readonly care: CareService) {}

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

@Module({ controllers: [CareController], providers: [CareService] })
export class CareModule {}
