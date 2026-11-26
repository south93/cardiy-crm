export type UsedCarListingStatus =
  | 'NHAP'
  | 'CHO_DUYET'
  | 'DANG_BAN'
  | 'BI_TU_CHOI'
  | 'TAM_AN'
  | 'DA_BAN'
  | 'HET_HAN'
  | 'BI_GO';

export type UsedCarAppraisalStatus =
  | 'CHO_XAC_NHAN'
  | 'DA_HEN'
  | 'DANG_KIEM_DINH'
  | 'HOAN_THANH'
  | 'TU_CHOI'
  | 'HUY';

export type AppraisalGrade = 'DAT_CHUAN' | 'LUU_Y' | 'KHONG_DAT';

export type ChecklistItemStatus = 'TOT' | 'LUU_Y' | 'KHONG_DAT';

export interface AppraisalChecklistItem {
  key: string;
  group: string;
  label: string;
  maxPoints: number;
  status: ChecklistItemStatus;
  note?: string | null;
}

export const USED_CAR_LISTING_TTL_DAYS = 60;
export const USED_CAR_MAX_HOURLY_THREADS_PER_IP = 20;

export const USED_CAR_STATUS_LABEL: Record<UsedCarListingStatus, string> = {
  NHAP: 'Bản nháp',
  CHO_DUYET: 'Chờ sàn duyệt',
  DANG_BAN: 'Đang đăng bán',
  BI_TU_CHOI: 'Bị từ chối',
  TAM_AN: 'Tạm ẩn',
  DA_BAN: 'Đã bán',
  HET_HAN: 'Hết hạn (60 ngày)',
  BI_GO: 'Bị sàn gỡ',
};

export const APPRAISAL_STATUS_LABEL: Record<UsedCarAppraisalStatus, string> = {
  CHO_XAC_NHAN: 'Chờ garage xác nhận',
  DA_HEN: 'Đã xác nhận lịch hẹn',
  DANG_KIEM_DINH: 'Đang kiểm định xe',
  HOAN_THANH: 'Đã hoàn tất báo cáo',
  TU_CHOI: 'Garage từ chối',
  HUY: 'Khách đã huỷ',
};

export const APPRAISAL_GRADE_LABEL: Record<AppraisalGrade, string> = {
  DAT_CHUAN: 'Đạt chuẩn kiểm định',
  LUU_Y: 'Có hạng mục cần lưu ý',
  KHONG_DAT: 'Không đạt kiểm định',
};

/** Mẫu checklist 6 nhóm kỹ thuật đại diện 150 tiêu chí kiểm định xe cũ (tổng 100 điểm) */
export const DEFAULT_APPRAISAL_CHECKLIST: readonly Omit<AppraisalChecklistItem, 'status' | 'note'>[] = [
  {
    key: 'BODY_FRAME',
    group: 'Khung gầm & Thân vỏ',
    label: 'Sắt-xi, cột kèo, keo chỉ nguyên bản, không biến dạng va chạm',
    maxPoints: 30,
  },
  {
    key: 'ENGINE_GEARBOX',
    group: 'Động cơ & Hộp số',
    label: 'Máy nổ êm, ốc chân máy nguyên zin, hộp số sang số mượt, không rò dầu',
    maxPoints: 25,
  },
  {
    key: 'SUSPENSION_BRAKE',
    group: 'Lái, Treo, Phanh & Lốp',
    label: 'Thước lái, giảm xóc, má phanh và độ sâu gai lốp đạt chuẩn',
    maxPoints: 15,
  },
  {
    key: 'ELECTRICAL_AC',
    group: 'Điện, Đèn & Điều hoà',
    label: 'Điều hoà lạnh sâu, ắc quy tốt, quét OBD không có mã lỗi',
    maxPoints: 15,
  },
  {
    key: 'INTERIOR_SAFETY',
    group: 'Nội thất & Túi khí',
    label: 'Túi khí, dây đai an toàn, ghế và hệ thống giải trí hoạt động tốt',
    maxPoints: 10,
  },
  {
    key: 'LEGAL_ODO',
    group: 'Giấy tờ & Lịch sử ODO',
    label: 'Số khung số máy khớp đăng ký, đồng hồ km trung thực',
    maxPoints: 5,
  },
];

export function buildDefaultChecklist(): AppraisalChecklistItem[] {
  return DEFAULT_APPRAISAL_CHECKLIST.map((g) => ({ ...g, status: 'TOT', note: null }));
}

