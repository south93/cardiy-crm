import { allocateDebt } from './finance-rules';

describe('Phân bổ thu nợ', () => {
  const orders = [
    { id: 'a', due: 300_000 },
    { id: 'b', due: 500_000 },
  ];
  it('trả đơn cũ trước, phần dư vào nợ đầu kỳ', () => {
    expect(allocateDebt(400_000, orders, 1_000_000)).toEqual({ toOrders: [{ id: 'a', amount: 300_000 }, { id: 'b', amount: 100_000 }], toOpening: 0 });
    expect(allocateDebt(1_000_000, orders, 1_000_000)).toEqual({ toOrders: [{ id: 'a', amount: 300_000 }, { id: 'b', amount: 500_000 }], toOpening: 200_000 });
    expect(allocateDebt(200_000, [], 1_000_000)).toEqual({ toOrders: [], toOpening: 200_000 });
  });
  it('không thu quá tổng nợ, số tiền > 0', () => {
    expect(() => allocateDebt(2_000_000, orders, 1_000_000)).toThrow('lớn hơn tổng nợ');
    expect(() => allocateDebt(0, orders, 0)).toThrow('lớn hơn 0');
  });
});
