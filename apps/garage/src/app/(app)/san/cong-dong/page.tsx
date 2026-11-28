'use client';

/* eslint-disable @next/next/no-img-element */

import { Alert, Badge, Button, Card, Dialog, Field, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import {
  Ban,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Headphones,
  Megaphone,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  CommunityPreviewDialog,
  CoverImageField,
  WysiwygEditor,
  type CommunityPreviewDraft,
} from '@/components/community-editor';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  COMMUNITY_AUTHOR_UI,
  COMMUNITY_STATUS_UI,
  COMMUNITY_TOPICS,
  COMMUNITY_TYPE_UI,
  plainPostExcerpt,
  type BannerPosition,
  type CommunityPostItem,
  type CommunityPostStatus,
  type CommunityPostType,
  type PlatformBannerItem,
  type PlaylistItem,
} from '@/lib/community';
import { fmtDateTime } from '@/lib/orders';

/** A6.32 Kiểm duyệt cộng đồng & A6.62 Quản lý nội dung (Blog, Sách nói, Playlist, Banner) */
export default function PlatformCommunityPage() {
  return (
    <RequirePermission permission="platform.report.view">
      <PlatformCommunityBody />
    </RequirePermission>
  );
}

const DEFAULT_CHAPTERS: PlaylistItem[] = [
  { title: 'Chương 1: Mở đầu hành trình an toàn', host: 'Ban biên tập CARDIY', duration: '12:00' },
];

