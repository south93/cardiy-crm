import { randomInt } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { normalizeVnPhone } from '@cardiy/shared';
import { AccessService, type Access } from '../auth/access.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { canGrantRole, canManageMember } from './grant-rules';

export interface RoleAssignment {
  roleId: string;
  branchId: string | null;
}

/** Mật khẩu tạm 10 ký tự, bỏ các ký tự dễ nhầm (0/O, 1/l/I). */
export function generateTempPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const all = letters + digits;
  const chars = [letters[randomInt(letters.length)]!, digits[randomInt(digits.length)]!];
  while (chars.length < 10) chars.push(all[randomInt(all.length)]!);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: AccessService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: Access) {
    const members = await this.prisma.membership.findMany({
      where: { tenantId: actor.tenantId },
      include: {
        user: { select: { id: true, fullName: true, phone: true, lastLoginAt: true, totpEnabled: true, mustChangePassword: true, status: true } },
        roles: { include: { role: { select: { id: true, code: true, name: true } }, branch: { select: { id: true, code: true, name: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const visible = members.filter((m) => {
      if (actor.branchIds === 'ALL') return true;
      const scope = actor.branchIds;
      return m.roles.some((r) => r.branchId && scope.includes(r.branchId));
    });
    const result = [];
    for (const m of visible) {
      const target = await this.accessService.get(m.id);
      result.push({
        membershipId: m.id,
        userId: m.user.id,
        fullName: m.user.fullName,
        phone: m.user.phone,
        title: m.title,
        status: m.status === 'ACTIVE' && m.user.status === 'ACTIVE' ? 'ACTIVE' : 'LOCKED',
        lastLoginAt: m.user.lastLoginAt,
        totpEnabled: m.user.totpEnabled,
        mustChangePassword: m.user.mustChangePassword,
        isSelf: m.id === actor.membershipId,
        canManage: target ? canManageMember(actor, target) : false,
        roles: m.roles.map((r) => ({ roleId: r.role.id, code: r.role.code, name: r.role.name, branchId: r.branchId, branchName: r.branch?.name ?? null })),
      });
    }
    return result;
  }

  private async validateAssignments(actor: Access, assignments: RoleAssignment[]) {
    if (!assignments.length) throw new BadRequestException('Cần chọn ít nhất một vai trò');
    const scope = actor.tenantType === 'PLATFORM' ? 'PLATFORM' : 'TENANT';
    for (const a of assignments) {
      const role = await this.prisma.role.findFirst({
        where: { id: a.roleId, OR: [{ tenantId: null, isSystem: true, scope }, { tenantId: actor.tenantId }] },
        include: { permissions: true },
      });
      if (!role) throw new BadRequestException('Vai trò không hợp lệ');
      if (a.branchId) {
        const b = await this.prisma.branch.findFirst({ where: { id: a.branchId, tenantId: actor.tenantId, deletedAt: null } });
        if (!b) throw new BadRequestException('Chi nhánh không hợp lệ');
      }
      if (!canGrantRole(actor, role.permissions.map((p) => p.permissionCode), a.branchId)) {
        throw new ForbiddenException(`Bạn không được cấp vai trò "${role.name}" ở phạm vi này`);
      }
    }
  }

  async create(actor: Access, dto: { fullName: string; phone: string; title?: string; roles: RoleAssignment[] }, ip?: string) {
    const phone = normalizeVnPhone(dto.phone);
    if (!phone) throw new BadRequestException('Số điện thoại không hợp lệ');
    await this.validateAssignments(actor, dto.roles);

    const existing = await this.prisma.user.findUnique({ where: { phone }, include: { memberships: { where: { tenantId: actor.tenantId } } } });
    if (existing?.memberships.length) throw new ConflictException('Số điện thoại này đã là nhân viên của garage');

    const tempPassword = existing ? null : generateTempPassword();
    const membership = await this.prisma.$transaction(async (tx) => {
      const user =
        existing ??
        (await tx.user.create({
          data: { phone, fullName: dto.fullName.trim(), passwordHash: await this.auth.hashPassword(tempPassword!), mustChangePassword: true },
        }));
      const m = await tx.membership.create({
        data: { userId: user.id, tenantId: actor.tenantId, title: dto.title?.trim() || null, roles: { create: dto.roles.map((r) => ({ roleId: r.roleId, branchId: r.branchId })) } },
      });
      await this.audit.log(
        { tenantId: actor.tenantId, actorId: actor.userId, action: 'staff.created', entity: 'membership', entityId: m.id, after: { fullName: user.fullName, phone, roles: dto.roles, existingAccount: !!existing }, ip },
        tx,
      );
      return m;
    });
    return { membershipId: membership.id, existingAccount: !!existing, tempPassword };
  }

  private async loadTarget(actor: Access, membershipId: string) {
    const m = await this.prisma.membership.findFirst({ where: { id: membershipId, tenantId: actor.tenantId }, include: { user: true } });
    if (!m) throw new NotFoundException('Không tìm thấy nhân viên');
    const target = await this.accessService.get(m.id);
    if (!target || !canManageMember(actor, target)) throw new ForbiddenException('Bạn không được quản lý tài khoản này');
    return m;
  }

  async update(actor: Access, membershipId: string, dto: { fullName?: string; title?: string | null; roles?: RoleAssignment[] }, ip?: string) {
    const m = await this.loadTarget(actor, membershipId);
    if (dto.roles) await this.validateAssignments(actor, dto.roles);
    const before = await this.accessService.get(m.id);
    await this.prisma.$transaction(async (tx) => {
      if (dto.fullName) await tx.user.update({ where: { id: m.userId }, data: { fullName: dto.fullName.trim() } });
      if (dto.title !== undefined) await tx.membership.update({ where: { id: m.id }, data: { title: dto.title?.trim() || null } });
      if (dto.roles) {
        await tx.membershipRole.deleteMany({ where: { membershipId: m.id } });
        await tx.membershipRole.createMany({ data: dto.roles.map((r) => ({ membershipId: m.id, roleId: r.roleId, branchId: r.branchId })) });
      }
      await this.audit.log(
        { tenantId: actor.tenantId, actorId: actor.userId, action: 'staff.updated', entity: 'membership', entityId: m.id, before: { fullName: m.user.fullName, title: m.title, roles: before?.roles }, after: dto, ip },
        tx,
      );
    });
    await this.accessService.invalidate(m.id);
    return { status: 'ok' };
  }

  async setLocked(actor: Access, membershipId: string, locked: boolean, ip?: string) {
    const m = await this.loadTarget(actor, membershipId);
    await this.prisma.$transaction(async (tx) => {
      await tx.membership.update({ where: { id: m.id }, data: { status: locked ? 'LOCKED' : 'ACTIVE' } });
      if (locked) await tx.session.updateMany({ where: { membershipId: m.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({ tenantId: actor.tenantId, actorId: actor.userId, action: locked ? 'staff.locked' : 'staff.unlocked', entity: 'membership', entityId: m.id, ip }, tx);
    });
    await this.accessService.invalidate(m.id);
    return { status: 'ok' };
  }

  /** Đặt lại mật khẩu: chỉ khi tài khoản không còn làm việc ở tenant khác (tránh chiếm tài khoản của garage khác). */
  async resetPassword(actor: Access, membershipId: string, ip?: string) {
    const m = await this.loadTarget(actor, membershipId);
    const elsewhere = await this.prisma.membership.count({ where: { userId: m.userId, tenantId: { not: actor.tenantId } } });
    if (elsewhere) throw new ConflictException('Tài khoản này còn làm việc ở nơi khác. Nhân viên cần tự đổi mật khẩu.');
    const tempPassword = generateTempPassword();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: m.userId }, data: { passwordHash: await this.auth.hashPassword(tempPassword), mustChangePassword: true } });
      await tx.session.updateMany({ where: { userId: m.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({ tenantId: actor.tenantId, actorId: actor.userId, action: 'staff.password_reset', entity: 'membership', entityId: m.id, ip }, tx);
    });
    return { tempPassword };
  }
}
