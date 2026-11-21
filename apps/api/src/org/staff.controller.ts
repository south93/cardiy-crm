import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { StaffService } from './staff.service';

const assignment = z.object({ roleId: z.string().uuid(), branchId: z.string().uuid().nullable() });
const createSchema = z.object({
  fullName: z.string().trim().min(2, 'Họ tên tối thiểu 2 ký tự').max(100),
  phone: z.string().min(9).max(20),
  title: z.string().max(100).optional(),
  roles: z.array(assignment).min(1, 'Cần chọn ít nhất một vai trò').max(20),
});
const updateSchema = z.object({
  fullName: z.string().trim().min(2).max(100).optional(),
  title: z.string().max(100).nullable().optional(),
  roles: z.array(assignment).min(1).max(20).optional(),
});

@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @RequirePermissions('staff.view')
  @Get()
  list(@CurrentAuth() auth: RequestAuth) {
    return this.staff.list(auth.access);
  }

  @RequirePermissions('staff.manage')
  @Post()
  create(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(createSchema)) dto: z.infer<typeof createSchema>, @Req() req: Request) {
    return this.staff.create(auth.access, dto, clientIp(req));
  }

  @RequirePermissions('staff.manage')
  @Patch(':id')
  update(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateSchema)) dto: z.infer<typeof updateSchema>, @Req() req: Request) {
    return this.staff.update(auth.access, id, dto, clientIp(req));
  }

  @RequirePermissions('staff.manage')
  @Post(':id/lock')
  @HttpCode(200)
  lock(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.staff.setLocked(auth.access, id, true, clientIp(req));
  }

  @RequirePermissions('staff.manage')
  @Post(':id/unlock')
  @HttpCode(200)
  unlock(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.staff.setLocked(auth.access, id, false, clientIp(req));
  }

  @RequirePermissions('staff.manage')
  @Post(':id/reset-password')
  @HttpCode(200)
  resetPassword(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.staff.resetPassword(auth.access, id, clientIp(req));
  }
}
