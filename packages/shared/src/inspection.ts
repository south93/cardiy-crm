/**
 * Phiếu kiểm tra xe (theo mẫu giấy PLG): danh mục hạng mục và kiểu dữ liệu dùng chung
 * cho app kỹ thuật viên (nhập trên điện thoại) và bản in A4.
 * Khoá lưu trong dữ liệu là chính tên hạng mục; đổi tên hạng mục thì dữ liệu cũ của hạng mục đó không còn hiện.
 */

/** Tình trạng: TỐT / CHÚ Ý / THAY THẾ */
export const INSPECTION_LEVELS = ['TOT', 'CHU_Y', 'THAY_THE'] as const;
export type InspectionLevel = (typeof INSPECTION_LEVELS)[number];
export const INSPECTION_LEVEL_LABEL: Record<InspectionLevel, string> = { TOT: 'Tốt', CHU_Y: 'Chú ý', THAY_THE: 'Thay thế' };

export const INSPECTION_REQUESTS = ['Thay lốp', 'Vá lốp', 'Bảo dưỡng', 'Rửa xe', 'Khác'] as const;

export const TYRE_POSITIONS = [
  { key: 'FL', label: 'Trước trái' },
  { key: 'RL', label: 'Sau trái' },
  { key: 'FR', label: 'Trước phải' },
  { key: 'RR', label: 'Sau phải' },
] as const;
export type TyrePosition = (typeof TYRE_POSITIONS)[number]['key'];

export const WIPER_ITEMS = ['Vệt gạt nước', 'Lưỡi gạt (cao su lão hóa, nứt)'] as const;

export const SAFETY_ITEMS_LEFT = ['Lốp xe', 'Gạt mưa', 'Nước rửa kính', 'Má phanh', 'Đĩa phanh', 'Dầu phanh', 'Dầu động cơ'] as const;
export const SAFETY_ITEMS_RIGHT = ['Lọc dầu động cơ', 'Nước làm mát', 'Ắc quy', 'Lọc gió động cơ', 'Lọc gió điều hòa', 'Góc đặt bánh xe'] as const;
export const SAFETY_ITEMS = [...SAFETY_ITEMS_LEFT, ...SAFETY_ITEMS_RIGHT] as const;

/** Gầm trước: in thành 2 cột (13 + 3 dòng) */
export const UNDER_FRONT_ITEMS = [
  'Phuộc trước',
  'Tăm bông phuộc',
  'Chụp bụi phuộc',
  'Chụp bụi láp',
  'Chụp bụi thước lái',
  'Bạc đạn bánh',
  'Rotuyn thanh giằng',
  'Rotuyn lái trong',
  'Rotuyn lái ngoài',
  'Rotuyn trụ trên',
  'Rotuyn trụ dưới',
  'Cao su càng A lớn – dưới',
  'Cao su càng A nhỏ – dưới',
  'Cao su càng A lớn – trên',
  'Cao su càng A nhỏ – trên',
  'Cao su cung D',
] as const;
export const UNDER_REAR_ITEMS = ['Phuộc sau', 'Tăm bông phuộc', 'Chụp bụi phuộc', 'Bạc đạn bánh', 'Rotuyn thanh giằng', 'Cao su cung D', 'Cao su chữ Y', 'Cao su thanh giằng dọc'] as const;

export const FINAL_CHECK_ITEMS = [
  'Hoàn thành sửa chữa, siết đủ lực',
  'Lốp bình thường, áp suất về chuẩn',
  'Hệ thống phanh bình thường',
  'Gạt mưa bình thường',
  'Hệ thống đèn bình thường',
  'Dầu / dung dịch đủ, đã reset bảo dưỡng',
  'Ắc quy khỏe, đấu nối chắc',
  'Giảm xóc, chụp bụi không hư',
  'Giá đỡ, gầm, cao su giằng không hư',
  'Không bỏ sót ốp, phụ kiện táp-lô',
  'Không bỏ quên dụng cụ trên xe',
] as const;

export interface TyreCheck {
  /** Mòn / lão hoá / xì hơi / phù */
  wear?: InspectionLevel | null;
  /** Hãng / quy cách */
  brand?: string | null;
  /** Áp suất (bar) */
  pressure?: number | null;
  valve?: InspectionLevel | null;
  /** Độ sâu gai (mm) */
  tread?: number | null;
}

export interface InspectionData {
  requests?: string[];
  maintenanceLevel?: string | null;
  tyres?: Partial<Record<TyrePosition, TyreCheck>>;
  sparePressure?: number | null;
  wiper?: Record<string, InspectionLevel>;
  /** Ghi chú thân vỏ (móp, trầy, đá văng, sơn lại) */
  bodyNote?: string | null;
  safety?: Record<string, InspectionLevel>;
  underFront?: Record<string, { L?: InspectionLevel | null; R?: InspectionLevel | null }>;
  underRear?: Record<string, { L?: InspectionLevel | null; R?: InspectionLevel | null }>;
  /** Khuyến nghị của KTV */
  recommendation?: string | null;
  /** Hạng mục đề xuất từ kiểm tra an toàn */
  suggestions?: string | null;
  /** Kiểm tra cuối: true = đạt, false = không đạt */
  final?: Record<string, boolean>;
  finalOther?: string | null;
}

/** Đếm số hạng mục cần chú ý / thay thế (để hiện tóm tắt) */
export function inspectionSummary(d: InspectionData | null | undefined) {
  const out = { checked: 0, attention: 0, replace: 0 };
  if (!d) return out;
  const add = (v: InspectionLevel | null | undefined) => {
    if (!v) return;
    out.checked++;
    if (v === 'CHU_Y') out.attention++;
    if (v === 'THAY_THE') out.replace++;
  };
  for (const t of Object.values(d.tyres ?? {})) {
    add(t?.wear);
    add(t?.valve);
  }
  for (const v of [...Object.values(d.wiper ?? {}), ...Object.values(d.safety ?? {})]) add(v);
  for (const side of [d.underFront, d.underRear]) {
    for (const x of Object.values(side ?? {})) {
      add(x?.L);
      add(x?.R);
    }
  }
  return out;
}
