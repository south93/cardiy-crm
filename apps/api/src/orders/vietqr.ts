/**
 * Mã VietQR chuyển khoản (chuẩn EMVCo của NAPAS) — tự tạo, không gọi dịch vụ ngoài.
 * Khách quét bằng app ngân hàng: điền sẵn tài khoản, số tiền, nội dung (mã đơn).
 * Tiền khách chuyển thẳng vào tài khoản của garage.
 */

/** Ngân hàng phổ biến: mã BIN NAPAS. Ngân hàng khác nhập BIN tay trong Cài đặt. */
export const BANKS: { bin: string; code: string; name: string }[] = [
  { bin: '970436', code: 'VCB', name: 'Vietcombank' },
  { bin: '970415', code: 'CTG', name: 'VietinBank' },
  { bin: '970418', code: 'BIDV', name: 'BIDV' },
  { bin: '970405', code: 'AGRIBANK', name: 'Agribank' },
  { bin: '970407', code: 'TCB', name: 'Techcombank' },
  { bin: '970422', code: 'MB', name: 'MB Bank' },
  { bin: '970416', code: 'ACB', name: 'ACB' },
  { bin: '970432', code: 'VPB', name: 'VPBank' },
  { bin: '970423', code: 'TPB', name: 'TPBank' },
  { bin: '970403', code: 'STB', name: 'Sacombank' },
  { bin: '970437', code: 'HDB', name: 'HDBank' },
  { bin: '970441', code: 'VIB', name: 'VIB' },
  { bin: '970443', code: 'SHB', name: 'SHB' },
  { bin: '970448', code: 'OCB', name: 'OCB' },
  { bin: '970426', code: 'MSB', name: 'MSB' },
  { bin: '970440', code: 'SEAB', name: 'SeABank' },
  { bin: '970431', code: 'EIB', name: 'Eximbank' },
  { bin: '970449', code: 'LPB', name: 'LPBank' },
];

const tlv = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`;

/** CRC-16/CCITT-FALSE (poly 0x1021, khởi tạo 0xFFFF) theo chuẩn EMVCo */
export function crc16(s: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(s, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Nội dung chuyển khoản: chỉ chữ không dấu, số, khoảng trắng (app ngân hàng hay lỗi với ký tự khác) */
export function cleanTransferNote(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D'))
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50);
}

export function vietQrPayload(opts: { bin: string; accountNo: string; amount?: number; note?: string }): string {
  if (!/^\d{6}$/.test(opts.bin)) throw new RangeError('Mã BIN ngân hàng gồm 6 chữ số');
  if (!/^[0-9A-Za-z]{4,19}$/.test(opts.accountNo)) throw new RangeError('Số tài khoản không hợp lệ');
  const merchant = tlv('00', 'A000000727') + tlv('01', tlv('00', opts.bin) + tlv('01', opts.accountNo)) + tlv('02', 'QRIBFTTA');
  const amount = opts.amount && opts.amount > 0 ? tlv('54', String(Math.round(opts.amount))) : '';
  const note = opts.note ? cleanTransferNote(opts.note) : '';
  const body =
    tlv('00', '01') +
    tlv('01', amount ? '12' : '11') + // 12: mã dùng một lần (có số tiền); 11: mã tĩnh
    tlv('38', merchant) +
    tlv('53', '704') + // VND
    amount +
    tlv('58', 'VN') +
    (note ? tlv('62', tlv('08', note)) : '') +
    '6304';
  return body + crc16(body);
}
