import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { z } from 'zod';
import { AllowLimited, CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import type { RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from './access.service';

const avatarSchema = z.object({ fileId: z.string().uuid().nullable() });

@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: AccessService,
    private readonly files: FilesService,
  ) {}

  /** Thông tin người dùng, không gian làm việc hiện tại, quyền, chi nhánh được phép. */
  @AllowLimited()
  @Get()
  async me(@CurrentAuth() auth: RequestAuth) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    const memberships = await this.prisma.membership.findMany({
      where: { userId: auth.userId, status: 'ACTIVE' },
      include: { tenant: { select: { id: true, name: true, type: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const a = auth.access;
    const branches = await this.prisma.branch.findMany({
      where: { tenantId: a.tenantId, deletedAt: null, ...(a.branchIds === 'ALL' ? {} : { id: { in: a.branchIds } }) },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true },
    });
    return {
      user: {
        id: user.id,
        phone: user.phone,
        fullName: user.fullName,
        email: user.email,
        totpEnabled: user.totpEnabled,
        mustChangePassword: user.mustChangePassword,
        avatarUrl: user.avatarFileId ? await this.files.signedUrl(user.avatarFileId) : null,
      },
      workspace: { membershipId: a.membershipId, tenantId: a.tenantId, tenantName: a.tenantName, tenantType: a.tenantType },
      roles: a.roles,
      permissions: a.permissions,
      branches,
      limited: auth.limited,
      memberships: memberships.map((m) => ({ membershipId: m.id, tenantId: m.tenant.id, tenantName: m.tenant.name, tenantType: m.tenant.type })),
    };
  }

  @RequirePermissions('file.upload')
  @Patch('avatar')
  async setAvatar(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(avatarSchema)) dto: z.infer<typeof avatarSchema>) {
    if (dto.fileId) await this.files.assertOwnedImage(dto.fileId, auth.tenantId);
    await this.prisma.user.update({ where: { id: auth.userId }, data: { avatarFileId: dto.fileId } });
    return { avatarUrl: dto.fileId ? await this.files.signedUrl(dto.fileId) : null };
  }

  @AllowLimited()
  @Get('sessions')
  async sessions(@CurrentAuth() auth: RequestAuth) {
    const rows = await this.prisma.session.findMany({
      where: { userId: auth.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true, userAgent: true, ip: true, createdAt: true, lastUsedAt: true },
    });
    return rows;
  }

  @AllowLimited()
  @Delete('sessions/:id')
  @HttpCode(200)
  async revokeSession(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.prisma.session.updateMany({ where: { id, userId: auth.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) throw new NotFoundException('Không tìm thấy phiên đăng nhập');
    await this.accessService.invalidate(auth.membershipId);
    return { status: 'ok' };
  }
}
