export type RentalListingStatus = 'NHAP' | 'CHO_DUYET' | 'DANG_CHO_THUE' | 'BI_TU_CHOI' | 'TAM_AN' | 'BI_GO';

export type RentalContractStatus =
  | 'DAT_TRUOC'
  | 'DA_XAC_MINH'
  | 'DA_KY_COC'
  | 'DANG_THUE'
  | 'QUA_HAN'
  | 'DA_TRA_XE'
  | 'DA_QUYET_TOAN'
  | 'HUY';

export const RENTAL_MAX_ACTIVE_PER_PHONE = 3;
export const RENTAL_MAX_HOURLY_PER_IP = 20;

export const RENTAL_LISTING_LABEL: Record<RentalListingStatus, string> = {
  NHAP: 'Bản nháp',
  CHO_DUYET: 'Chờ sàn duyệt',
  DANG_CHO_THUE: 'Đang cho thuê',
  BI_TU_CHOI: 'Bị từ chối',
  TAM_AN: 'Tạm ẩn',
  BI_GO: 'Bị sàn gỡ',
};

export const RENTAL_STATUS_LABEL: Record<RentalContractStatus, string> = {
  DAT_TRUOC: 'Đặt trước (chờ xác minh)',
  DA_XAC_MINH: 'Đã xác minh giấy tờ',
  DA_KY_COC: 'Đã ký hợp đồng & đặt cọc',
  DANG_THUE: 'Đang thuê xe',
  QUA_HAN: 'Quá hạn trả xe',
  DA_TRA_XE: 'Đã trả xe (chờ quyết toán)',
  DA_QUYET_TOAN: 'Đã quyết toán',
  HUY: 'Đã huỷ',
};

/** Các trạng thái hợp đồng đang giữ xe, không cho khách khác đặt trùng lịch */
export const HOLDING_RENTAL_STATUSES: RentalContractStatus[] = [
  'DAT_TRUOC',
  'DA_XAC_MINH',
  'DA_KY_COC',
  'DANG_THUE',
  'QUA_HAN',
];

/** Máy trạng thái S8: Hợp đồng thuê xe (docs/05-trang-thai.md) */
export const RENTAL_CONTRACT_TRANSITIONS: Record<RentalContractStatus, readonly RentalContractStatus[]> = {
  DAT_TRUOC: ['DA_XAC_MINH', 'HUY'],
  DA_XAC_MINH: ['DA_KY_COC'],
  DA_KY_COC: ['DANG_THUE'],
  DANG_THUE: ['DA_TRA_XE', 'QUA_HAN'],
  QUA_HAN: ['DA_TRA_XE'],
  DA_TRA_XE: ['DA_QUYET_TOAN'],
  DA_QUYET_TOAN: [],
  HUY: [],
};

export function canMoveContract(from: RentalContractStatus, to: RentalContractStatus): boolean {
  return RENTAL_CONTRACT_TRANSITIONS[from].includes(to);
}

export function contractTransitionError(from: RentalContractStatus, to: RentalContractStatus): string | null {
  if (canMoveContract(from, to)) return null;
  if (to === 'HUY') {
    return `Hợp đồng đang ở trạng thái "${RENTAL_STATUS_LABEL[from]}", không huỷ trực tuyến được nữa. Vui lòng liên hệ trực tiếp garage.`;
  }
  return `Không thể chuyển hợp đồng từ "${RENTAL_STATUS_LABEL[from]}" sang "${RENTAL_STATUS_LABEL[to]}"`;
}

/** Kiểm duyệt tin xe cho thuê (tương tự S5): PLG lên sàn ngay, Đối tác chờ duyệt */
export function listingStatusOnSubmit(current: RentalListingStatus, isPlg: boolean): RentalListingStatus | null {
  if (current !== 'NHAP' && current !== 'BI_TU_CHOI') return null;
  return isPlg ? 'DANG_CHO_THUE' : 'CHO_DUYET';
}

export function listingStatusAfterEdit(current: RentalListingStatus, importantChange: boolean, isPlg: boolean): RentalListingStatus {
  if (current === 'BI_TU_CHOI') return 'NHAP';
  if (!importantChange) return current;
  if (current === 'DANG_CHO_THUE') return isPlg ? 'DANG_CHO_THUE' : 'CHO_DUYET';
  return current;
}

/** Kiểm tra khoảng thời gian thuê hợp lệ và tính số ngày thuê (làm tròn lên theo 24h, tối thiểu 1 ngày) */
export function checkRentalPeriod(
  startAt: Date,
  endAt: Date,
  now = new Date(),
): { days: number } | { error: string } {
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return { error: 'Thời gian nhận / trả xe không hợp lệ' };
  }
  if (startAt.getTime() < now.getTime() - 15 * 60_000) {
    return { error: 'Thời điểm nhận xe đã qua' };
  }
  const diffMs = endAt.getTime() - startAt.getTime();
  if (diffMs < 4 * 3_600_000) {
    return { error: 'Thời gian thuê tối thiểu 4 tiếng' };
  }
  const days = Math.max(1, Math.ceil(diffMs / 86_400_000));
  if (days > 90) {
    return { error: 'Chỉ đặt thuê tối đa 90 ngày một hợp đồng' };
  }
  return { days };
}

/** Kiểm tra 2 khoảng [aStart, aEnd) và [bStart, bEnd) có giao nhau không */
export function periodsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** Gợi ý phụ phí vượt định mức km khi trả xe */
export function suggestOverKmFee(opts: {
  handoverKm: number | null;
  returnKm: number;
  rentalDays: number;
  kmLimitPerDay: number;
  overKmFee: number;
}): { drivenKm: number; overKm: number; suggestedFee: number } {
  if (opts.handoverKm === null || opts.returnKm <= opts.handoverKm) {
    return { drivenKm: 0, overKm: 0, suggestedFee: 0 };
  }
  const drivenKm = opts.returnKm - opts.handoverKm;
  if (opts.kmLimitPerDay <= 0) {
    return { drivenKm, overKm: 0, suggestedFee: 0 };
  }
  const allowedKm = opts.rentalDays * opts.kmLimitPerDay;
  const overKm = Math.max(0, drivenKm - allowedKm);
  return { drivenKm, overKm, suggestedFee: overKm * opts.overKmFee };
}

/** Tính quyết toán hợp đồng: tổng tiền thuê thực tế, số hoàn cọc hoặc thu thêm */
export function computeSettlement(opts: {
  baseTotal: number;
  extraFee: number;
  discount: number;
  depositPaid: number;
}): { finalTotal: number; depositRefund: number; extraCollect: number } {
  const finalTotal = Math.max(0, opts.baseTotal + opts.extraFee - opts.discount);
  const depositRefund = Math.max(0, opts.depositPaid - finalTotal);
  const extraCollect = Math.max(0, finalTotal - opts.depositPaid);
  return { finalTotal, depositRefund, extraCollect };
}

export const rentalVehicleCode = (n: number) => `TX${String(n).padStart(6, '0')}`;
export const rentalContractCode = (n: number) => `HDT${String(n).padStart(6, '0')}`;
