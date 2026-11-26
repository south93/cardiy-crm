import { buildTemplateData, decrypt, encrypt, zaloPhone } from './zalo-rules';

describe('Zalo ZNS', () => {
  it('số điện thoại theo định dạng Zalo', () => {
    expect(zaloPhone('0912 345 678')).toBe('84912345678');
    expect(zaloPhone('+84912345678')).toBe('84912345678');
    expect(zaloPhone('123')).toBeNull();
    expect(zaloPhone(null)).toBeNull();
  });

  it('ghép tham số mẫu: số có dấu chấm, thiếu dữ liệu thì báo', () => {
    const r = buildTemplateData(
      [
        { name: 'ten_khach', source: 'customer_name' },
        { name: 'so_tien', source: 'order_total' },
        { name: 'bien_so', source: 'plate' },
      ],
      { customer_name: 'Anh Nam', order_total: 1_250_000 },
    );
    expect(r.data).toEqual({ ten_khach: 'Anh Nam', so_tien: '1.250.000' });
    expect(r.missing).toEqual(['bien_so (Biển số xe)']);
  });

  it('mã hoá token: giải mã đúng khoá, sai khoá thì lỗi', () => {
    const box = encrypt('refresh-token-gia-123', 'k'.repeat(40));
    expect(box).not.toContain('refresh');
    expect(decrypt(box, 'k'.repeat(40))).toBe('refresh-token-gia-123');
    expect(() => decrypt(box, 'x'.repeat(40))).toThrow();
  });
});
