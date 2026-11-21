/** Đọc số tiền (đồng) thành chữ tiếng Việt, dùng trên báo giá / hoá đơn. */
const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
const UNITS = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];

/** Đọc một nhóm 3 chữ số. `full`: nhóm không đứng đầu thì đọc đủ "không trăm", "lẻ". */
function readTriple(n: number, full: boolean): string {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  const out: string[] = [];
  if (h > 0 || full) out.push(DIGITS[h]!, 'trăm');
  if (t > 1) {
    out.push(DIGITS[t]!, 'mươi');
    if (u === 1) out.push('mốt');
    else if (u === 4) out.push('tư');
    else if (u === 5) out.push('lăm');
    else if (u > 0) out.push(DIGITS[u]!);
  } else if (t === 1) {
    out.push('mười');
    if (u === 5) out.push('lăm');
    else if (u > 0) out.push(DIGITS[u]!);
  } else if (u > 0) {
    if (h > 0 || full) out.push('lẻ');
    out.push(DIGITS[u]!);
  }
  return out.join(' ');
}

export function moneyToWords(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError('Số tiền không hợp lệ');
  if (amount === 0) return 'Không đồng';
  const groups: number[] = [];
  for (let n = amount; n > 0; n = Math.floor(n / 1000)) groups.push(n % 1000);
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    if (g === 0) continue;
    const first = i === groups.length - 1;
    parts.push(readTriple(g, !first), UNITS[i]!);
  }
  const s = parts.filter(Boolean).join(' ') + ' đồng';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
