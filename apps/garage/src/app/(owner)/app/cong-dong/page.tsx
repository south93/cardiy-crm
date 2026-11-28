'use client';

/* eslint-disable @next/next/no-img-element */

import { Alert, Badge, Button, Card, Dialog, Field, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import { CheckCircle2, Eye, FileText, Headphones, Heart, MessageCircle, Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  CommunityPreviewDialog,
  CoverImageField,
  WysiwygEditor,
  type CommunityPreviewDraft,
} from '@/components/community-editor';
import { ApiError } from '@/lib/api';
import {
  COMMUNITY_STATUS_UI,
  COMMUNITY_TOPICS,
  COMMUNITY_TYPE_UI,
  ownerUploadCommunityPhoto,
  plainPostExcerpt,
  publicCommunityGet,
  type CommunityPostItem,
  type CommunityPostType,
} from '@/lib/community';
import { fmtDateTime } from '@/lib/orders';
import { ownerApi } from '@/lib/owner';

/** A2.11 Cộng đồng chủ xe trên App chủ xe (/app/cong-dong) */
export default function OwnerCommunityPage() {
  const [tab, setTab] = useState<'explore' | 'mine'>('explore');
  const [filterType, setFilterType] = useState<'ALL' | CommunityPostType>('ALL');
  const [publicPosts, setPublicPosts] = useState<CommunityPostItem[] | null>(null);
  const [myPosts, setMyPosts] = useState<CommunityPostItem[] | null>(null);

  const [openForm, setOpenForm] = useState(false);
  const [editingPost, setEditingPost] = useState<CommunityPostItem | null>(null);
  const [postType, setPostType] = useState<'QA' | 'BLOG'>('QA');
  const [topic, setTopic] = useState('BAO_DUONG');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [coverFileId, setCoverFileId] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [previewDraft, setPreviewDraft] = useState<CommunityPreviewDraft | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = filterType === 'ALL' ? '' : `?type=${filterType}`;
      const [pub, mine] = await Promise.all([
        publicCommunityGet<{ items: CommunityPostItem[] }>(`posts${qs}`),
        ownerApi<CommunityPostItem[]>('/community/my-posts'),
      ]);
      setPublicPosts(pub.items);
      setMyPosts(mine);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được dữ liệu cộng đồng');
    }
  }, [filterType]);

  useEffect(() => {
    void load();
  }, [load]);

  function openNewPost() {
    setEditingPost(null);
    setPostType('QA');
    setTopic('BAO_DUONG');
    setTitle('');
    setContent('');
    setCoverFileId(null);
    setCoverUrl(null);
    setError(null);
    setOpenForm(true);
  }

  function openEditPost(p: CommunityPostItem) {
    setEditingPost(p);
    setPostType(p.type === 'BLOG' ? 'BLOG' : 'QA');
    setTopic(p.topic);
    setTitle(p.title);
    setContent(p.content);
    setCoverFileId(p.coverFileId);
    setCoverUrl(p.coverUrl);
    setError(null);
    setOpenForm(true);
  }

  async function submitPost(saveAsDraft: boolean) {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        type: postType,
        topic,
        title,
        content,
        coverFileId,
        saveAsDraft,
      };
      if (editingPost) {
        await ownerApi(`/community/posts/${editingPost.id}`, { method: 'PUT', body: payload });
      } else {
        await ownerApi('/community/posts', { body: payload });
      }
      setOpenForm(false);
      setEditingPost(null);
      setTitle('');
      setContent('');
      setCoverFileId(null);
      setCoverUrl(null);
      setTab('mine');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : saveAsDraft ? 'Lưu nháp thất bại' : 'Gửi bài thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="owner-community-page">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Cộng đồng chủ xe</h1>
          <p className="text-xs text-slate-500">Hỏi đáp kỹ thuật, blog & sách nói trên xe</p>
        </div>
        <Button onClick={openNewPost} data-testid="owner-new-post-btn">
          <Plus className="h-4 w-4" /> Đăng bài
        </Button>
      </header>

      <Tabs
        tabs={[
          { value: 'explore', label: 'Khám phá' },
          { value: 'mine', label: `Bài của tôi${myPosts?.length ? ` (${myPosts.length})` : ''}` },
        ]}
        value={tab}
        onChange={setTab}
      />

      {error && <Alert>{error}</Alert>}

      {tab === 'explore' ? (
        <div className="space-y-3">
          <div className="flex gap-1.5 overflow-x-auto pb-1 text-xs">
            {(
              [
                ['ALL', 'Tất cả'],
                ['QA', 'Hỏi đáp'],
                ['BLOG', 'Blog'],
                ['AUDIO', 'Sách nói'],
                ['PLAYLIST', 'Playlist'],
              ] as const
            ).map(([val, lb]) => (
              <button
                key={val}
                type="button"
                onClick={() => setFilterType(val)}
                className={`shrink-0 rounded-full px-3 py-1.5 font-medium ${
                  filterType === val ? 'bg-brand-600 text-white' : 'bg-white text-slate-600'
                }`}
              >
                {lb}
              </button>
            ))}
          </div>

          {!publicPosts ? (
            <Spinner className="h-6 w-6 text-brand-600" />
          ) : !publicPosts.length ? (
            <Card className="p-6 text-center text-sm text-slate-500">Chưa có bài viết trong mục này.</Card>
          ) : (
            <ul className="space-y-2.5" data-testid="owner-community-list">
              {publicPosts.map((p) => {
                const tp = COMMUNITY_TYPE_UI[p.type];
                const excerpt = plainPostExcerpt(p, 130);
                return (
                  <li key={p.id}>
                    <Link href={`/app/cong-dong/${p.id}`} className="block" data-testid="owner-community-card">
                      <Card className="overflow-hidden p-0">
                        {p.coverUrl && (
                          <div className="aspect-[16/9] w-full overflow-hidden bg-slate-100">
                            <img src={p.coverUrl} alt={p.title} loading="lazy" className="h-full w-full object-cover" />
                          </div>
                        )}
                        <div className="space-y-1.5 p-4">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={tp.tone}>{tp.label}</Badge>
                            {p.type === 'QA' && p.isSolved && (
                              <Badge tone="mint">
                                <CheckCircle2 className="h-3 w-3" /> Đã giải đáp
                              </Badge>
                            )}
                          </div>
                          <div className="font-semibold text-slate-900">{p.title}</div>
                          {excerpt && <p className="line-clamp-2 text-xs text-slate-600">{excerpt}</p>}
                          <div className="flex items-center justify-between pt-1 text-xs text-slate-500">
                            <span>{p.authorName}</span>
                            <span className="flex items-center gap-2.5">
                              {p.durationMinutes && (
                                <span className="inline-flex items-center gap-0.5 text-indigo-600">
                                  <Headphones className="h-3 w-3" /> {p.durationMinutes}p
                                </span>
                              )}
                              <span className="inline-flex items-center gap-0.5">
                                <Heart className="h-3 w-3" /> {p.likesCount}
                              </span>
                              <span className="inline-flex items-center gap-0.5">
                                <MessageCircle className="h-3 w-3" /> {p.commentsCount}
                              </span>
                            </span>
                          </div>
                        </div>
                      </Card>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : !myPosts ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : !myPosts.length ? (
        <Card className="p-6 text-center text-sm text-slate-500">Bạn chưa gửi câu hỏi hoặc bài chia sẻ nào.</Card>
      ) : (
        <ul className="space-y-2.5" data-testid="owner-my-posts">
          {myPosts.map((p) => {
            const st = COMMUNITY_STATUS_UI[p.status];
            return (
              <li key={p.id}>
                <Card className="space-y-2 p-4" data-testid="owner-my-post-card">
                  {p.coverUrl && (
                    <img src={p.coverUrl} alt={p.title} className="aspect-[16/9] w-full rounded-xl object-cover" />
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs text-slate-500">{p.code}</span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                  <div className="font-semibold text-slate-900">
                    {p.status !== 'BI_GO' ? (
                      <Link href={`/app/cong-dong/${p.id}`} className="hover:underline">
                        {p.title}
                      </Link>
                    ) : (
                      p.title
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span>{fmtDateTime(p.createdAt)}</span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        className="px-2.5 py-1 text-xs"
                        onClick={() =>
                          setPreviewDraft({
                            title: p.title,
                            summary: p.summary,
                            content: p.content,
                            coverUrl: p.coverUrl,
                            type: p.type,
                            topic: p.topic,
                            authorKind: 'OWNER',
                            authorName: p.authorName,
                            permanentUrl: `/cho/cong-dong/${p.id}`,
                            isDraft: p.status !== 'DA_DANG',
                          })
                        }
                      >
                        <Eye className="h-3.5 w-3.5" /> Xem trước
                      </Button>
                      {p.status !== 'BI_GO' && (
                        <Button
                          variant="outline"
                          className="px-2.5 py-1 text-xs"
                          onClick={() => openEditPost(p)}
                          data-testid="owner-edit-post-btn"
                        >
                          <Pencil className="h-3.5 w-3.5" /> Sửa bài
                        </Button>
                      )}
                    </div>
                  </div>
                  {p.reviewNote && <p className="text-xs text-rose-600">Ghi chú kiểm duyệt: {p.reviewNote}</p>}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={openForm}
        onClose={() => setOpenForm(false)}
        title={editingPost ? `Sửa bài ${editingPost.code} (giữ nguyên link)` : 'Đặt câu hỏi / Chia sẻ kinh nghiệm'}
        wide
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setOpenForm(false)}>
              Huỷ
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                setPreviewDraft({
                  title,
                  content,
                  coverUrl,
                  type: postType,
                  topic,
                  authorKind: 'OWNER',
                  authorName: editingPost?.authorName ?? 'Chủ xe',
                  permanentUrl: editingPost ? `/cho/cong-dong/${editingPost.id}` : null,
                  isDraft: true,
                })
              }
              data-testid="owner-preview-post-btn"
            >
              <Eye className="h-4 w-4" /> Xem trước
            </Button>
            <Button
              variant="outline"
              onClick={() => void submitPost(true)}
              disabled={busy}
              data-testid="owner-draft-post-btn"
            >
              <FileText className="h-4 w-4" /> Lưu nháp
            </Button>
            <Button onClick={() => void submitPost(false)} disabled={busy} data-testid="owner-submit-post-btn">
              {editingPost ? 'Cập nhật & Gửi duyệt' : 'Gửi kiểm duyệt'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {editingPost && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-900">
              Đường dẫn bài viết giữ nguyên không đổi: <code className="font-mono">/cho/cong-dong/{editingPost.id}</code>
            </div>
          )}
          {error && <Alert>{error}</Alert>}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Loại bài đăng">
              {(id) => (
                <Select id={id} value={postType} onChange={(e) => setPostType(e.target.value as 'QA' | 'BLOG')}>
                  <option value="QA">Hỏi đáp kỹ thuật & sửa xe</option>
                  <option value="BLOG">Chia sẻ kinh nghiệm lái xe</option>
                </Select>
              )}
            </Field>
            <Field label="Chủ đề *">
              {(id) => (
                <Select id={id} value={topic} onChange={(e) => setTopic(e.target.value)}>
                  {COMMUNITY_TOPICS.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Tiêu đề câu hỏi / bài viết *">
            {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VD: Xe đi 4 vạn cần thay những gì?" />}
          </Field>
          <CoverImageField
            label="Ảnh bìa / ảnh minh hoạ chính (tuỳ chọn)"
            coverUrl={coverUrl}
            uploadFn={ownerUploadCommunityPhoto}
            onChange={({ id, url }) => {
              setCoverFileId(id);
              setCoverUrl(url);
            }}
            testIdPrefix="owner-post-cover"
          />
          <WysiwygEditor
            label="Nội dung chi tiết *"
            value={content}
            onChange={setContent}
            uploadFn={ownerUploadCommunityPhoto}
            minHeightClass="min-h-[160px]"
            placeholder="Mô tả dòng xe, tình trạng gặp phải hoặc chèn hình ảnh chụp thực tế…"
            testId="owner-post-wysiwyg"
          />
        </div>
      </Dialog>

      <CommunityPreviewDialog open={!!previewDraft} onClose={() => setPreviewDraft(null)} draft={previewDraft} />
    </div>
  );
}
