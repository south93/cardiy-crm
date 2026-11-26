import { cleanTransferNote, crc16, vietQrPayload } from './vietqr';

describe('VietQR', () => {
  it('CRC-16/CCITT-FALSE đúng mẫu chuẩn', () => {
    expect(crc16('123456789')).toBe('29B1');
  });

  it('nội dung chuyển khoản bỏ dấu và ký tự lạ', () => {
    expect(cleanTransferNote('Thanh toán DH000123 – Anh Đức!')).toBe('Thanh toan DH000123 Anh Duc');
  });

  it('dựng chuỗi EMVCo: tài khoản, số tiền, nội dung, CRC khớp', () => {
    const p = vietQrPayload({ bin: '970436', accountNo: '0123456789', amount: 5_650_000, note: 'DH000123' });
    expect(p.startsWith('000201010212')).toBe(true);
    expect(p).toContain('38540010A00000072701240006970436011001234567890208QRIBFTTA');
    expect(p).toContain('5303704540756500005802VN');
    expect(p).toContain('62120808DH000123');
    expect(p.slice(-8, -4)).toBe('6304');
    expect(crc16(p.slice(0, -4))).toBe(p.slice(-4));
  });

  it('không có số tiền → mã tĩnh; BIN / số tài khoản sai → lỗi', () => {
    expect(vietQrPayload({ bin: '970436', accountNo: '0123456789' }).startsWith('000201010211')).toBe(true);
    expect(() => vietQrPayload({ bin: '9704', accountNo: '0123456789' })).toThrow('BIN');
    expect(() => vietQrPayload({ bin: '970436', accountNo: '12' })).toThrow('tài khoản');
  });
});
