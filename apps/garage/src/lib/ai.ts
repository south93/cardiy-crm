import type { Tone } from '@cardiy/ui';

export type AiSuggestionKindCode = 'VEHICLE_SUMMARY' | 'QUOTE_SUGGESTION' | 'TECH_QA';
export type AiSuggestionStatusCode = 'DE_XUAT' | 'DA_AP_DUNG' | 'BO_QUA';
export type AiDocCategoryCode = 'BAO_DUONG' | 'CHAN_DOAN' | 'DAU_NHOT' | 'LOP_PHANH' | 'DIEN_OBD';

export const AI_KIND_UI: Record<AiSuggestionKindCode, { label: string; tone: Tone }> = {
  VEHICLE_SUMMARY: { label: 'Tóm tắt lịch sử xe', tone: 'sky' },
  QUOTE_SUGGESTION: { label: 'Gợi ý báo giá', tone: 'lav' },
  TECH_QA: { label: 'Hỏi đáp kỹ thuật', tone: 'mint' },
};

export const AI_STATUS_UI: Record<AiSuggestionStatusCode, { label: string; tone: Tone }> = {
  DE_XUAT: { label: 'Chỉ đề xuất (chưa ghi)', tone: 'peach' },
  DA_AP_DUNG: { label: 'Đã duyệt ghi vào đơn', tone: 'mint' },
  BO_QUA: { label: 'Đã bỏ qua', tone: 'slate' },
};

export const AI_DOC_CATEGORIES: readonly { code: AiDocCategoryCode; label: string }[] = [
  { code: 'BAO_DUONG', label: 'Bảo dưỡng định kỳ' },
  { code: 'CHAN_DOAN', label: 'Chẩn đoán hệ thống & điều hoà' },
  { code: 'DAU_NHOT', label: 'Dầu nhớt & dung dịch' },
  { code: 'LOP_PHANH', label: 'Lốp, phanh & gầm lái' },
  { code: 'DIEN_OBD', label: 'Điện, ắc quy & mã lỗi OBD' },
];

export interface SuggestedQuoteLineDto {
  kind: 'PHU_TUNG' | 'DICH_VU';
  productId: string | null;
  code: string | null;
  name: string;
  unit: string | null;
  quantity: number;
  unitPrice: number | null;
  onHandStock: number | null;
  reason: string;
}

export interface AiSuggestionDto {
  id: string;
  kind: AiSuggestionKindCode;
  branchId: string | null;
  vehicleId: string | null;
  orderId: string | null;
  promptSummary: string;
  sanitizedContext: string;
  piiMaskedCount: number;
  provider: string;
  responseText: string;
  suggestedItems: SuggestedQuoteLineDto[];
  citedDocCodes: string[];
  status: AiSuggestionStatusCode;
  appliedItemCount: number;
  decidedAt: string | null;
  createdAt: string;
}

export interface AiDocumentDto {
  id: string;
  tenantId: string | null;
  code: string;
  title: string;
  category: AiDocCategoryCode;
  make: string | null;
  content: string;
  tags: string[];
  active: boolean;
  updatedAt: string;
}

export interface AiOverviewResponse {
  provider: 'heuristic' | 'http';
  documentsCount: number;
  suggestionsTotal: number;
  appliedCount: number;
  recentSuggestions: AiSuggestionDto[];
}
