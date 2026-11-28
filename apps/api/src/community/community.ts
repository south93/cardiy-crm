import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  extractEmbeddedFileIds,
  injectResolvedFileUrls,
  sanitizeCommunityHtml,
  searchKey,
  stripHtmlToText,
} from '@cardiy/shared';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { Access } from '../auth/access.service';
import { CurrentAuth, Public, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { reserveNumbers } from '../crm/counters';
import { FilesModule } from '../files/files.module';
import { FilesService } from '../files/files.service';
import { OwnerModule } from '../owner/owner';
import { OwnerGuard, type OwnerRequest } from '../owner/owner-auth';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  canAcceptQaAnswer,
  COMMUNITY_MAX_HOURLY_COMMENTS_PER_USER,
  COMMUNITY_MAX_HOURLY_POSTS_PER_USER,
  COMMUNITY_STATUS_LABEL,
  COMMUNITY_TOPICS,
  COMMUNITY_TYPE_LABEL,
  communityPostCode,
  initialPostStatus,
  postStatusAfterEdit,
  type CommunityAuthorKind,
  type CommunityPostStatus,
  type CommunityPostType,
} from './community-rules';

type Db = PrismaService | Prisma.TransactionClient;
const optText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());

const POST_TYPES = ['BLOG', 'AUDIO', 'PLAYLIST', 'QA'] as const;
const TOPIC_CODES = COMMUNITY_TOPICS.map((t) => t.code);
const MAX_EMBEDDED_IMAGES = 40;

const playlistItemSchema = z.object({
  title: z.string().trim().min(1).max(160),
  host: optText(100),
  duration: optText(20),
  url: optText(500),
});

export const communityPostSchema = z
  .object({
    type: z.enum(POST_TYPES).default('QA'),
    title: z.string().trim().min(2, 'Nhập tiêu đề tối thiểu 2 ký tự').max(200),
    summary: optText(300),
    content: z.string().trim().max(100_000).default(''),
    topic: z
      .string()
      .trim()
      .refine((v) => TOPIC_CODES.includes(v), 'Chủ đề không hợp lệ')
      .default('KINH_NGHIEM'),
    coverFileId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable().optional()),
    mediaUrl: optText(500),
    durationMinutes: z.preprocess(
      (v) => (v === undefined || v === null || v === '' ? null : Number(v)),
      z.number().int().min(1).max(600).nullable().optional(),
    ),
    playlistItems: z.array(playlistItemSchema).max(30).default([]),
    pinned: z.boolean().optional(),
    saveAsDraft: z.boolean().optional().default(false),
  })
  .superRefine((val, ctx) => {
    if (!val.saveAsDraft) {
      if (val.title.length < 5) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['title'], message: 'Nhập tiêu đề tối thiểu 5 ký tự' });
      }
      const plain = stripHtmlToText(val.content);
      const hasEmbeddedImages = extractEmbeddedFileIds(val.content).length > 0;
      if (plain.length < 10 && !hasEmbeddedImages) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['content'], message: 'Nhập nội dung tối thiểu 10 ký tự' });
      }
    }
  });
type CommunityPostDto = z.infer<typeof communityPostSchema>;

const commentBodySchema = z.object({
  content: z.string().trim().min(2, 'Nhập bình luận tối thiểu 2 ký tự').max(2000),
});

const acceptAnswerSchema = z.object({
  commentId: z.string().uuid('Chọn câu trả lời'),
});

const reviewNoteSchema = z.object({
  note: z.string().trim().min(3, 'Nhập lý do kiểm duyệt').max(500),
});

const hideCommentSchema = z.object({
  hidden: z.boolean(),
  reason: optText(300),
});

const bannerSchema = z.object({
  title: z.string().trim().min(3, 'Nhập tiêu đề banner').max(160),
  subtitle: optText(300),
  linkUrl: optText(300),
  ctaLabel: optText(60),
  imageFileId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable().optional()),
  position: z.enum(['HOME', 'COMMUNITY']).default('COMMUNITY'),
  sortOrder: z.coerce.number().int().min(1).max(100).default(1),
  active: z.boolean().default(true),
});

function assertPlatformModeration(a: Access) {
  const ok =
    a.tenantType === 'PLATFORM' &&
    a.permissions.some((p) => ['platform.partner.review', 'platform.report.handle', 'platform.content.manage'].includes(p));
  if (!ok) throw new ForbiddenException('Chỉ bộ phận kiểm duyệt / nội dung sàn mới thực hiện được thao tác này');
}

function assertPlatformContent(a: Access) {
  if (a.tenantType !== 'PLATFORM' || !a.permissions.includes('platform.content.manage')) {
    throw new ForbiddenException('Chỉ bộ phận Nội dung & Marketing sàn mới thực hiện được thao tác này');
  }
}

