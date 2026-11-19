import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PERMISSION_CODES, PERMISSIONS, SYSTEM_ROLES, checkPasswordPolicy, normalizeVnPhone } from './index';

test('mã quyền không trùng nhau', () => {
  assert.equal(new Set(PERMISSION_CODES).size, PERMISSION_CODES.length);
});

test('mọi quyền của vai trò hệ thống đều có trong danh mục, đúng phạm vi', () => {
  for (const role of SYSTEM_ROLES) {
    for (const code of role.permissions) {
      const def = PERMISSIONS.find((p) => p.code === code);
      assert.ok(def, `${role.code}: quyền ${code} không tồn tại`);
      if (role.scope === 'TENANT') assert.equal(def.scope, 'TENANT', `${role.code} không được có quyền sàn ${code}`);
    }
  }
});

test('Đối tác chỉ có quyền cổng đối tác (+ tải file): không CRM, không quản lý nhân viên', () => {
  const dt = SYSTEM_ROLES.find((r) => r.code === 'DT')!;
  for (const code of dt.permissions) {
    const def = PERMISSIONS.find((p) => p.code === code)!;
    assert.ok(def.scope === 'PARTNER' || code === 'file.upload', `Đối tác không được có quyền ${code}`);
  }
  for (const c of ['staff.view', 'staff.manage', 'role.manage', 'ro.view', 'customer.view'] as const) {
    assert.ok(!(dt.permissions as string[]).includes(c), c);
  }
});

test('Chủ garage có toàn bộ quyền cấp garage', () => {
  const cg = SYSTEM_ROLES.find((r) => r.code === 'CG')!;
  const tenantCodes = PERMISSIONS.filter((p) => p.scope === 'TENANT').map((p) => p.code);
  assert.deepEqual([...cg.permissions].sort(), [...tenantCodes].sort());
});

test('Kỹ thuật viên không quản lý được nhân viên hay tài chính', () => {
  const ktv = SYSTEM_ROLES.find((r) => r.code === 'KTV')!;
  for (const c of ['staff.manage', 'finance.view', 'finance.manage', 'role.manage'] as const) {
    assert.ok(!(ktv.permissions as string[]).includes(c), c);
  }
});

test('Quản lý chi nhánh cấp được vai trò cho nhân viên xưởng (BH, KTV, CS, Cứu hộ)', () => {
  const ql = SYSTEM_ROLES.find((r) => r.code === 'QL')!;
  for (const code of ['BH', 'KTV', 'CS', 'CH']) {
    const role = SYSTEM_ROLES.find((r) => r.code === code)!;
    const missing = role.permissions.filter((p) => !(ql.permissions as string[]).includes(p));
    assert.deepEqual(missing, [], `QL thiếu quyền để cấp ${code}: ${missing.join(', ')}`);
  }
});

test('chuẩn hoá số điện thoại Việt Nam', () => {
  assert.equal(normalizeVnPhone('0912 345 678'), '0912345678');
  assert.equal(normalizeVnPhone('+84912345678'), '0912345678');
  assert.equal(normalizeVnPhone('84912345678'), '0912345678');
  assert.equal(normalizeVnPhone('0912.345.678'), '0912345678');
  assert.equal(normalizeVnPhone('091234567'), null);
  assert.equal(normalizeVnPhone('0212345678'), null);
  assert.equal(normalizeVnPhone('abc'), null);
});

test('chính sách mật khẩu', () => {
  assert.equal(checkPasswordPolicy('abc123'), 'Mật khẩu cần ít nhất 8 ký tự');
  assert.equal(checkPasswordPolicy('abcdefgh'), 'Mật khẩu cần có cả chữ và số');
  assert.equal(checkPasswordPolicy('12345678'), 'Mật khẩu cần có cả chữ và số');
  assert.equal(checkPasswordPolicy('Garage2026'), null);
});
