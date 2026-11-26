import type { Tone } from '@cardiy/ui';

export type CareKind = 'DANG_KIEM' | 'BAO_HIEM' | 'BAO_DUONG' | 'HOI_THAM' | 'KHAC';
export type CallOutcome = 'DA_TU_VAN' | 'DAT_LICH' | 'KHONG_NGHE' | 'GOI_LAI_SAU' | 'KHONG_CAN' | 'SAI_SO';

export const KINDS: Record<CareKind, { label: string; tone: Tone }> = {
  DANG_KIEM: { label: 'Đăng kiểm', tone: 'peach' },
  BAO_HIEM: { label: 'Bảo hiểm', tone: 'lav' },
  BAO_DUONG: { label: 'Bảo dưỡng', tone: 'sky' },
  HOI_THAM: { label: 'Hỏi thăm', tone: 'mint' },
  KHAC: { label: 'Khác', tone: 'slate' },
};

export const OUTCOMES: { value: CallOutcome; label: string; hint: string }[] = [
  { value: 'DA_TU_VAN', label: 'Đã tư vấn', hint: 'Xong việc gọi' },
  { value: 'DAT_LICH', label: 'Khách đặt lịch', hint: 'Mở form đặt lịch' },
  { value: 'KHONG_NGHE', label: 'Không nghe máy', hint: 'Tự hẹn gọi lại ngày mai' },
  { value: 'GOI_LAI_SAU', label: 'Hẹn gọi lại', hint: 'Chọn ngày gọi lại' },
  { value: 'KHONG_CAN', label: 'Khách không cần', hint: 'Xong việc gọi' },
  { value: 'SAI_SO', label: 'Sai số / thuê bao', hint: 'Bỏ qua' },
];
export const outcomeLabel = (o: CallOutcome | null) => OUTCOMES.find((x) => x.value === o)?.label ?? '';

export interface CareTask {
  id: string;
  kind: CareKind;
  title: string;
  status: 'CAN_GOI' | 'GOI_LAI' | 'XONG' | 'BO_QUA';
  dueDate: string;
  overdueDays: number;
  eventDate: string | null;
  attempts: number;
  lastOutcome: CallOutcome | null;
  lastNote: string | null;
  customer: { id: string; name: string; phone: string | null };
  vehicle: { id: string; plate: string; make: string | null; model: string | null } | null;
  orderId: string | null;
  branchId: string | null;
}

export const fmtDay = (ymd: string) => {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
};
