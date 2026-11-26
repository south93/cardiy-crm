import { Injectable, Logger } from '@nestjs/common';
import type { PermissionCode, TenantKind } from '@cardiy/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export interface Access {
  userId: string;
  membershipId: string;
  tenantId: string;
  tenantType: TenantKind;
  tenantName: string;
  active: boolean;
  roles: { id: string; code: string; name: string; branchId: string | null }[];
  permissions: PermissionCode[];
  /** 'ALL' = mọi chi nhánh của tenant */
  branchIds: 'ALL' | string[];
  require2fa: boolean;
}

const TTL_SECONDS = 60;
const key = (membershipId: string) => `acl:${membershipId}`;

/**
 * Tính quyền và phạm vi chi nhánh của một thành viên. Có cache Redis 60 giây;
 * mọi thay đổi vai trò / khoá tài khoản phải gọi invalidate().
 */
@Injectable()
export class AccessService {
  private readonly logger = new Logger(AccessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async get(membershipId: string): Promise<Access | null> {
    try {
      const cached = await this.redis.client.get(key(membershipId));
      if (cached) return JSON.parse(cached) as Access;
    } catch {
      /* Redis lỗi: đọc thẳng DB */
    }
    const access = await this.load(membershipId);
    if (access) {
      try {
        await this.redis.client.set(key(membershipId), JSON.stringify(access), 'EX', TTL_SECONDS);
      } catch (e) {
        this.logger.warn(`Không ghi được cache quyền: ${(e as Error).message}`);
      }
    }
    return access;
  }

  async invalidate(...membershipIds: string[]): Promise<void> {
    if (!membershipIds.length) return;
    try {
      await this.redis.client.del(...membershipIds.map(key));
    } catch (e) {
      this.logger.warn(`Không xoá được cache quyền: ${(e as Error).message}`);
    }
  }

  private async load(membershipId: string): Promise<Access | null> {
    const m = await this.prisma.membership.findUnique({
      where: { id: membershipId },
      include: {
        user: { select: { status: true } },
        tenant: { select: { type: true, name: true, status: true, deletedAt: true } },
        roles: { include: { role: { include: { permissions: true } } } },
      },
    });
    if (!m) return null;
    const permissions = new Set<PermissionCode>();
    let allBranches = false;
    const branchIds = new Set<string>();
    let require2fa = false;
    for (const mr of m.roles) {
      mr.role.permissions.forEach((p) => permissions.add(p.permissionCode as PermissionCode));
      if (mr.branchId) branchIds.add(mr.branchId);
      else allBranches = true;
      require2fa ||= mr.role.require2fa;
    }
    const tenantUsable = !m.tenant.deletedAt && !['TAM_KHOA', 'CHAM_DUT', 'TU_CHOI'].includes(m.tenant.status);
    return {
      userId: m.userId,
      membershipId: m.id,
      tenantId: m.tenantId,
      tenantType: m.tenant.type,
      tenantName: m.tenant.name,
      active: m.status === 'ACTIVE' && m.user.status === 'ACTIVE' && tenantUsable,
      roles: m.roles.map((mr) => ({ id: mr.role.id, code: mr.role.code, name: mr.role.name, branchId: mr.branchId })),
      permissions: [...permissions].sort(),
      branchIds: allBranches ? 'ALL' : [...branchIds],
      require2fa,
    };
  }

  static has(access: Access, ...codes: PermissionCode[]): boolean {
    return codes.every((c) => access.permissions.includes(c));
  }

  static canAccessBranch(access: Access, branchId: string): boolean {
    return access.branchIds === 'ALL' || access.branchIds.includes(branchId);
  }
}
