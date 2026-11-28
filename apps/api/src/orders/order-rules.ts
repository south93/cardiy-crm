/**
 * Luật nghiệp vụ thuần của đơn hàng (không đụng database) để test riêng.
 * Tiền tính bằng đồng (số nguyên); số lượng tối đa 2 chữ số thập phân.
 */
import type { OrderPhotoStage, PermissionCode } from '@cardiy/shared';

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

/** Kiểm tra quyền cập nhật thông tin hiện trạng xe lúc tiếp nhận */
export function intakeUpdateError(status: OrderStatus, permissions: ReadonlySet<string>): { kind: 'conflict' | 'forbidden'; message: string } | null {
  if (!OPEN_STATUSES.includes(status)) {
    return { kind: 'conflict', message: 'Đơn đã giao hoặc đã huỷ, không sửa được hiện trạng tiếp nhận' };
  }
  if (!permissions.has('ro.manage')) {
    return { kind: 'forbidden', message: 'Chỉ Cố vấn dịch vụ hoặc Quản lý mới được cập nhật hiện trạng tiếp nhận' };
  }
  return null;
}

/** Kiểm tra quyền tải ảnh theo từng giai đoạn (TIEP_NHAN cho CVDV/Quản lý; KIEM_TRA & HOAN_TAT cho KTV phụ trách hoặc CVDV/Quản lý) */
export function photoUploadError(p: {
  status: OrderStatus;
  stage: OrderPhotoStage;
  permissions: ReadonlySet<string>;
  technicianId: string | null;
  membershipId: string | null;
}): { kind: 'conflict' | 'forbidden'; message: string } | null {
  if (!OPEN_STATUSES.includes(p.status)) {
    return { kind: 'conflict', message: 'Đơn đã giao hoặc đã huỷ, không thêm được hình ảnh' };
  }
  if (!p.permissions.has('file.upload')) {
    return { kind: 'forbidden', message: 'Bạn không có quyền tải ảnh lên' };
  }
  if (p.stage === 'TIEP_NHAN') {
    if (!p.permissions.has('ro.manage')) {
      return { kind: 'forbidden', message: 'Chỉ Cố vấn dịch vụ hoặc Quản lý mới được tải ảnh hiện trạng tiếp nhận' };
    }
    return null;
  }
  if (p.permissions.has('ro.manage')) return null;
  if (!p.permissions.has('ro.task.update')) {
    return { kind: 'forbidden', message: 'Bạn không có quyền tải ảnh kiểm tra / hoàn tất dịch vụ' };
  }
  if (p.technicianId && p.technicianId !== p.membershipId) {
    return { kind: 'forbidden', message: 'Đơn này đang do kỹ thuật viên khác phụ trách' };
  }
  return null;
}

/** Kiểm tra quyền xoá ảnh trên lệnh sửa chữa */
export function photoDeleteError(p: {
  status: OrderStatus;
  stage: OrderPhotoStage;
  permissions: ReadonlySet<string>;
  technicianId: string | null;
  membershipId: string | null;
  uploadedBy: string | null;
  userId: string;
}): { kind: 'conflict' | 'forbidden'; message: string } | null {
  if (!OPEN_STATUSES.includes(p.status)) {
    return { kind: 'conflict', message: 'Đơn đã giao hoặc đã huỷ, không xoá được hình ảnh' };
  }
  if (p.permissions.has('ro.manage')) return null;
  if (p.stage === 'TIEP_NHAN') {
    return { kind: 'forbidden', message: 'Chỉ Cố vấn dịch vụ hoặc Quản lý mới được xoá ảnh hiện trạng tiếp nhận' };
  }
  if (!p.permissions.has('ro.task.update')) {
    return { kind: 'forbidden', message: 'Bạn không có quyền xoá hình ảnh này' };
  }
  if (p.technicianId && p.technicianId !== p.membershipId) {
    return { kind: 'forbidden', message: 'Đơn này đang do kỹ thuật viên khác phụ trách' };
  }
  if (p.uploadedBy !== p.userId) {
    return { kind: 'forbidden', message: 'Bạn chỉ xoá được hình ảnh do chính mình tải lên' };
  }
  return null;
}

