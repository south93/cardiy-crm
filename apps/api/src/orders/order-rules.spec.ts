import { lineAmount, orderTotals, paymentState, quantityHundredths, transitionError } from './order-rules';

describe('Luật đơn hàng', () => {
  it('số lượng: tối đa 2 số lẻ, dấu phẩy hoặc chấm, phải > 0', () => {
    expect(quantityHundredths('1')).toBe(100);
    expect(quantityHundredths('1,5')).toBe(150);
    expect(quantityHundredths(0.25)).toBe(25);
    expect(quantityHundredths('0')).toBeNull();
    expect(quantityHundredths('1.234')).toBeNull();
    expect(quantityHundredths('-1')).toBeNull();
    expect(quantityHundredths('abc')).toBeNull();
  });

  it('thành tiền dòng: làm tròn đồng, trừ giảm giá dòng', () => {
    expect(lineAmount({ quantity: 4, unitPrice: 1_850_000 })).toBe(7_400_000);
    expect(lineAmount({ quantity: '4.5', unitPrice: 135_000, discount: 7_500 })).toBe(600_000);
    expect(lineAmount({ quantity: '0.33', unitPrice: 10_001 })).toBe(3_300);
    expect(() => lineAmount({ quantity: 1, unitPrice: 100, discount: 101 })).toThrow('Giảm giá dòng');
    expect(() => lineAmount({ quantity: 1, unitPrice: -1 })).toThrow('Đơn giá');
  });

  it('tổng đơn = tổng dòng − giảm giá đơn; giảm giá không vượt tổng', () => {
    const items = [
      { quantity: 1, unitPrice: 350_000 },
      { quantity: 4, unitPrice: 1_850_000, discount: 400_000 },
    ];
    expect(orderTotals(items, 50_000)).toEqual({ subtotal: 7_350_000, vat: 0, total: 7_300_000 });
    expect(orderTotals([], 0)).toEqual({ subtotal: 0, vat: 0, total: 0 });
    expect(() => orderTotals(items, 8_000_000)).toThrow('Giảm giá đơn');
  });

  it('VAT theo % từng dòng, chiết khấu đơn chia theo tỷ lệ trước khi tính thuế', () => {
    const items = [
      { quantity: 4, unitPrice: 2_000_000, vatRate: 8 }, // 8.000.000
      { quantity: 1, unitPrice: 2_000_000, vatRate: 0 }, // 2.000.000
    ];
    expect(orderTotals(items, 0)).toEqual({ subtotal: 10_000_000, vat: 640_000, total: 10_640_000 });
    // CK đơn 1.000.000 = 10% → dòng 1 còn 7.200.000 → VAT 576.000
    expect(orderTotals(items, 1_000_000)).toEqual({ subtotal: 10_000_000, vat: 576_000, total: 9_576_000 });
    expect(() => orderTotals([{ quantity: 1, unitPrice: 1, vatRate: 101 }], 0)).toThrow('% thuế');
  });

  it('chuyển trạng thái: đúng mũi tên và đúng quyền', () => {
    const ktv = new Set(['ro.view', 'ro.task.update']);
    const bh = new Set(['ro.view', 'ro.manage']);
    const ql = new Set(['ro.view', 'ro.manage', 'ro.approve']);
    expect(transitionError('TIEP_NHAN', 'DANG_SUA', ktv)).toBeNull();
    expect(transitionError('DANG_SUA', 'HOAN_THANH', ktv)).toBeNull();
    expect(transitionError('HOAN_THANH', 'DA_GIAO', ktv)).toMatch(/không có quyền/);
    expect(transitionError('HOAN_THANH', 'DA_GIAO', bh)).toBeNull();
    expect(transitionError('TIEP_NHAN', 'HUY', bh)).toMatch(/không có quyền/);
    expect(transitionError('TIEP_NHAN', 'HUY', ql)).toBeNull();
    expect(transitionError('TIEP_NHAN', 'DA_GIAO', ql)).toMatch(/Không chuyển được/);
    expect(transitionError('DA_GIAO', 'HUY', ql)).toMatch(/Không chuyển được/);
  });

  it('trạng thái tiền', () => {
    expect(paymentState(100, 0)).toBe('CHUA_THU');
    expect(paymentState(100, 40)).toBe('THU_MOT_PHAN');
    expect(paymentState(100, 100)).toBe('DA_THU_DU');
    expect(paymentState(0, 0)).toBe('DA_THU_DU');
  });
});
