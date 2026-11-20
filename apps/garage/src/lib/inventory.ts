import type { Tone } from '@cardiy/ui';
import type { ItemKind } from './orders';

export interface Category {
  id: string;
  name: string;
  count: number;
  children: { id: string; name: string; count: number }[];
}

export interface ProductRow {
  id: string;
  code: string;
  name: string;
  kind: ItemKind;
  brand: string | null;
  unit: string | null;
  category: { id: string; name: string } | null;
  salePrice: number;
  costPrice: number | null;
  vehicleMakes: string[];
  active: boolean;
  minStock: number | null;
  mfgMonth: number | null;
  mfgYear: number | null;
  stock: number | null;
}

export type DocType = 'NHAP' | 'CHUYEN' | 'DIEU_CHINH';
export const DOC_TYPES: Record<DocType, { label: string; tone: Tone; title: string }> = {
  NHAP: { label: 'Nhập hàng', tone: 'mint', title: 'Phiếu nhập hàng' },
  CHUYEN: { label: 'Chuyển kho', tone: 'sky', title: 'Phiếu chuyển kho' },
  DIEU_CHINH: { label: 'Kiểm kê', tone: 'peach', title: 'Phiếu kiểm kê (điều chỉnh tồn)' },
};

export const MOVE_KINDS: Record<string, string> = {
  NHAP_HANG: 'Nhập hàng',
  XUAT_BAN: 'Xuất bán',
  CHUYEN_DI: 'Chuyển đi',
  CHUYEN_DEN: 'Chuyển đến',
  DIEU_CHINH: 'Kiểm kê',
};

/** Tháng / năm sản xuất: "09/2026" hoặc "2026" */
export const fmtMfg = (m: number | null | undefined, y: number | null | undefined) => (y ? (m ? `${String(m).padStart(2, '0')}/${y}` : String(y)) : null);

export const fmtQty = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('vi-VN', { maximumFractionDigits: 2 }));