@Injectable()
export class CommunityService {
  private cachedPlatformId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly redis: RedisService,
  ) {}

  private url = (id: string | null | undefined) => (id ? this.files.signedUrl(id).catch(() => null) : Promise.resolve(null));

  private async platformTenantId(tx: Db = this.prisma): Promise<string> {
    if (this.cachedPlatformId) return this.cachedPlatformId;
    const t = await tx.tenant.findFirstOrThrow({ where: { type: 'PLATFORM' }, select: { id: true } });
    this.cachedPlatformId = t.id;
    return t.id;
  }

  private async checkUserRateLimit(scope: 'post' | 'comment', userId: string) {
    const max = scope === 'post' ? COMMUNITY_MAX_HOURLY_POSTS_PER_USER : COMMUNITY_MAX_HOURLY_COMMENTS_PER_USER;
    const key = `community:${scope}:${userId}`;
    const hits = await this.redis.client.incr(key);
    if (hits === 1) await this.redis.client.expire(key, 3600);
    if (hits > max) {
      throw new HttpException('Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** Làm sạch HTML WYSIWYG, kiểm tra quyền sở hữu ảnh bìa + ảnh chèn trong bài (trên R2/Storage) và trích xuất tóm tắt văn bản thuần */
  private async preparePostContent(
    dto: CommunityPostDto,
    storageTenantId: string,
    existing?: { coverFileId: string | null; content: string },
  ): Promise<{ cleanContent: string; plainSummary: string | null; plainExcerpt: string }> {
    const cleanContent = sanitizeCommunityHtml(dto.content);
    const embeddedIds = extractEmbeddedFileIds(cleanContent);
    if (embeddedIds.length > MAX_EMBEDDED_IMAGES) {
      throw new BadRequestException(`Mỗi bài viết chèn tối đa ${MAX_EMBEDDED_IMAGES} hình ảnh`);
    }

    const allowedExisting = new Set<string>(
      existing
        ? [...extractEmbeddedFileIds(existing.content), ...(existing.coverFileId ? [existing.coverFileId.toLowerCase()] : [])]
        : [],
    );

    const toVerify = new Set<string>();
    if (dto.coverFileId && !allowedExisting.has(dto.coverFileId.toLowerCase())) {
      toVerify.add(dto.coverFileId);
    }
    for (const fid of embeddedIds) {
      if (!allowedExisting.has(fid)) toVerify.add(fid);
    }
    if (toVerify.size > 0) {
      await Promise.all([...toVerify].map((fid) => this.files.assertOwnedImage(fid, storageTenantId)));
    }

    const plainText = stripHtmlToText(cleanContent);
    const plainSummary = dto.summary?.trim() ? stripHtmlToText(dto.summary) : plainText ? plainText.slice(0, 180) : null;
    return { cleanContent, plainSummary, plainExcerpt: plainText.slice(0, 500) };
  }

  private async bannerView(b: Prisma.PlatformBannerGetPayload<object>) {
    return {
      id: b.id,
      title: b.title,
      subtitle: b.subtitle,
      linkUrl: b.linkUrl,
      ctaLabel: b.ctaLabel,
      position: b.position,
      sortOrder: b.sortOrder,
      active: b.active,
      imageUrl: await this.url(b.imageFileId),
      imageFileId: b.imageFileId,
      updatedAt: b.updatedAt,
    };
  }

  private async postSummaryView(p: Prisma.CommunityPostGetPayload<object>, likedIds?: Set<string>) {
    const topicLabel = COMMUNITY_TOPICS.find((t) => t.code === p.topic)?.label ?? p.topic;
    const embeddedIds = extractEmbeddedFileIds(p.content);
    const [coverUrl, embeddedPairs] = await Promise.all([
      this.url(p.coverFileId),
      embeddedIds.length
        ? Promise.all(
            embeddedIds.map(async (fid) => {
              const u = await this.url(fid);
              return u ? ([fid, u] as const) : null;
            }),
          )
        : Promise.resolve([]),
    ]);

    const urlMap = new Map<string, string>();
    for (const pair of embeddedPairs) {
      if (pair) urlMap.set(pair[0], pair[1]);
    }
    const resolvedContent = urlMap.size > 0 ? injectResolvedFileUrls(p.content, urlMap) : p.content;

    return {
      id: p.id,
      code: p.code,
      type: p.type as CommunityPostType,
      typeLabel: COMMUNITY_TYPE_LABEL[p.type as CommunityPostType],
      authorKind: p.authorKind as CommunityAuthorKind,
      authorName: p.authorName,
      title: p.title,
      summary: p.summary ? stripHtmlToText(p.summary) : null,
      content: resolvedContent,
      topic: p.topic,
      topicLabel,
      coverFileId: p.coverFileId,
      coverUrl,
      mediaUrl: p.mediaUrl,
      durationMinutes: p.durationMinutes,
      playlistItems: Array.isArray(p.playlistItems) ? p.playlistItems : [],
      pinned: p.pinned,
      isSolved: p.isSolved,
      acceptedCommentId: p.acceptedCommentId,
      viewsCount: p.viewsCount,
      likesCount: p.likesCount,
      commentsCount: p.commentsCount,
      liked: likedIds ? likedIds.has(p.id) : false,
      status: p.status as CommunityPostStatus,
      statusLabel: COMMUNITY_STATUS_LABEL[p.status as CommunityPostStatus],
      reviewNote: p.reviewNote,
      publishedAt: p.publishedAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  // ---------------- Công khai trên sàn (/cho/cong-dong, A1.10) ----------------

  async publicBanners(position?: 'HOME' | 'COMMUNITY') {
    const rows = await this.prisma.platformBanner.findMany({
      where: { active: true, ...(position ? { position } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      take: 10,
    });
    return Promise.all(rows.map((r) => this.bannerView(r)));
  }

  async publicPosts(q: { type?: string; topic?: string; q?: string; sort?: string }) {
    const where: Prisma.CommunityPostWhereInput = { status: 'DA_DANG' };
    if (q.type && (POST_TYPES as readonly string[]).includes(q.type)) where.type = q.type as CommunityPostType;
    if (q.topic && TOPIC_CODES.includes(q.topic)) where.topic = q.topic;
    if (q.q?.trim()) where.searchText = { contains: searchKey(q.q) };

    const orderBy: Prisma.CommunityPostOrderByWithRelationInput[] =
      q.sort === 'soi-noi'
        ? [{ pinned: 'desc' }, { commentsCount: 'desc' }, { likesCount: 'desc' }]
        : q.sort === 'xem-nhieu'
          ? [{ pinned: 'desc' }, { viewsCount: 'desc' }]
          : [{ pinned: 'desc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }];

    const [rows, banners] = await Promise.all([
      this.prisma.communityPost.findMany({ where, orderBy, take: 100 }),
      this.publicBanners('COMMUNITY'),
    ]);

    return {
      topics: COMMUNITY_TOPICS,
      banners,
      items: await Promise.all(rows.map((r) => this.postSummaryView(r))),
    };
  }

  async publicPostDetail(id: string, ip?: string, viewerUserId?: string) {
    const row = await this.prisma.communityPost.findUnique({
      where: { id },
      include: {
        comments: { where: { hidden: false }, orderBy: { createdAt: 'asc' } },
      },
    });
    const isAuthorPreview = Boolean(viewerUserId && row && row.authorUserId === viewerUserId && row.status !== 'BI_GO');
    if (!row || (row.status !== 'DA_DANG' && !isAuthorPreview)) {
      throw new NotFoundException('Không tìm thấy bài viết cộng đồng');
    }

    if (ip && row.status === 'DA_DANG') {
      const key = `community:view:${id}:${ip}`;
      const added = await this.redis.client.set(key, '1', 'EX', 1800, 'NX');
      if (added === 'OK') {
        await this.prisma.communityPost.update({ where: { id }, data: { viewsCount: { increment: 1 } } });
        row.viewsCount += 1;
      }
    }

    let liked = false;
    if (viewerUserId) {
      const lk = await this.prisma.communityPostLike.findUnique({
        where: { postId_userId: { postId: id, userId: viewerUserId } },
      });
      liked = !!lk;
    }

    const base = await this.postSummaryView(row, liked ? new Set([id]) : undefined);
    return {
      ...base,
      isMine: viewerUserId ? row.authorUserId === viewerUserId : false,
      comments: row.comments.map((c) => ({
        id: c.id,
        authorKind: c.authorKind,
        authorName: c.authorName,
        content: c.content,
        isAccepted: row.acceptedCommentId === c.id,
        createdAt: c.createdAt,
      })),
    };
  }

  // ---------------- App chủ xe (/app/cong-dong, A2.11) ----------------

  async ownerUpload(userId: string, file: Express.Multer.File, ip?: string) {
    if (!file) throw new BadRequestException('Chọn file ảnh để tải lên');
    if (!file.mimetype?.startsWith('image/')) throw new BadRequestException('Chỉ chấp nhận file ảnh');
    const platformId = await this.platformTenantId();
    return this.files.upload(platformId, userId, file, ip);
  }

  async ownerMyPosts(userId: string) {
    const rows = await this.prisma.communityPost.findMany({
      where: { authorUserId: userId, authorKind: 'OWNER' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return Promise.all(rows.map((r) => this.postSummaryView(r)));
  }

  async ownerCreatePost(userId: string, dto: CommunityPostDto, ip?: string) {
    if (dto.type !== 'QA' && dto.type !== 'BLOG') {
      throw new BadRequestException('Chủ xe có thể đăng câu hỏi Hỏi đáp hoặc bài Blog chia sẻ kinh nghiệm');
    }
    await this.checkUserRateLimit('post', userId);
    const [user, platformId] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true } }),
      this.platformTenantId(),
    ]);
    const { cleanContent, plainSummary, plainExcerpt } = await this.preparePostContent(dto, platformId);

    const status = initialPostStatus('OWNER', dto.saveAsDraft);
    const created = await this.prisma.$transaction(async (tx) => {
      const code = communityPostCode(await reserveNumbers(tx, platformId, 'community_post'));
      const row = await tx.communityPost.create({
        data: {
          code,
          type: dto.type,
          authorKind: 'OWNER',
          authorUserId: userId,
          authorName: user.fullName,
          title: dto.title,
          summary: plainSummary,
          content: cleanContent,
          topic: dto.topic,
          coverFileId: dto.coverFileId ?? null,
          status,
          searchText: searchKey(code, dto.title, plainSummary, plainExcerpt, dto.topic, user.fullName),
        },
      });
      await this.audit.log(
        { tenantId: platformId, actorId: userId, action: 'community_post.owner_created', entity: 'community_post', entityId: row.id, after: { code, type: dto.type, status }, ip },
        tx,
      );
      return row;
    });
    return this.postSummaryView(created);
  }

  async ownerUpdatePost(userId: string, id: string, dto: CommunityPostDto, ip?: string) {
    if (dto.type !== 'QA' && dto.type !== 'BLOG') {
      throw new BadRequestException('Chủ xe có thể đăng câu hỏi Hỏi đáp hoặc bài Blog chia sẻ kinh nghiệm');
    }
    const cur = await this.prisma.communityPost.findFirst({ where: { id, authorUserId: userId, authorKind: 'OWNER' } });
    if (!cur) throw new NotFoundException('Không tìm thấy bài viết của bạn');
    if (cur.status === 'BI_GO') throw new ConflictException('Bài viết đã bị gỡ do vi phạm');
    const platformId = await this.platformTenantId();
    const { cleanContent, plainSummary, plainExcerpt } = await this.preparePostContent(dto, platformId, cur);

    const nextStatus = postStatusAfterEdit(cur.status as CommunityPostStatus, 'OWNER', dto.saveAsDraft);
    const saved = await this.prisma.communityPost.update({
      where: { id },
      data: {
        type: dto.type,
        title: dto.title,
        summary: plainSummary,
        content: cleanContent,
        topic: dto.topic,
        coverFileId: dto.coverFileId ?? null,
        status: nextStatus,
        reviewNote: nextStatus === 'CHO_DUYET' ? null : cur.reviewNote,
        searchText: searchKey(cur.code, dto.title, plainSummary, plainExcerpt, dto.topic, cur.authorName),
      },
    });
    await this.audit.log({
      tenantId: platformId,
      actorId: userId,
      action: 'community_post.owner_updated',
      entity: 'community_post',
      entityId: id,
      before: { status: cur.status },
      after: { status: nextStatus },
      ip,
    });
    return this.postSummaryView(saved);
  }

  private async addCommentInternal(opts: {
    postId: string;
    authorKind: CommunityAuthorKind;
    authorUserId: string;
    authorTenantId: string | null;
    authorName: string;
    content: string;
  }) {
    await this.checkUserRateLimit('comment', opts.authorUserId);
    const post = await this.prisma.communityPost.findUnique({ where: { id: opts.postId }, select: { id: true, status: true } });
    if (!post || post.status !== 'DA_DANG') throw new NotFoundException('Bài viết không tồn tại hoặc chưa xuất bản');

    const comment = await this.prisma.$transaction(async (tx) => {
      const c = await tx.communityComment.create({
        data: {
          postId: opts.postId,
          authorKind: opts.authorKind,
          authorUserId: opts.authorUserId,
          authorTenantId: opts.authorTenantId,
          authorName: opts.authorName,
          content: opts.content,
        },
      });
      const visibleCount = await tx.communityComment.count({ where: { postId: opts.postId, hidden: false } });
      await tx.communityPost.update({ where: { id: opts.postId }, data: { commentsCount: visibleCount } });
      return c;
    });

    return {
      id: comment.id,
      authorKind: comment.authorKind,
      authorName: comment.authorName,
      content: comment.content,
      isAccepted: false,
      createdAt: comment.createdAt,
    };
  }

  async ownerAddComment(userId: string, postId: string, content: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true } });
    return this.addCommentInternal({
      postId,
      authorKind: 'OWNER',
      authorUserId: userId,
      authorTenantId: null,
      authorName: user.fullName,
      content,
    });
  }

  async ownerToggleLike(userId: string, postId: string) {
    const post = await this.prisma.communityPost.findUnique({ where: { id: postId }, select: { id: true, status: true } });
    if (!post || post.status !== 'DA_DANG') throw new NotFoundException('Bài viết không tồn tại');

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.communityPostLike.findUnique({ where: { postId_userId: { postId, userId } } });
      if (existing) {
        await tx.communityPostLike.delete({ where: { postId_userId: { postId, userId } } });
      } else {
        await tx.communityPostLike.create({ data: { postId, userId } });
      }
      const likesCount = await tx.communityPostLike.count({ where: { postId } });
      await tx.communityPost.update({ where: { id: postId }, data: { likesCount } });
      return { liked: !existing, likesCount };
    });
  }

  async ownerAcceptAnswer(userId: string, postId: string, commentId: string) {
    const post = await this.prisma.communityPost.findFirst({ where: { id: postId, authorUserId: userId } });
    if (!post) throw new ForbiddenException('Chỉ người đặt câu hỏi mới chọn được câu trả lời giải đáp');
    if (!canAcceptQaAnswer({ type: post.type as CommunityPostType, status: post.status as CommunityPostStatus })) {
      throw new ConflictException('Chỉ áp dụng cho bài Hỏi đáp đang xuất bản');
    }
    const comment = await this.prisma.communityComment.findFirst({ where: { id: commentId, postId, hidden: false } });
    if (!comment) throw new NotFoundException('Không tìm thấy bình luận này');

    await this.prisma.communityPost.update({
      where: { id: postId },
      data: { isSolved: true, acceptedCommentId: commentId },
    });
    return { isSolved: true, acceptedCommentId: commentId };
  }

  // ---------------- Chủ garage PLG chia sẻ bài chuyên gia (/cong-dong) ----------------

  async garageListPosts(a: Access) {
    if (a.tenantType !== 'GARAGE') throw new ForbiddenException('Chỉ dành cho không gian Garage PLG');
    const rows = await this.prisma.communityPost.findMany({
      where: { authorTenantId: a.tenantId, authorKind: 'GARAGE' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return Promise.all(rows.map((r) => this.postSummaryView(r)));
  }

  async garageCreatePost(a: Access, dto: CommunityPostDto, ip?: string) {
    if (a.tenantType !== 'GARAGE') throw new ForbiddenException('Chỉ dành cho không gian Garage PLG');
    const [tenant, shop, platformId] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: a.tenantId } }),
      this.prisma.shop.findUnique({ where: { tenantId: a.tenantId } }),
      this.platformTenantId(),
    ]);
    const { cleanContent, plainSummary, plainExcerpt } = await this.preparePostContent(dto, a.tenantId);

    const authorName = shop?.name ?? tenant.name;
    const status = initialPostStatus('GARAGE', dto.saveAsDraft);
    const created = await this.prisma.$transaction(async (tx) => {
      const code = communityPostCode(await reserveNumbers(tx, platformId, 'community_post'));
      const row = await tx.communityPost.create({
        data: {
          code,
          type: dto.type === 'QA' ? 'QA' : 'BLOG',
          authorKind: 'GARAGE',
          authorUserId: a.userId,
          authorTenantId: a.tenantId,
          authorName,
          title: dto.title,
          summary: plainSummary,
          content: cleanContent,
          topic: dto.topic,
          coverFileId: dto.coverFileId ?? null,
          status,
          searchText: searchKey(code, dto.title, plainSummary, plainExcerpt, dto.topic, authorName),
        },
      });
      await this.audit.log(
        { tenantId: a.tenantId, actorId: a.userId, action: 'community_post.garage_created', entity: 'community_post', entityId: row.id, after: { code, status }, ip },
        tx,
      );
      return row;
    });
    return this.postSummaryView(created);
  }

  /** Chuyên gia Garage cập nhật bản nháp hoặc sửa bài đã đăng mà không thay đổi đường dẫn công khai (/cho/cong-dong/:id) */
  async garageUpdatePost(a: Access, id: string, dto: CommunityPostDto, ip?: string) {
    if (a.tenantType !== 'GARAGE') throw new ForbiddenException('Chỉ dành cho không gian Garage PLG');
    const cur = await this.prisma.communityPost.findFirst({
      where: { id, authorTenantId: a.tenantId, authorKind: 'GARAGE' },
    });
    if (!cur) throw new NotFoundException('Không tìm thấy bài viết của garage');
    if (cur.status === 'BI_GO') throw new ConflictException('Bài viết đã bị gỡ do vi phạm');

    const { cleanContent, plainSummary, plainExcerpt } = await this.preparePostContent(dto, a.tenantId, cur);
    const nextStatus = postStatusAfterEdit(cur.status as CommunityPostStatus, 'GARAGE', dto.saveAsDraft);

    const saved = await this.prisma.communityPost.update({
      where: { id },
      data: {
        type: dto.type === 'QA' ? 'QA' : 'BLOG',
        title: dto.title,
        summary: plainSummary,
        content: cleanContent,
        topic: dto.topic,
        coverFileId: dto.coverFileId ?? null,
        status: nextStatus,
        reviewNote: nextStatus === 'CHO_DUYET' ? null : cur.reviewNote,
        searchText: searchKey(cur.code, dto.title, plainSummary, plainExcerpt, dto.topic, cur.authorName),
      },
    });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'community_post.garage_updated',
      entity: 'community_post',
      entityId: id,
      before: { status: cur.status },
      after: { status: nextStatus },
      ip,
    });
    return this.postSummaryView(saved);
  }

  async garageAddComment(a: Access, postId: string, content: string) {
    if (a.tenantType !== 'GARAGE') throw new ForbiddenException('Chỉ dành cho không gian Garage PLG');
    const [tenant, shop] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: a.tenantId } }),
      this.prisma.shop.findUnique({ where: { tenantId: a.tenantId } }),
    ]);
    return this.addCommentInternal({
      postId,
      authorKind: 'GARAGE',
      authorUserId: a.userId,
      authorTenantId: a.tenantId,
      authorName: shop?.name ?? tenant.name,
      content,
    });
  }

  // ---------------- Quản trị sàn: Kiểm duyệt A6.32 & Xuất bản Nội dung/Banner A6.62 ----------------

  async platformListPosts(a: Access, q: { status?: string; type?: string; q?: string }) {
    assertPlatformModeration(a);
    const where: Prisma.CommunityPostWhereInput = {};
    if (q.status && q.status !== 'ALL') where.status = q.status as CommunityPostStatus;
    if (q.type && (POST_TYPES as readonly string[]).includes(q.type)) where.type = q.type as CommunityPostType;
    if (q.q?.trim()) where.searchText = { contains: searchKey(q.q) };

    const [rows, counts] = await Promise.all([
      this.prisma.communityPost.findMany({
        where,
        include: { comments: { orderBy: { createdAt: 'desc' }, take: 20 } },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: 150,
      }),
      this.prisma.communityPost.groupBy({ by: ['status'], _count: true }),
    ]);

    const items = await Promise.all(
      rows.map(async (r) => ({
        ...(await this.postSummaryView(r)),
        recentComments: r.comments.map((c) => ({
          id: c.id,
          authorName: c.authorName,
          authorKind: c.authorKind,
          content: c.content,
          hidden: c.hidden,
          hiddenReason: c.hiddenReason,
          createdAt: c.createdAt,
        })),
      })),
    );

    return {
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
      items,
    };
  }

  async platformModeratePost(a: Access, id: string, to: 'DA_DANG' | 'BI_TU_CHOI' | 'BI_GO', note: string | null, ip?: string) {
    assertPlatformModeration(a);
    const p = await this.prisma.communityPost.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Không tìm thấy bài cộng đồng');
    if (to === 'DA_DANG' && p.status !== 'CHO_DUYET' && p.status !== 'NHAP') {
      throw new ConflictException('Bài viết không ở trạng thái chờ duyệt hoặc bản nháp');
    }
    if (to === 'BI_TU_CHOI' && p.status !== 'CHO_DUYET') {
      throw new ConflictException('Bài viết không ở trạng thái chờ duyệt');
    }
    if (to === 'BI_GO' && p.status !== 'DA_DANG' && p.status !== 'TAM_AN') {
      throw new ConflictException('Chỉ gỡ được bài đang hiển thị');
    }

    const now = new Date();
    await this.prisma.communityPost.update({
      where: { id },
      data: {
        status: to,
        reviewNote: note,
        reviewedBy: a.userId,
        reviewedAt: now,
        ...(to === 'DA_DANG' && !p.publishedAt ? { publishedAt: now } : {}),
      },
    });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: `community_post.${to.toLowerCase()}`,
      entity: 'community_post',
      entityId: id,
      before: { status: p.status },
      after: { status: to, note },
      ip,
    });
    return { status: to };
  }

  async platformTogglePin(a: Access, id: string, ip?: string) {
    assertPlatformModeration(a);
    const p = await this.prisma.communityPost.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Không tìm thấy bài cộng đồng');
    const saved = await this.prisma.communityPost.update({ where: { id }, data: { pinned: !p.pinned } });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'community_post.pin_toggled',
      entity: 'community_post',
      entityId: id,
      after: { pinned: saved.pinned },
      ip,
    });
    return { pinned: saved.pinned };
  }

  async platformModerateComment(a: Access, commentId: string, dto: z.infer<typeof hideCommentSchema>, ip?: string) {
    assertPlatformModeration(a);
    const c = await this.prisma.communityComment.findUnique({ where: { id: commentId } });
    if (!c) throw new NotFoundException('Không tìm thấy bình luận');

    await this.prisma.$transaction(async (tx) => {
      await tx.communityComment.update({
        where: { id: commentId },
        data: { hidden: dto.hidden, hiddenReason: dto.hidden ? (dto.reason ?? 'Vi phạm quy tắc cộng đồng') : null },
      });
      const visibleCount = await tx.communityComment.count({ where: { postId: c.postId, hidden: false } });
      await tx.communityPost.update({ where: { id: c.postId }, data: { commentsCount: visibleCount } });
    });

    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: dto.hidden ? 'community_comment.hidden' : 'community_comment.restored',
      entity: 'community_comment',
      entityId: commentId,
      after: { hidden: dto.hidden, reason: dto.reason ?? null },
      ip,
    });
    return { hidden: dto.hidden };
  }

  /** A6.62 Xuất bản trực tiếp hoặc lưu nháp Blog, Sách nói (AUDIO), Playlist của Ban biên tập sàn */
  async platformCreateEditorial(a: Access, dto: CommunityPostDto, ip?: string) {
    assertPlatformContent(a);
    const { cleanContent, plainSummary, plainExcerpt } = await this.preparePostContent(dto, a.tenantId);

    const now = new Date();
    const status = initialPostStatus('PLATFORM', dto.saveAsDraft);
    const authorName = dto.type === 'AUDIO' ? 'Tủ sách nói CARDIY' : 'Ban biên tập CARDIY';
    const created = await this.prisma.$transaction(async (tx) => {
      const code = communityPostCode(await reserveNumbers(tx, a.tenantId, 'community_post'));
      const row = await tx.communityPost.create({
        data: {
          code,
          type: dto.type,
          authorKind: 'PLATFORM',
          authorUserId: a.userId,
          authorTenantId: a.tenantId,
          authorName,
          title: dto.title,
          summary: plainSummary,
          content: cleanContent,
          topic: dto.topic,
          coverFileId: dto.coverFileId ?? null,
          mediaUrl: dto.mediaUrl ?? null,
          durationMinutes: dto.durationMinutes ?? null,
          playlistItems: dto.playlistItems as unknown as Prisma.InputJsonValue,
          pinned: dto.pinned ?? false,
          status,
          publishedAt: status === 'DA_DANG' ? now : null,
          searchText: searchKey(code, dto.title, plainSummary, plainExcerpt, dto.topic, authorName),
        },
      });
      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: status === 'NHAP' ? 'community_post.editorial_drafted' : 'community_post.editorial_published',
          entity: 'community_post',
          entityId: row.id,
          after: { code, type: dto.type, status },
          ip,
        },
        tx,
      );
      return row;
    });
    return this.postSummaryView(created);
  }

  /** A6.62 Chỉnh sửa bài viết / sách nói / bản nháp trực tiếp mà giữ nguyên ID, mã bài và đường dẫn /cho/cong-dong/:id */
  async platformUpdatePost(a: Access, id: string, dto: CommunityPostDto, ip?: string) {
    assertPlatformContent(a);
    const cur = await this.prisma.communityPost.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Không tìm thấy bài cộng đồng');

    const { cleanContent, plainSummary, plainExcerpt } = await this.preparePostContent(dto, a.tenantId, cur);
    const now = new Date();
    const nextStatus = postStatusAfterEdit(cur.status as CommunityPostStatus, 'PLATFORM', dto.saveAsDraft);
    const authorName =
      cur.authorKind === 'PLATFORM'
        ? dto.type === 'AUDIO'
          ? 'Tủ sách nói CARDIY'
          : 'Ban biên tập CARDIY'
        : cur.authorName;

    const saved = await this.prisma.communityPost.update({
      where: { id },
      data: {
        type: dto.type,
        authorName,
        title: dto.title,
        summary: plainSummary,
        content: cleanContent,
        topic: dto.topic,
        coverFileId: dto.coverFileId ?? null,
        mediaUrl: dto.mediaUrl ?? null,
        durationMinutes: dto.durationMinutes ?? null,
        playlistItems: dto.playlistItems as unknown as Prisma.InputJsonValue,
        pinned: dto.pinned ?? cur.pinned,
        status: nextStatus,
        publishedAt: nextStatus === 'DA_DANG' && !cur.publishedAt ? now : cur.publishedAt,
        searchText: searchKey(cur.code, dto.title, plainSummary, plainExcerpt, dto.topic, authorName),
      },
    });

    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'community_post.platform_updated',
      entity: 'community_post',
      entityId: id,
      before: { status: cur.status, title: cur.title },
      after: { status: nextStatus, title: dto.title },
      ip,
    });
    return this.postSummaryView(saved);
  }

  async platformListBanners(a: Access) {
    assertPlatformModeration(a);
    const rows = await this.prisma.platformBanner.findMany({
      orderBy: [{ position: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    return Promise.all(rows.map((r) => this.bannerView(r)));
  }

  async platformCreateBanner(a: Access, dto: z.infer<typeof bannerSchema>, ip?: string) {
    assertPlatformContent(a);
    if (dto.imageFileId) await this.files.assertOwnedImage(dto.imageFileId, a.tenantId);
    const saved = await this.prisma.platformBanner.create({
      data: {
        title: dto.title,
        subtitle: dto.subtitle ?? null,
        linkUrl: dto.linkUrl ?? null,
        ctaLabel: dto.ctaLabel ?? null,
        imageFileId: dto.imageFileId ?? null,
        position: dto.position,
        sortOrder: dto.sortOrder,
        active: dto.active,
        createdBy: a.userId,
      },
    });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'platform_banner.created',
      entity: 'platform_banner',
      entityId: saved.id,
      after: { title: dto.title, position: dto.position, active: dto.active },
      ip,
    });
    return this.bannerView(saved);
  }

  async platformUpdateBanner(a: Access, id: string, dto: z.infer<typeof bannerSchema>, ip?: string) {
    assertPlatformContent(a);
    const existing = await this.prisma.platformBanner.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Không tìm thấy banner');
    if (dto.imageFileId) await this.files.assertOwnedImage(dto.imageFileId, a.tenantId);
    const saved = await this.prisma.platformBanner.update({
      where: { id },
      data: {
        title: dto.title,
        subtitle: dto.subtitle ?? null,
        linkUrl: dto.linkUrl ?? null,
        ctaLabel: dto.ctaLabel ?? null,
        imageFileId: dto.imageFileId ?? null,
        position: dto.position,
        sortOrder: dto.sortOrder,
        active: dto.active,
      },
    });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'platform_banner.updated',
      entity: 'platform_banner',
      entityId: id,
      after: { title: dto.title, active: dto.active },
      ip,
    });
    return this.bannerView(saved);
  }

  async platformDeleteBanner(a: Access, id: string, ip?: string) {
    assertPlatformContent(a);
    const existing = await this.prisma.platformBanner.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Không tìm thấy banner');
    await this.prisma.platformBanner.delete({ where: { id } });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'platform_banner.deleted',
      entity: 'platform_banner',
      entityId: id,
      before: { title: existing.title },
      ip,
    });
    return { status: 'ok' };
  }
}

