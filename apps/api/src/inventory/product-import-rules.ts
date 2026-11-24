/**
 * Nhập danh mục sản phẩm + tồn đầu kỳ từ file Excel AppSheet ("NEW KHO 3 CHI NHÁNH").
 * Hàm thuần (không đụng CSDL) để test riêng. Dùng 2 sheet:
 *  - "SẢN PHẨM": danh mục gốc (mã, tên, loại hàng, nhóm hàng, hãng, ĐVT, giá bán = giá Bình Phước, giá nhập, tồn tối thiểu)
 *  - "BANG_GIA_3CN": giá BD / BP / VAT và tồn hiện tại từng chi nhánh (TON_CN1, TON_CN2, TON_CN3)
 *  - "LO DATE" (tuỳ chọn): giá vốn theo lô → giá vốn bình quân khi sheet SẢN PHẨM không có giá nhập
 */
import type { Issue } from '../imports/appsheet';

export type Cell = string | number | boolean | Date | null | undefined;
export type SheetRow = Record<string, Cell>;

/** Tồn lớn hơn mức này coi là nhập nhầm (VD 349.999 bộ bố thắng): không nhập, đưa vào danh sách cần xem lại */
export const ABNORMAL_QTY = 10_000;
/** Tên nhóm hàng dễ đọc cho các mã nhóm của AppSheet; mã khác giữ nguyên */
export const GROUP_NAMES: Record<string, string> = {
  LX: 'Lốp xe',
  PTSC: 'Phụ tùng sửa chữa',
  PTBD: 'Phụ tùng bảo dưỡng',
  DV: 'Dịch vụ',
  KM: 'Khuyến mãi',
  MÂM: 'Mâm xe',
};

export interface PlannedProduct {
  code: string;
  name: string;
  kind: 'PHU_TUNG' | 'DICH_VU';
  brand: string | null;
  unit: string | null;
  salePrice: number;
  salePriceBd: number | null;
  vatPrice: number | null;
  costPrice: number;
  minStock: number | null;
  group: string | null;
  subgroup: string | null;
  existingId: string | null;
}
export interface PlannedStock {
  branchCode: string;
  code: string;
  qty: number;
}
export interface ProductImportPlan {
  products: PlannedProduct[];
  stock: PlannedStock[];
  groups: { name: string; children: string[] }[];
}
export interface ProductImportSummary {
  rows: number;
  products: number;
  newProducts: number;
  updatedProducts: number;
  services: number;
  noPrice: number;
  duplicates: number;
  skipped: number;
  groups: number;
  stock: Record<string, { items: number; qty: number }>;
  negativeZeroed: number;
  abnormalSkipped: number;
  missingBranchCodes: string[];
}
export interface ExistingProducts {
  byCode: Map<string, { id: string; kind: 'PHU_TUNG' | 'DICH_VU'; hasMoves: boolean }>;
  branchCodes: Set<string>;
}

const str = (v: Cell): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number' && Number.isInteger(v)) return String(v);
  return String(v).replace(/\s+/g, ' ').trim();
};
/** Mã hàng: Excel hay lưu mã toàn số thành số thực (691314.0) → "691314"; CRM lưu mã chữ in hoa */
export const productCode = (v: Cell) => str(v).toUpperCase();
const money = (v: Cell): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
const qty = (v: Cell): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
/** "cái" → "Cái", "SỢI" → "Sợi" */
const unitOf = (v: Cell) => {
  const s = str(v).toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : null;
};
/** "KUMHO" → "Kumho" (chỉ dùng khi sheet SẢN PHẨM không có hãng) */
const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const isUnnamed = (name: string) => !name || /CHƯA CÓ TÊN/i.test(name);

/** Giá vốn bình quân theo lô (gia_von, trọng số = sl_trong_kho; không còn tồn thì bình quân thường) */
export function lotCosts(lots: SheetRow[]) {
  const acc = new Map<string, { w: number; sum: number; n: number; plain: number }>();
  for (const r of lots) {
    const code = productCode(r.ma_sp);
    const cost = money(r.gia_von);
    if (!code || !cost) continue;
    const q = Math.max(0, qty(r.sl_trong_kho) ?? 0);
    const a = acc.get(code) ?? { w: 0, sum: 0, n: 0, plain: 0 };
    a.w += q;
    a.sum += q * cost;
    a.n++;
    a.plain += cost;
    acc.set(code, a);
  }
  return new Map([...acc].map(([c, a]) => [c, Math.round(a.w > 0 ? a.sum / a.w : a.plain / a.n)]));
}

