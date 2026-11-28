import { stripHtmlToText } from '@cardiy/shared';
import type { Tone } from '@cardiy/ui';
import { api, API_URL, ApiError } from './api';
import { convertImageToWebp } from './image-webp';
import { ownerApi } from './owner';

export type CommunityPostType = 'BLOG' | 'AUDIO' | 'PLAYLIST' | 'QA';
export type CommunityPostStatus = 'NHAP' | 'CHO_DUYET' | 'DA_DANG' | 'BI_TU_CHOI' | 'TAM_AN' | 'BI_GO';
export type CommunityAuthorKind = 'PLATFORM' | 'GARAGE' | 'OWNER';
export type BannerPosition = 'HOME' | 'COMMUNITY';

export const COMMUNITY_TYPE_UI: Record<CommunityPostType, { label: string; tone: Tone }> = {
  BLOG: { label: 'Bài viết chuyên gia', tone: 'sky' },
  AUDIO: { label: 'Sách nói ô tô', tone: 'lav' },
  PLAYLIST: { label: 'Playlist đường dài', tone: 'mint' },
  QA: { label: 'Hỏi đáp chủ xe', tone: 'peach' },
};

export const COMMUNITY_STATUS_UI: Record<CommunityPostStatus, { label: string; tone: Tone }> = {
  NHAP: { label: 'Bản nháp', tone: 'slate' },
  CHO_DUYET: { label: 'Chờ kiểm duyệt', tone: 'peach' },
  DA_DANG: { label: 'Đang hiển thị', tone: 'mint' },
  BI_TU_CHOI: { label: 'Bị từ chối', tone: 'rose' },
  TAM_AN: { label: 'Tạm ẩn', tone: 'slate' },
  BI_GO: { label: 'Bị gỡ vi phạm', tone: 'rose' },
};

export const COMMUNITY_AUTHOR_UI: Record<CommunityAuthorKind, { label: string; tone: Tone }> = {
  PLATFORM: { label: 'Ban biên tập CARDIY', tone: 'brand' },
  GARAGE: { label: 'Chuyên gia Garage', tone: 'mint' },
  OWNER: { label: 'Chủ xe', tone: 'slate' },
};

export const COMMUNITY_TOPICS = [
  { code: 'KINH_NGHIEM', label: 'Kinh nghiệm lái xe' },
  { code: 'BAO_DUONG', label: 'Bảo dưỡng & chăm sóc' },
  { code: 'HOI_DAP_KY_THUAT', label: 'Bắt bệnh & kỹ thuật' },
  { code: 'HANH_TRINH', label: 'Cung đường & hành trình' },
  { code: 'LUAT_GIAO_THONG', label: 'Luật & đăng kiểm' },
  { code: 'DANH_GIA_XE', label: 'Đánh giá xe' },
] as const;

export interface PlaylistItem {
  title: string;
  host?: string | null;
  duration?: string | null;
  url?: string | null;
}

export interface PlatformBannerItem {
  id: string;
  title: string;
  subtitle: string | null;
  linkUrl: string | null;
  ctaLabel: string | null;
  position: BannerPosition;
  sortOrder: number;
  active: boolean;
  imageUrl: string | null;
  imageFileId: string | null;
  updatedAt: string;
}

export interface CommunityCommentItem {
  id: string;
  authorKind: CommunityAuthorKind;
  authorName: string;
  content: string;
  isAccepted?: boolean;
  hidden?: boolean;
  hiddenReason?: string | null;
  createdAt: string;
}

export interface CommunityPostItem {
  id: string;
  code: string;
  type: CommunityPostType;
  typeLabel: string;
  authorKind: CommunityAuthorKind;
  authorName: string;
  title: string;
  summary: string | null;
  content: string;
  topic: string;
  topicLabel: string;
  coverFileId: string | null;
  coverUrl: string | null;
  mediaUrl: string | null;
  durationMinutes: number | null;
  playlistItems: PlaylistItem[];
  pinned: boolean;
  isSolved: boolean;
  acceptedCommentId: string | null;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  liked: boolean;
  status: CommunityPostStatus;
  statusLabel: string;
  reviewNote: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  recentComments?: CommunityCommentItem[];
}

export interface CommunityPostDetail extends CommunityPostItem {
  isMine: boolean;
  comments: CommunityCommentItem[];
}

// ---- Kiểu dữ liệu Báo cáo & KPI chuỗi (M30 · A3.80 & A6.01 / A6.80) ----

export interface BranchComparisonItem {
  rank: number;
  branchId: string;
  code: string;
  name: string;
  ordersDelivered: number;
  roRevenue: number;
  partsCost: number;
  grossProfit: number;
  marginPct: number | null;
  collected: number;
  expense: number;
  slaOnTimePct: number | null;
  overdueOpen: number;
  avgRating: number | null;
  rentalRevenue: number;
  appraisalRevenue: number;
}

