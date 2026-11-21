/** Khoản mục thu / chi và luật phân bổ thu nợ (thuần, test riêng). */
export const CATEGORIES = {
  THU: [
    { code: 'THU_NO_DAU_KY', label: 'Thu công nợ đầu kỳ (AppSheet)' },
    { code: 'THU_KHAC', label: 'Thu khác' },
  ],
  CHI: [
    { code: 'CHI_NHA_CUNG_CAP', label: 'Trả nhà cung cấp' },
    { code: 'LUONG', label: 'Lương, thưởng' },
    { code: 'DIEN_NUOC', label: 'Điện, nước, internet' },
    { code: 'MAT_BANG', label: 'Thuê mặt bằng' },
    { code: 'CONG_CU', label: 'Công cụ, dụng cụ' },
    { code: 'VAN_CHUYEN', label: 'Vận chuyển' },
    { code: 'CHI_KHAC', label: 'Chi khác' },
  ],
} as const;

export const categoryLabel = (code: string) => [...CATEGORIES.THU, ...CATEGORIES.CHI].find((c) => c.code === code)?.label ?? code;
export const isCategory = (type: 'THU' | 'CHI', code: string) => CATEGORIES[type].some((c) => c.code === code);

/**
 * Chia số tiền thu nợ: trả các đơn nợ cũ nhất trước, còn lại trừ vào công nợ đầu kỳ.
 * Không được thu quá tổng nợ.
 */
export function allocateDebt(amount: number, orders: { id: string; due: number }[], openingLeft: number) {
  const total = orders.reduce((s, o) => s + o.due, 0) + openingLeft;
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new RangeError('Số tiền phải lớn hơn 0');
  if (amount > total) throw new RangeError(`Số tiền lớn hơn tổng nợ (${total.toLocaleString('vi-VN')} đ)`);
  let left = amount;
  const toOrders: { id: string; amount: number }[] = [];
  for (const o of orders) {
    if (left <= 0) break;
    const x = Math.min(left, o.due);
    if (x > 0) toOrders.push({ id: o.id, amount: x });
    left -= x;
  }
  return { toOrders, toOpening: left };
}
