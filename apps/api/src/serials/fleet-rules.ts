import { removeDiacritics } from '@cardiy/shared';
import type { SerialEventAction, SerialKind, SerialStatus } from '@prisma/client';
import { addMonths, vnDate, vnToday, ymd } from '../care/care-rules';

export type MaintenanceAlertState = 'QUA_HAN' | 'SAP_DEN_HAN' | 'BINH_THUONG';
export type WarrantyState = 'CON_BAO_HANH' | 'SAP_HET_BAO_HANH' | 'HET_BAO_HANH' | 'CHUA_KICH_HOAT';

export const SERIAL_KIND_LABEL: Record<SerialKind, string> = {
  LOP: 'Lốp xe',
  AC_QUY: 'Ắc quy',
  PIN_LITHIUM: 'Pin Lithium',
};

export const SERIAL_STATUS_LABEL: Record<SerialStatus, string> = {
  TRONG_KHO: 'Trong kho',
  DANG_SU_DUNG: 'Đang gắn trên xe',
  DA_THAO: 'Đã tháo rời',
  BAO_HANH: 'Đang xử lý bảo hành',
  LOAI_BO: 'Ngừng sử dụng',
};

export const SERIAL_ACTION_LABEL: Record<SerialEventAction, string> = {
  NHAP_KHO: 'Nhập kho sê-ri',
  LAP_MOI: 'Lắp mới lên xe',
  LAP_LAI: 'Lắp lại lên xe',
  DAO_VI_TRI: 'Đảo vị trí trên xe',
  CHUYEN_XE: 'Chuyển sang xe khác',
  THAO_RA: 'Tháo rời khỏi xe',
  DOI_BAO_HANH: 'Đổi / Xử lý bảo hành',
  LOAI_BO: 'Thanh lý / Loại bỏ',
};

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

export function positionLabel(pos: string | null | undefined): string | null {
  if (!pos) return null;
  return SERIAL_POSITIONS.find((p) => p.code === pos)?.label ?? pos;
}

export const BADGE_TYPES: readonly { code: string; label: string }[] = [
  { code: 'XE_HOP_DONG', label: 'Xe hợp đồng' },
  { code: 'XE_TAI', label: 'Xe tải vận chuyển hàng' },
  { code: 'CONTAINER', label: 'Xe đầu kéo / Container' },
  { code: 'TUYEN_CO_DINH', label: 'Xe khách tuyến cố định' },
  { code: 'TAXI', label: 'Xe Taxi' },
  { code: 'NOI_BO', label: 'Xe vận tải nội bộ' },
];

export interface DefaultMaintenanceRuleSeed {
  code: string;
  name: string;
  intervalKm: number | null;
  intervalMonths: number | null;
  remindBeforeKm: number;
  remindBeforeDays: number;
  keywords: string[];
  sortOrder: number;
}

export const DEFAULT_MAINTENANCE_RULES: readonly DefaultMaintenanceRuleSeed[] = [
  {
    code: 'DAU_NHOT',
    name: 'Thay dầu nhớt động cơ',
    intervalKm: 5000,
    intervalMonths: 6,
    remindBeforeKm: 500,
    remindBeforeDays: 15,
    keywords: ['dau nhot', 'nhot may', 'nhot dong co', '5w30', '5w-30', '10w40', '0w20', 'castrol', 'mobil'],
    sortOrder: 1,
  },
  {
    code: 'LOC_NHOT',
    name: 'Thay lọc dầu động cơ',
    intervalKm: 10000,
    intervalMonths: 12,
    remindBeforeKm: 500,
    remindBeforeDays: 15,
    keywords: ['loc nhot', 'loc dau dong co'],
    sortOrder: 2,
  },
  {
    code: 'LOP_DAO',
    name: 'Đảo lốp & cân bằng động',
    intervalKm: 10000,
    intervalMonths: 6,
    remindBeforeKm: 500,
    remindBeforeDays: 15,
    keywords: ['dao lop', 'can bang dong', 'can chinh thuoc lai'],
    sortOrder: 3,
  },
  {
    code: 'LOP_THAY',
    name: 'Thay lốp xe ô tô',
    intervalKm: 50000,
    intervalMonths: 48,
    remindBeforeKm: 2000,
    remindBeforeDays: 30,
    keywords: ['lop michelin', 'lop bridgestone', 'lop kumho', 'lop hankook', 'lop continental', 'thay lop'],
    sortOrder: 4,
  },
  {
    code: 'AC_QUY',
    name: 'Kiểm tra / Thay bình ắc quy',
    intervalKm: 40000,
    intervalMonths: 24,
    remindBeforeKm: 1500,
    remindBeforeDays: 30,
    keywords: ['ac quy', 'binh dien', 'varta', 'delkor', 'amaron', 'gs mf'],
    sortOrder: 5,
  },
  {
    code: 'PIN_LITHIUM',
    name: 'Bảo dưỡng / Kiểm tra Pin Lithium',
    intervalKm: 30000,
    intervalMonths: 12,
    remindBeforeKm: 1000,
    remindBeforeDays: 20,
    keywords: ['pin lithium', 'lifepo4', 'pack pin'],
    sortOrder: 6,
  },
  {
    code: 'MA_PHANH',
    name: 'Kiểm tra / Thay má phanh & dầu phanh',
    intervalKm: 20000,
    intervalMonths: 12,
    remindBeforeKm: 1000,
    remindBeforeDays: 20,
    keywords: ['ma phanh', 'bo thang', 'dau phanh'],
    sortOrder: 7,
  },
];

