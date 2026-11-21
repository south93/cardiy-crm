import type { Access } from '../auth/access.service';
import { canGrantRole, canManageMember } from './grant-rules';

const base = (over: Partial<Access>): Access => ({
  userId: 'u',
  membershipId: 'm',
  tenantId: 't',
  tenantType: 'GARAGE',
  tenantName: 'G',
  active: true,
  roles: [],
  permissions: [],
  branchIds: 'ALL',
  require2fa: false,
  ...over,
});

const owner = base({ membershipId: 'cg', permissions: ['staff.manage', 'ro.view', 'ro.manage', 'finance.manage', 'role.manage'] });
const manager = base({ membershipId: 'ql', permissions: ['staff.manage', 'ro.view', 'ro.manage'], branchIds: ['cn1'] });

describe('canGrantRole', () => {
  it('Chủ garage cấp được vai trò có quyền con', () => {
    expect(canGrantRole(owner, ['ro.view'], null)).toBe(true);
  });
  it('Quản lý không cấp được quyền mình không có (tài chính)', () => {
    expect(canGrantRole(manager, ['ro.view', 'finance.manage'], 'cn1')).toBe(false);
  });
  it('Quản lý chỉ cấp trong chi nhánh của mình', () => {
    expect(canGrantRole(manager, ['ro.view'], 'cn1')).toBe(true);
    expect(canGrantRole(manager, ['ro.view'], 'cn2')).toBe(false);
  });
  it('Quản lý một chi nhánh không cấp được phạm vi "mọi chi nhánh"', () => {
    expect(canGrantRole(manager, ['ro.view'], null)).toBe(false);
  });
});

describe('canManageMember', () => {
  it('không tự quản lý chính mình', () => {
    expect(canManageMember(owner, owner)).toBe(false);
  });
  it('Quản lý không sửa được Chủ garage', () => {
    expect(canManageMember(manager, owner)).toBe(false);
  });
  it('Quản lý sửa được KTV trong chi nhánh mình, không sửa được KTV chi nhánh khác', () => {
    const ktv1 = base({ membershipId: 'k1', permissions: ['ro.view'], branchIds: ['cn1'] });
    const ktv2 = base({ membershipId: 'k2', permissions: ['ro.view'], branchIds: ['cn2'] });
    expect(canManageMember(manager, ktv1)).toBe(true);
    expect(canManageMember(manager, ktv2)).toBe(false);
  });
});
