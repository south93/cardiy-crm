/**
 * Luật nghiệp vụ thuần của đơn hàng (không đụng database) để test riêng.
 * Tiền tính bằng đồng (số nguyên); số lượng tối đa 2 chữ số thập phân.
 */
import type { PermissionCode } from '@cardiy/shared';

export type OrderStatus = 'TIEP_NHAN' | 'DANG_SUA' | 'HOAN_THANH' | 'DA_GIAO' | 'HUY';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  TIEP_NHAN: 'Tiếp nhận',
  DANG_SUA: 'Đang sửa',
  HOAN_THANH: 'Hoàn thành',
  DA_GIAO: 'Đã giao xe',
  HUY: 'Đã huỷ',
};

/** Đơn còn mở (hiện ở "Đơn đang xử lý") */
export const OPEN_STATUSES: OrderStatus[] = ['TIEP_NHAN', 'DANG_SUA', 'HOAN_THANH'];
/** Còn sửa được hạng mục, giảm giá */
export const EDITABLE_STATUSES: OrderStatus[] = OPEN_STATUSES;

interface Transition {
  /** Có một trong các quyền này là được chuyển */
  anyOf: PermissionCode[];
}

/** Chuyển trạng thái hợp lệ. Mọi chuyển khác bị từ chối. */
export const TRANSITIONS: Record<OrderStatus, Partial<Record<OrderStatus, Transition>>> = {
  TIEP_NHAN: { DANG_SUA: { anyOf: ['ro.manage', 'ro.task.update'] }, HUY: { anyOf: ['ro.approve'] } },
  DANG_SUA: { HOAN_THANH: { anyOf: ['ro.manage', 'ro.task.update'] }, TIEP_NHAN: { anyOf: ['ro.manage'] }, HUY: { anyOf: ['ro.approve'] } },
  HOAN_THANH: { DA_GIAO: { anyOf: ['ro.manage'] }, DANG_SUA: { anyOf: ['ro.manage'] }, HUY: { anyOf: ['ro.approve'] } },
  DA_GIAO: {},
  HUY: {},
};

export function transitionError(from: OrderStatus, to: OrderStatus, permissions: ReadonlySet<string>): string | null {
  const t = TRANSITIONS[from][to];
  if (!t) return `Không chuyển được từ "${STATUS_LABEL[from]}" sang "${STATUS_LABEL[to]}"`;
  if (!t.anyOf.some((p) => permissions.has(p))) return `Bạn không có quyền chuyển đơn sang "${STATUS_LABEL[to]}"`;
  return null;
}

/** "1.5" → 150 (phần trăm đơn vị). Trả null nếu không hợp lệ. */
export function quantityHundredths(q: string | number): number | null {
  const s = String(q).trim().replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [i, f = ''] = s.split('.');
  const n = Number(i) * 100 + Number(f.padEnd(2, '0'));
  return n > 0 ? n : null;
}

export interface ItemInput {
  quantity: string | number;
  unitPrice: number;
  discount?: number;
  /** % thuế VAT của dòng */
  vatRate?: number;
}

/** Thành tiền một dòng = làm tròn(số lượng × đơn giá) − giảm giá dòng. */
export function lineAmount(item: ItemInput): number {
  const q = quantityHundredths(item.quantity);
  if (q === null) throw new RangeError('Số lượng không hợp lệ');
  if (!Number.isSafeInteger(item.unitPrice) || item.unitPrice < 0) throw new RangeError('Đơn giá không hợp lệ');
  const gross = Math.round((q * item.unitPrice) / 100);
  const discount = item.discount ?? 0;
  if (!Number.isSafeInteger(discount) || discount < 0 || discount > gross) throw new RangeError('Giảm giá dòng không được lớn hơn thành tiền');
  return gross - discount;
}

/**
 * Tổng đơn: tiền hàng (sau chiết khấu dòng) − chiết khấu đơn + VAT.
 * VAT tính theo % từng dòng trên phần tiền sau khi đã chia đều chiết khấu đơn theo tỷ lệ.
 */
export function orderTotals(items: ItemInput[], orderDiscount: number) {
  const amounts = items.map((i) => lineAmount(i));
  const subtotal = amounts.reduce((s, a) => s + a, 0);
  if (!Number.isSafeInteger(orderDiscount) || orderDiscount < 0 || orderDiscount > subtotal) throw new RangeError('Giảm giá đơn không được lớn hơn tổng tiền hàng');
  const factor = subtotal ? (subtotal - orderDiscount) / subtotal : 0;
  const vat = items.reduce((s, it, k) => {
    const rate = it.vatRate ?? 0;
    if (!Number.isInteger(rate) || rate < 0 || rate > 100) throw new RangeError('% thuế không hợp lệ');
    return s + Math.round((amounts[k]! * factor * rate) / 100);
  }, 0);
  return { subtotal, vat, total: subtotal - orderDiscount + vat };
}

/** Trạng thái tiền của đơn, để hiển thị */
export function paymentState(total: number, paid: number): 'CHUA_THU' | 'THU_MOT_PHAN' | 'DA_THU_DU' {
  if (paid <= 0) return total === 0 ? 'DA_THU_DU' : 'CHUA_THU';
  return paid >= total ? 'DA_THU_DU' : 'THU_MOT_PHAN';
}
