'use client';

import { Alert, Badge, Button, Card, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import { CheckCircle2, Eye, Headphones, Heart, ListMusic, MessageCircle, Pin, PlusCircle, Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  COMMUNITY_AUTHOR_UI,
  COMMUNITY_TOPICS,
  COMMUNITY_TYPE_UI,
  publicCommunityGet,
  type CommunityPostItem,
  type CommunityPostType,
  type PlatformBannerItem,
} from '@/lib/community';
import { fmtDateTime } from '@/lib/orders';

/** A1.10 Cộng đồng chủ xe trên Web sàn công khai: Blog, Sách nói, Playlist & Hỏi đáp */
export default function PublicCommunityPage() {
  const [type, setType] = useState<'ALL' | CommunityPostType>('ALL');
  const [topic, setTopic] = useState('');
  const [sort, setSort] = useState<'moi-nhat' | 'soi-noi' | 'xem-nhieu'>('moi-nhat');
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ banners: PlatformBannerItem[]; items: CommunityPostItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ sort });
      if (type !== 'ALL') qs.set('type', type);
      if (topic) qs.set('topic', topic);
      if (q.trim()) qs.set('q', q.trim());
      const res = await publicCommunityGet<{ banners: PlatformBannerItem[]; items: CommunityPostItem[] }>(`posts?${qs}`);
      setData(res);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được bài viết cộng đồng');
    }
  }, [type, topic, sort, q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  return (
    <div className="space-y-6" data-testid="public-community-page">
      <section className="rounded-3xl bg-gradient-to-br from-sky-700 via-brand-700 to-indigo-800 px-6 py-8 text-white md:px-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-2xl space-y-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
              <Headphones className="h-3.5 w-3.5" /> Cộng đồng & Tri thức chủ xe CARDIY
            </span>
            <h1 className="text-2xl font-bold md:text-3xl">Kinh nghiệm chăm xe, Sách nói đường dài & Hỏi đáp kỹ thuật</h1>
            <p className="text-sm text-sky-100">
              Cẩm nang thực chiến từ đội ngũ kỹ sư, các garage uy tín trên toàn quốc và tủ sách nói tuyển chọn dành riêng cho bác tài.
            </p>
          </div>
          <Link
            href="/app/cong-dong"
            className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-brand-700 shadow-sm hover:bg-sky-50"
            data-testid="public-community-ask-cta"
          >
            <PlusCircle className="h-4 w-4" /> Đặt câu hỏi / Chia sẻ bài
          </Link>
        </div>
      </section>

      {data && data.banners.length > 0 && (
        <section className="grid gap-3 md:grid-cols-2" data-testid="community-banners">
          {data.banners.map((b) => (
            <Card key={b.id} className="flex flex-wrap items-center justify-between gap-3 border-sky-200 bg-gradient-to-r from-sky-50 to-indigo-50 p-4" data-testid="community-banner-card">
              <div>
                <div className="font-semibold text-slate-900">{b.title}</div>
                {b.subtitle && <p className="mt-0.5 text-xs text-slate-600">{b.subtitle}</p>}
              </div>
              {b.linkUrl && (
                <Link href={b.linkUrl} className=" shrink-0 rounded-full bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">
                  {b.ctaLabel ?? 'Khám phá'}
                </Link>
              )}
            </Card>
          ))}
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          tabs={[
            { value: 'ALL', label: 'Tất cả' },
            { value: 'BLOG', label: 'Bài viết chuyên gia' },
            { value: 'AUDIO', label: 'Sách nói' },
            { value: 'PLAYLIST', label: 'Playlist' },
            { value: 'QA', label: 'Hỏi đáp' },
          ]}
          value={type}
          onChange={setType}
        />

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-56">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm chủ đề, từ khoá…"
              aria-label="Tìm trong cộng đồng"
              className="rounded-full bg-white pl-9"
            />
          </div>
          <Select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Chủ đề" className="w-48 bg-white">
            <option value="">Mọi chủ đề</option>
            {COMMUNITY_TOPICS.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sắp xếp" className="w-40 bg-white">
            <option value="moi-nhat">Mới nhất</option>
            <option value="soi-noi">Sôi nổi nhất</option>
            <option value="xem-nhieu">Xem nhiều</option>
          </Select>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      {!data ? (
        <div className="grid place-items-center p-12">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      ) : !data.items.length ? (
        <Card className="p-10 text-center text-sm text-slate-500">
          Chưa có bài viết nào khớp bộ lọc.{' '}
          <Button
            variant="outline"
            className="ml-2"
            onClick={() => {
              setType('ALL');
              setTopic('');
              setQ('');
            }}
          >
            Xoá bộ lọc
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2" data-testid="public-community-list">
          {data.items.map((p) => {
            const tp = COMMUNITY_TYPE_UI[p.type];
            const au = COMMUNITY_AUTHOR_UI[p.authorKind];
            return (
              <Link key={p.id} href={`/cho/cong-dong/${p.id}`} className="block" data-testid="public-community-card">
                <Card className="flex h-full flex-col justify-between gap-3 p-5 transition hover:border-brand-300 hover:shadow-md">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {p.pinned && (
                        <Badge tone="brand">
                          <Pin className="h-3 w-3" /> Đáng chú ý
                        </Badge>
                      )}
                      <Badge tone={tp.tone}>{tp.label}</Badge>
                      <Badge tone={au.tone}>{p.authorName}</Badge>
                      {p.type === 'QA' && p.isSolved && (
                        <Badge tone="mint">
                          <CheckCircle2 className="h-3 w-3" /> Đã giải đáp
                        </Badge>
                      )}
                    </div>
                    <h2 className="line-clamp-2 text-lg font-semibold text-slate-900">{p.title}</h2>
                    {p.summary && <p className="line-clamp-2 text-sm text-slate-600">{p.summary}</p>}
                    {(p.type === 'AUDIO' || p.type === 'PLAYLIST') && (
                      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        {p.type === 'AUDIO' ? <Headphones className="h-4 w-4 text-indigo-600" /> : <ListMusic className="h-4 w-4 text-emerald-600" />}
                        <span>
                          {p.playlistItems.length > 0 ? `${p.playlistItems.length} chương / tập` : 'Nội dung âm thanh'}
                          {p.durationMinutes ? ` · Tổng ${p.durationMinutes} phút` : ''}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
                    <span>
                      {p.topicLabel} · {fmtDateTime(p.publishedAt ?? p.createdAt)}
                    </span>
                    <span className="flex items-center gap-3 tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <Eye className="h-3.5 w-3.5" /> {p.viewsCount}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Heart className="h-3.5 w-3.5" /> {p.likesCount}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MessageCircle className="h-3.5 w-3.5" /> {p.commentsCount}
                      </span>
                    </span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
