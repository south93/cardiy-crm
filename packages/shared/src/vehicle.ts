/**
 * Biển số xe Việt Nam.
 * - Lưu dạng chuẩn hoá (khoá so trùng): chữ in hoa, chỉ chữ + số. VD "30A12345".
 * - Hiển thị dạng quen thuộc: "30A-123.45", "51F-2223", "29H1-123.45".
 * Chấp nhận người dùng gõ: "30a-123.45", "30A 12345", "30A.123.45"…
 */

/**
 * Mẫu biển dân sự: 2 số tỉnh + seri 1–2 chữ (có thể kèm 1 số) + 4–5 số.
 * Thử theo thứ tự ưu tiên đuôi 5 số để "30A12345" ra "30A-123.45" (không phải "30A1-2345").
 */
const CIVIL_PATTERNS = [
  /^(\d{2})([A-Z]{1,2})(\d{5})$/,
  /^(\d{2})([A-Z]{1,2}\d)(\d{5})$/,
  /^(\d{2})([A-Z]{1,2})(\d{4})$/,
  /^(\d{2})([A-Z]{1,2}\d)(\d{4})$/,
];

function matchCivil(normalized: string): RegExpExecArray | null {
  for (const re of CIVIL_PATTERNS) {
    const m = re.exec(normalized);
    if (m) return m;
  }
  return null;
}

/** Chuẩn hoá để so trùng. Trả về null nếu rỗng hoặc độ dài vô lý. */
export function normalizePlate(input: string): string | null {
  const s = input
    .normalize('NFKC')
    .toUpperCase()
    .replace(/Đ/g, 'D')
    .replace(/[^A-Z0-9]/g, '');
  return s.length >= 5 && s.length <= 12 ? s : null;
}

/** Biển có đúng mẫu biển dân sự không (biển ngoại giao, quân đội vẫn lưu được nhưng không định dạng). */
export function isCivilPlate(normalized: string): boolean {
  return matchCivil(normalized) !== null;
}

/** Định dạng hiển thị: "30A12345" → "30A-123.45", "51F2223" → "51F-2223". */
export function formatPlate(normalized: string): string {
  const m = matchCivil(normalized);
  if (!m) return normalized;
  const [, province, series, num] = m;
  const tail = num!.length === 5 ? `${num!.slice(0, 3)}.${num!.slice(3)}` : num!;
  return `${province}${series}-${tail}`;
}

/** Số VIN: 17 ký tự, chữ + số, không có I, O, Q. */
export function normalizeVin(input: string): string | null {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(s) ? s : null;
}
