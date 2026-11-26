'use client';

import { Alert, Badge, Button, Card, Dialog, Field, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import { CheckCircle2, MessageCircle, Plus, Send } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { RequirePermission } from '@/components/require-permission';
import { api, ApiError } from '@/lib/api';
import {
  COMMUNITY_STATUS_UI,
  COMMUNITY_TOPICS,
  COMMUNITY_TYPE_UI,
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
  const [topic, setTopic] = useState('BAO_DUONG');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
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

  async function createArticle() {
    setBusy(true);
    setError(null);
    try {
      await api('/community/posts', {
        body: {
          type: 'BLOG',
          topic,
          title,
          content,
        },
      });
      setOpenCreate(false);
      setTitle('');
      setContent('');
      setTab('mine');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gửi bài viết thất bại');
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
        <Button onClick={() => setOpenCreate(true)} data-testid="garage-new-article-btn">
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
                    <p className="line-clamp-2 text-sm text-slate-600">{p.content}</p>
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
                <Card className="space-y-1.5 p-5" data-testid="garage-article-card">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-500">{p.code}</span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <Badge tone={tp.tone}>{tp.label}</Badge>
                    <Badge tone="slate">{p.topicLabel}</Badge>
                  </div>
                  <h3 className="font-semibold text-slate-900">{p.title}</h3>
                  <p className="line-clamp-2 text-sm text-slate-600">{p.summary ?? p.content}</p>
                  <div className="text-xs text-slate-500">
                    Tạo lúc {fmtDateTime(p.createdAt)} · {p.viewsCount} lượt xem · {p.likesCount} hữu ích
                  </div>
                  {p.reviewNote && <p className="text-xs text-rose-600">Ghi chú kiểm duyệt sàn: {p.reviewNote}</p>}
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
              <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{activeQa.content}</p>
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
        title="Viết bài chia sẻ kiến thức kỹ thuật"
        wide
        footer={
          <>
            <Button variant="outline" onClick={() => setOpenCreate(false)}>
              Huỷ
            </Button>
            <Button onClick={createArticle} disabled={busy} data-testid="garage-submit-article-btn">
              Gửi Ban biên tập duyệt
            </Button>
          </>
        }
      >
        <div className="space-y-3">
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
          <Field label="Nội dung chia sẻ *">
            {(id) => (
              <textarea
                id={id}
                rows={6}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Chia sẻ kinh nghiệm chẩn đoán, chi phí tham khảo, lưu ý an toàn cho chủ xe…"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
            )}
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