@Public()
@Controller('public/community')
export class PublicCommunityController {
  constructor(private readonly svc: CommunityService) {}

  @Get('banners')
  banners(@Query('position') position?: string) {
    const pos = position === 'HOME' || position === 'COMMUNITY' ? position : undefined;
    return this.svc.publicBanners(pos);
  }

  @Get('posts')
  posts(@Query('type') type?: string, @Query('topic') topic?: string, @Query('q') q?: string, @Query('sort') sort?: string) {
    return this.svc.publicPosts({ type, topic, q, sort });
  }

  @Get('posts/:id')
  post(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.publicPostDetail(id, clientIp(req));
  }
}

@Public()
@UseGuards(OwnerGuard)
@Controller('owner/community')
export class OwnerCommunityController {
  constructor(private readonly svc: CommunityService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  upload(@Req() req: OwnerRequest, @UploadedFile() file: Express.Multer.File) {
    return this.svc.ownerUpload(req.owner!.userId, file, clientIp(req));
  }

  @Get('my-posts')
  myPosts(@Req() req: OwnerRequest) {
    return this.svc.ownerMyPosts(req.owner!.userId);
  }

  @Get('posts/:id')
  detail(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.publicPostDetail(id, clientIp(req), req.owner!.userId);
  }

  @Post('posts')
  create(@Req() req: OwnerRequest, @Body(new ZodPipe(communityPostSchema)) dto: CommunityPostDto) {
    return this.svc.ownerCreatePost(req.owner!.userId, dto, clientIp(req));
  }

  @Put('posts/:id')
  update(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(communityPostSchema)) dto: CommunityPostDto) {
    return this.svc.ownerUpdatePost(req.owner!.userId, id, dto, clientIp(req));
  }

