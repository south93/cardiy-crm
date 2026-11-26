import { distanceKm, tenantListable } from '../marketplace/offer-rules';

/** Thời gian tối đa chờ một garage nhận ca cứu hộ trước khi hiện hotline trực tiếp (3 phút theo F5, S6) */
export const SOS_SEARCH_TTL_MS = 3 * 60_000;
/** Chống spam: tối đa 2 ca cứu hộ đang mở trên cùng một số điện thoại */
export const SOS_MAX_ACTIVE_PER_PHONE = 2;
/** Chống spam: tối đa 15 yêu cầu cứu hộ / giờ / IP */
export const SOS_MAX_HOURLY_PER_IP = 15;

export type SosStatus =
  | 'MOI'
  | 'DANG_TIM_GARAGE'
  | 'DA_NHAN'
  | 'KHONG_CO_GARAGE'
  | 'DANG_DEN'
  | 'TAI_HIEN_TRUONG'
  | 'XU_LY_TAI_CHO'
  | 'DANG_KEO_XE'
  | 'DA_VE_GARAGE'
  | 'HOAN_THANH'
  | 'KHACH_HUY';

export type SosIssueType =
  | 'HET_BINH'
  | 'THUNG_LOP'
  | 'CHET_MAY'
  | 'TAI_NAN'
  | 'HET_NHIEN_LIEU'
  | 'KEO_XE'
  | 'KHAC';

export const SOS_STATUS_LABEL: Record<SosStatus, string> = {
  MOI: 'Mới gửi',
  DANG_TIM_GARAGE: 'Đang tìm garage cứu hộ',
  DA_NHAN: 'Garage đã nhận ca',
  KHONG_CO_GARAGE: 'Chưa có garage nhận trực tuyến',
  DANG_DEN: 'Đội cứu hộ đang đến',
  TAI_HIEN_TRUONG: 'Đã tới hiện trường',
  XU_LY_TAI_CHO: 'Đang xử lý tại chỗ',
  DANG_KEO_XE: 'Đang kéo xe về garage',
  DA_VE_GARAGE: 'Xe đã về tới garage',
  HOAN_THANH: 'Hoàn thành',
  KHACH_HUY: 'Khách đã huỷ',
};

export const SOS_ISSUE_LABEL: Record<SosIssueType, string> = {
  HET_BINH: 'Hết bình / kích ắc quy',
  THUNG_LOP: 'Thủng / nổ lốp',
  CHET_MAY: 'Chết máy / không đề được',
  TAI_NAN: 'Va chạm / tai nạn',
  HET_NHIEN_LIEU: 'Hết nhiên liệu / quá nhiệt',
  KEO_XE: 'Cần xe cẩu / kéo về xưởng',
  KHAC: 'Sự cố khác',
};

/** Ca chưa kết thúc (dùng kiểm tra giới hạn số ca đang mở của khách) */
export const OPEN_SOS_STATUSES: SosStatus[] = [
  'MOI',
  'DANG_TIM_GARAGE',
  'DA_NHAN',
  'DANG_DEN',
  'TAI_HIEN_TRUONG',
  'XU_LY_TAI_CHO',
  'DANG_KEO_XE',
  'DA_VE_GARAGE',
];

/** Ca đã có garage nhận và đang xử lý trên đường / tại hiện trường / về xưởng */
export const ACTIVE_ASSIGNED_SOS_STATUSES: SosStatus[] = [
  'DA_NHAN',
  'DANG_DEN',
  'TAI_HIEN_TRUONG',
  'XU_LY_TAI_CHO',
  'DANG_KEO_XE',
  'DA_VE_GARAGE',
];

/** Trạng thái cho phép đội cứu hộ cập nhật vị trí GPS */
export const TRACKABLE_SOS_STATUSES: SosStatus[] = [
  'DANG_DEN',
  'TAI_HIEN_TRUONG',
  'DANG_KEO_XE',
];

/** Trạng thái khách được phép tự bấm huỷ trên web / app (S6) */
export const CUSTOMER_CANCELLABLE_SOS_STATUSES: SosStatus[] = [
  'MOI',
  'DANG_TIM_GARAGE',
  'DA_NHAN',
];

