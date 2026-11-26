'use client';

import { Alert, Badge, Button, Card, Dialog, Field, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import { CheckCircle2, Headphones, Heart, MessageCircle, Plus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  COMMUNITY_STATUS_UI,
  COMMUNITY_TOPICS,
  COMMUNITY_TYPE_UI,
  ownerUploadCommunityPhoto,
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
  const [postType, setPostType] = useState<'QA' | 'BLOG'>('QA');
  const [topic, setTopic] = useState('BAO_DUONG');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [coverFileId, setCoverFileId] = useState<string | null>(null);
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

  async function submitPost() {
    setBusy(true);
    setError(null);
    try {
      await ownerApi('/community/posts', {
        body: {
          type: postType,
          topic,
          title,
          content,
          coverFileId,
        },
      });
      setOpenForm(false);
      setTitle('');
      setContent('');
      setCoverFileId(null);
      setTab('mine');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gửi bài thất bại');
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
        <Button onClick={() => setOpenForm(true)} data-testid="owner-new-post-btn">
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
                return (
                  <li key={p.id}>
                    <Link href={`/app/cong-dong/${p.id}`} className="block" data-testid="owner-community-card">
                      <Card className="space-y-1.5 p-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={tp.tone}>{tp.label}</Badge>
                          {p.type === 'QA' && p.isSolved && (
                            <Badge tone="mint">
                              <CheckCircle2 className="h-3 w-3" /> Đã giải đáp
                            </Badge>
                          )}
                        </div>
                        <div className="font-semibold text-slate-900">{p.title}</div>
                        <div className="flex items-center justify-between text-xs text-slate-500">
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
                <Card className="space-y-1.5 p-4" data-testid="owner-my-post-card">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs text-slate-500">{p.code}</span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                  <div className="font-semibold text-slate-900">
                    {p.status === 'DA_DANG' ? (
                      <Link href={`/app/cong-dong/${p.id}`} className="hover:underline">
                        {p.title}
                      </Link>
                    ) : (
                      p.title
                    )}
                  </div>
                  <div className="text-xs text-slate-500">{fmtDateTime(p.createdAt)}</div>
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
        title="Đặt câu hỏi / Chia sẻ kinh nghiệm"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpenForm(false)}>
              Huỷ
            </Button>
            <Button onClick={submitPost} disabled={busy} data-testid="owner-submit-post-btn">
              Gửi kiểm duyệt
            </Button>
          </>
        }
      >
        <div className="space-y-3">
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
          <Field label="Tiêu đề câu hỏi / bài viết *">
            {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VD: Xe đi 4 vạn cần thay những gì?" />}
          </Field>
          <Field label="Nội dung chi tiết *">
            {(id) => (
              <textarea
                id={id}
                rows={4}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Mô tả dòng xe, tình trạng gặp phải hoặc kinh nghiệm thực tế…"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
            )}
          </Field>
          <Field label="Ảnh minh hoạ (tuỳ chọn)">
            {(id) => (
              <input
                id={id}
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    const up = await ownerUploadCommunityPhoto(f);
                    setCoverFileId(up.id);
                  } catch (err) {
                    setError(err instanceof ApiError ? err.message : 'Tải ảnh thất bại');
                  }
                }}
                className="text-xs text-slate-600"
              />
            )}
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