  @Post('posts/:id/comments')
  comment(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(commentBodySchema)) dto: { content: string }) {
    return this.svc.ownerAddComment(req.owner!.userId, id, dto.content);
  }

  @Post('posts/:id/like')
  @HttpCode(200)
  like(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.ownerToggleLike(req.owner!.userId, id);
  }

  @Post('posts/:id/accept-answer')
  @HttpCode(200)
  accept(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(acceptAnswerSchema)) dto: { commentId: string }) {
    return this.svc.ownerAcceptAnswer(req.owner!.userId, id, dto.commentId);
  }
}

@RequirePermissions('community.manage')
@Controller('community')
export class GarageCommunityController {
  constructor(private readonly svc: CommunityService) {}

  @Get('posts')
  posts(@CurrentAuth() auth: RequestAuth) {
    return this.svc.garageListPosts(auth.access);
  }

  @Post('posts')
  create(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(communityPostSchema)) dto: CommunityPostDto, @Req() req: Request) {
    return this.svc.garageCreatePost(auth.access, dto, clientIp(req));
  }

  @Put('posts/:id')
  update(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(communityPostSchema)) dto: CommunityPostDto,
    @Req() req: Request,
  ) {
    return this.svc.garageUpdatePost(auth.access, id, dto, clientIp(req));
  }

  @Post('posts/:id/comments')
  comment(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(commentBodySchema)) dto: { content: string }) {
    return this.svc.garageAddComment(auth.access, id, dto.content);
  }
}

