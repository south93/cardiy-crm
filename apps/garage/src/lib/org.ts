export interface RoleRow {
  id: string;
  code: string;
  name: string;
  isSystem: boolean;
  require2fa: boolean;
  permissions: string[];
  memberCount: number;
  grantable: boolean;
}

export interface BranchRow {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  bays: number;
  /** BP: giá Bình Phước (chính) · BD: giá Bình Dương */
  priceZone?: 'BP' | 'BD';
}

export interface StaffRow {
  membershipId: string;
  userId: string;
  fullName: string;
  phone: string;
  title: string | null;
  status: 'ACTIVE' | 'LOCKED';
  lastLoginAt: string | null;
  totpEnabled: boolean;
  mustChangePassword: boolean;
  isSelf: boolean;
  canManage: boolean;
  roles: { roleId: string; code: string; name: string; branchId: string | null; branchName: string | null }[];
}

export interface PermissionRow {
  code: string;
  group: string;
  label: string;
  scope: 'PLATFORM' | 'TENANT';
}

export const ALL_BRANCHES = '__all__';
