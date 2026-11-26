'use client';

import { Alert, Badge, Button, Card, Input, Spinner } from '@cardiy/ui';
import { ArrowLeft, CheckCircle2, Headphones, Heart, ListMusic, Send } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  COMMUNITY_AUTHOR_UI,
  COMMUNITY_TYPE_UI,
  type CommunityPostDetail,
} from '@/lib/community';
import { fmtDateTime } from '@/lib/orders';
import { ownerApi } from '@/lib/owner';

/** A2.11 Chi tiết bài viết & tương tác (thích, bình luận, chọn lời giải) trên App chủ xe */
export default function OwnerCommunityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [post, setPost] = useState<CommunityPostDetail | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await ownerApi<CommunityPostDetail>(`/community/posts/${id}`);
      setPost(d);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được bài viết');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleLike() {
    if (!post) return;
    try {
      const res = await ownerApi<{ liked: boolean; likesCount: number }>(`/community/posts/${post.id}/like`, { body: {} });
      setPost({ ...post, liked: res.liked, likesCount: res.likesCount });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Thao tác thất bại');
    }
  }

  async function sendComment() {
    if (!post || !reply.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await ownerApi(`/community/posts/${post.id}/comments`, { body: { content: reply } });
      setReply('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không gửi được bình luận');
    } finally {
      setBusy(false);
    }
  }

  async function acceptAnswer(commentId: string) {
    if (!post) return;
    setBusy(true);
    try {
      await ownerApi(`/community/posts/${post.id}/accept-answer`, { body: { commentId } });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không chọn được câu trả lời');
    } finally {
      setBusy(false);
    }
  }

  if (!post) {
    return error ? <Alert>{error}</Alert> : <Spinner className="h-6 w-6 text-brand-600" />;
  }

  const tp = COMMUNITY_TYPE_UI[post.type];
  const au = COMMUNITY_AUTHOR_UI[post.authorKind];

  return (
    <div className="space-y-4" data-testid="owner-community-detail">
      <Link href="/app/cong-dong" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Cộng đồng
      </Link>

      {error && <Alert>{error}</Alert>}

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={tp.tone}>{tp.label}</Badge>
          <Badge tone={au.tone}>{post.authorName}</Badge>
          {post.type === 'QA' && post.isSolved && (
            <Badge tone="mint">
              <CheckCircle2 className="h-3 w-3" /> Đã giải đáp
            </Badge>
          )}
        </div>
        <h1 className="text-lg font-bold text-slate-900">{post.title}</h1>

        {(post.type === 'AUDIO' || post.type === 'PLAYLIST') && post.playlistItems.length > 0 && (
          <div className="space-y-1.5 rounded-xl bg-indigo-50 p-3 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-indigo-900">
              {post.type === 'AUDIO' ? <Headphones className="h-4 w-4" /> : <ListMusic className="h-4 w-4" />}
              <span>Danh sách chương ({post.playlistItems.length})</span>
            </div>
            <ul className="space-y-1 text-slate-700">
              {post.playlistItems.map((it, idx) => (
                <li key={idx} className="flex justify-between gap-2">
                  <span>
                    {idx + 1}. {it.title}
                  </span>
                  {it.duration && <span className="font-mono text-slate-500">{it.duration}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{post.content}</p>

        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <Button variant={post.liked ? 'primary' : 'outline'} onClick={toggleLike} data-testid="owner-like-btn">
            <Heart className="h-4 w-4" /> Hữu ích ({post.likesCount})
          </Button>
          <span className="text-xs text-slate-400">{fmtDateTime(post.publishedAt ?? post.createdAt)}</span>
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold text-slate-900">Bình luận & Tư vấn ({post.comments.length})</h2>
        <div className="flex gap-2">
          <Input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Nhập bình luận hoặc câu trả lời…"
            aria-label="Viết bình luận hoặc câu trả lời"
          />
          <Button onClick={sendComment} disabled={busy || !reply.trim()} data-testid="owner-comment-submit">
            <Send className="h-4 w-4" />
          </Button>
        </div>

        <ul className="space-y-2.5" data-testid="owner-comments-list">
          {post.comments.map((c) => {
            const cau = COMMUNITY_AUTHOR_UI[c.authorKind];
            return (
              <li
                key={c.id}
                className={`rounded-xl border p-3 text-sm ${c.isAccepted ? 'border-emerald-300 bg-emerald-50/70' : 'border-slate-100 bg-slate-50'}`}
                data-testid="owner-comment-card"
              >
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <b className="text-xs">{c.authorName}</b>
                    <Badge tone={cau.tone}>{cau.label}</Badge>
                    {c.isAccepted && <Badge tone="mint">Lời giải</Badge>}
                  </div>
                  {post.isMine && post.type === 'QA' && !c.isAccepted && (
                    <button
                      type="button"
                      onClick={() => acceptAnswer(c.id)}
                      disabled={busy}
                      className="text-xs font-semibold text-emerald-700 hover:underline"
                      data-testid="owner-accept-answer-btn"
                    >
                      Chọn làm lời giải
                    </button>
                  )}
                </div>
                <p className="mt-1.5 whitespace-pre-line text-slate-700">{c.content}</p>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
