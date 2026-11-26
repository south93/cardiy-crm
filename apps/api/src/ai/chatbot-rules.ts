import { searchKey } from '@cardiy/shared';
import type { OpeningDay } from '../marketplace/offer-rules';
import { checkSchedule } from '../marketplace/request-rules';
import { bookingTimeError } from '../owner/owner-booking';
import { extractKeywords } from './ai-rules';

const VN_OFFSET_MS = 7 * 3_600_000;

const POPULAR_MAKES = [
  'Toyota',
  'Mazda',
  'Hyundai',
  'Honda',
  'Kia',
  'Ford',
  'Mitsubishi',
  'VinFast',
  'Mercedes',
  'BMW',
  'Suzuki',
  'Nissan',
  'Peugeot',
  'Subaru',
  'Isuzu',
  'Lexus',
];

export interface MaintenancePlan {
  inputKm: number;
  milestoneKm: number;
  tierCode: 'CAP_NHO' | 'CAP_TRUNG_BINH' | 'CAP_TRUNG' | 'CAP_LON';
  tierLabel: string;
  vehicleLabel: string | null;
  estimatedMinutes: number;
  checklist: string[];
}

export interface ChatbotOfferCandidate {
  offerId: string;
  tenantId: string;
  shopName: string;
  shopSlug: string;
  kind: 'PRODUCT' | 'SERVICE';
  itemCode: string;
  name: string;
  brand: string | null;
  category: string | null;
  price: number;
  priceFrom: boolean;
  installIncluded: boolean;
  durationMinutes: number | null;
  available: number | null;
  openingHours: OpeningDay[];
}

/** Bóc tách hãng xe và số km từ câu hỏi tự nhiên tiếng Việt (VD: "Mazda CX-5 đi 4 vạn km" -> Mazda, 40000) */
export function parseVehicleAndKmFromText(text: string): { make: string | null; odometerKm: number | null } {
  const norm = searchKey(text);
  let foundMake: string | null = null;
  for (const m of POPULAR_MAKES) {
    const mk = searchKey(m);
    if (new RegExp(`\\b${mk}\\b`).test(norm)) {
      foundMake = m;
      break;
    }
  }

  // 1. Dạng "4 vạn", "4.5 vạn", "4,5 van"
  const vanMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:vạn|van)\b/i);
  if (vanMatch?.[1]) {
    const num = Number(vanMatch[1].replace(',', '.'));
    if (Number.isFinite(num) && num > 0 && num <= 100) {
      return { make: foundMake, odometerKm: Math.round(num * 10_000) };
    }
  }

  // 2. Dạng "40k km" / "40k"
  const kMatch = text.match(/\b(\d{1,3})\s*k(?:\s*km)?\b/i);
  if (kMatch?.[1]) {
    const num = Number(kMatch[1]);
    if (num >= 5 && num <= 500) {
      return { make: foundMake, odometerKm: num * 1_000 };
    }
  }

  // 3. Dạng "40.000 km", "40,000km", "40000 km"
  const kmMatch = text.match(/\b(\d{1,3}(?:[.,]\d{3})+|\d{4,6})\s*km\b/i);
  if (kmMatch?.[1]) {
    const digits = Number(kmMatch[1].replace(/[.,]/g, ''));
    if (Number.isFinite(digits) && digits >= 1_000 && digits <= 1_000_000) {
      return { make: foundMake, odometerKm: digits };
    }
  }

  return { make: foundMake, odometerKm: null };
}

