import type { Access } from '../auth/access.service';

/**
 * Quy tắc chống tự nâng quyền:
 * - Chỉ được cấp vai trò mà mọi quyền của nó mình đều đang có.
 * - Chỉ được cấp trong phạm vi chi nhánh của mình; cấp "mọi chi nhánh" cần phạm vi "mọi chi nhánh".
 * - Chỉ quản lý được người có quyền và phạm vi nằm trong của mình.
 */
export function canGrantRole(actor: Access, rolePermissions: string[], branchId: string | null): boolean {
  if (!rolePermissions.every((p) => (actor.permissions as string[]).includes(p))) return false;
  if (branchId === null) return actor.branchIds === 'ALL';
  return actor.branchIds === 'ALL' || actor.branchIds.includes(branchId);
}

export function canManageMember(actor: Access, target: Access): boolean {
  if (actor.membershipId === target.membershipId) return false;
  if (!target.permissions.every((p) => actor.permissions.includes(p))) return false;
  if (actor.branchIds === 'ALL') return true;
  if (target.branchIds === 'ALL') return false;
  const scope = actor.branchIds;
  return target.branchIds.every((b) => scope.includes(b));
}