/** Chấm điểm checklist kiểm định (0–100), xếp loại và quyết định cấp huy hiệu Đã kiểm định */
export function evaluateAppraisalChecklist(
  items: AppraisalChecklistItem[],
  flags: { noMajorAccident: boolean; noFloodDamage: boolean; validDocuments: boolean },
): { score: number; grade: AppraisalGrade; earnsVerifiedBadge: boolean } {
  const byKey = new Map(items.map((i) => [i.key, i]));
  let raw = 0;
  let criticalFailed = false;

  for (const def of DEFAULT_APPRAISAL_CHECKLIST) {
    const found = byKey.get(def.key);
    const st: ChecklistItemStatus = found?.status ?? 'TOT';
    if (st === 'TOT') raw += def.maxPoints;
    else if (st === 'LUU_Y') raw += Math.round(def.maxPoints * 0.6);
    else if (def.key === 'BODY_FRAME' || def.key === 'ENGINE_GEARBOX' || def.key === 'LEGAL_ODO') {
      criticalFailed = true;
    }
  }

  raw = Math.max(0, Math.min(100, raw));

  if (!flags.noMajorAccident || !flags.noFloodDamage || !flags.validDocuments) {
    return {
      score: Math.min(raw, 49),
      grade: 'KHONG_DAT',
      earnsVerifiedBadge: false,
    };
  }

  if (criticalFailed || raw < 50) {
    return { score: raw, grade: 'KHONG_DAT', earnsVerifiedBadge: false };
  }

  if (raw >= 75) {
    return { score: raw, grade: 'DAT_CHUAN', earnsVerifiedBadge: true };
  }

  return { score: raw, grade: 'LUU_Y', earnsVerifiedBadge: false };
}

/** Chuyển trạng thái tin xe cũ sau khi chỉnh sửa */
export function usedCarStatusAfterEdit(current: UsedCarListingStatus, importantChange: boolean): UsedCarListingStatus {
  if (current === 'BI_TU_CHOI') return 'NHAP';
  if (!importantChange) return current;
  if (current === 'DANG_BAN' || current === 'TAM_AN') return 'CHO_DUYET';
  return current;
}

export function canSubmitUsedCar(status: UsedCarListingStatus): boolean {
  return status === 'NHAP' || status === 'BI_TU_CHOI';
}

export function computeListingExpiry(publishedAt = new Date()): Date {
  return new Date(publishedAt.getTime() + USED_CAR_LISTING_TTL_DAYS * 86_400_000);
}

/** Máy trạng thái phiếu kiểm định xe cũ */
export const APPRAISAL_TRANSITIONS: Record<UsedCarAppraisalStatus, readonly UsedCarAppraisalStatus[]> = {
  CHO_XAC_NHAN: ['DA_HEN', 'DANG_KIEM_DINH', 'TU_CHOI', 'HUY'],
  DA_HEN: ['DANG_KIEM_DINH', 'HOAN_THANH', 'TU_CHOI', 'HUY'],
  DANG_KIEM_DINH: ['HOAN_THANH'],
  HOAN_THANH: [],
  TU_CHOI: [],
  HUY: [],
};

export function canMoveAppraisal(from: UsedCarAppraisalStatus, to: UsedCarAppraisalStatus): boolean {
  return APPRAISAL_TRANSITIONS[from].includes(to);
}

export function appraisalTransitionError(from: UsedCarAppraisalStatus, to: UsedCarAppraisalStatus): string | null {
  if (canMoveAppraisal(from, to)) return null;
  if (to === 'HUY') {
    return `Phiếu kiểm định đang ở trạng thái "${APPRAISAL_STATUS_LABEL[from]}", không huỷ trực tuyến được nữa.`;
  }
  return `Không thể chuyển phiếu kiểm định từ "${APPRAISAL_STATUS_LABEL[from]}" sang "${APPRAISAL_STATUS_LABEL[to]}"`;
}

/** Che 2 ký tự cuối của biển số khi hiển thị công khai trên sàn (VD: 30H-567.89 -> 30H-567.**) */
export function maskPlatePublic(formattedPlate: string | null | undefined): string | null {
  if (!formattedPlate) return null;
  if (formattedPlate.length <= 4) return formattedPlate;
  return `${formattedPlate.slice(0, -2)}**`;
}

export const usedCarCode = (n: number) => `XC${String(n).padStart(6, '0')}`;
export const appraisalCode = (n: number) => `KD${String(n).padStart(6, '0')}`;
