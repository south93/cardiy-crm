import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import type { RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const querySchema = z.object({
  action: z.string().max(100).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  /** Nhật ký thao tác của tenant hiện tại, mới nhất trước. Phân trang bằng `before` (id). */
  @RequirePermissions('audit.view')
  @Get()
  async list(@CurrentAuth() auth: RequestAuth, @Query(new ZodPipe(querySchema)) q: z.infer<typeof querySchema>) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        tenantId: auth.tenantId,
        ...(q.action ? { action: { startsWith: q.action } } : {}),
        ...(q.before ? { id: { lt: BigInt(q.before) } } : {}),
      },
      orderBy: { id: 'desc' },
      take: q.limit,
    });
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
    const actors = await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } });
    const nameOf = new Map(actors.map((a) => [a.id, a.fullName]));
    return {
      items: rows.map((r) => ({
        id: Number(r.id),
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        actorId: r.actorId,
        actorName: r.actorId ? (nameOf.get(r.actorId) ?? null) : null,
        before: r.before,
        after: r.after,
        ip: r.ip,
        createdAt: r.createdAt,
      })),
      nextBefore: rows.length === q.limit ? Number(rows[rows.length - 1]!.id) : null,
    };
  }
}
