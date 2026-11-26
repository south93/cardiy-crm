/** Quy tắc đánh giá từ sàn, phản ánh vi phạm & thống kê gian hàng (thuần, test riêng) */
import { canMovePartner } from '../platform/partner-rules';

export type MarketReviewStatus = 'HIEN' | 'AN';

export type MarketReportReason =
  | 'SAI_GIA'
  | 'HANG_KHONG_DUNG'
  | 'THAI_DO_PHUC_VU'
  | 'KHONG_LIEN_LAC_DUOC'
  | 'BAO_HANH_DOI_TRA'
  | 'THONG_TIN_SAI'
  | 'KHAC';

export type MarketReportStatus = 'MOI' | 'CHO_GIAI_TRINH' | 'DA_GIAI_TRINH' | 'DA_XU_LY' | 'TU_CHOI';

export type ViolationAction = 'NHAC_NHO' | 'GO_TIN' | 'TAM_KHOA' | 'CHAM_DUT';

export const REPORT_REASONS: readonly MarketReportReason[] = [
  'SAI_GIA',
  'HANG_KHONG_DUNG',
  'THAI_DO_PHUC_VU',
  'KHONG_LIEN_LAC_DUOC',
  'BAO_HANH_DOI_TRA',
  'THONG_TIN_SAI',
  'KHAC',
];

/** Chỉ yêu cầu đã hoàn tất mới được khách đánh giá */
export const canReviewRequest = (requestStatus: string): boolean => requestStatus === 'HOAN_THANH';

/** Khách được cập nhật đánh giá khi đánh giá đang hiển thị và garage chưa trả lời */
export const canEditReview = (review: { status: MarketReviewStatus; reply: string | null }): boolean =>
  review.status === 'HIEN' && !review.reply;

/** Gộp điểm sao từ nhiều nguồn (đánh giá đơn CRM + đánh giá yêu cầu sàn đang hiển thị) */
export function combineRating(sources: { sum: number; count: number }[]): { avg: number; count: number } | null {
  const count = sources.reduce((s, x) => s + x.count, 0);
  if (count <= 0) return null;
  const sum = sources.reduce((s, x) => s + x.sum, 0);
  return { avg: Math.round((sum / count) * 10) / 10, count };
}

const REPORT_FLOW: Record<MarketReportStatus, MarketReportStatus[]> = {
  MOI: ['CHO_GIAI_TRINH', 'DA_XU_LY', 'TU_CHOI'],
  CHO_GIAI_TRINH: ['DA_GIAI_TRINH', 'DA_XU_LY', 'TU_CHOI'],
  DA_GIAI_TRINH: ['DA_XU_LY', 'TU_CHOI', 'CHO_GIAI_TRINH'],
  DA_XU_LY: [],
  TU_CHOI: [],
};

export const canMoveReport = (from: MarketReportStatus, to: MarketReportStatus): boolean => REPORT_FLOW[from].includes(to);

/** Kiểm tra biện pháp xử lý vi phạm có áp dụng được cho garage này không. Trả về lỗi tiếng Việt hoặc null */
export function checkViolationAction(
  action: ViolationAction,
  tenant: { type: string; status: string },
  offerId?: string | null,
): string | null {
  if (action === 'GO_TIN' && !offerId) return 'Chọn tin đăng cần gỡ';
  if (action === 'TAM_KHOA' || action === 'CHAM_DUT') {
    if (tenant.type !== 'PARTNER') return 'Chỉ tạm khoá hoặc chấm dứt được tài khoản đối tác';
    if (tenant.status === action) return null;
    if (!canMovePartner(tenant.status, action)) return 'Trạng thái đối tác hiện tại không cho phép thao tác này';
  }
  return null;
}

/** Tỉ lệ phần trăm làm tròn 1 chữ số thập phân (VD: 1/3 → 33.3). Mẫu số ≤ 0 trả về null */
export function ratePercent(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/** Ngày YYYY-MM-DD theo múi giờ Việt Nam (UTC+7) */
export function vnYmd(d: Date): string {
  return new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** Chuỗi N ngày gần nhất theo giờ Việt Nam để thống kê lượt xem & yêu cầu */
export function statsWindow(days: number, now = new Date()): {
  days: number;
  keys: string[];
  fromDate: Date;
  toDate: Date;
  fromTimestamp: Date;
} {
  const n = days === 7 || days === 90 ? days : 30;
  const shifted = new Date(now.getTime() + 7 * 3_600_000);
  const endUtc = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(endUtc.getTime() - i * 86_400_000);
    keys.push(d.toISOString().slice(0, 10));
  }
  const firstKey = keys[0]!;
  return {
    days: n,
    keys,
    fromDate: new Date(`${firstKey}T00:00:00.000Z`),
    toDate: endUtc,
    fromTimestamp: new Date(`${firstKey}T00:00:00.000+07:00`),
  };
}
