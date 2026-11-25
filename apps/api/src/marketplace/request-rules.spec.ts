import { canMoveRequest, checkSchedule, voucherDiscount, type VoucherLike } from './request-rules';

const v = (o: Partial<VoucherLike> = {}): VoucherLike => ({
  kind: 'PERCENT',
  value: 10,
  minOrder: 0,
  maxDiscount: null,
  appliesTo: 'ALL',
  startsAt: new Date('2026-01-01'),
  endsAt: new Date('2027-01-01'),
  usageLimit: null,
  active: true,
  ...o,
});
const now = new Date('2026-11-25T03:00:00Z'); // 10:00 thứ 4 giờ VN

describe('Yêu cầu đặt hàng & voucher', () => {
  it('voucher %: giảm theo dòng đúng loại, có trần', () => {
    const lines = [
      { kind: 'PRODUCT', amount: 4_000_000 },
      { kind: 'SERVICE', amount: 500_000 },
    ];
    expect(voucherDiscount(v(), lines, 0, now)).toEqual({ discount: 450_000 });
    expect(voucherDiscount(v({ appliesTo: 'PRODUCT', maxDiscount: 300_000 }), lines, 0, now)).toEqual({ discount: 300_000 });
    expect(voucherDiscount(v({ appliesTo: 'SERVICE' }), [lines[0]!], 0, now)).toMatchObject({ error: expect.stringMatching(/dịch vụ/) });
  });

  it('voucher tiền: không giảm quá giá trị; đơn tối thiểu, hết lượt, hết hạn', () => {
    expect(voucherDiscount(v({ kind: 'AMOUNT', value: 900_000 }), [{ kind: 'SERVICE', amount: 500_000 }], 0, now)).toEqual({ discount: 500_000 });
    expect(voucherDiscount(v({ minOrder: 1_000_000 }), [{ kind: 'PRODUCT', amount: 800_000 }], 0, now)).toMatchObject({ error: expect.stringMatching(/tối thiểu/) });
    expect(voucherDiscount(v({ usageLimit: 3 }), [{ kind: 'PRODUCT', amount: 800_000 }], 3, now)).toMatchObject({ error: expect.stringMatching(/hết lượt/) });
    expect(voucherDiscount(v({ endsAt: new Date('2026-11-01') }), [{ kind: 'PRODUCT', amount: 800_000 }], 0, now)).toMatchObject({ error: expect.stringMatching(/hết hạn/) });
  });

  it('giờ hẹn: sau ít nhất 1 giờ, trong 30 ngày, đúng giờ mở cửa', () => {
    const hours = [
      { day: 3, open: '07:30', close: '17:30', closed: false },
      { day: 0, open: '', close: '', closed: true },
    ];
    expect(checkSchedule(new Date('2026-11-25T03:30:00Z'), hours, now)).toMatch(/1 giờ/);
    expect(checkSchedule(new Date('2026-11-25T07:00:00Z'), hours, now)).toBeNull(); // 14:00 VN
    expect(checkSchedule(new Date('2026-11-25T11:00:00Z'), hours, now)).toMatch(/07:30 – 17:30/);
    expect(checkSchedule(new Date('2026-11-29T03:00:00Z'), hours, now)).toMatch(/nghỉ/); // CN
    expect(checkSchedule(new Date('2027-02-01T03:00:00Z'), [], now)).toMatch(/30 ngày/);
    expect(checkSchedule(new Date('2026-11-26T03:00:00Z'), [], now)).toBeNull();
  });

  it('chuyển trạng thái', () => {
    expect(canMoveRequest('CHO_XAC_NHAN', 'DA_XAC_NHAN')).toBe(true);
    expect(canMoveRequest('CHO_XAC_NHAN', 'HOAN_THANH')).toBe(false);
    expect(canMoveRequest('DA_XAC_NHAN', 'KHONG_DEN')).toBe(true);
    expect(canMoveRequest('HOAN_THANH', 'KHACH_HUY')).toBe(false);
  });
});
