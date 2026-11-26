'use client';

import { Alert, Badge, Card, Spinner } from '@cardiy/ui';
import { ArrowLeft, CheckCircle2, Eye, Headphones, Heart, ListMusic, MessageCircle, Pin } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  COMMUNITY_AUTHOR_UI,
  COMMUNITY_TYPE_UI,
  publicCommunityGet,
  type CommunityPostDetail,
} from '@/lib/community';
import { fmtDateTime } from '@/lib/orders';

/** A1.10 Chi tiết bài viết / sách nói / playlist / hỏi đáp trên Web sàn công khai */
export default function PublicCommunityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [post, setPost] = useState<CommunityPostDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    publicCommunityGet<CommunityPostDetail>(`posts/${id}`)
      .then(setPost)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Không tải được bài viết'));
  }, [id]);

  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/cho/cong-dong" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Quay lại Cộng đồng
        </Link>
        <Alert>{error}</Alert>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="grid place-items-center p-12">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  }

  const tp = COMMUNITY_TYPE_UI[post.type];
  const au = COMMUNITY_AUTHOR_UI[post.authorKind];

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="public-community-detail">
      <Link href="/cho/cong-dong" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Quay lại Cộng đồng chủ xe
      </Link>

      <Card className="space-y-5 p-6 md:p-8">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {post.pinned && (
              <Badge tone="brand">
                <Pin className="h-3 w-3" /> Bài ghim
              </Badge>
            )}
            <Badge tone={tp.tone}>{tp.label}</Badge>
            <Badge tone={au.tone}>{post.authorName}</Badge>
            <Badge tone="slate">{post.topicLabel}</Badge>
            {post.type === 'QA' && post.isSolved && (
              <Badge tone="mint">
                <CheckCircle2 className="h-3 w-3" /> Đã giải đáp
              </Badge>
            )}
          </div>

          <h1 className="text-2xl font-bold text-slate-900 md:text-3xl" data-testid="community-detail-title">
            {post.title}
          </h1>

          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
            <span>Mã bài: {post.code}</span>
            <span>Đăng lúc {fmtDateTime(post.publishedAt ?? post.createdAt)}</span>
            <span className="inline-flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" /> {post.viewsCount} lượt xem
            </span>
            <span className="inline-flex items-center gap-1">
              <Heart className="h-3.5 w-3.5" /> {post.likesCount} hữu ích
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="h-3.5 w-3.5" /> {post.commentsCount} bình luận
            </span>
          </div>
        </div>

        {post.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.coverUrl} alt={post.title} className="max-h-80 w-full rounded-2xl object-cover" />
        )}

        {(post.type === 'AUDIO' || post.type === 'PLAYLIST') && (
          <div className="space-y-3 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5" data-testid="community-playlist-box">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-semibold text-indigo-950">
                {post.type === 'AUDIO' ? <Headphones className="h-5 w-5 text-indigo-600" /> : <ListMusic className="h-5 w-5 text-emerald-600" />}
                <span>{post.type === 'AUDIO' ? 'Danh mục chương Sách nói' : 'Danh sách tập trong Playlist'}</span>
              </div>
              {post.durationMinutes && <span className="text-xs font-medium text-indigo-700">Tổng thời lượng: {post.durationMinutes} phút</span>}
            </div>
            {post.mediaUrl && (
              <p className="text-xs text-indigo-800">
                Nguồn phát chính thức:{' '}
                <a href={post.mediaUrl} target="_blank" rel="noreferrer" className="font-medium underline">
                  {post.mediaUrl}
                </a>
              </p>
            )}
            {post.playlistItems.length > 0 && (
              <ol className="divide-y divide-indigo-100 rounded-xl bg-white px-4 py-1 text-sm">
                {post.playlistItems.map((it, idx) => (
                  <li key={idx} className="flex flex-wrap items-center justify-between gap-2 py-2.5" data-testid="community-playlist-item">
                    <div>
                      <span className="mr-2 font-mono text-xs text-slate-400">#{idx + 1}</span>
                      <span className="font-medium text-slate-900">{it.title}</span>
                      {it.host && <span className="ml-2 text-xs text-slate-500">· {it.host}</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      {it.duration && <span className="font-mono">{it.duration}</span>}
                      {it.url && (
                        <a href={it.url} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 hover:underline">
                          Nghe
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        <div className="whitespace-pre-line text-base leading-relaxed text-slate-800" data-testid="community-detail-content">
          {post.content}
        </div>
      </Card>

      <Card className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Thảo luận & Giải đáp ({post.comments.length})</h2>
          <Link
            href={`/app/cong-dong/${post.id}`}
            className="rounded-full bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700"
            data-testid="public-community-interact-cta"
          >
            Đăng nhập Chủ xe để thích & trả lời
          </Link>
        </div>

        {!post.comments.length ? (
          <p className="text-sm text-slate-500">Chưa có bình luận nào. Hãy là người đầu tiên chia sẻ góc nhìn của bạn!</p>
        ) : (
          <ul className="space-y-3" data-testid="community-comments-list">
            {post.comments.map((c) => {
              const cau = COMMUNITY_AUTHOR_UI[c.authorKind];
              return (
                <li
                  key={c.id}
                  className={`rounded-2xl border p-4 text-sm ${
                    c.isAccepted ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-100 bg-slate-50/70'
                  }`}
                  data-testid="community-comment-item"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">{c.authorName}</span>
                      <Badge tone={cau.tone}>{cau.label}</Badge>
                      {c.isAccepted && (
                        <Badge tone="mint">
                          <CheckCircle2 className="h-3 w-3" /> Lời giải được chọn
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-slate-400">{fmtDateTime(c.createdAt)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-line text-slate-700">{c.content}</p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
