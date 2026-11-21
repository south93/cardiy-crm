import { addDays, applyOutcome, dueBefore, vnToday, ymd } from './care-rules';

describe('Luật chăm sóc khách', () => {
  const today = new Date('2026-11-21T00:00:00Z');

  it('ngày hôm nay theo giờ Việt Nam', () => {
    expect(ymd(vnToday(new Date('2026-11-21T16:59:00Z')))).toBe('2026-11-21');
    expect(ymd(vnToday(new Date('2026-11-21T17:01:00Z')))).toBe('2026-11-22');
  });

  it('kết quả cuộc gọi', () => {
    expect(applyOutcome('DA_TU_VAN', 0, today, null, 3)).toEqual({ status: 'XONG', attempts: 1 });
    expect(applyOutcome('KHONG_NGHE', 0, today, null, 3)).toEqual({ status: 'GOI_LAI', dueDate: addDays(today, 1), attempts: 1 });
    expect(applyOutcome('KHONG_NGHE', 2, today, null, 3)).toEqual({ status: 'BO_QUA', attempts: 3 });
    expect(applyOutcome('GOI_LAI_SAU', 0, today, addDays(today, 5), 3)).toMatchObject({ status: 'GOI_LAI', dueDate: addDays(today, 5) });
    expect(() => applyOutcome('GOI_LAI_SAU', 0, today, today, 3)).toThrow('ngày gọi lại');
    expect(applyOutcome('SAI_SO', 0, today, null, 3).status).toBe('BO_QUA');
  });

  it('hạn gọi trước ngày hết hạn, không sớm hơn hôm nay', () => {
    expect(ymd(dueBefore(addDays(today, 45), 30, today))).toBe('2026-12-06');
    expect(ymd(dueBefore(addDays(today, 10), 30, today))).toBe('2026-11-21');
  });
});
