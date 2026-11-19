import { Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { normalizeVnPhone } from '@cardiy/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const branchSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/, 'Mã 2–20 ký tự: chữ, số, - hoặc _'),
  name: z.string().trim().min(2).max(100),
  address: z.string().trim().max(300).optional(),
  phone: z
    .string()
    .optional()
    .refine((v) => !v || normalizeVnPhone(v) !== null, 'Số điện thoại không hợp lệ'),
  bays: z.coerce.number().int().min(0).max(200).default(0),
});

@Controller('branches')
export class BranchesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Chi nhánh trong phạm vi của người dùng. */
  @Get()
  list(@CurrentAuth() auth: RequestAuth) {
    const a = auth.access;
    return this.prisma.branch.findMany({
      where: { tenantId: a.tenantId, deletedAt: null, ...(a.branchIds === 'ALL' ? {} : { id: { in: a.branchIds } }) },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, address: true, phone: true, bays: true },
    });
  }

  @RequirePermissions('branch.manage')
  @Post()
  async create(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(branchSchema)) dto: z.infer<typeof branchSchema>, @Req() req: Request) {
    const exists = await this.prisma.branch.findFirst({ where: { tenantId: auth.tenantId, code: dto.code } });
    if (exists) throw new ConflictException('Mã chi nhánh đã tồn tại');
    const phone = dto.phone ? normalizeVnPhone(dto.phone) : null;
    const b = await this.prisma.branch.create({ data: { ...dto, phone, tenantId: auth.tenantId } });
    await this.audit.log({ tenantId: auth.tenantId, actorId: auth.userId, action: 'branch.created', entity: 'branch', entityId: b.id, after: dto, ip: clientIp(req) });
    return b;
  }

  @RequirePermissions('branch.manage')
  @Patch(':id')
  async update(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(branchSchema.partial())) dto: Partial<z.infer<typeof branchSchema>>, @Req() req: Request) {
    const b = await this.prisma.branch.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
    if (!b) throw new NotFoundException('Không tìm thấy chi nhánh');
    if (dto.code && dto.code !== b.code && (await this.prisma.branch.findFirst({ where: { tenantId: auth.tenantId, code: dto.code } }))) {
      throw new ConflictException('Mã chi nhánh đã tồn tại');
    }
    const phone = dto.phone === undefined ? undefined : dto.phone ? normalizeVnPhone(dto.phone) : null;
    const updated = await this.prisma.branch.update({ where: { id }, data: { ...dto, phone } });
    await this.audit.log({ tenantId: auth.tenantId, actorId: auth.userId, action: 'branch.updated', entity: 'branch', entityId: id, before: b, after: dto, ip: clientIp(req) });
    return updated;
  }
}