export function normalizeSerialNo(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '-');
}

export function computeNextDue(opts: {
  installedAt: Date;
  installedKm: number | null;
  intervalKm: number | null;
  intervalMonths: number | null;
}): { nextDueKm: number | null; nextDueDate: Date | null } {
  const baseDate = vnDate(opts.installedAt);
  const nextDueKm =
    opts.installedKm !== null && opts.intervalKm !== null && opts.intervalKm > 0
      ? opts.installedKm + opts.intervalKm
      : null;
  const nextDueDate =
    opts.intervalMonths !== null && opts.intervalMonths > 0
      ? addMonths(baseDate, opts.intervalMonths)
      : null;
  return { nextDueKm, nextDueDate };
}

export interface EvaluatedMaintenanceItem {
  kmDriven: number | null;
  kmRemaining: number | null;
  daysRemaining: number | null;
  alertState: MaintenanceAlertState;
  reasonText: string;
}

/**
 * Đánh giá tình trạng sử dụng & nhắc bảo dưỡng của một hạng mục trên xe:
 * - Tính số km đã chạy kể từ lúc lắp/thay (currentKm - installedKm)
 * - Kích hoạt nhắc khi số km còn lại <= remindBeforeKm HOẶC số ngày còn lại <= remindBeforeDays
 */
export function evaluateMaintenanceItem(
  item: {
    installedAt: Date;
    installedKm: number | null;
    intervalKm: number | null;
    intervalMonths: number | null;
    remindBeforeKm: number;
    remindBeforeDays: number;
    nextDueKm: number | null;
    nextDueDate: Date | null;
  },
  currentOdometerKm: number | null,
  today = vnToday(),
): EvaluatedMaintenanceItem {
  const kmDriven =
    currentOdometerKm !== null && item.installedKm !== null
      ? Math.max(0, currentOdometerKm - item.installedKm)
      : null;

  const kmRemaining =
    item.nextDueKm !== null && currentOdometerKm !== null
      ? item.nextDueKm - currentOdometerKm
      : null;

  const daysRemaining =
    item.nextDueDate !== null
      ? Math.round((vnDate(item.nextDueDate).getTime() - vnDate(today).getTime()) / 86_400_000)
      : null;

  const kmOverdue = kmRemaining !== null && kmRemaining <= 0;
  const dateOverdue = daysRemaining !== null && daysRemaining < 0;
  const kmDueSoon = kmRemaining !== null && kmRemaining > 0 && kmRemaining <= item.remindBeforeKm;
  const dateDueSoon = daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= item.remindBeforeDays;

  let alertState: MaintenanceAlertState = 'BINH_THUONG';
  if (kmOverdue || dateOverdue) alertState = 'QUA_HAN';
  else if (kmDueSoon || dateDueSoon) alertState = 'SAP_DEN_HAN';

  const parts: string[] = [];
  if (kmDriven !== null && item.intervalKm) {
    parts.push(`Đã chạy ${kmDriven.toLocaleString('vi-VN')}/${item.intervalKm.toLocaleString('vi-VN')} km`);
  } else if (kmDriven !== null) {
    parts.push(`Đã chạy ${kmDriven.toLocaleString('vi-VN')} km từ lúc thay`);
  }
  if (kmRemaining !== null) {
    parts.push(
      kmRemaining <= 0
        ? `quá mốc ${Math.abs(kmRemaining).toLocaleString('vi-VN')} km`
        : `còn ${kmRemaining.toLocaleString('vi-VN')} km`,
    );
  }
  if (item.nextDueDate !== null && daysRemaining !== null) {
    const dueLabel = ymd(vnDate(item.nextDueDate)).split('-').reverse().join('/');
    parts.push(
      daysRemaining < 0
        ? `quá hạn ${Math.abs(daysRemaining)} ngày (mốc ${dueLabel})`
        : `hạn ${dueLabel} (còn ${daysRemaining} ngày)`,
    );
  }

  return {
    kmDriven,
    kmRemaining,
    daysRemaining,
    alertState,
    reasonText: parts.join(' · ') || 'Đang theo dõi',
  };
}

