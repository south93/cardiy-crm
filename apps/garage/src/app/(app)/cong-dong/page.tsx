'use client';

/* eslint-disable @next/next/no-img-element */

import { Alert, Badge, Button, Card, Dialog, Field, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import { CheckCircle2, ExternalLink, Eye, FileText, MessageCircle, Pencil, Plus, Send } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  CommunityPreviewDialog,
  CommunityRichContent,
  CoverImageField,
  WysiwygEditor,
  type CommunityPreviewDraft,
} from '@/components/community-editor';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import {
  COMMUNITY_STATUS_UI,
  COMMUNITY_TOPICS,
  COMMUNITY_TYPE_UI,
  plainPostExcerpt,
  publicCommunityGet,
  type CommunityPostDetail,
  type CommunityPostItem,
} from '@/lib/community';
import { fmtDateTime } from '@/lib/orders';

/** A3.64 Chủ garage PLG chia sẻ bài viết chuyên gia & tư vấn hỏi đáp cộng đồng */
export default function GarageCommunityPage() {
  return (
    <RequirePermission permission="community.manage">
      <GarageCommunityBody />
    </RequirePermission>
  );
}

function GarageCommunityBody() {
  const [tab, setTab] = useState<'qa' | 'mine'>('qa');
  const [qaPosts, setQaPosts] = useState<CommunityPostItem[] | null>(null);
  const [myPosts, setMyPosts] = useState<CommunityPostItem[] | null>(null);
  const [activeQa, setActiveQa] = useState<CommunityPostDetail | null>(null);
  const [replyText, setReplyText] = useState('');

  const [openCreate, setOpenCreate] = useState(false);
  const [editingPost, setEditingPost] = useState<CommunityPostItem | null>(null);
  const [topic, setTopic] = useState('BAO_DUONG');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [coverFileId, setCoverFileId] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [previewDraft, setPreviewDraft] = useState<CommunityPreviewDraft | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [pub, mine] = await Promise.all([
        publicCommunityGet<{ items: CommunityPostItem[] }>('posts?type=QA'),
        api<CommunityPostItem[]>('/community/posts'),
      ]);
      setQaPosts(pub.items);
      setMyPosts(mine);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được dữ liệu cộng đồng');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openNewArticle() {
    setEditingPost(null);
    setTopic('BAO_DUONG');
    setTitle('');
    setSummary('');
    setContent('');
    setCoverFileId(null);
    setCoverUrl(null);
    setError(null);
    setOpenCreate(true);
  }

  function openEditArticle(p: CommunityPostItem) {
    setEditingPost(p);
    setTopic(p.topic);
    setTitle(p.title);
    setSummary(p.summary ?? '');
    setContent(p.content);
    setCoverFileId(p.coverFileId);
    setCoverUrl(p.coverUrl);
    setError(null);
    setOpenCreate(true);
  }

  async function openQaDetail(id: string) {
    try {
      const d = await publicCommunityGet<CommunityPostDetail>(`posts/${id}`);
      setActiveQa(d);
      setReplyText('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không mở được câu hỏi');
    }
  }

  async function sendExpertReply() {
    if (!activeQa || !replyText.trim()) return;
    setBusy(true);
    try {
      await api(`/community/posts/${activeQa.id}/comments`, { body: { content: replyText } });
      setReplyText('');
      const refreshed = await publicCommunityGet<CommunityPostDetail>(`posts/${activeQa.id}`);
      setActiveQa(refreshed);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gửi tư vấn thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function saveArticle(saveAsDraft: boolean) {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        type: 'BLOG',
        topic,
        title,
        summary: summary || null,
        content,
        coverFileId,
        saveAsDraft,
      };
      if (editingPost) {
        await api(`/community/posts/${editingPost.id}`, { method: 'PUT', body: payload });
      } else {
        await api('/community/posts', { body: payload });
      }
      setOpenCreate(false);
      setEditingPost(null);
      setTitle('');
      setSummary('');
      setContent('');
      setCoverFileId(null);
      setCoverUrl(null);
      setTab('mine');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : saveAsDraft ? 'Lưu nháp thất bại' : 'Gửi bài viết thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="garage-community-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          tabs={[
            { value: 'qa', label: `Câu hỏi chủ xe cần tư vấn${qaPosts ? ` (${qaPosts.length})` : ''}` },
            { value: 'mine', label: `Bài chuyên gia của Garage${myPosts ? ` (${myPosts.length})` : ''}` },
          ]}
          value={tab}
          onChange={setTab}
        />
        <Button onClick={openNewArticle} data-testid="garage-new-article-btn">
          <Plus className="h-4 w-4" /> Viết bài chia sẻ chuyên gia
        </Button>
      </div>

      {error && <Alert>{error}</Alert>}

      {tab === 'qa' ? (
        !qaPosts ? (
          <Spinner className="h-6 w-6 text-brand-600" />
        ) : !qaPosts.length ? (
          <Card className="p-8 text-center text-sm text-slate-500">Chưa có câu hỏi nào từ chủ xe trên sàn.</Card>
        ) : (
          <ul className="space-y-3" data-testid="garage-qa-list">
            {qaPosts.map((p) => (
              <li key={p.id}>
                <Card className="flex flex-wrap items-start justify-between gap-4 p-5" data-testid="garage-qa-card">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-slate-500">{p.code}</span>
                      <Badge tone="slate">{p.topicLabel}</Badge>
                      {p.isSolved && (
                        <Badge tone="mint">
                          <CheckCircle2 className="h-3 w-3" /> Đã giải đáp
                        </Badge>
                      )}
                    </div>
                    <h3 className="font-semibold text-slate-900">{p.title}</h3>
                    <p className="line-clamp-2 text-sm text-slate-600">{plainPostExcerpt(p, 180)}</p>
                    <div className="text-xs text-slate-500">
                      Chủ xe: {p.authorName} · {p.commentsCount} phản hồi
                    </div>
                  </div>
                  <Button variant="outline" onClick={() => openQaDetail(p.id)} data-testid="garage-answer-qa-btn">
                    <MessageCircle className="h-4 w-4" /> Tư vấn kỹ thuật
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        )
      ) : !myPosts ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : !myPosts.length ? (
        <Card className="p-8 text-center text-sm text-slate-500">Garage chưa gửi bài chia sẻ chuyên gia nào.</Card>
      ) : (
        <ul className="space-y-3" data-testid="garage-my-articles">
          {myPosts.map((p) => {
            const st = COMMUNITY_STATUS_UI[p.status];
            const tp = COMMUNITY_TYPE_UI[p.type];
            return (
              <li key={p.id}>
                <Card className="flex flex-wrap items-start justify-between gap-4 p-5" data-testid="garage-article-card">
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
                        <Badge tone="slate">{p.topicLabel}</Badge>
                      </div>
                      <h3 className="font-semibold text-slate-900">{p.title}</h3>
                      <p className="line-clamp-2 text-sm text-slate-600">{plainPostExcerpt(p, 180)}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>
                          Tạo lúc {fmtDateTime(p.createdAt)} · {p.viewsCount} lượt xem · {p.likesCount} hữu ích
                        </span>
                        {p.status === 'DA_DANG' && (
                          <Link
                            href={`/cho/cong-dong/${p.id}`}
                            target="_blank"
                            className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" /> Xem trên sàn
                          </Link>
                        )}
                      </div>
                      {p.reviewNote && <p className="text-xs text-rose-600">Ghi chú kiểm duyệt sàn: {p.reviewNote}</p>}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() =>
                        setPreviewDraft({
                          title: p.title,
                          summary: p.summary,
                          content: p.content,
                          coverUrl: p.coverUrl,
                          type: p.type,
                          topic: p.topic,
                          authorKind: 'GARAGE',
                          authorName: p.authorName,
                          permanentUrl: `/cho/cong-dong/${p.id}`,
                          isDraft: p.status !== 'DA_DANG',
                        })
                      }
                      data-testid="garage-preview-article-btn"
                    >
                      <Eye className="h-4 w-4" /> Xem trước
                    </Button>
                    {p.status !== 'BI_GO' && (
                      <Button variant="outline" onClick={() => openEditArticle(p)} data-testid="garage-edit-article-btn">
                        <Pencil className="h-4 w-4" /> Sửa bài
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={!!activeQa}
        onClose={() => setActiveQa(null)}
        title={activeQa ? `Tư vấn câu hỏi ${activeQa.code}` : 'Tư vấn'}
        wide
        footer={
          <Button variant="outline" onClick={() => setActiveQa(null)}>
            Đóng
          </Button>
        }
      >
        {activeQa && (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="font-semibold text-slate-900">{activeQa.title}</div>
              <CommunityRichContent content={activeQa.content} className="mt-2" />
            </div>
            <div className="flex gap-2">
              <Input
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Nhập lời khuyên kỹ thuật dưới danh nghĩa Chuyên gia Garage…"
                aria-label="Nội dung tư vấn kỹ thuật"
              />
              <Button onClick={sendExpertReply} disabled={busy || !replyText.trim()} data-testid="garage-send-expert-reply">
                <Send className="h-4 w-4" /> Gửi tư vấn
              </Button>
            </div>
            <ul className="space-y-2 text-sm">
              {activeQa.comments.map((c) => (
                <li key={c.id} className="rounded-xl border border-slate-100 p-3">
                  <div className="text-xs font-semibold text-slate-800">{c.authorName}</div>
                  <p className="mt-1 text-slate-600">{c.content}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Dialog>

      <Dialog
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        title={editingPost ? `Sửa bài chuyên gia ${editingPost.code} (giữ nguyên link)` : 'Viết bài chia sẻ kiến thức kỹ thuật'}
        wide
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setOpenCreate(false)}>
              Huỷ
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                setPreviewDraft({
                  title,
                  summary: summary || null,
                  content,
                  coverUrl,
                  type: 'BLOG',
                  topic,
                  authorKind: 'GARAGE',
                  authorName: editingPost?.authorName ?? 'Chuyên gia Garage',
                  permanentUrl: editingPost ? `/cho/cong-dong/${editingPost.id}` : null,
                  isDraft: true,
                })
              }
              data-testid="garage-article-preview-btn"
            >
              <Eye className="h-4 w-4" /> Xem trước
            </Button>
            <Button
              variant="outline"
              onClick={() => void saveArticle(true)}
              disabled={busy}
              data-testid="garage-draft-article-btn"
            >
              <FileText className="h-4 w-4" /> Lưu nháp
            </Button>
            <Button onClick={() => void saveArticle(false)} disabled={busy} data-testid="garage-submit-article-btn">
              {editingPost?.status === 'DA_DANG' ? 'Lưu cập nhật (giữ link)' : 'Gửi Ban biên tập duyệt'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3.5">
          {editingPost && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5 text-xs text-emerald-900">
              Đang sửa bài <b>{editingPost.code}</b> — Đường dẫn cố định giữ nguyên:{' '}
              <code className="rounded bg-white px-1.5 py-0.5 font-mono">/cho/cong-dong/{editingPost.id}</code>
            </div>
          )}
          {error && <Alert>{error}</Alert>}

          <Field label="Chủ đề chuyên môn *">
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
          <Field label="Tiêu đề bài viết *">
            {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VD: Dấu hiệu nhận biết má phanh mòn cần thay sớm" />}
          </Field>
          <Field label="Tóm tắt ngắn (hiển thị trên danh sách)">
            {(id) => <Input id={id} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Tóm tắt 1-2 câu nội dung chính" />}
          </Field>
          <CoverImageField
            coverUrl={coverUrl}
            onChange={({ id, url }) => {
              setCoverFileId(id);
              setCoverUrl(url);
            }}
            testIdPrefix="garage-article-cover"
          />
          <WysiwygEditor
            label="Nội dung chia sẻ *"
            value={content}
            onChange={setContent}
            placeholder="Chia sẻ kinh nghiệm chẩn đoán, quy trình bảo dưỡng, chèn ảnh thực tế tại xưởng (WebP -> Cloudflare R2)…"
            testId="garage-article-wysiwyg"
          />
        </div>
      </Dialog>

      <CommunityPreviewDialog open={!!previewDraft} onClose={() => setPreviewDraft(null)} draft={previewDraft} />
    </div>
  );
}
