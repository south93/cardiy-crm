/**
 * Đọc và phân tích file xuất từ AppSheet (khách hàng, xe) thành "kế hoạch nhập".
 * Hàm thuần: không đụng database, để kiểm thử từng quy tắc.
 *
 * Quy tắc chính (đúc kết từ dữ liệu thật của PLG):
 * - Mỗi SĐT là một khách; nhiều dòng cùng SĐT → gộp. SĐT mất số 0 đầu (Excel) → thêm lại.
 * - SĐT không hợp lệ ("123", "0"…) nhưng có biển số → tạo khách không SĐT, nhận diện theo biển.
 * - Ô "Chi tiết xe" có nhiều biển (cách nhau dấu phẩy) → nhiều xe.
 * - Biển đúng mẫu → xe hợp lệ; biển thiếu số → xe "chưa chuẩn"; chữ không phải biển → ghi chú.
 * - Một biển nằm ở nhiều khách → gán khách đầu tiên, báo để kiểm tra.
 */
import { randomUUID } from 'node:crypto';
import { formatPlate, isCivilPlate, normalizePlate, normalizeVin, normalizeVnPhone, searchKey } from '@cardiy/shared';
import { parse } from 'csv-parse/sync';

export type Level = 'error' | 'warning' | 'info';
export interface Issue {
  row: number;
  level: Level;
  message: string;
  value?: string;
}

export type CustomerSourceCode =
  | 'ZALO' | 'FACEBOOK' | 'TIKTOK' | 'GIOI_THIEU' | 'KHACH_CU' | 'VANG_LAI' | 'WEBSITE'
  | 'CUOC_GOI' | 'GARA' | 'CHAM_SOC_XE' | 'DAI_LY' | 'SAN_CARDIY' | 'KHAC';

// ---------------------------------------------------------------- Đọc file

export interface DecodedFile {
  text: string;
  encoding: 'utf-8' | 'windows-1252';
  /** File bảng mã cũ đã mất dấu tiếng Việt (chữ bị thay bằng "?") */
  lossy: boolean;
}

export function decodeFile(buf: Buffer): DecodedFile {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '');
    return { text, encoding: 'utf-8', lossy: false };
  } catch {
    const text = new TextDecoder('windows-1252').decode(buf);
    return { text, encoding: 'windows-1252', lossy: /[A-Za-zÀ-ÿ]\?[A-Za-zÀ-ÿ]/.test(text) };
  }
}

export function parseTable(text: string): { headers: string[]; rows: string[][] } {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = { '\t': 0, ',': 0, ';': 0 };
  for (const ch of firstLine) if (ch in counts) counts[ch as keyof typeof counts]++;
  const delimiter = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ',') as string;
  const records = parse(text, {
    delimiter,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  }) as string[][];
  const [headers = [], ...rows] = records;
  return { headers, rows: rows.filter((r) => r.some((c) => c && c.trim())) };
}

type FieldAliases = Record<string, string[]>;

/** Tìm vị trí cột theo tên (không phân biệt dấu, hoa thường). */
export function mapHeaders(headers: string[], aliases: FieldAliases): Record<string, number> {
  const keys = headers.map((h) => searchKey(h));
  const out: Record<string, number> = {};
  for (const [field, names] of Object.entries(aliases)) {
    const idx = keys.findIndex((k) => names.includes(k));
    if (idx >= 0) out[field] = idx;
  }
  return out;
}

export const CUSTOMER_COLUMNS: FieldAliases = {
  name: ['ten khach hang', 'ho ten', 'ho va ten', 'ten', 'khach hang'],
  phone: ['dien thoai', 'so dien thoai', 'sdt', 'so dt'],
  info: ['thong tin khach hang'],
  address: ['dia chi'],
  email: ['mail', 'email', 'e-mail'],
  representative: ['dai dien', 'nguoi dai dien'],
  position: ['chuc vu'],
  taxCode: ['mst', 'ma so thue'],
  bankAccount: ['stk', 'so tai khoan'],
  bankName: ['ngan hang'],
  createdAt: ['ngay tao'],
  openingDebt: ['cong no ban dau'],
  note: ['ghi chu'],
  source: ['nguon khach hang', 'nguon'],
  branch: ['chi nhanh'],
  plates: ['chi tiet xe', 'bien so', 'bien so xe', 'xe'],
};