function PlatformCommunityBody() {
  const { can } = useAuth();
  const canModerate = can('platform.partner.review') || can('platform.report.handle') || can('platform.content.manage');
  const canContent = can('platform.content.manage');

  const [section, setSection] = useState<'moderation' | 'editorial' | 'banners'>('moderation');
  const [status, setStatus] = useState<'CHO_DUYET' | 'NHAP' | 'DA_DANG' | 'BI_TU_CHOI' | 'BI_GO' | 'ALL'>('CHO_DUYET');
  const [q, setQ] = useState('');
  const [postsData, setPostsData] = useState<{ counts: Record<string, number>; items: CommunityPostItem[] } | null>(null);
  const [allPlatformPosts, setAllPlatformPosts] = useState<CommunityPostItem[]>([]);
  const [banners, setBanners] = useState<PlatformBannerItem[] | null>(null);
  const [noteModal, setNoteModal] = useState<{ item: CommunityPostItem; action: 'reject' | 'takedown' } | null>(null);
  const [modNote, setModNote] = useState('');

  // Form xuất bản / sửa bài & lưu nháp nội dung chính thức (A6.62)
  const [openEditorial, setOpenEditorial] = useState(false);
  const [editingPost, setEditingPost] = useState<CommunityPostItem | null>(null);
  const [edType, setEdType] = useState<CommunityPostType>('AUDIO');
  const [edTopic, setEdTopic] = useState('HANH_TRINH');
  const [edTitle, setEdTitle] = useState('');
  const [edSummary, setEdSummary] = useState('');
  const [edContent, setEdContent] = useState('');
  const [edCoverFileId, setEdCoverFileId] = useState<string | null>(null);
  const [edCoverUrl, setEdCoverUrl] = useState<string | null>(null);
  const [edMediaUrl, setEdMediaUrl] = useState('');
  const [edDuration, setEdDuration] = useState('35');
  const [edPinned, setEdPinned] = useState(true);
  const [chapters, setChapters] = useState<PlaylistItem[]>(DEFAULT_CHAPTERS);

  // Hộp thoại Xem trước (Điện thoại / Máy tính)
  const [previewDraft, setPreviewDraft] = useState<CommunityPreviewDraft | null>(null);

  // Form tạo Banner (A6.62)
  const [openBanner, setOpenBanner] = useState(false);
  const [bnTitle, setBnTitle] = useState('');
  const [bnSubtitle, setBnSubtitle] = useState('');
  const [bnLink, setBnLink] = useState('/cho/cong-dong');
  const [bnCta, setBnCta] = useState('Nghe ngay');
  const [bnPosition, setBnPosition] = useState<BannerPosition>('COMMUNITY');
  const [bnImageFileId, setBnImageFileId] = useState<string | null>(null);
  const [bnImageUrl, setBnImageUrl] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canModerate) return;
    try {
      const qs = new URLSearchParams({ status });
      if (q.trim()) qs.set('q', q.trim());
      const [p, allRes, b] = await Promise.all([
        api<{ counts: Record<string, number>; items: CommunityPostItem[] }>(`/platform/community/posts?${qs}`),
        api<{ counts: Record<string, number>; items: CommunityPostItem[] }>('/platform/community/posts?status=ALL'),
        api<PlatformBannerItem[]>('/platform/community/banners'),
      ]);
      setPostsData(p);
      setAllPlatformPosts(allRes.items.filter((it) => it.authorKind === 'PLATFORM'));
      setBanners(b);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được dữ liệu cộng đồng');
    }
  }, [canModerate, status, q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  function openNewEditorial(defaultType: CommunityPostType = 'AUDIO') {
    setEditingPost(null);
    setEdType(defaultType);
    setEdTopic(defaultType === 'BLOG' ? 'BAO_DUONG' : 'HANH_TRINH');
    setEdTitle('');
    setEdSummary('');
    setEdContent('');
    setEdCoverFileId(null);
    setEdCoverUrl(null);
    setEdMediaUrl('');
    setEdDuration('35');
    setEdPinned(true);
    setChapters(DEFAULT_CHAPTERS);
    setError(null);
    setOpenEditorial(true);
  }

  function openEditEditorial(p: CommunityPostItem) {
    setEditingPost(p);
    setEdType(p.type);
    setEdTopic(p.topic);
    setEdTitle(p.title);
    setEdSummary(p.summary ?? '');
    setEdContent(p.content);
    setEdCoverFileId(p.coverFileId);
    setEdCoverUrl(p.coverUrl);
    setEdMediaUrl(p.mediaUrl ?? '');
    setEdDuration(p.durationMinutes ? String(p.durationMinutes) : '35');
    setEdPinned(p.pinned);
    setChapters(p.playlistItems.length > 0 ? p.playlistItems : DEFAULT_CHAPTERS);
    setError(null);
    setOpenEditorial(true);
  }

  function openPreviewFromForm() {
    const cleanChapters = edType === 'AUDIO' || edType === 'PLAYLIST' ? chapters.filter((c) => c.title.trim().length > 0) : [];
    setPreviewDraft({
      title: edTitle,
      summary: edSummary || null,
      content: edContent,
      coverUrl: edCoverUrl,
      type: edType,
      topic: edTopic,
      authorKind: editingPost?.authorKind ?? 'PLATFORM',
      authorName:
        editingPost?.authorName ?? (edType === 'AUDIO' ? 'Tủ sách nói CARDIY' : 'Ban biên tập CARDIY'),
      durationMinutes: edType === 'AUDIO' || edType === 'PLAYLIST' ? Number(edDuration) || null : null,
      mediaUrl: edMediaUrl || null,
      playlistItems: cleanChapters,
      permanentUrl: editingPost ? `/cho/cong-dong/${editingPost.id}` : null,
      isDraft: true,
    });
  }

  function openPreviewFromItem(p: CommunityPostItem) {
    setPreviewDraft({
      title: p.title,
      summary: p.summary,
      content: p.content,
      coverUrl: p.coverUrl,
      type: p.type,
      topic: p.topic,
      authorKind: p.authorKind,
      authorName: p.authorName,
      durationMinutes: p.durationMinutes,
      mediaUrl: p.mediaUrl,
      playlistItems: p.playlistItems,
      permanentUrl: `/cho/cong-dong/${p.id}`,
      isDraft: p.status !== 'DA_DANG',
    });
  }

  async function approvePost(id: string) {
    setBusy(id);
    try {
      await api(`/platform/community/posts/${id}/approve`, { body: {} });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Duyệt bài thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function submitNoteAction() {
    if (!noteModal) return;
    setBusy(noteModal.item.id);
    try {
      await api(`/platform/community/posts/${noteModal.item.id}/${noteModal.action}`, { body: { note: modNote } });
      setNoteModal(null);
      setModNote('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Thao tác thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function togglePin(id: string) {
    setBusy(id);
    try {
      await api(`/platform/community/posts/${id}/pin`, { body: {} });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không đổi được trạng thái ghim');
    } finally {
      setBusy(null);
    }
  }

  async function toggleHideComment(commentId: string, hidden: boolean) {
    setBusy(commentId);
    try {
      await api(`/platform/community/comments/${commentId}/hide`, { body: { hidden, reason: 'Vi phạm tiêu chuẩn cộng đồng' } });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không xử lý được bình luận');
    } finally {
      setBusy(null);
    }
  }

  async function saveEditorial(saveAsDraft: boolean) {
    setBusy(saveAsDraft ? 'editorial-draft' : 'editorial');
    setError(null);
    try {
      const cleanChapters =
        edType === 'AUDIO' || edType === 'PLAYLIST' ? chapters.filter((c) => c.title.trim().length > 0) : [];
      const payload = {
        type: edType,
        topic: edTopic,
        title: edTitle,
        summary: edSummary || null,
        content: edContent,
        coverFileId: edCoverFileId,
        mediaUrl: edMediaUrl || null,
        durationMinutes: edType === 'AUDIO' || edType === 'PLAYLIST' ? Number(edDuration) || null : null,
        playlistItems: cleanChapters,
        pinned: edPinned,
        saveAsDraft,
      };

      if (editingPost) {
        await api(`/platform/community/posts/${editingPost.id}`, {
          method: 'PUT',
          body: payload,
        });
      } else {
        await api('/platform/community/editorial', {
          body: payload,
        });
      }

      setOpenEditorial(false);
      setEditingPost(null);
      setEdTitle('');
      setEdSummary('');
      setEdContent('');
      setEdCoverFileId(null);
      setEdCoverUrl(null);
      setStatus(saveAsDraft ? 'NHAP' : 'DA_DANG');
      setSection('moderation');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : saveAsDraft ? 'Lưu nháp thất bại' : 'Xuất bản nội dung thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function saveBanner() {
    setBusy('banner');
    setError(null);
    try {
      await api('/platform/community/banners', {
        body: {
          title: bnTitle,
          subtitle: bnSubtitle || null,
          linkUrl: bnLink || null,
          ctaLabel: bnCta || null,
          imageFileId: bnImageFileId,
          position: bnPosition,
          sortOrder: 1,
          active: true,
        },
      });
      setOpenBanner(false);
      setBnTitle('');
      setBnSubtitle('');
      setBnImageFileId(null);
      setBnImageUrl(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Tạo banner thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function toggleBannerActive(b: PlatformBannerItem) {
    setBusy(b.id);
    try {
      await api(`/platform/community/banners/${b.id}`, {
        method: 'PUT',
        body: {
          title: b.title,
          subtitle: b.subtitle,
          linkUrl: b.linkUrl,
          ctaLabel: b.ctaLabel,
          imageFileId: b.imageFileId,
          position: b.position,
          sortOrder: b.sortOrder,
          active: !b.active,
        },
      });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Cập nhật banner thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function deleteBanner(id: string) {
    setBusy(id);
    try {
      await api(`/platform/community/banners/${id}/delete`, { body: {} });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Xoá banner thất bại');
    } finally {
      setBusy(null);
    }
  }

  if (!canModerate) {
    return <Card className="p-8 text-center text-sm text-slate-500">Tài khoản của bạn chỉ có quyền xem báo cáo tổng hợp sàn.</Card>;
  }

  return (
    <div className="space-y-4" data-testid="platform-community-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          tabs={[
            {
              value: 'moderation',
              label: `Kiểm duyệt bài & bình luận${postsData?.counts.CHO_DUYET ? ` (${postsData.counts.CHO_DUYET} chờ duyệt)` : ''}`,
            },
            { value: 'editorial', label: 'Tủ sách nói, Blog & Playlist' },
            { value: 'banners', label: `Banner truyền thông${banners ? ` (${banners.length})` : ''}` },
          ]}
          value={section}
          onChange={setSection}
        />

        <div className="flex flex-wrap items-center gap-2">
          {canContent && (
            <>
              <Button variant="outline" onClick={() => setOpenBanner(true)} data-testid="platform-add-banner-btn">
                <Megaphone className="h-4 w-4" /> Tạo banner
              </Button>
              <Button onClick={() => openNewEditorial('AUDIO')} data-testid="platform-publish-editorial-btn">
                <Headphones className="h-4 w-4" /> Xuất bản Blog / Sách nói
              </Button>
            </>
          )}
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      {section === 'moderation' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs
              tabs={[
                { value: 'CHO_DUYET', label: `Chờ duyệt (${postsData?.counts.CHO_DUYET ?? 0})` },
                { value: 'NHAP', label: `Bản nháp (${postsData?.counts.NHAP ?? 0})` },
                { value: 'DA_DANG', label: `Đang hiển thị (${postsData?.counts.DA_DANG ?? 0})` },
                { value: 'BI_TU_CHOI', label: `Từ chối (${postsData?.counts.BI_TU_CHOI ?? 0})` },
                { value: 'BI_GO', label: `Đã gỡ (${postsData?.counts.BI_GO ?? 0})` },
                { value: 'ALL', label: 'Tất cả' },
              ]}
              value={status}
              onChange={setStatus}
            />
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Mã BV, tiêu đề, người đăng…"
                aria-label="Tìm bài cộng đồng"
                className="rounded-full bg-white pl-10"
              />
            </div>
          </div>

          {!postsData ? (
            <Spinner className="h-6 w-6 text-brand-600" />
          ) : !postsData.items.length ? (
            <Card className="p-10 text-center text-sm text-slate-500">Không có bài cộng đồng nào trong mục này.</Card>
          ) : (
            <ul className="space-y-3" data-testid="platform-community-list">
              {postsData.items.map((p) => {
                const st = COMMUNITY_STATUS_UI[p.status as CommunityPostStatus];
                const tp = COMMUNITY_TYPE_UI[p.type];
                const au = COMMUNITY_AUTHOR_UI[p.authorKind];
                const excerpt = plainPostExcerpt(p, 200);
                return (
                  <li key={p.id}>
                    <Card className="space-y-3 p-5" data-testid="platform-community-card">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row">
                          {p.coverUrl && (
                            <img
                              src={p.coverUrl}
                              alt={p.title}
                              className="aspect-[16/9] w-full shrink-0 rounded-xl border border-slate-100 object-cover sm:w-36"
                            />
                          )}
                          <div className="min-w-0 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs text-slate-500">{p.code}</span>
                              <Badge tone={st.tone}>{st.label}</Badge>
                              <Badge tone={tp.tone}>{tp.label}</Badge>
                              <Badge tone={au.tone}>{p.authorName}</Badge>
                              {p.pinned && <Badge tone="brand">Đang ghim</Badge>}
                            </div>
                            <h3 className="text-base font-semibold text-slate-900">{p.title}</h3>
                            {excerpt && <p className="line-clamp-2 text-sm text-slate-600">{excerpt}</p>}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                              <span>
                                Chủ đề: {p.topicLabel} · {fmtDateTime(p.createdAt)} · {p.viewsCount} xem · {p.likesCount} thích ·{' '}
                                {p.commentsCount} bình luận
                              </span>
                              {p.status === 'DA_DANG' && (
                                <Link
                                  href={`/cho/cong-dong/${p.id}`}
                                  target="_blank"
                                  className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
                                >
                                  <ExternalLink className="h-3 w-3" /> /cho/cong-dong/{p.id.slice(0, 8)}…
                                </Link>
                              )}
                            </div>
                            {p.reviewNote && <p className="text-xs text-rose-600">Lý do kiểm duyệt: {p.reviewNote}</p>}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            onClick={() => openPreviewFromItem(p)}
                            data-testid="platform-community-preview"
                          >
                            <Eye className="h-4 w-4" /> Xem trước
                          </Button>
                          {canContent && p.status !== 'BI_GO' && (
                            <Button
                              variant="outline"
                              onClick={() => openEditEditorial(p)}
                              data-testid="platform-community-edit"
                            >
                              <Pencil className="h-4 w-4" /> Sửa bài
                            </Button>
                          )}
                          {p.status === 'NHAP' && (
                            <Button onClick={() => approvePost(p.id)} disabled={busy === p.id} data-testid="platform-community-publish-draft">
                              <CheckCircle2 className="h-4 w-4" /> Xuất bản ngay
                            </Button>
                          )}
                          {p.status === 'CHO_DUYET' && (
                            <>
                              <Button onClick={() => approvePost(p.id)} disabled={busy === p.id} data-testid="platform-community-approve">
                                <CheckCircle2 className="h-4 w-4" /> Duyệt hiển thị
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setNoteModal({ item: p, action: 'reject' });
                                  setModNote('');
                                }}
                                disabled={busy === p.id}
                                data-testid="platform-community-reject"
                              >
                                <XCircle className="h-4 w-4" /> Từ chối
                              </Button>
                            </>
                          )}
                          {p.status === 'DA_DANG' && (
                            <>
                              <Button variant="outline" onClick={() => togglePin(p.id)} disabled={busy === p.id}>
                                <Pin className="h-4 w-4" /> {p.pinned ? 'Bỏ ghim' : 'Ghim nổi bật'}
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setNoteModal({ item: p, action: 'takedown' });
                                  setModNote('');
                                }}
                                disabled={busy === p.id}
                                data-testid="platform-community-takedown"
                              >
                                <Ban className="h-4 w-4 text-rose-600" /> Gỡ bài
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      {p.recentComments && p.recentComments.length > 0 && (
                        <div className="space-y-1.5 rounded-xl bg-slate-50 p-3 text-xs">
                          <div className="font-semibold text-slate-700">Bình luận gần đây ({p.recentComments.length})</div>
                          {p.recentComments.map((c) => (
                            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 pt-1.5">
                              <span className={c.hidden ? 'line-through text-slate-400' : 'text-slate-700'}>
                                <b>{c.authorName}:</b> {c.content}
                              </span>
                              <button
                                type="button"
                                onClick={() => toggleHideComment(c.id, !c.hidden)}
                                disabled={busy === c.id}
                                className="inline-flex items-center gap-1 font-medium text-rose-600 hover:underline"
                                data-testid="platform-comment-toggle-hide"
                              >
                                {c.hidden ? (
                                  <>
                                    <RotateCcw className="h-3 w-3" /> Khôi phục
                                  </>
                                ) : (
                                  <>
                                    <EyeOff className="h-3 w-3" /> Ẩn bình luận
                                  </>
                                )}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {section === 'editorial' && (
        <Card className="space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Tủ nội dung chính thức của Ban biên tập CARDIY</h2>
              <p className="text-xs text-slate-500">
                Soạn thảo WYSIWYG, gắn ảnh bìa 16:9 (Cloudflare R2 WebP), lưu nháp, xem trước và sửa bài đã đăng mà không đổi link.
              </p>
            </div>
            {canContent && (
              <Button onClick={() => openNewEditorial('BLOG')}>
                <Plus className="h-4 w-4" /> Viết bài mới
              </Button>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {allPlatformPosts.map((p) => {
              const st = COMMUNITY_STATUS_UI[p.status];
              return (
                <div key={p.id} className="flex flex-col justify-between gap-3 overflow-hidden rounded-2xl border border-slate-200 p-4">
                  <div className="space-y-2">
                    {p.coverUrl && (
                      <img src={p.coverUrl} alt={p.title} className="aspect-[16/9] w-full rounded-xl object-cover" />
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={st.tone}>{st.label}</Badge>
                      <Badge tone={COMMUNITY_TYPE_UI[p.type].tone}>{COMMUNITY_TYPE_UI[p.type].label}</Badge>
                      <span className="font-mono text-xs text-slate-400">{p.code}</span>
                    </div>
                    <div className="font-semibold text-slate-900">{p.title}</div>
                    <div className="text-xs text-slate-500">
                      {p.playlistItems.length > 0 ? `${p.playlistItems.length} chương · ` : ''}
                      {p.viewsCount} lượt xem · {p.likesCount} thích
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5">
                    <Button variant="outline" className="px-3 py-1 text-xs" onClick={() => openPreviewFromItem(p)}>
                      <Eye className="h-3.5 w-3.5" /> Xem trước
                    </Button>
                    {canContent && (
                      <Button variant="outline" className="px-3 py-1 text-xs" onClick={() => openEditEditorial(p)}>
                        <Pencil className="h-3.5 w-3.5" /> Sửa bài
                      </Button>
                    )}
                    {p.status === 'DA_DANG' && (
                      <Link href={`/cho/cong-dong/${p.id}`} target="_blank" className="ml-auto text-xs font-medium text-brand-700 hover:underline">
                        Mở trang công khai →
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {section === 'banners' && (
        <div className="space-y-3" data-testid="platform-banners-list">
          {!banners ? (
            <Spinner className="h-6 w-6 text-brand-600" />
          ) : !banners.length ? (
            <Card className="p-8 text-center text-sm text-slate-500">Chưa có banner truyền thông nào.</Card>
          ) : (
            banners.map((b) => (
              <Card key={b.id} className="flex flex-wrap items-center justify-between gap-4 p-5" data-testid="platform-banner-row">
                <div className="flex items-center gap-3">
                  {b.imageUrl && <img src={b.imageUrl} alt={b.title} className="h-14 w-24 rounded-xl object-cover" />}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge tone={b.active ? 'mint' : 'slate'}>{b.active ? 'Đang bật' : 'Tạm tắt'}</Badge>
                      <Badge tone="sky">{b.position === 'HOME' ? 'Trang chủ sàn (/cho)' : 'Trang Cộng đồng (/cho/cong-dong)'}</Badge>
                    </div>
                    <div className="font-semibold text-slate-900">{b.title}</div>
                    {b.subtitle && <div className="text-xs text-slate-600">{b.subtitle}</div>}
                    {b.linkUrl && <div className="font-mono text-xs text-brand-700">{b.linkUrl}</div>}
                  </div>
                </div>
                {canContent && (
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => toggleBannerActive(b)} disabled={busy === b.id}>
                      {b.active ? 'Tạm tắt' : 'Bật hiển thị'}
                    </Button>
                    <Button variant="outline" onClick={() => deleteBanner(b.id)} disabled={busy === b.id}>
                      <Trash2 className="h-4 w-4 text-rose-600" />
                    </Button>
                  </div>
                )}
              </Card>
            ))
          )}
        </div>
      )}

      {/* Hộp thoại lý do từ chối / gỡ bài */}
      <Dialog
        open={!!noteModal}
        onClose={() => setNoteModal(null)}
        title={noteModal?.action === 'reject' ? 'Từ chối bài cộng đồng' : 'Gỡ bài vi phạm khỏi cộng đồng'}
        footer={
          <>
            <Button variant="outline" onClick={() => setNoteModal(null)}>
              Huỷ
            </Button>
            <Button className="bg-rose-600 hover:bg-rose-700" onClick={submitNoteAction} disabled={!!busy} data-testid="platform-community-note-confirm">
              Xác nhận
            </Button>
          </>
        }
      >
        <Field label="Lý do gửi tới người đăng *">
          {(id) => <Input id={id} value={modNote} onChange={(e) => setModNote(e.target.value)} placeholder="VD: Nội dung quảng cáo sai chuyên mục…" />}
        </Field>
      </Dialog>

      {/* Hộp thoại xuất bản / sửa bài & lưu nháp Blog / Sách nói / Playlist (A6.62) */}
      <Dialog
        open={openEditorial}
        onClose={() => setOpenEditorial(false)}
        title={
          editingPost
            ? `Chỉnh sửa bài viết ${editingPost.code} (giữ nguyên đường dẫn)`
            : 'Xuất bản nội dung chính thức (Blog / Sách nói / Playlist)'
        }
        wide
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setOpenEditorial(false)}>
              Huỷ
            </Button>
            <Button
              variant="outline"
              onClick={openPreviewFromForm}
              data-testid="platform-editorial-preview-btn"
            >
              <Eye className="h-4 w-4" /> Xem trước
            </Button>
            <Button
              variant="outline"
              onClick={() => void saveEditorial(true)}
              disabled={busy === 'editorial' || busy === 'editorial-draft'}
              data-testid="platform-editorial-draft-btn"
            >
              <FileText className="h-4 w-4" /> Lưu nháp
            </Button>
            <Button
              onClick={() => void saveEditorial(false)}
              disabled={busy === 'editorial' || busy === 'editorial-draft'}
              data-testid="platform-editorial-submit"
            >
              {editingPost && editingPost.status === 'DA_DANG' ? 'Lưu cập nhật (giữ link)' : 'Xuất bản ngay'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3.5">
          {editingPost && (
            <div
              className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5 text-xs text-emerald-900"
              data-testid="platform-editorial-permanent-link-banner"
            >
              Đang sửa bài <b>{editingPost.code}</b> — Đường dẫn bài viết giữ nguyên không đổi:{' '}
              <code className="rounded bg-white px-1.5 py-0.5 font-mono text-emerald-800">/cho/cong-dong/{editingPost.id}</code>
            </div>
          )}

          {error && <Alert>{error}</Alert>}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Định dạng nội dung *">
              {(id) => (
                <Select id={id} value={edType} onChange={(e) => setEdType(e.target.value as CommunityPostType)}>
                  <option value="AUDIO">Sách nói ô tô (AUDIO)</option>
                  <option value="PLAYLIST">Playlist đường dài (PLAYLIST)</option>
                  <option value="BLOG">Bài viết chuyên gia (BLOG)</option>
                  {editingPost?.type === 'QA' && <option value="QA">Hỏi đáp chủ xe (QA)</option>}
                </Select>
              )}
            </Field>
            <Field label="Chủ đề *">
              {(id) => (
                <Select id={id} value={edTopic} onChange={(e) => setEdTopic(e.target.value)}>
                  {COMMUNITY_TOPICS.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <Field label="Tiêu đề xuất bản *">
            {(id) => <Input id={id} value={edTitle} onChange={(e) => setEdTitle(e.target.value)} placeholder="VD: Sách nói: 15 quy tắc vàng lái xe đường đèo" />}
          </Field>

          <Field label="Tóm tắt ngắn">
            {(id) => <Input id={id} value={edSummary} onChange={(e) => setEdSummary(e.target.value)} placeholder="Hiển thị trên thẻ danh sách cộng đồng" />}
          </Field>

          <CoverImageField
            coverUrl={edCoverUrl}
            onChange={({ id, url }) => {
              setEdCoverFileId(id);
              setEdCoverUrl(url);
            }}
            testIdPrefix="platform-editorial-cover"
          />

          {(edType === 'AUDIO' || edType === 'PLAYLIST') && (
            <div className="space-y-2 rounded-xl bg-slate-50 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Tổng thời lượng (phút)">
                  {(id) => <Input id={id} type="number" value={edDuration} onChange={(e) => setEdDuration(e.target.value)} />}
                </Field>
                <Field label="Đường dẫn nguồn âm thanh (tuỳ chọn)">
                  {(id) => <Input id={id} value={edMediaUrl} onChange={(e) => setEdMediaUrl(e.target.value)} placeholder="https://..." />}
                </Field>
              </div>
              <div className="text-xs font-semibold text-slate-700">Danh sách chương / tập</div>
              {chapters.map((ch, idx) => (
                <div key={idx} className="grid gap-2 sm:grid-cols-3">
                  <Input
                    value={ch.title}
                    onChange={(e) => {
                      const next = [...chapters];
                      next[idx] = { ...ch, title: e.target.value };
                      setChapters(next);
                    }}
                    placeholder={`Tên chương #${idx + 1}`}
                  />
                  <Input
                    value={ch.host ?? ''}
                    onChange={(e) => {
                      const next = [...chapters];
                      next[idx] = { ...ch, host: e.target.value };
                      setChapters(next);
                    }}
                    placeholder="Người đọc / Chuyên gia"
                  />
                  <Input
                    value={ch.duration ?? ''}
                    onChange={(e) => {
                      const next = [...chapters];
                      next[idx] = { ...ch, duration: e.target.value };
                      setChapters(next);
                    }}
                    placeholder="10:30"
                  />
                </div>
              ))}
              <Button
                variant="outline"
                onClick={() => setChapters([...chapters, { title: '', host: 'Ban biên tập CARDIY', duration: '10:00' }])}
              >
                <Plus className="h-3.5 w-3.5" /> Thêm chương
              </Button>
            </div>
          )}

          <WysiwygEditor
            label="Nội dung chi tiết / Lời giới thiệu *"
            value={edContent}
            onChange={setEdContent}
            placeholder="Nhập nội dung bài viết, định dạng tiêu đề, danh sách hoặc chèn hình ảnh minh hoạ (tự nén WebP lên Cloudflare R2)…"
            testId="platform-editorial-wysiwyg"
          />

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={edPinned} onChange={(e) => setEdPinned(e.target.checked)} />
            Ghim nổi bật trên đầu trang Cộng đồng
          </label>
        </div>
      </Dialog>

      {/* Hộp thoại Xem trước Điện thoại / Máy tính */}
      <CommunityPreviewDialog open={!!previewDraft} onClose={() => setPreviewDraft(null)} draft={previewDraft} />

      {/* Hộp thoại tạo Banner (A6.62) */}
      <Dialog
        open={openBanner}
        onClose={() => setOpenBanner(false)}
        title="Tạo Banner truyền thông trên sàn"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpenBanner(false)}>
              Huỷ
            </Button>
            <Button onClick={saveBanner} disabled={busy === 'banner'} data-testid="platform-banner-submit">
              Lưu & Hiển thị
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Vị trí hiển thị *">
            {(id) => (
              <Select id={id} value={bnPosition} onChange={(e) => setBnPosition(e.target.value as BannerPosition)}>
                <option value="COMMUNITY">Đầu trang Cộng đồng (/cho/cong-dong)</option>
                <option value="HOME">Trang chủ Sàn (/cho)</option>
              </Select>
            )}
          </Field>
          <Field label="Tiêu đề chiến dịch / banner *">
            {(id) => <Input id={id} value={bnTitle} onChange={(e) => setBnTitle(e.target.value)} placeholder="VD: Tuần lễ kiểm tra phanh & lốp mùa mưa" />}
          </Field>
          <Field label="Mô tả phụ">
            {(id) => <Input id={id} value={bnSubtitle} onChange={(e) => setBnSubtitle(e.target.value)} placeholder="Ưu đãi từ 50+ garage đối tác trên sàn CARDIY" />}
          </Field>
          <CoverImageField
            label="Ảnh banner (tuỳ chọn — WebP lưu Cloudflare R2)"
            coverUrl={bnImageUrl}
            onChange={({ id, url }) => {
              setBnImageFileId(id);
              setBnImageUrl(url);
            }}
            testIdPrefix="platform-banner-cover"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Đường dẫn đích">
              {(id) => <Input id={id} value={bnLink} onChange={(e) => setBnLink(e.target.value)} />}
            </Field>
            <Field label="Nhãn nút bấm">
              {(id) => <Input id={id} value={bnCta} onChange={(e) => setBnCta(e.target.value)} />}
            </Field>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