export interface EvaluatedWarranty {
  warrantyState: WarrantyState;
  daysLeft: number | null;
  kmLeft: number | null;
  kmUsedSinceInstall: number | null;
  summaryText: string;
}

/** Đánh giá hạn bảo hành của Lốp / Ắc quy / Pin Lithium theo cả thời gian và số km */
export function evaluateSerialWarranty(
  serial: {
    installedAt: Date | null;
    installedKm: number | null;
    warrantyMonths: number | null;
    warrantyKm: number | null;
    warrantyExpiresAt: Date | null;
    warrantyMaxKm: number | null;
  },
  currentOdometerKm: number | null,
  today = vnToday(),
): EvaluatedWarranty {
  if (!serial.installedAt || (!serial.warrantyExpiresAt && !serial.warrantyMaxKm)) {
    return {
      warrantyState: 'CHUA_KICH_HOAT',
      daysLeft: null,
      kmLeft: null,
      kmUsedSinceInstall: null,
      summaryText: serial.installedAt ? 'Không áp dụng hạn bảo hành' : 'Chưa lắp lên xe (chưa tính bảo hành)',
    };
  }

  const kmUsedSinceInstall =
    currentOdometerKm !== null && serial.installedKm !== null
      ? Math.max(0, currentOdometerKm - serial.installedKm)
      : null;

  const daysLeft =
    serial.warrantyExpiresAt !== null
      ? Math.round((vnDate(serial.warrantyExpiresAt).getTime() - vnDate(today).getTime()) / 86_400_000)
      : null;

  const kmLeft =
    serial.warrantyMaxKm !== null && currentOdometerKm !== null
      ? serial.warrantyMaxKm - currentOdometerKm
      : null;

  const expiredByDate = daysLeft !== null && daysLeft < 0;
  const expiredByKm = kmLeft !== null && kmLeft < 0;
  const soonByDate = daysLeft !== null && daysLeft >= 0 && daysLeft <= 30;
  const soonByKm = kmLeft !== null && kmLeft >= 0 && kmLeft <= 1500;

  let warrantyState: WarrantyState = 'CON_BAO_HANH';
  if (expiredByDate || expiredByKm) warrantyState = 'HET_BAO_HANH';
  else if (soonByDate || soonByKm) warrantyState = 'SAP_HET_BAO_HANH';

  const parts: string[] = [];
  if (serial.warrantyExpiresAt !== null && daysLeft !== null) {
    const expStr = ymd(vnDate(serial.warrantyExpiresAt)).split('-').reverse().join('/');
    parts.push(daysLeft < 0 ? `Hết hạn ngày ${expStr}` : `Đến ${expStr} (còn ${daysLeft} ngày)`);
  }
  if (serial.warrantyMaxKm !== null) {
    if (kmLeft !== null) {
      parts.push(
        kmLeft < 0
          ? `Vượt định mức ${Math.abs(kmLeft).toLocaleString('vi-VN')} km`
          : `Tối đa ${serial.warrantyMaxKm.toLocaleString('vi-VN')} km (còn ${kmLeft.toLocaleString('vi-VN')} km)`,
      );
    } else {
      parts.push(`Tối đa ${serial.warrantyMaxKm.toLocaleString('vi-VN')} km`);
    }
  }

  return {
    warrantyState,
    daysLeft,
    kmLeft,
    kmUsedSinceInstall,
    summaryText: parts.join(' · '),
  };
}

/** Đối chiếu tên hạng mục trên Lệnh sửa chữa với bộ quy tắc bảo dưỡng theo từ khoá không dấu */
export function matchRuleByItemName<T extends { code: string; active?: boolean; keywords: string[] }>(
  itemName: string,
  rules: readonly T[],
): T | null {
  const norm = removeDiacritics(itemName).toLowerCase();
  for (const r of rules) {
    if (r.active === false) continue;
    for (const kw of r.keywords) {
      const k = removeDiacritics(kw).toLowerCase().trim();
      if (k && norm.includes(k)) return r;
    }
  }
  return null;
}
