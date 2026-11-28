export type CommunityPostType = 'BLOG' | 'AUDIO' | 'PLAYLIST' | 'QA';
export type CommunityPostStatus = 'NHAP' | 'CHO_DUYET' | 'DA_DANG' | 'BI_TU_CHOI' | 'TAM_AN' | 'BI_GO';
export type CommunityAuthorKind = 'PLATFORM' | 'GARAGE' | 'OWNER';

export const COMMUNITY_MAX_HOURLY_POSTS_PER_USER = 10;
export const COMMUNITY_MAX_HOURLY_COMMENTS_PER_USER = 30;

export const COMMUNITY_TYPE_LABEL: Record<CommunityPostType, string> = {
  BLOG: 'Blog kinh nghiệm',
  AUDIO: 'Sách nói',
  PLAYLIST: 'Playlist hành trình',
  QA: 'Hỏi đáp chủ xe',
};

export const COMMUNITY_STATUS_LABEL: Record<CommunityPostStatus, string> = {
  NHAP: 'Bản nháp',
  CHO_DUYET: 'Chờ kiểm duyệt',
  DA_DANG: 'Đã xuất bản',
  BI_TU_CHOI: 'Bị từ chối',
  TAM_AN: 'Tạm ẩn',
  BI_GO: 'Bị sàn gỡ',
};

export const COMMUNITY_TOPICS: readonly { code: string; label: string }[] = [
  { code: 'KINH_NGHIEM', label: 'Kinh nghiệm lái xe' },
  { code: 'BAO_DUONG', label: 'Bảo dưỡng & chăm sóc' },
  { code: 'HOI_DAP_KY_THUAT', label: 'Bắt bệnh & kỹ thuật' },
  { code: 'HANH_TRINH', label: 'Cung đường & hành trình' },
  { code: 'LUAT_GIAO_THONG', label: 'Luật & đăng kiểm' },
  { code: 'DANH_GIA_XE', label: 'Đánh giá xe' },
];

/** Nội dung chính thức của Ban biên tập sàn lên thẳng DA_DANG; bài của Chủ xe / Garage qua kiểm duyệt A6.32; nếu chọn lưu nháp thì ở NHAP */
export function initialPostStatus(authorKind: CommunityAuthorKind, saveAsDraft = false): CommunityPostStatus {
  if (saveAsDraft) return 'NHAP';
  return authorKind === 'PLATFORM' ? 'DA_DANG' : 'CHO_DUYET';
}

export function postStatusAfterEdit(
  current: CommunityPostStatus,
  authorKind: CommunityAuthorKind,
  saveAsDraft = false,
): CommunityPostStatus {
  if (saveAsDraft) return 'NHAP';
  if (authorKind === 'PLATFORM') return current === 'TAM_AN' ? 'TAM_AN' : 'DA_DANG';
  if (authorKind === 'GARAGE' && current === 'DA_DANG') return 'DA_DANG';
  return 'CHO_DUYET';
}

export function canAcceptQaAnswer(post: { type: CommunityPostType; status: CommunityPostStatus }): boolean {
  return post.type === 'QA' && post.status === 'DA_DANG';
}

export const communityPostCode = (n: number) => `BV${String(n).padStart(6, '0')}`;
