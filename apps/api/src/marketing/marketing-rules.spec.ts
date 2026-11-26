import {
  calcEarnedPoints,
  campaignCode,
  computeTierForPoints,
  DEFAULT_LOYALTY_CONFIG,
  partitionAudienceByConsent,
  renderCampaignTemplate,
  segmentCode,
} from './marketing-rules';

describe('marketing-rules (Vòng 5.1 · M35)', () => {
  it('tính điểm tích luỹ theo giá trị đơn hàng đã giao và trạng thái bật/tắt', () => {
    expect(calcEarnedPoints(1_550_000, 100_000, true)).toBe(15);
    expect(calcEarnedPoints(99_000, 100_000, true)).toBe(0);
    expect(calcEarnedPoints(2_000_000, 100_000, false)).toBe(0);
  });

  it('nâng hạng thành viên tự động theo điểm tích luỹ nhưng không hạ hạng khách VIP cũ', () => {
    expect(computeTierForPoints(49, 'THUONG', DEFAULT_LOYALTY_CONFIG)).toBe('THUONG');
    expect(computeTierForPoints(50, 'THUONG', DEFAULT_LOYALTY_CONFIG)).toBe('BAC');
    expect(computeTierForPoints(210, 'BAC', DEFAULT_LOYALTY_CONFIG)).toBe('VANG');
    expect(computeTierForPoints(500, 'VANG', DEFAULT_LOYALTY_CONFIG)).toBe('KIM_CUONG');
    // Khách đã gán tay hạng Vàng dù mới tích 20 điểm vẫn giữ hạng Vàng
    expect(computeTierForPoints(20, 'VANG', DEFAULT_LOYALTY_CONFIG)).toBe('VANG');
  });

  it('tách tập khách nhận chiến dịch theo sự đồng ý nhận tin (marketingConsent)', () => {
    const res = partitionAudienceByConsent([
      { id: 'c1', marketingConsent: true },
      { id: 'c2', marketingConsent: false },
      { id: 'c3', marketingConsent: true },
    ]);
    expect(res.eligible.map((x) => x.id)).toEqual(['c1', 'c3']);
    expect(res.skippedNoConsent.map((x) => x.id)).toEqual(['c2']);
  });

  it('cá nhân hoá mẫu nội dung chiến dịch với các biến chuẩn', () => {
    const out = renderCampaignTemplate(
      'Chào {{ten_khach}} ({{hang_the}}, {{diem_thuong}} điểm), nhập mã {{ma_voucher}} tại {{ten_garage}}!',
      {
        ten_khach: 'Anh Minh',
        hang_the: 'Hạng Vàng',
        diem_thuong: 235,
        ma_voucher: 'TRI-AN-50K',
        ten_garage: 'Garage PLG',
      },
    );
    expect(out).toBe('Chào Anh Minh (Hạng Vàng, 235 điểm), nhập mã TRI-AN-50K tại Garage PLG!');
  });

  it('sinh mã phân khúc và chiến dịch đúng chuẩn PK / CD', () => {
    expect(segmentCode(3)).toBe('PK000003');
    expect(campaignCode(12)).toBe('CD000012');
  });
});
