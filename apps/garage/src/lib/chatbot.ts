import { API_URL, ApiError } from './api';

export interface ChatbotOfferCardDto {
  offerId: string;
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
  shopName: string;
  shopSlug: string;
  itemHref: string;
  bookHref: string;
}

export interface ChatbotMaintenancePlanDto {
  inputKm: number;
  milestoneKm: number;
  tierCode: 'CAP_NHO' | 'CAP_TRUNG_BINH' | 'CAP_TRUNG' | 'CAP_LON';
  tierLabel: string;
  vehicleLabel: string | null;
  estimatedMinutes: number;
  checklist: string[];
}

export interface ChatbotProposalDto {
  id: string;
  channel: 'PUBLIC_WEB' | 'OWNER_APP';
  status: 'DE_XUAT' | 'DA_XAC_NHAN' | 'DA_HUY';
  tenantId: string;
  shopName: string;
  shopSlug: string | null;
  branchId: string | null;
  branchName: string | null;
  vehicleId: string | null;
  vehicleLabel: string | null;
  offerId: string | null;
  unitPrice: number | null;
  serviceName: string;
  suggestedSlots: string[];
  confirmedSlot: string | null;
  bookingId: string | null;
  bookingCode: string | null;
  orderRequestId: string | null;
  orderRequestCode: string | null;
  trackingPath: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface ChatbotMessageDto {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  sanitizedContext: string | null;
  piiMaskedCount: number;
  provider: string;
  citedDocCodes: string[];
  matchedOffers: ChatbotOfferCardDto[];
  maintenancePlan: ChatbotMaintenancePlanDto | null;
  proposal: ChatbotProposalDto | null;
  createdAt: string;
}

export interface PublicChatbotSessionDto {
  sessionToken: string;
  vehicleMake: string | null;
  vehicleModel: string | null;
  odometerKm: number | null;
  messages: ChatbotMessageDto[];
}

export interface OwnerChatbotVehicleDto {
  id: string;
  tenantId: string;
  garageName: string;
  plate: string;
  make: string | null;
  model: string | null;
  year: number | null;
  odometerKm: number | null;
  branches: { id: string; tenantId: string; code: string; name: string; address: string | null }[];
}

export interface OwnerChatbotSessionDto {
  vehicles: OwnerChatbotVehicleDto[];
  selectedVehicleId: string | null;
  messages: ChatbotMessageDto[];
}

const TOKEN_STORAGE_KEY = 'cardiy_public_chatbot_token';

export function getStoredChatbotToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function saveChatbotToken(token: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export async function publicChatbotGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}/api/public/chatbot${path}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (data as { message?: string })?.message ?? `Lỗi ${res.status}`);
  return data as T;
}

export async function publicChatbotPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/api/public/chatbot${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const b = (data ?? {}) as { message?: string | string[]; errors?: { field: string; message: string }[] };
    throw new ApiError(res.status, (Array.isArray(b.message) ? b.message.join(', ') : b.message) || `Lỗi ${res.status}`, undefined, b.errors);
  }
  return data as T;
}

const WD = ['CN', 'Th 2', 'Th 3', 'Th 4', 'Th 5', 'Th 6', 'Th 7'];

export function fmtSlotVn(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const vn = new Date(d.getTime() + 7 * 3_600_000);
  const wd = WD[vn.getUTCDay()];
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const mm = String(vn.getUTCMinutes()).padStart(2, '0');
  const dd = String(vn.getUTCDate()).padStart(2, '0');
  const mo = String(vn.getUTCMonth() + 1).padStart(2, '0');
  return `${wd} · ${hh}:${mm} (${dd}/${mo})`;
}
