export type CustomerTierCode = 'THUONG' | 'BAC' | 'VANG' | 'KIM_CUONG';
export type LoyaltyTxTypeCode = 'EARN' | 'REDEEM' | 'ADJUST';
export type CampaignChannelCode = 'APP_PUSH' | 'ZALO_ZNS' | 'SMS';
export type CampaignStatusCode = 'NHAP' | 'DA_LEN_LICH' | 'HOAN_THANH' | 'HUY';

export const TIER_ORDER: readonly CustomerTierCode[] = ['THUONG', 'BAC', 'VANG', 'KIM_CUONG'];

export const TIER_LABEL: Record<CustomerTierCode, string> = {
  THUONG: 'Thành viên Thường',
  BAC: 'Hạng Bạc',
  VANG: 'Hạng Vàng',
  KIM_CUONG: 'Hạng Kim cương',
};

export const CAMPAIGN_CHANNEL_LABEL: Record<CampaignChannelCode, string> = {
  APP_PUSH: 'Thông báo App chủ xe',
  ZALO_ZNS: 'Zalo ZNS',
  SMS: 'Tin nhắn SMS',
};

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatusCode, string> = {
  NHAP: 'Bản nháp',
  DA_LEN_LICH: 'Đã lên lịch',
  HOAN_THANH: 'Đã phát hành',
  HUY: 'Đã huỷ',
};

export const DEFAULT_LOYALTY_CONFIG = {
  enabled: true,
  vndPerPoint: 100_000,
  pointValueVnd: 1_000,
  silverPoints: 50,
  goldPoints: 200,
  diamondPoints: 500,
} as const;

export function calcEarnedPoints(orderTotalVnd: number, vndPerPoint: number, enabled = true): number {
  if (!enabled || vndPerPoint <= 0 || orderTotalVnd <= 0) return 0;
  return Math.floor(orderTotalVnd / vndPerPoint);
}

/** Tính hạng thành viên theo tổng điểm tích luỹ (không hạ hạng khách VIP đã gán tay trước đó) */
export function computeTierForPoints(
  lifetimeEarnedPoints: number,
  currentTier: CustomerTierCode,
  cfg: { silverPoints: number; goldPoints: number; diamondPoints: number },
): CustomerTierCode {
  let computed: CustomerTierCode = 'THUONG';
  if (lifetimeEarnedPoints >= cfg.diamondPoints) computed = 'KIM_CUONG';
  else if (lifetimeEarnedPoints >= cfg.goldPoints) computed = 'VANG';
  else if (lifetimeEarnedPoints >= cfg.silverPoints) computed = 'BAC';

  return TIER_ORDER.indexOf(computed) > TIER_ORDER.indexOf(currentTier) ? computed : currentTier;
}

/** Nghị định 13/2023 & quy tắc P5: chiến dịch chỉ gửi cho khách đã đồng ý nhận tin */
export function partitionAudienceByConsent<T extends { marketingConsent: boolean }>(
  candidates: readonly T[],
): { eligible: T[]; skippedNoConsent: T[] } {
  const eligible: T[] = [];
  const skippedNoConsent: T[] = [];
  for (const c of candidates) {
    if (c.marketingConsent) eligible.push(c);
    else skippedNoConsent.push(c);
  }
  return { eligible, skippedNoConsent };
}

export function renderCampaignTemplate(
  template: string,
  vars: {
    ten_khach?: string | null;
    hang_the?: string | null;
    diem_thuong?: number | string | null;
    ma_voucher?: string | null;
    ten_garage?: string | null;
  },
): string {
  const map: Record<string, string> = {
    ten_khach: vars.ten_khach?.trim() || 'Quý khách',
    hang_the: vars.hang_the?.trim() || TIER_LABEL.THUONG,
    diem_thuong: vars.diem_thuong != null ? String(vars.diem_thuong) : '0',
    ma_voucher: vars.ma_voucher?.trim() || '',
    ten_garage: vars.ten_garage?.trim() || 'CARDIY',
  };
  return template.replace(/\{\{\s*(ten_khach|hang_the|diem_thuong|ma_voucher|ten_garage)\s*\}\}/g, (_m, k: string) => map[k] ?? '');
}

export const segmentCode = (n: number) => `PK${String(n).padStart(6, '0')}`;
export const campaignCode = (n: number) => `CD${String(n).padStart(6, '0')}`;
