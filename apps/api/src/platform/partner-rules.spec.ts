import { addMonths, canMove, canMovePartner, nextPeriod, overdueDays } from './partner-rules';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('Phí gói đối tác', () => {
  it('cộng tháng giữ ngày cuối tháng hợp lệ', () => {
    expect(addMonths(d('2026-01-31'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(addMonths(d('2028-01-31'), 1).toISOString().slice(0, 10)).toBe('2028-02-29');
    expect(addMonths(d('2026-11-15'), 3).toISOString().slice(0, 10)).toBe('2027-02-15');
  });

  it('kỳ phí: số tiền = phí tháng × số tháng, hạn trả 7 ngày từ đầu kỳ', () => {
    const p = nextPeriod(d('2026-12-01'), 3, 500_000);
    expect(p.amount).toBe(1_500_000);
    expect(p.periodTo.toISOString().slice(0, 10)).toBe('2027-03-01');
    expect(p.dueDate.toISOString().slice(0, 10)).toBe('2026-12-08');
  });

  it('quá hạn: chỉ hoá đơn chưa trả, đếm ngày sau hạn', () => {
    expect(overdueDays({ status: 'DA_PHAT_HANH', dueDate: d('2026-12-08') }, d('2026-12-08'))).toBe(0);
    expect(overdueDays({ status: 'DA_PHAT_HANH', dueDate: d('2026-12-08') }, d('2026-12-25'))).toBe(17);
    expect(overdueDays({ status: 'DA_THANH_TOAN', dueDate: d('2026-12-08') }, d('2026-12-25'))).toBe(0);
  });

  it('chuyển trạng thái hồ sơ / đối tác', () => {
    expect(canMove('CHO_DUYET', 'DA_DUYET')).toBe(true);
    expect(canMove('CAN_BO_SUNG', 'DA_DUYET')).toBe(false);
    expect(canMove('TU_CHOI', 'CHO_DUYET')).toBe(false);
    expect(canMovePartner('HOAT_DONG', 'TAM_KHOA')).toBe(true);
    expect(canMovePartner('CHAM_DUT', 'HOAT_DONG')).toBe(false);
  });
});
