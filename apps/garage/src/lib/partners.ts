import type { Tone } from '@cardiy/ui';

export interface PublicPlan {
  id: string;
  code: string;
  name: string;
  monthlyFee: number;
  billingMonths: number;
  description: string | null;
  features: string[];
}

export type AppStatus = 'CHO_DUYET' | 'CAN_BO_SUNG' | 'TU_CHOI' | 'DA_DUYET';
export const APP_STATUS: Record<AppStatus, { label: string; tone: Tone }> = {
  CHO_DUYET: { label: 'Chờ duyệt', tone: 'sky' },
  CAN_BO_SUNG: { label: 'Cần bổ sung', tone: 'peach' },
  TU_CHOI: { label: 'Từ chối', tone: 'rose' },
  DA_DUYET: { label: 'Đã duyệt', tone: 'mint' },
};

export const DOC_KINDS = [
  { value: 'GPKD', label: 'Giấy phép kinh doanh' },
  { value: 'CCCD', label: 'CCCD người đại diện' },
  { value: 'ANH', label: 'Ảnh garage' },
  { value: 'KHAC', label: 'Giấy tờ khác' },
] as const;
export const docKindLabel = (k: string) => DOC_KINDS.find((d) => d.value === k)?.label ?? k;

export interface AppDoc {
  fileId: string;
  kind: string;
  name: string;
  url?: string | null;
  mime?: string | null;
}

export interface ApplicationForm {
  garageName: string;
  taxCode: string;
  address: string;
  province: string;
  representative: string;
  phone: string;
  email: string;
  planId: string;
  note: string;
}
export const emptyApplication: ApplicationForm = { garageName: '', taxCode: '', address: '', province: '', representative: '', phone: '', email: '', planId: '', note: '' };

export interface PublicApplication extends Omit<ApplicationForm, 'taxCode' | 'province' | 'email' | 'planId' | 'note'> {
  code: string;
  status: AppStatus;
  taxCode: string | null;
  province: string | null;
  email: string | null;
  planId: string | null;
  note: string | null;
  plan: { name: string; monthlyFee: number; billingMonths: number } | null;
  documents: AppDoc[];
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  editable: boolean;
}

export const toForm = (a: PublicApplication): ApplicationForm => ({
  garageName: a.garageName,
  taxCode: a.taxCode ?? '',
  address: a.address,
  province: a.province ?? '',
  representative: a.representative,
  phone: a.phone,
  email: a.email ?? '',
  planId: a.planId ?? '',
  note: a.note ?? '',
});
export const fromForm = (f: ApplicationForm) => ({ ...f, planId: f.planId || null });

export type PartnerStatus = 'DANG_THIET_LAP' | 'HOAT_DONG' | 'TAM_KHOA' | 'CHAM_DUT';
export const PARTNER_STATUS: Record<string, { label: string; tone: Tone }> = {
  DANG_THIET_LAP: { label: 'Đang thiết lập', tone: 'sky' },
  HOAT_DONG: { label: 'Hoạt động', tone: 'mint' },
  TAM_KHOA: { label: 'Tạm khoá', tone: 'peach' },
  CHAM_DUT: { label: 'Chấm dứt', tone: 'slate' },
};

export const INVOICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  DA_PHAT_HANH: { label: 'Chưa thanh toán', tone: 'sky' },
  DA_THANH_TOAN: { label: 'Đã thanh toán', tone: 'mint' },
  HUY: { label: 'Đã huỷ', tone: 'slate' },
};

export interface Invoice {
  id: string;
  code: string;
  tenantId: string;
  plan: string;
  periodFrom: string;
  periodTo: string;
  amount: number;
  dueDate: string;
  status: 'DA_PHAT_HANH' | 'DA_THANH_TOAN' | 'HUY';
  overdueDays: number;
  paidAt: string | null;
  paidMethod: string | null;
  paidNote: string | null;
  partner?: string;
  partnerStatus?: string | null;
}

/** "350.000 đ / tháng" hoặc "810.000 đ / 3 tháng" */
export const planPrice = (fee: number, months: number) => `${(fee * months).toLocaleString('vi-VN')} đ / ${months === 1 ? 'tháng' : `${months} tháng`}`;
/** Ngày YYYY-MM-DD → dd/mm/yyyy */
export const dmy = (s: string | null | undefined) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');