/** Lập danh mục hạng mục bảo dưỡng khuyến nghị theo mốc km chuẩn xưởng Việt Nam */
export function buildMaintenanceChecklistByKm(odometerKm: number, vehicleLabel?: string | null): MaintenancePlan {
  const safeKm = Math.max(0, Math.round(odometerKm));
  const milestoneKm =
    safeKm <= 5_000
      ? 5_000
      : safeKm % 5_000 === 0
        ? safeKm
        : Math.ceil(safeKm / 5_000) * 5_000;

  if (milestoneKm % 40_000 === 0) {
    const extra80k =
      milestoneKm % 80_000 === 0
        ? ['Kiểm tra dây curoa tổng, puly tăng tỳ & lọc nhiên liệu (mốc 80.000 km)']
        : [];
    return {
      inputKm: safeKm,
      milestoneKm,
      tierCode: 'CAP_LON',
      tierLabel: `Bảo dưỡng cấp lớn (${milestoneKm.toLocaleString('vi-VN')} km)`,
      vehicleLabel: vehicleLabel?.trim() || null,
      estimatedMinutes: 150,
      checklist: [
        'Thay dầu động cơ tổng hợp & thay lọc dầu động cơ',
        'Thay lọc gió động cơ & lọc gió điều hoà cabin',
        'Thay dầu phanh DOT4 & thay nước làm mát động cơ',
        'Bảo dưỡng phanh 4 bánh, đảo lốp & cân bằng động',
        'Kiểm tra/thay bugi, vệ sinh họng ga – kim phun & kiểm tra dầu hộp số',
        ...extra80k,
      ],
    };
  }

  if (milestoneKm % 20_000 === 0) {
    return {
      inputKm: safeKm,
      milestoneKm,
      tierCode: 'CAP_TRUNG',
      tierLabel: `Bảo dưỡng cấp trung (${milestoneKm.toLocaleString('vi-VN')} km)`,
      vehicleLabel: vehicleLabel?.trim() || null,
      estimatedMinutes: 90,
      checklist: [
        'Thay dầu động cơ & thay lọc dầu động cơ',
        'Thay lọc gió điều hoà & kiểm tra/thay lọc gió động cơ',
        'Bảo dưỡng vệ sinh phanh 4 bánh, đảo lốp & cân bằng động',
        'Đo kiểm dung lượng ắc quy, góc đặt bánh xe & hệ thống gầm',
      ],
    };
  }

  if (milestoneKm % 10_000 === 0) {
    return {
      inputKm: safeKm,
      milestoneKm,
      tierCode: 'CAP_TRUNG_BINH',
      tierLabel: `Bảo dưỡng cấp trung bình (${milestoneKm.toLocaleString('vi-VN')} km)`,
      vehicleLabel: vehicleLabel?.trim() || null,
      estimatedMinutes: 60,
      checklist: [
        'Thay dầu động cơ & thay lọc dầu động cơ',
        'Vệ sinh lọc gió động cơ & lọc gió điều hoà',
        'Đảo lốp 4 bánh, kiểm tra má phanh & hệ thống đèn/gạt mưa',
      ],
    };
  }

  return {
    inputKm: safeKm,
    milestoneKm,
    tierCode: 'CAP_NHO',
    tierLabel: `Bảo dưỡng định kỳ cấp nhỏ (${milestoneKm.toLocaleString('vi-VN')} km)`,
    vehicleLabel: vehicleLabel?.trim() || null,
    estimatedMinutes: 45,
    checklist: [
      'Thay dầu động cơ đúng phẩm cấp độ nhớt theo xe',
      'Kiểm tra áp suất lốp, nước làm mát, dầu phanh & châm nước rửa kính',
      'Kiểm tra nhanh hệ thống đèn chiếu sáng, ắc quy & gạt mưa',
    ],
  };
}

/** Nhận diện ý định muốn đặt lịch / hẹn giờ của chủ xe hoặc khách trên sàn */
export function detectBookingIntent(text: string): boolean {
  const norm = searchKey(text);
  return /(dat lich|hen lich|dat hen|hen gio|khung gio|gio trong|qua xuong|mang xe qua|lap dat|muon dat)/.test(norm);
}

/** Nhận diện câu hỏi liên quan tới lịch bảo dưỡng định kỳ */
export function detectMaintenanceIntent(text: string): boolean {
  const norm = searchKey(text);
  return /(bao duong|dinh ky|moc km|van km|thay dau|thay nhot|can lam gi|hang muc)/.test(norm);
}

/** Mở rộng nhu cầu của chủ xe sang từ khoá tìm tin đăng trên sàn */
function expandMarketSynonyms(normQuery: string): string[] {
  const out: string[] = [];
  if (/(bao duong|dinh ky|thay dau|thay nhot|5w30|5w-30|0w20)/.test(normQuery)) {
    out.push('bao duong', 'dau', 'castrol', 'mobil', 'nhot');
  }
  if (/(lop|vo xe|michelin|bridgestone|205|215|can bang)/.test(normQuery)) {
    out.push('lop', 'michelin', 'bridgestone');
  }
  if (/(ac quy|het binh|de yeu|binh dien|gs|varta)/.test(normQuery)) {
    out.push('ac quy', 'gs', 'varta');
  }
  if (/(dieu hoa|kem mat|lanh|phanh|thang|sua chua|kiem tra)/.test(normQuery)) {
    out.push('sua chua', 'bao duong', 'kiem tra');
  }
  if (/(dong son|tray xuoc|danh bong|son xe)/.test(normQuery)) {
    out.push('dong son', 'son');
  }
  return out;
}

