import type { Tone } from '@cardiy/ui';

export type MaintenanceAlertState = 'QUA_HAN' | 'SAP_DEN_HAN' | 'BINH_THUONG';
export type WarrantyState = 'CON_BAO_HANH' | 'SAP_HET_BAO_HANH' | 'HET_BAO_HANH' | 'CHUA_KICH_HOAT';
export type SerialKind = 'LOP' | 'AC_QUY' | 'PIN_LITHIUM';
export type SerialStatus = 'TRONG_KHO' | 'DANG_SU_DUNG' | 'DA_THAO' | 'BAO_HANH' | 'LOAI_BO';
export type SerialTransitionAction =
  | 'LAP_MOI'
  | 'LAP_LAI'
  | 'DAO_VI_TRI'
  | 'CHUYEN_XE'
  | 'THAO_RA'
  | 'DOI_BAO_HANH'
  | 'LOAI_BO';

export const BADGE_TYPES: readonly { code: string; label: string }[] = [
  { code: 'XE_HOP_DONG', label: 'Xe hợp đồng' },
  { code: 'XE_TAI', label: 'Xe tải vận chuyển hàng' },
  { code: 'CONTAINER', label: 'Xe đầu kéo / Container' },
  { code: 'TUYEN_CO_DINH', label: 'Xe khách tuyến cố định' },
  { code: 'TAXI', label: 'Xe Taxi' },
  { code: 'NOI_BO', label: 'Xe vận tải nội bộ' },
];

export function badgeTypeLabel(code: string | null | undefined): string {
  if (!code) return '';
  return BADGE_TYPES.find((b) => b.code === code)?.label ?? code;
}

export const SERIAL_KINDS: readonly { value: SerialKind; label: string; tone: Tone }[] = [
  { value: 'LOP', label: 'Lốp xe', tone: 'sky' },
  { value: 'AC_QUY', label: 'Ắc quy', tone: 'peach' },
  { value: 'PIN_LITHIUM', label: 'Pin Lithium', tone: 'lav' },
];

export const SERIAL_POSITIONS: readonly { code: string; label: string; kinds: readonly SerialKind[] }[] = [
  { code: 'TRUOC_TRAI', label: 'Lốp trước trái (FL)', kinds: ['LOP'] },
  { code: 'TRUOC_PHAI', label: 'Lốp trước phải (FR)', kinds: ['LOP'] },
  { code: 'SAU_TRAI', label: 'Lốp sau trái (RL)', kinds: ['LOP'] },
  { code: 'SAU_PHAI', label: 'Lốp sau phải (RR)', kinds: ['LOP'] },
  { code: 'DU_PHONG', label: 'Lốp dự phòng', kinds: ['LOP'] },
  { code: 'CAU_SAU_TRONG_TRAI', label: 'Cầu sau trong trái', kinds: ['LOP'] },
  { code: 'CAU_SAU_TRONG_PHAI', label: 'Cầu sau trong phải', kinds: ['LOP'] },
  { code: 'KHOANG_MAY', label: 'Khoang động cơ', kinds: ['AC_QUY', 'PIN_LITHIUM'] },
  { code: 'COP_SAU', label: 'Cốp sau / Hộc phụ', kinds: ['AC_QUY', 'PIN_LITHIUM'] },
  { code: 'GAM_XE', label: 'Cụm pin gầm xe (Pack chính)', kinds: ['PIN_LITHIUM'] },
  { code: 'CABIN_PHU', label: 'Pin phụ lưu điện / Phụ tải', kinds: ['PIN_LITHIUM', 'AC_QUY'] },
];

export const SERIAL_STATUS_UI: Record<SerialStatus, { label: string; tone: Tone }> = {
  TRONG_KHO: { label: 'Trong kho', tone: 'slate' },
  DANG_SU_DUNG: { label: 'Đang gắn trên xe', tone: 'mint' },
  DA_THAO: { label: 'Đã tháo rời', tone: 'peach' },
  BAO_HANH: { label: 'Đang xử lý bảo hành', tone: 'rose' },
  LOAI_BO: { label: 'Ngừng sử dụng', tone: 'slate' },
};

export const WARRANTY_STATE_UI: Record<WarrantyState, { label: string; tone: Tone }> = {
  CON_BAO_HANH: { label: 'Còn bảo hành', tone: 'mint' },
  SAP_HET_BAO_HANH: { label: 'Sắp hết bảo hành', tone: 'peach' },
  HET_BAO_HANH: { label: 'Hết bảo hành', tone: 'rose' },
  CHUA_KICH_HOAT: { label: 'Chưa kích hoạt', tone: 'slate' },
};