export const VEHICLE_COLUMNS: FieldAliases = {
  owner: ['thong tin khach hang', 'khach hang', 'chu xe'],
  plate: ['bien so', 'bien so xe'],
  make: ['hang xe', 'hang'],
  model: ['dong xe', 'dong'],
  year: ['doi xe', 'nam san xuat', 'nam sx'],
  color: ['mau xe', 'mau'],
  vin: ['so vin', 'vin', 'so khung'],
  tireSize: ['size lop', 'co lop', 'kich thuoc lop'],
  km: ['km', 'so km', 'odo'],
  fuel: ['loai nhien lieu', 'nhien lieu'],
  transmission: ['loai hop so', 'hop so'],
  note: ['ghi chu'],
  createdAt: ['ngay tao'],
};

/** File xe AppSheet: có "Biển số" + "Thông tin khách hàng", không có "Tên khách hàng". */
export function detectKind(headers: string[]): 'CUSTOMERS' | 'VEHICLES' | null {
  const c = mapHeaders(headers, CUSTOMER_COLUMNS);
  const v = mapHeaders(headers, VEHICLE_COLUMNS);
  if (c.name !== undefined && c.phone !== undefined) return 'CUSTOMERS';
  if (v.plate !== undefined && v.owner !== undefined) return 'VEHICLES';
  return null;
}

// ---------------------------------------------------------------- Chuẩn hoá giá trị

/** SĐT: thêm lại số 0 đầu bị Excel làm mất ("909735299" → "0909735299"). */
export function importPhone(raw: string): string | null {
  const s = (raw ?? '').replace(/[\s.\-()]/g, '');
  return normalizeVnPhone(/^[35789]\d{8}$/.test(s) ? '0' + s : s);
}

export type PlateClass = { kind: 'valid' | 'partial'; plateNo: string } | { kind: 'text'; text: string };

export function classifyPlate(raw: string): PlateClass {
  const n = normalizePlate(raw);
  if (n && isCivilPlate(n)) return { kind: 'valid', plateNo: n };
  if (n && /^\d{2}[A-Z]/.test(n)) return { kind: 'partial', plateNo: n };
  return { kind: 'text', text: raw.trim() };
}

