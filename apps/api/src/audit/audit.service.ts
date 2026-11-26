import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  tenantId?: string | null;
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/** Các trường không bao giờ được ghi vào nhật ký. */
const SECRET_FIELDS = new Set(['passwordHash', 'password', 'totpSecret', 'tokenHash', 'token', 'refreshToken']);

function scrub(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (k, v) => (SECRET_FIELDS.has(k) ? '[ẩn]' : typeof v === 'bigint' ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Ghi nhật ký. Không làm hỏng thao tác chính nếu ghi lỗi (chỉ log cảnh báo). */
  async log(e: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    try {
      await db.auditLog.create({
        data: {
          tenantId: e.tenantId ?? null,
          actorId: e.actorId ?? null,
          action: e.action,
          entity: e.entity,
          entityId: e.entityId ?? null,
          before: scrub(e.before),
          after: scrub(e.after),
          ip: e.ip ?? null,
        },
      });
    } catch (err) {
      if (tx) throw err;
      this.logger.error(`Không ghi được nhật ký ${e.action}: ${(err as Error).message}`);
    }
  }
}