export function analyzeProductWorkbook(sp: SheetRow[], bg: SheetRow[], existing: ExistingProducts, lots: SheetRow[] = []) {
  const lotCost = lotCosts(lots);
  const issues: Issue[] = [];
  const issue = (sheet: string, row: number, level: Issue['level'], message: string, value?: string) => issues.push({ row, level, message: `[${sheet}] ${message}`, value });

  // Bảng giá & tồn theo mã
  const price = new Map<string, { row: number; r: SheetRow }>();
  bg.forEach((r, i) => {
    const code = productCode(r.MA_HANG);
    if (code && !price.has(code)) price.set(code, { row: i + 2, r });
  });

  const products = new Map<string, PlannedProduct>();
  let duplicates = 0;
  let skipped = 0;
  const add = (p: Omit<PlannedProduct, 'existingId'>, sheet: string, row: number) => {
    const ex = existing.byCode.get(p.code);
    let kind = p.kind;
    if (ex && ex.kind !== kind && ex.hasMoves) {
      issue(sheet, row, 'warning', 'Sản phẩm đã có xuất nhập kho trong CRM, giữ nguyên loại hàng hoá / dịch vụ cũ', p.code);
      kind = ex.kind;
    }
    products.set(p.code, { ...p, kind, existingId: ex?.id ?? null });
  };

  sp.forEach((r, i) => {
    const row = i + 2;
    const code = productCode(r.ma_sp);
    const name = str(r.ten_sp);
    if (!code && !name) return;
    if (!code || isUnnamed(name)) {
      skipped++;
      issue('SẢN PHẨM', row, 'error', !code ? 'Thiếu mã hàng, bỏ qua' : 'Thiếu tên hàng, bỏ qua', code || name);
      return;
    }
    if (products.has(code)) {
      duplicates++;
      issue('SẢN PHẨM', row, 'warning', 'Mã hàng bị trùng, chỉ lấy dòng đầu tiên', code);
      return;
    }
    const b = price.get(code)?.r;
    const kind = /dịch vụ/i.test(str(r.loai_hang)) ? 'DICH_VU' : 'PHU_TUNG';
    const bp = money(r.gia_ban) ?? money(b?.GIA_BP) ?? money(b?.GIA_BD);
    const group = str(r.nhom_hang) || str(b?.NHOM) || null;
    const sub = str(r.nhom_hang_1);
    add(
      {
        code,
        name,
        kind,
        brand: str(r.hang) || (str(b?.HANG) ? titleCase(str(b?.HANG)) : null),
        unit: unitOf(r.dvt) ?? unitOf(b?.DVT),
        salePrice: bp ?? 0,
        salePriceBd: money(b?.GIA_BD),
        vatPrice: money(b?.GIA_VAT),
        costPrice: money(r.gia_nhap_ht) ?? money(r.gia_nhap_tay) ?? lotCost.get(code) ?? 0,
        minStock: (qty(r.ton_min) ?? 0) > 0 ? qty(r.ton_min) : null,
        group: group ? (GROUP_NAMES[group] ?? group) : null,
        subgroup: sub && sub !== group ? sub : null,
      },
      'SẢN PHẨM',
      row,
    );
  });

  // Mã chỉ có trong bảng giá (chưa có trong sheet SẢN PHẨM)
  for (const [code, { row, r }] of price) {
    if (products.has(code)) continue;
    const name = str(r.TEN_HANG);
    if (isUnnamed(name)) {
      skipped++;
      issue('BANG_GIA_3CN', row, 'error', 'Mã chưa có tên hàng, bỏ qua', code);
      continue;
    }
    const group = str(r.NHOM);
    issue('BANG_GIA_3CN', row, 'info', 'Mã có trong bảng giá nhưng không có ở sheet SẢN PHẨM: vẫn nhập theo bảng giá', code);
    add(
      {
        code,
        name,
        kind: /^DV/i.test(group) ? 'DICH_VU' : 'PHU_TUNG',
        brand: str(r.HANG) ? titleCase(str(r.HANG)) : null,
        unit: unitOf(r.DVT),
        salePrice: money(r.GIA_BP) ?? money(r.GIA_BD) ?? 0,
        salePriceBd: money(r.GIA_BD),
        vatPrice: money(r.GIA_VAT),
        costPrice: lotCost.get(code) ?? 0,
        minStock: null,
        group: group && !/CHƯA CÓ SP/i.test(group) ? (GROUP_NAMES[group] ?? group) : null,
        subgroup: null,
      },
      'BANG_GIA_3CN',
      row,
    );
  }

  const noPrice = [...products.values()].filter((p) => !p.salePrice).length;
  if (noPrice) issues.push({ row: 0, level: 'info', message: `${noPrice} mã chưa có giá bán: nhập giá 0, bổ sung sau trong Danh mục sản phẩm` });

  // Tồn hiện tại từng chi nhánh → tồn đầu kỳ (chỉ hàng hoá)
  const stock: PlannedStock[] = [];
  const stockSum: Record<string, { items: number; qty: number }> = {};
  const missingBranchCodes = new Set<string>();
  let negativeZeroed = 0;
  let abnormalSkipped = 0;
  for (const [code, { row, r }] of price) {
    const p = products.get(code);
    if (!p || p.kind !== 'PHU_TUNG') continue;
    for (const col of Object.keys(r)) {
      const m = /^TON_(CN\d+)$/i.exec(col);
      if (!m) continue;
      const branchCode = m[1]!.toUpperCase();
      const q = qty(r[col]);
      if (q === null || q === 0) continue;
      if (!existing.branchCodes.has(branchCode)) {
        missingBranchCodes.add(branchCode);
        continue;
      }
      if (q < 0) {
        negativeZeroed++;
        issue('BANG_GIA_3CN', row, 'warning', `Tồn âm ở ${branchCode} (${q}): nhập tồn 0, cần kiểm kê lại`, code);
        continue;
      }
      if (q > ABNORMAL_QTY) {
        abnormalSkipped++;
        issue('BANG_GIA_3CN', row, 'warning', `Tồn ${branchCode} = ${q.toLocaleString('vi-VN')} bất thường, không nhập — kiểm tra lại số đếm`, code);
        continue;
      }
      stock.push({ branchCode, code, qty: q });
      stockSum[branchCode] ??= { items: 0, qty: 0 };
      stockSum[branchCode].items++;
      stockSum[branchCode].qty = Math.round((stockSum[branchCode].qty + q) * 100) / 100;
    }
  }
  for (const c of missingBranchCodes) issues.push({ row: 0, level: 'warning', message: `Chi nhánh ${c} chưa có trong CRM: bỏ qua tồn của chi nhánh này` });

  // Nhóm hàng (cha) → nhóm con
  const groupMap = new Map<string, Set<string>>();
  for (const p of products.values()) {
    if (!p.group) continue;
    if (!groupMap.has(p.group)) groupMap.set(p.group, new Set());
    if (p.subgroup) groupMap.get(p.group)!.add(p.subgroup);
  }
  const groups = [...groupMap].map(([name, children]) => ({ name, children: [...children].sort() })).sort((x, y) => x.name.localeCompare(y.name, 'vi'));

  const list = [...products.values()];
  const summary: ProductImportSummary = {
    rows: sp.length,
    products: list.length,
    newProducts: list.filter((p) => !p.existingId).length,
    updatedProducts: list.filter((p) => p.existingId).length,
    services: list.filter((p) => p.kind === 'DICH_VU').length,
    noPrice,
    duplicates,
    skipped,
    groups: groups.length,
    stock: stockSum,
    negativeZeroed,
    abnormalSkipped,
    missingBranchCodes: [...missingBranchCodes],
  };
  return { plan: { products: list, stock, groups } satisfies ProductImportPlan, summary, issues };
}