export const MAINT_ALERT_UI: Record<MaintenanceAlertState, { label: string; tone: Tone }> = {
  QUA_HAN: { label: 'Quá hạn thay / bảo dưỡng', tone: 'rose' },
  SAP_DEN_HAN: { label: 'Sắp đến kỳ nhắc', tone: 'peach' },
  BINH_THUONG: { label: 'Đang tốt', tone: 'mint' },
};

export interface MaintenanceRuleItem {
  id?: string;
  code: string;
  name: string;
  intervalKm: number | null;
  intervalMonths: number | null;
  remindBeforeKm: number;
  remindBeforeDays: number;
  keywords: string[];
  active: boolean;
  sortOrder: number;
}

export interface VehicleMaintenanceItemView {
  id: string;
  categoryCode: string;
  itemName: string;
  productId: string | null;
  orderId: string | null;
  installedAt: string;
  installedKm: number | null;
  intervalKm: number | null;
  intervalMonths: number | null;
  remindBeforeKm: number;
  remindBeforeDays: number;
  nextDueKm: number | null;
  nextDueDate: string | null;
  status: string;
  note: string | null;
  kmDriven: number | null;
  kmRemaining: number | null;
  daysRemaining: number | null;
  alertState: MaintenanceAlertState;
  reasonText: string;
}

export interface VehicleMaintenanceResponse {
  currentOdometerKm: number | null;
  rules: MaintenanceRuleItem[];
  active: VehicleMaintenanceItemView[];
  history: VehicleMaintenanceItemView[];
}

export interface SerialItemView {
  id: string;
  serialNo: string;
  kind: SerialKind;
  kindLabel: string;
  status: SerialStatus;
  statusLabel: string;
  branchId: string | null;
  productId: string | null;
  productName: string;
  brand: string | null;
  dotOrMfg: string | null;
  position: string | null;
  positionLabel: string | null;
  installedAt: string | null;
  installedKm: number | null;
  warrantyMonths: number | null;
  warrantyKm: number | null;
  warrantyExpiresAt: string | null;
  warrantyMaxKm: number | null;
  warrantyState: WarrantyState;
  warrantySummary: string;
  daysLeft: number | null;
  kmLeft: number | null;
  kmUsedSinceInstall: number | null;
  note: string | null;
  vehicle: {
    id: string;
    plate: string;
    make: string | null;
    model: string | null;
    odometerKm: number | null;
    owner: { id: string; name: string; phone: string | null } | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface SerialEventView {
  id: string;
  action: string;
  actionLabel: string;
  fromVehicle: { id: string; plate: string } | null;
  toVehicle: { id: string; plate: string } | null;
  fromPosition: string | null;
  fromPositionLabel: string | null;
  toPosition: string | null;
  toPositionLabel: string | null;
  orderId: string | null;
  orderCode: string | null;
  odometerKm: number | null;
  performedAt: string;
  note: string | null;
  actorName: string | null;
}

export interface SerialDetailView extends SerialItemView {
  events: SerialEventView[];
}

export interface SerialLookupResponse {
  query: string;
  vehicles: {
    id: string;
    plate: string;
    make: string | null;
    model: string | null;
    odometerKm: number | null;
    owner: { id: string; name: string; phone: string | null } | null;
  }[];
  items: SerialDetailView[];
}

export type SmsProviderCode = 'ESMS' | 'SPEEDSMS' | 'VIETGUYS' | 'WEBHOOK';

export interface SmsSettingsResponse {
  enabled: boolean;
  provider: SmsProviderCode;
  mode: 'development' | 'production';
  endpointUrl: string;
  brandname: string;
  apiKey: string;
  secretConfigured: boolean;
  templateText: string;
  updatedAt: string | null;
  providers: { code: SmsProviderCode; label: string; defaultUrl: string }[];
  variables: { code: string; label: string }[];
}

export interface SmsMessageRow {
  id: string;
  event: string;
  phone: string;
  content: string;
  provider: string;
  status: string;
  msgId: string | null;
  error: string | null;
  createdAt: string;
}

export interface ReminderDispatchLog {
  id: string;
  channel: 'APP' | 'ZALO' | 'SMS';
  kind: string;
  title: string;
  body: string;
  status: string;
  error: string | null;
  createdAt: string;
  customer: { id: string; name: string; phone: string | null } | null;
  vehicle: { id: string; plate: string } | null;
}
