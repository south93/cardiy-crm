import type { Tone } from '@cardiy/ui';

export type CustomerTierCode = 'THUONG' | 'BAC' | 'VANG' | 'KIM_CUONG';
export type CampaignChannelCode = 'APP_PUSH' | 'ZALO_ZNS' | 'SMS';
export type CampaignStatusCode = 'NHAP' | 'DA_LEN_LICH' | 'HOAN_THANH' | 'HUY';
export type CampaignDeliveryStatusCode = 'SENT' | 'SKIPPED_NO_CONSENT' | 'FAILED';
export type LoyaltyTxTypeCode = 'EARN' | 'REDEEM' | 'ADJUST';

export const TIER_UI: Record<CustomerTierCode, { label: string; tone: Tone }> = {
  THUONG: { label: 'Thường', tone: 'slate' },
  BAC: { label: 'Hạng Bạc', tone: 'sky' },
  VANG: { label: 'Hạng Vàng', tone: 'peach' },
  KIM_CUONG: { label: 'Kim cương', tone: 'brand' },
};

export const CAMPAIGN_CHANNEL_UI: Record<CampaignChannelCode, { label: string; tone: Tone }> = {
  APP_PUSH: { label: 'App chủ xe', tone: 'brand' },
  ZALO_ZNS: { label: 'Zalo ZNS', tone: 'sky' },
  SMS: { label: 'SMS', tone: 'slate' },
};

export const CAMPAIGN_STATUS_UI: Record<CampaignStatusCode, { label: string; tone: Tone }> = {
  NHAP: { label: 'Bản nháp', tone: 'slate' },
  DA_LEN_LICH: { label: 'Đã lên lịch', tone: 'sky' },
  HOAN_THANH: { label: 'Đã phát hành', tone: 'mint' },
  HUY: { label: 'Đã huỷ', tone: 'rose' },
};

export const DELIVERY_STATUS_UI: Record<CampaignDeliveryStatusCode, { label: string; tone: Tone }> = {
  SENT: { label: 'Đã gửi', tone: 'mint' },
  SKIPPED_NO_CONSENT: { label: 'Bỏ qua (chưa đồng ý nhận tin)', tone: 'peach' },
  FAILED: { label: 'Lỗi gửi', tone: 'rose' },
};

export const CUSTOMER_SOURCES = [
  { code: 'ZALO', label: 'Zalo' },
  { code: 'FACEBOOK', label: 'Facebook' },
  { code: 'TIKTOK', label: 'TikTok' },
  { code: 'GIOI_THIEU', label: 'Khách giới thiệu' },
  { code: 'KHACH_CU', label: 'Khách cũ' },
  { code: 'VANG_LAI', label: 'Vãng lai' },
  { code: 'SAN_CARDIY', label: 'Sàn CARDIY' },
  { code: 'WEBSITE', label: 'Website' },
] as const;

export interface LoyaltyConfigDto {
  tenantId?: string;
  enabled: boolean;
  vndPerPoint: number;
  pointValueVnd: number;
  silverPoints: number;
  goldPoints: number;
  diamondPoints: number;
}

export interface LoyaltyCustomerItem {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  tier: CustomerTierCode;
  tierLabel: string;
  marketingConsent: boolean;
  balance: number;
  lifetimeEarned: number;
}

export interface LoyaltyTransactionItem {
  id: string;
  type: LoyaltyTxTypeCode;
  points: number;
  balanceAfter: number;
  note: string | null;
  createdAt: string;
}

export interface SegmentRulesInput {
  tiers: CustomerTierCode[];
  sources: string[];
  branchId?: string | null;
  minSpent?: number | null;
  inactiveDays?: number | null;
  expiringWithinDays?: number | null;
}

export interface CustomerSegmentItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  rules: SegmentRulesInput;
  totalMatched: number;
  consentedCount: number;
  unconsentedCount: number;
  createdAt: string;
}

export interface SegmentPreviewResult {
  totalMatched: number;
  consentedCount: number;
  unconsentedCount: number;
  sampleCustomers: {
    id: string;
    code: string;
    name: string;
    phone: string | null;
    tier: CustomerTierCode;
    tierLabel: string;
    marketingConsent: boolean;
    spentTotal: number;
    pointsBalance: number;
  }[];
}

export interface MarketingCampaignItem {
  id: string;
  code: string;
  name: string;
  channel: CampaignChannelCode;
  channelLabel: string;
  segmentId: string | null;
  segmentName: string;
  voucherId: string | null;
  templateCode: string | null;
  title: string;
  bodyTemplate: string;
  status: CampaignStatusCode;
  statusLabel: string;
  sentAt: string | null;
  totalMatched: number;
  sentCount: number;
  skippedNoConsent: number;
  createdAt: string;
}

export interface MarketingCampaignDetail extends MarketingCampaignItem {
  deliveries: {
    id: string;
    recipientName: string;
    phone: string | null;
    status: CampaignDeliveryStatusCode;
    renderedBody: string | null;
    reason: string | null;
    createdAt: string;
  }[];
}

export interface NotificationTemplateItem {
  id: string;
  code: string;
  name: string;
  channel: 'ZNS' | 'SMS' | 'EMAIL' | 'PUSH';
  title: string;
  body: string;
  active: boolean;
  updatedAt: string;
}

export interface OwnerLoyaltyResponse {
  wallets: {
    customerId: string;
    tenantId: string;
    garageName: string;
    tier: CustomerTierCode;
    tierLabel: string;
    balance: number;
    recentTransactions: LoyaltyTransactionItem[];
  }[];
  vouchers: {
    id: string;
    code: string;
    title: string;
    kind: 'PERCENT' | 'AMOUNT';
    value: number;
    minOrder: number;
    maxDiscount: number | null;
    endsAt: string;
    garageName: string;
  }[];
}

export interface OwnerNotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export interface OwnerPrivacyResponse {
  marketingConsent: boolean;
  history: {
    id: string;
    channel: string;
    purpose: string;
    granted: boolean;
    createdAt: string;
  }[];
}
