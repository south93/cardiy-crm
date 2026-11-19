/**
 * Chuẩn hoá số điện thoại Việt Nam về dạng 0xxxxxxxxx (10 số).
 * Chấp nhận: "0912 345 678", "+84912345678", "84912345678", "0912.345.678".
 * Trả về null nếu không hợp lệ.
 */
export function normalizeVnPhone(input: string): string | null {
  let s = input.replace(/[\s.\-()]/g, '');
  if (s.startsWith('+84')) s = '0' + s.slice(3);
  else if (/^84\d{9}$/.test(s)) s = '0' + s.slice(2);
  return /^0[35789]\d{8}$/.test(s) ? s : null;
}

/**
 * Chính sách mật khẩu: tối thiểu 8 ký tự, có chữ và số.
 * Trả về thông báo lỗi tiếng Việt, hoặc null nếu hợp lệ.
 */
export function checkPasswordPolicy(password: string): string | null {
  if (password.length < 8) return 'Mật khẩu cần ít nhất 8 ký tự';
  if (password.length > 72) return 'Mật khẩu tối đa 72 ký tự';
  if (!/[A-Za-zÀ-ỹ]/.test(password) || !/\d/.test(password)) return 'Mật khẩu cần có cả chữ và số';
  return null;
}