/** Máy trạng thái S6 (docs/05-trang-thai.md): mọi chuyển ngoài bảng này đều bị từ chối */
export const SOS_TRANSITIONS: Record<SosStatus, readonly SosStatus[]> = {
  MOI: ['DANG_TIM_GARAGE', 'KHACH_HUY'],
  DANG_TIM_GARAGE: ['DA_NHAN', 'KHONG_CO_GARAGE', 'KHACH_HUY'],
  DA_NHAN: ['DANG_DEN', 'KHACH_HUY'],
  DANG_DEN: ['TAI_HIEN_TRUONG'],
  TAI_HIEN_TRUONG: ['XU_LY_TAI_CHO', 'DANG_KEO_XE'],
  XU_LY_TAI_CHO: ['HOAN_THANH'],
  DANG_KEO_XE: ['DA_VE_GARAGE'],
  DA_VE_GARAGE: ['HOAN_THANH'],
  HOAN_THANH: [],
  KHACH_HUY: [],
  KHONG_CO_GARAGE: [],
};

export function canMoveSos(from: SosStatus, to: SosStatus): boolean {
  return SOS_TRANSITIONS[from].includes(to);
}

export function sosTransitionError(from: SosStatus, to: SosStatus): string | null {
  if (canMoveSos(from, to)) return null;
  if (to === 'KHACH_HUY') {
    return `Ca cứu hộ đang ở trạng thái "${SOS_STATUS_LABEL[from]}", đội cứu hộ đã xuất phát nên không tự huỷ trực tuyến được. Vui lòng gọi trực tiếp hotline garage.`;
  }
  return `Không thể chuyển ca cứu hộ từ "${SOS_STATUS_LABEL[from]}" sang "${SOS_STATUS_LABEL[to]}"`;
}

export interface RescueGarageInput {
  tenantId: string;
  tenantType: string;
  tenantStatus: string;
  tenantDeletedAt: Date | null;
  name: string;
  slug: string | null;
  address: string | null;
  hotline: string | null;
  lat: number | null;
  lng: number | null;
  enabled: boolean;
  onDuty: boolean;
  radiusKm: number;
  basePrice: number;
  note: string | null;
}

export interface MatchedRescueGarage extends RescueGarageInput {
  distanceKm: number;
}

/**
 * Tìm các garage đủ điều kiện nhận thông báo SOS:
 * - Tenant được phép hiển thị trên sàn (PLG không bị khoá, đối tác đang HOAT_DONG)
 * - Đã bật dịch vụ cứu hộ (enabled) và đang trực (onDuty)
 * - Có toạ độ và khoảng cách tới xe khách <= radiusKm của garage
 * Kết quả xếp theo khoảng cách tăng dần.
 */
export function matchRescueGarages(
  pos: { lat: number; lng: number },
  garages: RescueGarageInput[],
): MatchedRescueGarage[] {
  const out: MatchedRescueGarage[] = [];
  for (const g of garages) {
    if (!g.enabled || !g.onDuty) continue;
    if (!tenantListable({ type: g.tenantType, status: g.tenantStatus, deletedAt: g.tenantDeletedAt })) continue;
    if (g.lat === null || g.lng === null) continue;
    const d = distanceKm(pos, { lat: g.lat, lng: g.lng });
    if (d <= g.radiusKm) {
      out.push({ ...g, distanceKm: d });
    }
  }
  return out.sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * Danh sách hotline dự phòng khi hết 3 phút không có garage nhận (KHONG_CO_GARAGE):
 * lấy tối đa `limit` garage có bật cứu hộ, có SĐT hotline và đang hoạt động, ưu tiên gần khách nhất
 * (kể cả khi khách ở hơi ngoài bán kính nhận tự động hoặc garage tạm tắt trực online).
 */
export function nearestFallbackHotlines(
  pos: { lat: number; lng: number },
  garages: RescueGarageInput[],
  limit = 5,
): {
  tenantId: string;
  name: string;
  slug: string | null;
  address: string | null;
  hotline: string;
  distanceKm: number | null;
  basePrice: number;
  onDuty: boolean;
}[] {
  return garages
    .filter(
      (g) =>
        g.enabled &&
        !!g.hotline &&
        tenantListable({ type: g.tenantType, status: g.tenantStatus, deletedAt: g.tenantDeletedAt }),
    )
    .map((g) => ({
      tenantId: g.tenantId,
      name: g.name,
      slug: g.slug,
      address: g.address,
      hotline: g.hotline!,
      distanceKm: g.lat !== null && g.lng !== null ? distanceKm(pos, { lat: g.lat, lng: g.lng }) : null,
      basePrice: g.basePrice,
      onDuty: g.onDuty,
    }))
    .sort((a, b) => (a.distanceKm ?? 99999) - (b.distanceKm ?? 99999))
    .slice(0, limit);
}

export function sosCode(n: number): string {
  return `SOS${String(n).padStart(6, '0')}`;
}
