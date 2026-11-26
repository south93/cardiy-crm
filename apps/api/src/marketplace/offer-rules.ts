/** Quy tắc tin đăng & gian hàng trên sàn (thuần, test riêng) */

export type OfferStatus = 'NHAP' | 'CHO_DUYET' | 'DANG_BAN' | 'BI_TU_CHOI' | 'TAM_AN' | 'BI_GO';

/** Garage tự sửa được tin ở các trạng thái này (tin bị gỡ thì không) */
export const EDITABLE: OfferStatus[] = ['NHAP', 'CHO_DUYET', 'DANG_BAN', 'BI_TU_CHOI', 'TAM_AN'];

/**
 * Trạng thái sau khi garage sửa tin.
 * Đổi sản phẩm / dịch vụ chuẩn, ghi chú hoặc ảnh là đổi thông tin quan trọng: tin đang bán phải duyệt lại.
 * Đổi giá, tồn, chi nhánh, lắp đặt… giữ nguyên trạng thái. Tin bị từ chối sửa xong về Nháp.
 */
export function statusAfterEdit(current: OfferStatus, importantChanged: boolean, autoApprove: boolean): OfferStatus {
  if (current === 'BI_TU_CHOI') return 'NHAP';
  if (importantChanged && (current === 'DANG_BAN' || current === 'TAM_AN')) return autoApprove ? current : 'CHO_DUYET';
  return current;
}

/** Gửi duyệt: garage của chủ sàn (PLG) lên bán ngay, đối tác chờ sàn duyệt */
export function statusOnSubmit(current: OfferStatus, autoApprove: boolean): OfferStatus | null {
  if (current !== 'NHAP') return null;
  return autoApprove ? 'DANG_BAN' : 'CHO_DUYET';
}

const FLOW: Record<OfferStatus, OfferStatus[]> = {
  NHAP: ['CHO_DUYET', 'DANG_BAN'],
  CHO_DUYET: ['DANG_BAN', 'BI_TU_CHOI'],
  BI_TU_CHOI: ['NHAP'],
  DANG_BAN: ['TAM_AN', 'BI_GO', 'CHO_DUYET'],
  TAM_AN: ['DANG_BAN', 'BI_GO', 'CHO_DUYET'],
  BI_GO: [],
};
export const canMoveOffer = (from: OfferStatus, to: OfferStatus) => FLOW[from].includes(to);

/** Tồn khả dụng: PLG cộng tồn các chi nhánh bán (không âm); đối tác dùng số nhập tay. Dịch vụ không tính tồn (null) */
export function availableStock(o: { kind: string; productId: string | null; manualStock: number | null; branchIds: string[] }, levels: { branchId: string; quantity: number }[]): number | null {
  if (o.kind === 'SERVICE') return null;
  if (!o.productId) return Math.max(0, o.manualStock ?? 0);
  const rows = o.branchIds.length ? levels.filter((l) => o.branchIds.includes(l.branchId)) : levels;
  return Math.max(0, Math.floor(rows.reduce((s, l) => s + Math.max(0, l.quantity), 0)));
}

/** Hiện trên sàn: đang bán, gian hàng hoạt động; sản phẩm còn hàng thì "Còn hàng" */
export function publicState(status: OfferStatus, stock: number | null): 'CON_HANG' | 'HET_HANG' | 'AN' {
  if (status !== 'DANG_BAN') return 'AN';
  return stock === 0 ? 'HET_HANG' : 'CON_HANG';
}

export interface OpeningDay {
  day: number;
  open: string;
  close: string;
  closed: boolean;
}
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Kiểm tra giờ mở cửa: đủ 7 ngày, giờ HH:mm, mở trước đóng. Trả về lỗi đầu tiên hoặc null */
export function checkOpeningHours(days: OpeningDay[]): string | null {
  const seen = new Set<number>();
  for (const d of days) {
    if (d.day < 0 || d.day > 6 || seen.has(d.day)) return 'Ngày trong tuần không hợp lệ';
    seen.add(d.day);
    if (d.closed) continue;
    if (!HM.test(d.open) || !HM.test(d.close)) return 'Giờ phải có dạng 07:30';
    if (d.open >= d.close) return 'Giờ mở cửa phải trước giờ đóng cửa';
  }
  return null;
}

/** Đường dẫn gian hàng từ tên: bỏ dấu tiếng Việt, chữ thường, nối bằng gạch ngang */
export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Gian hàng sẵn sàng hiện trên sàn: còn thiếu gì */
export function shopMissing(
  s: { name?: string | null; phone?: string | null; address?: string | null; lat?: number | null; openingHours: OpeningDay[] } | null,
  liveOffers: number,
  tenantStatus: string,
): string[] {
  const miss: string[] = [];
  if (tenantStatus !== 'HOAT_DONG') miss.push(tenantStatus === 'DANG_THIET_LAP' ? 'Nộp phí kỳ đầu để kích hoạt gian hàng' : 'Gian hàng đang bị khoá');
  if (!s?.name || !s.phone || !s.address) miss.push('Điền tên, số điện thoại, địa chỉ gian hàng');
  if (s && s.lat == null) miss.push('Đánh dấu vị trí trên bản đồ');
  if (!s?.openingHours.some((d) => !d.closed)) miss.push('Nhập giờ mở cửa');
  if (!liveOffers) miss.push('Có ít nhất 1 sản phẩm hoặc dịch vụ đang bán');
  return miss;
}

/** Đang mở cửa theo giờ Việt Nam (UTC+7) */
export function openNow(hours: OpeningDay[], now = new Date()): boolean {
  const vn = new Date(now.getTime() + 7 * 3_600_000);
  const d = hours.find((h) => h.day === vn.getUTCDay());
  if (!d || d.closed) return false;
  const hm = `${String(vn.getUTCHours()).padStart(2, '0')}:${String(vn.getUTCMinutes()).padStart(2, '0')}`;
  return hm >= d.open && hm < d.close;
}

/** Khoảng cách đường chim bay (km), làm tròn 0,1 */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}

/** Tên khách trên đánh giá công khai: chỉ giữ tên gọi, VD "Nguyễn Văn Cường" → "Cường" */
export const reviewerName = (full: string | null | undefined) => (full?.trim().split(/\s+/).pop() ?? '') || 'Khách';

/** Gian hàng hiện trên sàn: garage chủ sàn (không bị khoá) hoặc đối tác đang hoạt động */
export function tenantListable(t: { type: string; status: string; deletedAt: Date | null }): boolean {
  if (t.deletedAt) return false;
  if (t.type === 'GARAGE') return !['TAM_KHOA', 'CHAM_DUT', 'TU_CHOI'].includes(t.status);
  return t.type === 'PARTNER' && t.status === 'HOAT_DONG';
}