export function splitPlates(raw: string): string[] {
  return (raw ?? '')
    .split(/[,;/\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function mapSource(raw: string): CustomerSourceCode {
  const k = searchKey(raw ?? '');
  if (!k) return 'KHAC';
  if (k.includes('zalo')) return 'ZALO';
  if (k.includes('facebook') || /\bfb\b/.test(k)) return 'FACEBOOK';
  if (k.includes('tiktok')) return 'TIKTOK';
  if (k.includes('gioi thieu')) return 'GIOI_THIEU';
  if (k.includes('khach cu')) return 'KHACH_CU';
  if (k.includes('vang lai')) return 'VANG_LAI';
  if (k.includes('web')) return 'WEBSITE';
  if (k.includes('cuoc goi') || k.includes('cskh')) return 'CUOC_GOI';
  if (k.includes('cham soc xe')) return 'CHAM_SOC_XE';
  if (k.includes('dai ly')) return 'DAI_LY';
  if (k.includes('gara') || k.includes('garage')) return 'GARA';
  if (k.includes('cardiy') || k.includes('san')) return 'SAN_CARDIY';
  return 'KHAC';
}

/** "500.000" / "1,250,000" → 500000 / 1250000 */
export function parseMoney(raw: string): number {
  const digits = (raw ?? '').replace(/[^\d-]/g, '');
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

/** "11/05/2026" (ngày/tháng/năm) → "2026-05-11" */
export function parseDate(raw: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((raw ?? '').trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (date.getUTCDate() !== Number(d) || date.getUTCMonth() !== Number(mo) - 1) return null;
  return date.toISOString().slice(0, 10);
}

const COMPANY_PREFIX = ['cong ty', 'cty', 'ngan hang', 'dntn', 'htx', 'hop tac xa', 'doanh nghiep'];
export function looksLikeCompany(name: string): boolean {
  const k = searchKey(name);
  return COMPANY_PREFIX.some((p) => k.startsWith(p)) || k.includes(' tnhh') || k.includes('co phan');
}

/** "Anh Huy - 0918750686" → { name: "Anh Huy", phone: "0918750686" } */
export function parseOwner(raw: string): { name: string; phone: string | null } {
  const parts = (raw ?? '').split(' - ').map((s) => s.trim());
  const last = parts[parts.length - 1] ?? '';
  const phone = parts.length > 1 ? importPhone(last) : null;
  const name = (phone ? parts.slice(0, -1) : parts).join(' - ').trim();
  return { name, phone };
}

// ---------------------------------------------------------------- Kế hoạch nhập

export interface ExistingData {
  /** SĐT → id khách đã có */
  customersByPhone: Map<string, string>;
  /** Biển số → xe đã có */
  vehiclesByPlate: Map<string, { id: string; ownerCustomerId: string | null; filled: Record<string, unknown> }>;
  branchCodes: Set<string>;
}

export interface PlannedCustomer {
  ref: string;
  id: string;
  name: string;
  phone: string | null;
  type: 'PERSON' | 'COMPANY';
  email: string | null;
  address: string | null;
  taxCode: string | null;
  representative: string | null;
  note: string | null;
  source: CustomerSourceCode;
  branchCode: string | null;
  createdAt: string | null;
  openingDebt: number;
}

export interface PlannedVehicle {
  id: string;
  plateNo: string;
  plateValid: boolean;
  /** id khách (mới hoặc đã có); null = chưa có chủ */
  ownerId: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  color?: string | null;
  vin?: string | null;
  tireSize?: string | null;
  fuel?: string | null;
  transmission?: string | null;
  note?: string | null;
  km?: number | null;
}

export interface VehicleUpdate {
  vehicleId: string;
  data: Partial<Omit<PlannedVehicle, 'id' | 'plateNo' | 'plateValid' | 'ownerId' | 'km'>>;
  km: number | null;
  setOwnerId: string | null;
}

export interface ImportPlan {
  newCustomers: PlannedCustomer[];
  newVehicles: PlannedVehicle[];
  vehicleUpdates: VehicleUpdate[];
  /** Biển số bổ sung cho khách đã có (theo SĐT) */
  missingBranchCodes: string[];
}

export interface ImportSummary {
  rows: number;
  newCustomers: number;
  existingCustomers: number;
  mergedRows: number;
  customersWithoutPhone: number;
  newVehicles: number;
  partialPlates: number;
  updatedVehicles: number;
  skippedRows: number;
  errors: number;
  warnings: number;
}

export interface AnalyzeResult {
  plan: ImportPlan;
  summary: ImportSummary;
  issues: Issue[];
}

const cell = (row: string[], idx: number | undefined) => (idx === undefined ? '' : (row[idx] ?? '').trim());
const orNull = (s: string) => (s ? s : null);

function emptySummary(rows: number): ImportSummary {
  return { rows, newCustomers: 0, existingCustomers: 0, mergedRows: 0, customersWithoutPhone: 0, newVehicles: 0, partialPlates: 0, updatedVehicles: 0, skippedRows: 0, errors: 0, warnings: 0 };
}

function finish(plan: ImportPlan, summary: ImportSummary, issues: Issue[]): AnalyzeResult {
  summary.errors = issues.filter((i) => i.level === 'error').length;
  summary.warnings = issues.filter((i) => i.level === 'warning').length;
  return { plan, summary, issues };
}

/** Phân tích file khách hàng AppSheet. */
export function analyzeCustomers(headers: string[], rows: string[][], existing: ExistingData): AnalyzeResult {
  const col = mapHeaders(headers, CUSTOMER_COLUMNS);
  const issues: Issue[] = [];
  const summary = emptySummary(rows.length);
  const byPhone = new Map<string, PlannedCustomer>();
  const customers: PlannedCustomer[] = [];
  const platesOf = new Map<string, { plates: PlateClass[]; row: number }[]>(); // ref → biển
  const existingTouched = new Set<string>();

  rows.forEach((row, i) => {
    const line = i + 2; // dòng trong file (dòng 1 là tiêu đề)
    const rawPhone = cell(row, col.phone);
    const phone = importPhone(rawPhone);
    const infoName = cell(row, col.info).split(' - ')[0]?.trim() ?? '';
    const name = cell(row, col.name) || infoName;
    const plates = splitPlates(cell(row, col.plates)).map(classifyPlate);
    const hasPlate = plates.some((p) => p.kind !== 'text');

    if (!name && !phone && !hasPlate) {
      summary.skippedRows++;
      issues.push({ row: line, level: 'error', message: 'Dòng không có tên, SĐT, biển số: bỏ qua' });
      return;
    }

    // Khách đã có trong hệ thống (theo SĐT): chỉ bổ sung xe
    if (phone && existing.customersByPhone.has(phone)) {
      const id = existing.customersByPhone.get(phone)!;
      if (!existingTouched.has(id)) summary.existingCustomers++;
      existingTouched.add(id);
      platesOf.set(id, [...(platesOf.get(id) ?? []), { plates, row: line }]);
      return;
    }

    // Khách không SĐT: nhận diện theo biển số đã có trong hệ thống (nhập lại file không tạo trùng)
    if (!phone && hasPlate) {
      const ownerId = plates
        .map((p) => (p.kind === 'text' ? undefined : existing.vehiclesByPlate.get(p.plateNo)?.ownerCustomerId))
        .find((id): id is string => !!id);
      if (ownerId) {
        if (!existingTouched.has(ownerId)) summary.existingCustomers++;
        existingTouched.add(ownerId);
        platesOf.set(ownerId, [...(platesOf.get(ownerId) ?? []), { plates, row: line }]);
        return;
      }
    }

    if (!phone && !hasPlate) {
      summary.skippedRows++;
      issues.push({ row: line, level: 'error', message: `SĐT không hợp lệ và không có biển số: bỏ qua (${name})`, value: rawPhone });
      return;
    }

    const bankAccount = cell(row, col.bankAccount);
    const bankName = cell(row, col.bankName);
    const position = cell(row, col.position);
    const notes = [
      cell(row, col.note),
      bankAccount ? `STK: ${bankAccount}${bankName ? ` (${bankName})` : ''}` : '',
      position ? `Chức vụ: ${position}` : '',
      ...plates.filter((p): p is { kind: 'text'; text: string } => p.kind === 'text').map((p) => `Ghi chú xe cũ: ${p.text}`),
    ].filter(Boolean);

    const data: PlannedCustomer = {
      ref: phone ?? `dong-${line}`,
      id: randomUUID(),
      name: name || 'Khách chưa có tên',
      phone,
      type: looksLikeCompany(name) ? 'COMPANY' : 'PERSON',
      email: orNull(cell(row, col.email)),
      address: orNull(cell(row, col.address)),
      taxCode: orNull(cell(row, col.taxCode)),
      representative: orNull(cell(row, col.representative)),
      note: notes.length ? notes.join('\n') : null,
      source: mapSource(cell(row, col.source)),
      branchCode: orNull(cell(row, col.branch).toUpperCase()),
      createdAt: parseDate(cell(row, col.createdAt)),
      openingDebt: parseMoney(cell(row, col.openingDebt)),
    };

    plates
      .filter((p): p is { kind: 'text'; text: string } => p.kind === 'text')
      .forEach((p) => issues.push({ row: line, level: 'warning', message: `"${p.text}" không phải biển số: chuyển vào ghi chú khách`, value: p.text }));

    if (!phone) {
      summary.customersWithoutPhone++;
      issues.push({ row: line, level: 'warning', message: `SĐT không hợp lệ: tạo khách không SĐT, nhận diện theo biển số (${data.name})`, value: rawPhone });
    }

    const dup = phone ? byPhone.get(phone) : undefined;
    if (dup) {
      // Gộp: giữ giá trị dòng đầu, điền thêm chỗ trống
      summary.mergedRows++;
      for (const k of ['email', 'address', 'taxCode', 'representative', 'branchCode', 'createdAt'] as const) {
        if (!dup[k] && data[k]) dup[k] = data[k];
      }
      if (data.note) dup.note = [dup.note, data.note].filter(Boolean).join('\n');
      if (!dup.openingDebt && data.openingDebt) dup.openingDebt = data.openingDebt;
      if (data.name && searchKey(data.name) !== searchKey(dup.name)) {
        issues.push({ row: line, level: 'info', message: `Cùng SĐT ${phone} với tên "${dup.name}": gộp, tên "${data.name}" ghi vào ghi chú` });
        dup.note = [dup.note, `Tên khác: ${data.name}`].filter(Boolean).join('\n');
      }
      platesOf.set(dup.id, [...(platesOf.get(dup.id) ?? []), { plates, row: line }]);
      return;
    }

    if (phone) byPhone.set(phone, data);
    customers.push(data);
    platesOf.set(data.id, [{ plates, row: line }]);
  });

  // Xe
  const newVehicles: PlannedVehicle[] = [];
  const plateOwner = new Map<string, string>(); // biển → id khách trong file
  for (const [ownerId, entries] of platesOf) {
    for (const { plates, row } of entries) {
      for (const p of plates) {
        if (p.kind === 'text') continue;
        const ex = existing.vehiclesByPlate.get(p.plateNo);
        if (ex) {
          if (ex.ownerCustomerId && ex.ownerCustomerId !== ownerId) {
            issues.push({ row, level: 'warning', message: `Biển ${formatPlate(p.plateNo)} đã thuộc khách khác trong hệ thống: không đổi chủ`, value: p.plateNo });
          }
          continue;
        }
        const first = plateOwner.get(p.plateNo);
        if (first) {
          if (first !== ownerId) issues.push({ row, level: 'warning', message: `Biển ${formatPlate(p.plateNo)} ghi ở nhiều khách: đã gán cho khách đầu tiên, cần kiểm tra`, value: p.plateNo });
          continue;
        }
        plateOwner.set(p.plateNo, ownerId);
        if (p.kind === 'partial') {
          summary.partialPlates++;
          issues.push({ row, level: 'warning', message: `Biển "${p.plateNo}" chưa đúng mẫu (thiếu số?): vẫn nhập, đánh dấu cần xem lại`, value: p.plateNo });
        }
        newVehicles.push({ id: randomUUID(), plateNo: p.plateNo, plateValid: p.kind === 'valid', ownerId });
      }
    }
  }

  summary.newCustomers = customers.length;
  summary.newVehicles = newVehicles.length;
  const missingBranchCodes = [...new Set(customers.map((c) => c.branchCode).filter((b): b is string => !!b && !existing.branchCodes.has(b)))].sort();
  return finish({ newCustomers: customers, newVehicles, vehicleUpdates: [], missingBranchCodes }, summary, issues);
}

/** Phân tích file xe AppSheet (bổ sung hãng, dòng, đời, VIN, km… và chủ xe). */
export function analyzeVehicles(headers: string[], rows: string[][], existing: ExistingData): AnalyzeResult {
  const col = mapHeaders(headers, VEHICLE_COLUMNS);
  const issues: Issue[] = [];
  const summary = emptySummary(rows.length);
  const newCustomers = new Map<string, PlannedCustomer>();
  const newVehicles: PlannedVehicle[] = [];
  const vehicleUpdates: VehicleUpdate[] = [];
  const seen = new Set<string>();

  rows.forEach((row, i) => {
    const line = i + 2;
    const plate = classifyPlate(cell(row, col.plate));
    if (plate.kind === 'text') {
      summary.skippedRows++;
      issues.push({ row: line, level: 'error', message: 'Không có biển số hợp lệ: bỏ qua', value: cell(row, col.plate) });
      return;
    }
    if (seen.has(plate.plateNo)) {
      summary.skippedRows++;
      issues.push({ row: line, level: 'warning', message: `Biển ${formatPlate(plate.plateNo)} lặp lại trong file: bỏ qua dòng sau`, value: plate.plateNo });
      return;
    }
    seen.add(plate.plateNo);

    const yearNum = Number(cell(row, col.year).replace(/\D/g, ''));
    const kmNum = parseMoney(cell(row, col.km));
    const rawVin = cell(row, col.vin);
    const vin = rawVin ? normalizeVin(rawVin) : null;
    if (rawVin && !vin) issues.push({ row: line, level: 'warning', message: `Số VIN "${rawVin}" không đúng 17 ký tự: ghi vào ghi chú`, value: rawVin });
    const details = {
      make: orNull(cell(row, col.make)),
      model: orNull(cell(row, col.model)),
      year: yearNum >= 1950 && yearNum <= 2100 ? yearNum : null,
      color: orNull(cell(row, col.color)),
      vin,
      tireSize: orNull(cell(row, col.tireSize)),
      fuel: orNull(cell(row, col.fuel)),
      transmission: orNull(cell(row, col.transmission)),
      note: orNull([cell(row, col.note), rawVin && !vin ? `VIN cũ: ${rawVin}` : ''].filter(Boolean).join('\n')),
    };
    const km = kmNum > 0 ? kmNum : null;

    // Chủ xe
    const owner = parseOwner(cell(row, col.owner));
    let ownerId: string | null = null;
    if (owner.phone && existing.customersByPhone.has(owner.phone)) ownerId = existing.customersByPhone.get(owner.phone)!;
    else if (owner.phone || owner.name) {
      const ref = owner.phone ?? `dong-${line}`;
      let c = newCustomers.get(ref);
      if (!c) {
        c = {
          ref, id: randomUUID(), name: owner.name || 'Khách chưa có tên', phone: owner.phone, type: looksLikeCompany(owner.name) ? 'COMPANY' : 'PERSON',
          email: null, address: null, taxCode: null, representative: null, note: null, source: 'KHAC', branchCode: null,
          createdAt: parseDate(cell(row, col.createdAt)), openingDebt: 0,
        };
        newCustomers.set(ref, c);
        if (!owner.phone) {
          summary.customersWithoutPhone++;
          issues.push({ row: line, level: 'warning', message: `Chủ xe "${owner.name}" không có SĐT hợp lệ: tạo khách không SĐT` });
        }
      }
      ownerId = c.id;
    }

    const ex = existing.vehiclesByPlate.get(plate.plateNo);
    if (ex) {
      // Chỉ điền chỗ còn trống, không ghi đè dữ liệu đã có
      const data: VehicleUpdate['data'] = {};
      for (const [k, v] of Object.entries(details)) if (v !== null && (ex.filled[k] === null || ex.filled[k] === undefined)) (data as Record<string, unknown>)[k] = v;
      let setOwnerId: string | null = null;
      if (ownerId && !ex.ownerCustomerId) setOwnerId = ownerId;
      else if (ownerId && ex.ownerCustomerId !== ownerId) {
        issues.push({ row: line, level: 'warning', message: `Biển ${formatPlate(plate.plateNo)} đang thuộc khách khác: không đổi chủ tự động`, value: plate.plateNo });
      }
      if (Object.keys(data).length || km || setOwnerId) {
        vehicleUpdates.push({ vehicleId: ex.id, data, km, setOwnerId });
        summary.updatedVehicles++;
      }
      return;
    }
    if (plate.kind === 'partial') {
      summary.partialPlates++;
      issues.push({ row: line, level: 'warning', message: `Biển "${plate.plateNo}" chưa đúng mẫu: vẫn nhập, đánh dấu cần xem lại`, value: plate.plateNo });
    }
    newVehicles.push({ id: randomUUID(), plateNo: plate.plateNo, plateValid: plate.kind === 'valid', ownerId, ...details, km });
  });

  summary.newCustomers = newCustomers.size;
  summary.newVehicles = newVehicles.length;
  return finish({ newCustomers: [...newCustomers.values()], newVehicles, vehicleUpdates, missingBranchCodes: [] }, summary, issues);
}
