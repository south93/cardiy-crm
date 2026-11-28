import { renderSmsTemplate } from '../sms/sms';
import {
  computeNextDue,
  DEFAULT_MAINTENANCE_RULES,
  evaluateMaintenanceItem,
  evaluateSerialWarranty,
  matchRuleByItemName,
  normalizeSerialNo,
} from './fleet-rules';

describe('Quy tắc Nhắc bảo dưỡng theo Km/Thời gian, Sê-ri Bảo hành & Mẫu tin SMS', () => {
  const today = new Date('2026-12-01T00:00:00.000Z');

  it('tính chính xác số km đã chạy kể từ lần thay và cảnh báo khi chạm ngưỡng km hoặc thời gian', () => {
    const installedAt = new Date('2026-08-01T00:00:00.000Z');
    const { nextDueKm, nextDueDate } = computeNextDue({
      installedAt,
      installedKm: 20_000,
      intervalKm: 5_000,
      intervalMonths: 6,
    });
    expect(nextDueKm).toBe(25_000);

    // Mới chạy thêm 2.000 km (tổng 22.000 km), còn 2 tháng -> BINH_THUONG
    const okEval = evaluateMaintenanceItem(
      {
        installedAt,
        installedKm: 20_000,
        intervalKm: 5_000,
        intervalMonths: 6,
        remindBeforeKm: 500,
        remindBeforeDays: 15,
        nextDueKm,
        nextDueDate,
      },
      22_000,
      today,
    );
    expect(okEval.kmDriven).toBe(2_000);
    expect(okEval.kmRemaining).toBe(3_000);
    expect(okEval.alertState).toBe('BINH_THUONG');

    // Chạy lên 24.650 km (còn 350 km <= 500 km báo trước) -> SAP_DEN_HAN
    const soonEval = evaluateMaintenanceItem(
      {
        installedAt,
        installedKm: 20_000,
        intervalKm: 5_000,
        intervalMonths: 6,
        remindBeforeKm: 500,
        remindBeforeDays: 15,
        nextDueKm,
        nextDueDate,
      },
      24_650,
      today,
    );
    expect(soonEval.kmDriven).toBe(4_650);
    expect(soonEval.kmRemaining).toBe(350);
    expect(soonEval.alertState).toBe('SAP_DEN_HAN');

    // Chạy lên 25.300 km -> QUA_HAN
    const overdueEval = evaluateMaintenanceItem(
      {
        installedAt,
        installedKm: 20_000,
        intervalKm: 5_000,
        intervalMonths: 6,
        remindBeforeKm: 500,
        remindBeforeDays: 15,
        nextDueKm,
        nextDueDate,
      },
      25_300,
      today,
    );
    expect(overdueEval.kmDriven).toBe(5_300);
    expect(overdueEval.alertState).toBe('QUA_HAN');
  });

  it('đánh giá hạn bảo hành Sê-ri Lốp / Ắc quy / Pin Lithium theo cả ngày hết hạn và số km tối đa', () => {
    expect(normalizeSerialNo('  sn lop 2026 01 ')).toBe('SN-LOP-2026-01');

    const installedAt = new Date('2026-01-01T00:00:00.000Z');
    const expiresAt = new Date('2028-01-01T00:00:00.000Z');

    const active = evaluateSerialWarranty(
      {
        installedAt,
        installedKm: 10_000,
        warrantyMonths: 24,
        warrantyKm: 50_000,
        warrantyExpiresAt: expiresAt,
        warrantyMaxKm: 60_000,
      },
      35_000,
      today,
    );
    expect(active.warrantyState).toBe('CON_BAO_HANH');
    expect(active.kmUsedSinceInstall).toBe(25_000);
    expect(active.kmLeft).toBe(25_000);

    // Chưa hết ngày nhưng đã vượt 60.000 km -> HET_BAO_HANH
    const expiredKm = evaluateSerialWarranty(
      {
        installedAt,
        installedKm: 10_000,
        warrantyMonths: 24,
        warrantyKm: 50_000,
        warrantyExpiresAt: expiresAt,
        warrantyMaxKm: 60_000,
      },
      61_200,
      today,
    );
    expect(expiredKm.warrantyState).toBe('HET_BAO_HANH');
  });

  it('nhận diện hạng mục bảo dưỡng trên đơn và ghép mẫu SMS chính xác', () => {
    const matchedOil = matchRuleByItemName('Dầu nhớt Castrol Magnatec 5W-30 4L', DEFAULT_MAINTENANCE_RULES);
    expect(matchedOil?.code).toBe('DAU_NHOT');

    const matchedBattery = matchRuleByItemName('Bình ắc quy Varta 65Ah', DEFAULT_MAINTENANCE_RULES);
    expect(matchedBattery?.code).toBe('AC_QUY');

    const sms = renderSmsTemplate('[{garage_name}] Xe {plate}: {care_title} ({due_date})', {
      garage_name: 'PHI LONG AUTO',
      plate: '61A-888.99',
      care_title: 'Han phu hieu xe',
      due_date: '25/12/2026',
    });
    expect(sms).toBe('[PHI LONG AUTO] Xe 61A-888.99: Han phu hieu xe (25/12/2026)');
  });
});
