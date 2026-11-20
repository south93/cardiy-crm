import type { Tone } from '@cardiy/ui';

export type OrderStatus = 'TIEP_NHAN' | 'DANG_SUA' | 'HOAN_THANH' | 'DA_GIAO' | 'HUY';
export type PaymentState = 'CHUA_THU' | 'THU_MOT_PHAN' | 'DA_THU_DU';
export type ItemKind = 'DICH_VU' | 'PHU_TUNG';
export type PaymentMethod = 'TIEN_MAT' | 'CHUYEN_KHOAN' | 'THE';

export const STATUS: Record<OrderStatus, { label: string; tone: Tone }> = {
  TIEP_NHAN: { label: 'Tiếp nhận', tone: 'sky' },
  DANG_SUA: { label: 'Đang sửa', tone: 'peach' },
  HOAN_THANH: { label: 'Hoàn thành', tone: 'lav' },
  DA_GIAO: { label: 'Đã giao xe', tone: 'mint' },
  HUY: { label: 'Đã huỷ', tone: 'slate' },
};

export const PAYMENT_STATE: Record<PaymentState, { label: string; tone: Tone }> = {
  CHUA_THU: { label: 'Chưa thu', tone: 'rose' },
  THU_MOT_PHAN: { label: 'Thu một phần', tone: 'peach' },
  DA_THU_DU: { label: 'Đã thu đủ', tone: 'mint' },
};

export const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'TIEN_MAT', label: 'Tiền mặt' },
  { value: 'CHUYEN_KHOAN', label: 'Chuyển khoản' },
  { value: 'THE', label: 'Quẹt thẻ' },
];
export const methodLabel = (m: PaymentMethod) => METHODS.find((x) => x.value === m)?.label ?? m;

export const KINDS: { value: ItemKind; label: string }[] = [
  { value: 'DICH_VU', label: 'Dịch vụ' },
  { value: 'PHU_TUNG', label: 'Phụ tùng' },
];

export interface OrderRow {
  id: string;
  code: string;
  status: OrderStatus;
  branch: { id: string; code: string; name: string };
  customer: { id: string; name: string; phone: string | null };
  vehicle: { id: string; plate: string; make: string | null; model: string | null } | null;
  request: string | null;
  technician: { id: string; name: string } | null;
  itemCount: number;
  total: number | null;
  paid: number | null;
  paymentState: PaymentState | null;
  receivedAt: string;
  promisedAt: string | null;
  completedAt: string | null;
  deliveredAt: string | null;
}

export interface OrderList {
  total: number;
  page: number;
  pageSize: number;
  counts: Partial<Record<OrderStatus, number>>;
  items: OrderRow[];
}

/** Dòng hạng mục trong form: giữ số dạng chuỗi để gõ thoải mái */
export interface ItemDraft {
  key: string;
  /** Chọn từ danh mục (giao xe sẽ trừ kho); trống = nhập tay */
  productId?: string | null;
  code?: string | null;
  kind: ItemKind;
  name: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  discount: string;
}

let seq = 0;
export const newItem = (kind: ItemKind = 'DICH_VU'): ItemDraft => ({ key: `n${++seq}`, kind, name: '', unit: '', quantity: '1', unitPrice: '', discount: '' });

/** "1.250.000" / "1250000" → 1250000 */
export const parseMoney = (s: string): number => Number(s.replace(/[^\d]/g, '')) || 0;
export const moneyInput = (n: number): string => (n ? n.toLocaleString('vi-VN') : '');

export function parseQty(s: string): number | null {
  const v = s.trim().replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(v)) return null;
  const n = Number(v);
  return n > 0 ? n : null;
}

export function draftAmount(d: ItemDraft): number {
  const q = parseQty(d.quantity) ?? 0;
  return Math.max(0, Math.round(q * parseMoney(d.unitPrice)) - parseMoney(d.discount));
}

/** Dòng trống (chưa có tên) bị bỏ qua khi lưu */
export function draftsToPayload(rows: ItemDraft[]) {
  return rows
    .filter((r) => r.name.trim())
    .map((r) => ({ kind: r.kind, productId: r.productId ?? null, name: r.name.trim(), unit: r.unit.trim() || null, quantity: r.quantity.trim().replace(',', '.'), unitPrice: parseMoney(r.unitPrice), discount: parseMoney(r.discount) }));
}

export function fmtDateTime(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
}