export interface TechnicianKpiItem {
  membershipId: string;
  fullName: string;
  phone: string;
  ordersAssigned: number;
  ordersCompleted: number;
  slaOnTimePct: number | null;
  revenueContributed: number;
  appraisalsCompleted: number;
}

export interface GarageReportResponse {
  period: { from: string; to: string };
  branches: { id: string; code: string; name: string }[];
  summary: {
    roRevenue: number;
    grossProfit: number;
    marginPct: number | null;
    ordersDelivered: number;
    slaOnTimePct: number | null;
    overdueOpen: number;
    collected: number;
    expense: number;
    netCash: number;
    rentalRevenue: number;
    appraisalRevenue: number;
    returningRatePct: number;
  };
  branchComparison: BranchComparisonItem[];
  technicians: TechnicianKpiItem[];
  inventory: {
    activeParts: number;
    stockCostValue: number;
    lowStockCount: number;
    lowStockItems: {
      code: string;
      name: string;
      unit: string | null;
      branchCode: string;
      onHand: number;
      minStock: number;
    }[];
  };
  retention: {
    activeCustomers: number;
    newCustomers: number;
    returningCustomers: number;
    returningRatePct: number;
    totalReceivable: number;
  };
  marketplace: {
    views: number;
    requestsTotal: number;
    requestsCompleted: number;
    conversionPct: number;
    marketRevenue: number;
    sosCompleted: number;
    rentalsSettled: number;
    appraisalsCompleted: number;
  };
}

export interface PlatformReportOverviewResponse {
  period: { from: string; to: string };
  kpis: {
    totalViews: number;
    orderRequests: {
      total: number;
      completed: number;
      conversionPct: number;
      connectedGmv: number;
    };
    partners: {
      active: number;
      pendingApplications: number;
      newInPeriod: number;
      lockedOrSuspended: number;
    };
    platformFee: {
      collectedInPeriod: number;
      unpaidTotal: number;
      overdueCount: number;
    };
    sos: {
      totalInPeriod: number;
      completedInPeriod: number;
      noGarageCount: number;
      acceptRatePct: number;
    };
    rentals: {
      activeVehicles: number;
      contractsInPeriod: number;
      settledInPeriod: number;
    };
    usedCars: {
      activeListings: number;
      verifiedListings: number;
      appraisalsCompleted: number;
    };
    community: {
      publishedPosts: number;
      pendingPosts: number;
      commentsInPeriod: number;
    };
    moderation: {
      openReports: number;
      violationsInPeriod: number;
    };
  };
  dailySeries: { date: string; views: number; requests: number }[];
  topShops: {
    tenantId: string;
    name: string;
    slug: string | null;
    tenantType: string;
    status: string;
    views: number;
    requests: number;
    completed: number;
    gmv: number;
    sosCompleted: number;
  }[];
}

export function defaultReportRange(days = 30): { from: string; to: string } {
  const vnNow = new Date(Date.now() + 7 * 3_600_000);
  const to = vnNow.toISOString().slice(0, 10);
  const from = new Date(vnNow.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

export function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${v.toLocaleString('vi-VN')}%`;
}

export async function publicCommunityGet<T>(path: string): Promise<T> {
  const sep = path.startsWith('/') ? '' : '/';
  const res = await fetch(`${API_URL}/api/public/community${sep}${path}`, { cache: 'no-store' });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.message ?? 'Không tải được dữ liệu cộng đồng', data?.details);
  return data as T;
}

/** Tải ảnh bài viết / ảnh bìa / banner lên Cloudflare R2 (tự nén WebP trước khi upload) cho Quản trị sàn & Garage */
export async function uploadCommunityPhoto(file: File): Promise<{ id: string; url: string }> {
  const webpFile = await convertImageToWebp(file, { maxDimension: 1920, quality: 0.84 });
  const form = new FormData();
  form.append('file', webpFile);
  return api<{ id: string; url: string }>('/files', { form });
}

/** Tải ảnh bài viết / ảnh bìa lên Cloudflare R2 (tự nén WebP trước khi upload) cho Chủ xe */
export async function ownerUploadCommunityPhoto(file: File): Promise<{ id: string; url: string }> {
  const webpFile = await convertImageToWebp(file, { maxDimension: 1920, quality: 0.84 });
  const form = new FormData();
  form.append('file', webpFile);
  return ownerApi<{ id: string; url: string }>('/community/upload', { form });
}

/** Rút trích đoạn tóm tắt văn bản thuần sạch sẽ (không dính thẻ HTML) để hiển thị trên thẻ danh sách */
export function plainPostExcerpt(post: { summary?: string | null; content: string }, maxLen = 180): string {
  const base = post.summary?.trim() ? stripHtmlToText(post.summary) : stripHtmlToText(post.content);
  if (base.length <= maxLen) return base;
  return `${base.slice(0, maxLen).trimEnd()}…`;
}
