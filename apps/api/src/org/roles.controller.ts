import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { PERMISSIONS, isPermissionCode } from '@cardiy/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { AccessService } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const roleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  permissions: z.array(z.string()).min(1, 'Chọn ít nhất một quyền').max(200),
});
const updateSchema = roleSchema.partial();

@Controller()
export class RolesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: AccessService,
    private readonly audit: AuditService,
  ) {}

  private scopeOf(auth: RequestAuth) {
    return auth.access.tenantType === 'PLATFORM' ? ('PLATFORM' as const) : ('TENANT' as const);
  }

  /** Danh mục quyền theo phạm vi của không gian làm việc hiện tại. */
  @RequirePermissions('staff.view')
  @Get('permissions')
  permissions(@CurrentAuth() auth: RequestAuth) {
    const scope = this.scopeOf(auth);
    return PERMISSIONS.filter((p) => scope === 'PLATFORM' || p.scope === 'TENANT');
  }

  @RequirePermissions('staff.view')
  @Get('roles')
  async list(@CurrentAuth() auth: RequestAuth) {
    const roles = await this.prisma.role.findMany({
      where: { OR: [{ tenantId: null, isSystem: true, scope: this.scopeOf(auth) }, { tenantId: auth.tenantId }] },
      include: { permissions: true, _count: { select: { members: { where: { membership: { tenantId: auth.tenantId } } } } } },
      orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
    });
    return roles.map((r) => {
      const perms = r.permissions.map((p) => p.permissionCode);
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        isSystem: r.isSystem,
        require2fa: r.require2fa,
        permissions: perms,
        memberCount: r._count.members,
        grantable: perms.every((p) => (auth.access.permissions as string[]).includes(p)),
      };
    });
  }

  private validatePermissions(auth: RequestAuth, codes: string[]) {
    const scope = this.scopeOf(auth);
    for (const c of codes) {
      if (!isPermissionCode(c)) throw new BadRequestException(`Quyền không tồn tại: ${c}`);
      const def = PERMISSIONS.find((p) => p.code === c)!;
      if (scope === 'TENANT' && def.scope !== 'TENANT') throw new BadRequestException(`Quyền ${c} chỉ dành cho sàn`);
      if (!(auth.access.permissions as string[]).includes(c)) throw new ForbiddenException(`Bạn không được cấp quyền mình không có: ${c}`);
    }
  }

  @RequirePermissions('role.manage')
  @Post('roles')
  async create(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(roleSchema)) dto: z.infer<typeof roleSchema>, @Req() req: Request) {
    const perms = [...new Set(dto.permissions)];
    this.validatePermissions(auth, perms);
    const role = await this.prisma.role.create({
      data: {
        tenantId: auth.tenantId,
        code: `TC_${randomBytes(3).toString('hex').toUpperCase()}`,
        name: dto.name,
        scope: this.scopeOf(auth),
        permissions: { create: perms.map((permissionCode) => ({ permissionCode })) },
      },
    });
    await this.audit.log({ tenantId: auth.tenantId, actorId: auth.userId, action: 'role.created', entity: 'role', entityId: role.id, after: { name: dto.name, permissions: perms }, ip: clientIp(req) });
    return { id: role.id, code: role.code };
  }

  private async customRole(auth: RequestAuth, id: string) {
    const role = await this.prisma.role.findFirst({ where: { id, tenantId: auth.tenantId }, include: { permissions: true } });
    if (!role) throw new NotFoundException('Không tìm thấy vai trò tuỳ chỉnh (vai trò hệ thống không sửa được)');
    return role;
  }

  @RequirePermissions('role.manage')
  @Patch('roles/:id')
  async update(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateSchema)) dto: z.infer<typeof updateSchema>, @Req() req: Request) {
    const role = await this.customRole(auth, id);
    const perms = dto.permissions ? [...new Set(dto.permissions)] : undefined;
    if (perms) this.validatePermissions(auth, perms);
    await this.prisma.$transaction(async (tx) => {
      if (dto.name) await tx.role.update({ where: { id }, data: { name: dto.name } });
      if (perms) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({ data: perms.map((permissionCode) => ({ roleId: id, permissionCode })) });
      }
    });
    const members = await this.prisma.membershipRole.findMany({ where: { roleId: id }, select: { membershipId: true } });
    await this.accessService.invalidate(...members.map((m) => m.membershipId));
    await this.audit.log({
      tenantId: auth.tenantId, actorId: auth.userId, action: 'role.updated', entity: 'role', entityId: id,
      before: { name: role.name, permissions: role.permissions.map((p) => p.permissionCode) }, after: { name: dto.name, permissions: perms }, ip: clientIp(req),
    });
    return { status: 'ok' };
  }

  @RequirePermissions('role.manage')
  @Delete('roles/:id')
  @HttpCode(200)
  async remove(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const role = await this.customRole(auth, id);
    if (await this.prisma.membershipRole.count({ where: { roleId: id } })) throw new ConflictException('Vai trò đang được gán cho nhân viên, gỡ trước khi xoá');
    await this.prisma.role.delete({ where: { id } });
    await this.audit.log({ tenantId: auth.tenantId, actorId: auth.userId, action: 'role.deleted', entity: 'role', entityId: id, before: { name: role.name }, ip: clientIp(req) });
    return { status: 'ok' };
  }
}
