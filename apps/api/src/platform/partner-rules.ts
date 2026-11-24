/** Quy tắc đối tác & phí gói (thuần, test riêng) */

/** Hạn thanh toán: 7 ngày kể từ ngày đầu kỳ */
export const DUE_DAYS = 7;
/** Quá hạn N ngày thì gợi ý tạm khoá gian hàng (máy trạng thái S7) */
export const SUSPEND_AFTER_DAYS = 15;
/** Phát hành hoá đơn kỳ tới khi còn ≤ N ngày là hết kỳ đã lập hoá đơn */
export const ISSUE_AHEAD_DAYS = 7;

const DAY = 86_400_000;
/** Ngày (UTC 00:00) cộng n tháng, giữ ngày cuối tháng hợp lệ (31/1 + 1 tháng → 28 hoặc 29/2) */
export function addMonths(d: Date, n: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
}
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
/** Ngày theo giờ VN dưới dạng Date UTC 00:00 (khớp cột @db.Date) */
export function vnDate(now = new Date()): Date {
  const x = new Date(now.getTime() + 7 * 3_600_000);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}

/** Kỳ phí tiếp theo: [từ, đến) theo chu kỳ của gói; số tiền = phí tháng × số tháng */
export function nextPeriod(from: Date, billingMonths: number, monthlyFee: number) {
  const to = addMonths(from, billingMonths);
  return { periodFrom: from, periodTo: to, amount: monthlyFee * billingMonths, dueDate: addDays(from, DUE_DAYS) };
}

/** Hoá đơn chưa trả và đã qua hạn: số ngày quá hạn (0 = chưa quá hạn) */
export function overdueDays(inv: { status: string; dueDate: Date }, today = vnDate()): number {
  if (inv.status !== 'DA_PHAT_HANH') return 0;
  return Math.max(0, Math.floor((today.getTime() - inv.dueDate.getTime()) / DAY));
}

/** Chuyển trạng thái hồ sơ đăng ký đối tác */
const FLOW: Record<string, string[]> = {
  CHO_DUYET: ['CAN_BO_SUNG', 'TU_CHOI', 'DA_DUYET'],
  CAN_BO_SUNG: ['CHO_DUYET', 'TU_CHOI'],
  TU_CHOI: [],
  DA_DUYET: [],
};
export const canMove = (from: string, to: string) => FLOW[from]?.includes(to) ?? false;

/** Trạng thái đối tác do sàn đổi tay (S4) */
const PARTNER_FLOW: Record<string, string[]> = {
  DANG_THIET_LAP: ['HOAT_DONG', 'TAM_KHOA', 'CHAM_DUT'],
  HOAT_DONG: ['TAM_KHOA', 'CHAM_DUT'],
  TAM_KHOA: ['HOAT_DONG', 'CHAM_DUT'],
  CHAM_DUT: [],
};
export const canMovePartner = (from: string, to: string) => PARTNER_FLOW[from]?.includes(to) ?? false;