/** Đối chiếu & xếp hạng các tin sản phẩm / dịch vụ đang bán trên sàn theo câu hỏi của khách */
export function matchMarketplaceOffers(
  query: string,
  candidates: readonly ChatbotOfferCandidate[],
  limit = 4,
): ChatbotOfferCandidate[] {
  const normQuery = searchKey(query);
  const tokens = extractKeywords(query);
  const expanded = expandMarketSynonyms(normQuery);

  const scored = candidates
    .filter((c) => c.kind === 'SERVICE' || c.available === null || c.available > 0)
    .map((c) => {
      const hay = searchKey(c.itemCode, c.name, c.brand, c.category, c.shopName);
      let score = 0;
      for (const ph of expanded) {
        if (hay.includes(ph)) score += 6;
      }
      for (const tk of tokens) {
        if (tk.length >= 3 && hay.includes(tk)) score += 4;
      }
      if (/(gia|bao nhieu|chi phi)/.test(normQuery) && score > 0) score += 2;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.c.price - b.c.price);

  return scored.slice(0, limit).map((x) => x.c);
}

/**
 * Đề xuất các khung giờ hẹn hợp lệ trên App chủ xe (A2):
 * - Tuân thủ nghiêm ngặt BOOKING_HOURS (07:30 -> 17:00 giờ VN, chẵn/rưỡi)
 * - Cách hiện tại ít nhất 90 phút để khách thoải mái bấm xác nhận mà không vi phạm lead-time 60 phút
 * - Tránh hoàn toàn các khung giờ nằm trong khoảng ±3 giờ quanh lịch hẹn đang chờ của xe đó
 */
export function proposeOwnerBookingSlots(opts: {
  now?: Date;
  existingScheduledAts?: readonly Date[];
  count?: number;
}): string[] {
  const now = opts.now ?? new Date();
  const existing = opts.existingScheduledAts ?? [];
  const targetCount = opts.count ?? 4;
  const preferredMinutes = [8 * 60 + 30, 10 * 60, 14 * 60, 15 * 60 + 30];
  const minEpoch = now.getTime() + 90 * 60_000;
  const results: string[] = [];

  const vnNow = new Date(now.getTime() + VN_OFFSET_MS);
  for (let dayOffset = 0; dayOffset <= 14 && results.length < targetCount; dayOffset++) {
    const dayUtc = new Date(Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate() + dayOffset));
    for (const mins of preferredMinutes) {
      if (results.length >= targetCount) break;
      const candidate = new Date(
        Date.UTC(dayUtc.getUTCFullYear(), dayUtc.getUTCMonth(), dayUtc.getUTCDate(), 0, mins) - VN_OFFSET_MS,
      );
      if (candidate.getTime() < minEpoch) continue;
      if (bookingTimeError(candidate, now) !== null) continue;
      const collides = existing.some((ex) => Math.abs(ex.getTime() - candidate.getTime()) <= 3 * 3_600_000);
      if (collides) continue;
      results.push(candidate.toISOString());
    }
  }

  return results;
}

/**
 * Đề xuất khung giờ hẹn hợp lệ theo giờ mở cửa gian hàng trên Web sàn (A1):
 * - Khớp tuyệt đối checkSchedule(slot, openingHours, now) === null
 * - Cách hiện tại ít nhất 90 phút để khách điền tên/SĐT rồi bấm Xác nhận luôn hợp lệ
 */
export function proposeShopRequestSlots(opts: {
  openingHours: OpeningDay[];
  now?: Date;
  count?: number;
}): string[] {
  const now = opts.now ?? new Date();
  const targetCount = opts.count ?? 4;
  const minEpoch = now.getTime() + 90 * 60_000;
  const preferred = ['08:30', '10:00', '14:00', '15:30', '09:00', '11:00', '16:00'];
  const results: string[] = [];

  const vnNow = new Date(now.getTime() + VN_OFFSET_MS);
  for (let dayOffset = 0; dayOffset <= 14 && results.length < targetCount; dayOffset++) {
    const dayUtc = new Date(Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate() + dayOffset));
    const ymd = dayUtc.toISOString().slice(0, 10);
    for (const hm of preferred) {
      if (results.length >= targetCount) break;
      const candidate = new Date(`${ymd}T${hm}:00+07:00`);
      if (candidate.getTime() < minEpoch) continue;
      if (checkSchedule(candidate, opts.openingHours, now) !== null) continue;
      results.push(candidate.toISOString());
    }
  }

  return results;
}