@Controller('platform/community')
export class PlatformCommunityController {
  constructor(private readonly svc: CommunityService) {}

  @Get('posts')
  posts(@CurrentAuth() auth: RequestAuth, @Query('status') status?: string, @Query('type') type?: string, @Query('q') q?: string) {
    return this.svc.platformListPosts(auth.access, { status, type, q });
  }

  @Post('posts/:id/approve')
  @HttpCode(200)
  approve(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.platformModeratePost(auth.access, id, 'DA_DANG', null, clientIp(req));
  }

  @Post('posts/:id/reject')
  @HttpCode(200)
  reject(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(reviewNoteSchema)) dto: { note: string },
    @Req() req: Request,
  ) {
    return this.svc.platformModeratePost(auth.access, id, 'BI_TU_CHOI', dto.note, clientIp(req));
  }

  @Post('posts/:id/takedown')
  @HttpCode(200)
  takedown(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(reviewNoteSchema)) dto: { note: string },
    @Req() req: Request,
  ) {
    return this.svc.platformModeratePost(auth.access, id, 'BI_GO', dto.note, clientIp(req));
  }

  @Post('posts/:id/pin')
  @HttpCode(200)
  pin(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.platformTogglePin(auth.access, id, clientIp(req));
  }

  @Post('comments/:id/hide')
  @HttpCode(200)
  hideComment(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(hideCommentSchema)) dto: z.infer<typeof hideCommentSchema>,
    @Req() req: Request,
  ) {
    return this.svc.platformModerateComment(auth.access, id, dto, clientIp(req));
  }

  @Post('editorial')
  createEditorial(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(communityPostSchema)) dto: CommunityPostDto, @Req() req: Request) {
    return this.svc.platformCreateEditorial(auth.access, dto, clientIp(req));
  }

  @Put('posts/:id')
  updatePost(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(communityPostSchema)) dto: CommunityPostDto,
    @Req() req: Request,
  ) {
    return this.svc.platformUpdatePost(auth.access, id, dto, clientIp(req));
  }

  @Get('banners')
  banners(@CurrentAuth() auth: RequestAuth) {
    return this.svc.platformListBanners(auth.access);
  }

  @Post('banners')
  createBanner(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(bannerSchema)) dto: z.infer<typeof bannerSchema>, @Req() req: Request) {
    return this.svc.platformCreateBanner(auth.access, dto, clientIp(req));
  }

  @Put('banners/:id')
  updateBanner(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(bannerSchema)) dto: z.infer<typeof bannerSchema>,
    @Req() req: Request,
  ) {
    return this.svc.platformUpdateBanner(auth.access, id, dto, clientIp(req));
  }

  @Post('banners/:id/delete')
  @HttpCode(200)
  deleteBanner(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.platformDeleteBanner(auth.access, id, clientIp(req));
  }
}

@Module({
  imports: [FilesModule, OwnerModule],
  controllers: [PublicCommunityController, OwnerCommunityController, GarageCommunityController, PlatformCommunityController],
  providers: [CommunityService],
  exports: [CommunityService],
})
export class CommunityModule {}
