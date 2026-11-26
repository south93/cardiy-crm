import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
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
import { formatPlate, isCivilPlate, normalizePlate, normalizeVnPhone, searchKey } from '@cardiy/shared';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AccessService, type Access } from '../auth/access.service';
import { CurrentAuth, Public, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { customerCode, reserveNumbers } from '../crm/counters';
import { FilesModule } from '../files/files.module';
import { FilesService } from '../files/files.service';
import { distanceKm } from '../marketplace/offer-rules';
import { OrdersModule } from '../orders/orders.module';
import { OrdersService } from '../orders/orders.service';
import { OwnerModule } from '../owner/owner';
import { OwnerGuard, type OwnerRequest } from '../owner/owner-auth';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  ACTIVE_ASSIGNED_SOS_STATUSES,
  CUSTOMER_CANCELLABLE_SOS_STATUSES,
  matchRescueGarages,
  nearestFallbackHotlines,
  OPEN_SOS_STATUSES,
  SOS_ISSUE_LABEL,
  SOS_MAX_ACTIVE_PER_PHONE,
  SOS_MAX_HOURLY_PER_IP,
  SOS_SEARCH_TTL_MS,
  SOS_STATUS_LABEL,
  sosCode,
  sosTransitionError,
  TRACKABLE_SOS_STATUSES,
  type RescueGarageInput,
  type SosIssueType,
  type SosStatus,
} from './sos-rules';

type Db = PrismaService | Prisma.TransactionClient;
const n = (b: bigint | number | null | undefined) => (b === null || b === undefined ? null : Number(b));
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const optText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());

const issueEnum = z.enum(['HET_BINH', 'THUNG_LOP', 'CHET_MAY', 'TAI_NAN', 'HET_NHIEN_LIEU', 'KEO_XE', 'KHAC']);
const latSchema = z.coerce.number().min(-90, 'Vĩ độ không hợp lệ').max(90, 'Vĩ độ không hợp lệ');
const lngSchema = z.coerce.number().min(-180, 'Kinh độ không hợp lệ').max(180, 'Kinh độ không hợp lệ');
const moneySchema = z.coerce.number().int().min(0, 'Số tiền không hợp lệ').max(1_000_000_000);

export const sosConfigSchema = z.object({
  enabled: z.boolean(),
  onDuty: z.boolean().default(true),
  hotline: optText(20),
  radiusKm: z.coerce.number().int().min(1, 'Bán kính tối thiểu 1 km').max(200, 'Bán kính tối đa 200 km').default(30),
  basePrice: moneySchema.default(0),
  branchId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable().optional()),
  note: optText(500),
});
type SosConfigDto = z.infer<typeof sosConfigSchema>;

export const publicSosCreateSchema = z.object({
  name: z.string().trim().min(2, 'Nhập họ tên').max(100),
  phone: z.string().trim().min(9, 'Nhập số điện thoại').max(20),
  plateNo: optText(20),
  vehicleInfo: optText(120),
  lat: latSchema,
  lng: lngSchema,
  addressText: optText(300),
  issueType: issueEnum,
  description: optText(1000),
});
type PublicSosCreateDto = z.infer<typeof publicSosCreateSchema>;

export const ownerSosCreateSchema = z.object({
  vehicleId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable().optional()),
  plateNo: optText(20),
  vehicleInfo: optText(120),
  lat: latSchema,
  lng: lngSchema,
  addressText: optText(300),
  issueType: issueEnum,
  description: optText(1000),
  imageFileIds: z.array(z.string().uuid()).max(4, 'Tối đa 4 ảnh').default([]),
});
type OwnerSosCreateDto = z.infer<typeof ownerSosCreateSchema>;

const tokenSchema = z.object({ token: z.string().min(10).max(100) });
const publicCancelSchema = tokenSchema.extend({ reason: optText(300) });
const ownerCancelSchema = z.object({ reason: optText(300) });
const reviewBodySchema = z.object({
  rating: z.coerce.number().int().min(1, 'Chọn từ 1 đến 5 sao').max(5, 'Chọn từ 1 đến 5 sao'),
  comment: optText(1000),
});
const publicReviewSchema = tokenSchema.merge(reviewBodySchema);

const acceptSchema = z.object({
  quotedPrice: moneySchema,
  etaMinutes: z.coerce.number().int().min(1, 'Nhập thời gian dự kiến tới (phút)').max(360, 'Tối đa 360 phút'),
  branchId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable().optional()),
  assignedStaffId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable().optional()),
  sellerNote: optText(500),
});
type AcceptDto = z.infer<typeof acceptSchema>;

const dispatchSchema = z.object({
  assignedStaffId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable().optional()),
  etaMinutes: z.coerce.number().int().min(1).max(360).nullable().optional(),
  lat: latSchema.nullable().optional(),
  lng: lngSchema.nullable().optional(),
  sellerNote: optText(500),
});

const trackSchema = z.object({
  lat: latSchema,
  lng: lngSchema,
  etaMinutes: z.coerce.number().int().min(1).max(360).nullable().optional(),
  note: optText(200),
});

const sceneSchema = z.object({
  lat: latSchema.nullable().optional(),
  lng: lngSchema.nullable().optional(),
  sceneImageIds: z.array(z.string().uuid()).max(6, 'Tối đa 6 ảnh hiện trường').optional(),
  finalPrice: moneySchema.nullable().optional(),
  sellerNote: optText(500),
});

const decisionSchema = z.object({
  finalPrice: moneySchema.nullable().optional(),
  sellerNote: optText(500),
});

const completeSchema = z.object({
  finalPrice: moneySchema,
  sellerNote: optText(500),
});

const replySchema = z.object({
  reply: z.string().trim().min(2, 'Nhập nội dung phản hồi').max(1000),
});

function assertSosConfigAccess(a: Access) {
  const ok =
    a.tenantType === 'PARTNER'
      ? a.permissions.some((p) => ['partner.request.manage', 'partner.listing.manage', 'partner.shop.manage'].includes(p))
      : a.tenantType === 'GARAGE' && a.permissions.some((p) => ['sos.manage', 'shop.manage'].includes(p));
  if (!ok) throw new ForbiddenException('Bạn không có quyền cấu hình dịch vụ cứu hộ');
}

function assertSosAcceptAccess(a: Access) {
  const ok =
    a.tenantType === 'PARTNER'
      ? a.permissions.includes('partner.request.manage')
      : a.tenantType === 'GARAGE' && a.permissions.includes('sos.manage');
  if (!ok) throw new ForbiddenException('Bạn không có quyền nhận ca cứu hộ');
}

function assertSosOperateAccess(a: Access) {
  const ok =
    a.tenantType === 'PARTNER'
      ? a.permissions.includes('partner.request.manage')
      : a.tenantType === 'GARAGE' && (a.permissions.includes('sos.manage') || a.permissions.includes('sos.handle'));
  if (!ok) throw new ForbiddenException('Bạn không có quyền xử lý ca cứu hộ');
}

function assertPlatformSupervisor(a: Access) {
  if (a.tenantType !== 'PLATFORM' || !a.permissions.includes('platform.report.handle')) {
    throw new ForbiddenException('Chỉ bộ phận giám sát sàn mới thực hiện được thao tác này');
  }
}

/** Chuyển mọi ca DANG_TIM_GARAGE đã quá 3 phút sang KHONG_CO_GARAGE trước mỗi lần đọc / ghi */
export async function expireStaleSos(db: Db) {
  await db.sosRequest.updateMany({
    where: { status: 'DANG_TIM_GARAGE', searchExpiresAt: { lt: new Date() } },
    data: { status: 'KHONG_CO_GARAGE' },
  });
}

type SosFullRow = Prisma.SosRequestGetPayload<{ include: { tracks: true; review: true } }>;

@Injectable()
export class SosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly redis: RedisService,
    private readonly orders: OrdersService,
  ) {}

  private url = (id: string | null | undefined) => (id ? this.files.signedUrl(id).catch(() => null) : Promise.resolve(null));

  private async platformTenantId(db: Db = this.prisma): Promise<string> {
    const p = await db.tenant.findFirstOrThrow({ where: { type: 'PLATFORM', deletedAt: null }, select: { id: true } });
    return p.id;
  }

  /** Gom toàn bộ garage có cấu hình cứu hộ kèm toạ độ (gian hàng hoặc chi nhánh trực) */
  private async allRescueCandidates(db: Db = this.prisma): Promise<RescueGarageInput[]> {
    const configs = await db.sosConfig.findMany();
    if (!configs.length) return [];
    const tenantIds = configs.map((c) => c.tenantId);
    const [tenants, shops, branches] = await Promise.all([
      db.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true, type: true, status: true, deletedAt: true } }),
      db.shop.findMany({ where: { tenantId: { in: tenantIds } } }),
      db.branch.findMany({ where: { tenantId: { in: tenantIds }, deletedAt: null }, orderBy: { code: 'asc' } }),
    ]);

    return configs.flatMap((cfg) => {
      const t = tenants.find((x) => x.id === cfg.tenantId);
      if (!t) return [];
      const shop = shops.find((s) => s.tenantId === cfg.tenantId) ?? null;
      const tenantBranches = branches.filter((b) => b.tenantId === cfg.tenantId);
      const preferredBranch = (cfg.branchId ? tenantBranches.find((b) => b.id === cfg.branchId) : null) ?? tenantBranches[0] ?? null;
      const lat = preferredBranch?.lat ?? shop?.lat ?? null;
      const lng = preferredBranch?.lng ?? shop?.lng ?? null;
      const hotline = cfg.hotline ?? shop?.phone ?? preferredBranch?.phone ?? null;
      const address = shop?.address ?? preferredBranch?.address ?? null;
      return [
        {
          tenantId: t.id,
          tenantType: t.type,
          tenantStatus: t.status,
          tenantDeletedAt: t.deletedAt,
          name: shop?.name ?? t.name,
          slug: shop?.slug ?? null,
          address,
          hotline,
          lat,
          lng,
          enabled: cfg.enabled,
          onDuty: cfg.onDuty,
          radiusKm: cfg.radiusKm,
          basePrice: n(cfg.basePrice) ?? 0,
          note: cfg.note,
        },
      ];
    });
  }

  // ---------------- Công khai: danh sách garage cứu hộ & gửi SOS (A1.09) ----------------

  async publicRescueGarages(latStr?: string, lngStr?: string) {
    const a = Number(latStr);
    const b = Number(lngStr);
    const hasGeo = Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 && (latStr ?? '') !== '';
    const all = await this.allRescueCandidates();
    const active = all.filter(
      (g) => g.enabled && (g.tenantType === 'GARAGE' ? !g.tenantDeletedAt && g.tenantStatus !== 'TAM_KHOA' && g.tenantStatus !== 'CHAM_DUT' : !g.tenantDeletedAt && g.tenantStatus === 'HOAT_DONG'),
    );
    return active
      .map((g) => {
        const dist = hasGeo && g.lat !== null && g.lng !== null ? distanceKm({ lat: a, lng: b }, { lat: g.lat, lng: g.lng }) : null;
        return {
          tenantId: g.tenantId,
          name: g.name,
          slug: g.slug,
          address: g.address,
          hotline: g.hotline,
          onDuty: g.onDuty,
          radiusKm: g.radiusKm,
          basePrice: g.basePrice,
          note: g.note,
          distanceKm: dist,
          inRange: dist !== null ? dist <= g.radiusKm : null,
        };
      })
      .sort((x, y) => {
        if (x.onDuty !== y.onDuty) return x.onDuty ? -1 : 1;
        return (x.distanceKm ?? 99999) - (y.distanceKm ?? 99999);
      });
  }

  private async checkRateLimit(phone: string, ip?: string) {
    if (ip) {
      const key = `sos:ip:${ip}`;
      const hits = await this.redis.client.incr(key);
      if (hits === 1) await this.redis.client.expire(key, 3600);
      if (hits > SOS_MAX_HOURLY_PER_IP) {
        throw new HttpException('Bạn đã gửi quá nhiều yêu cầu cứu hộ trong giờ qua. Vui lòng gọi trực tiếp hotline garage.', HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    await expireStaleSos(this.prisma);
    const openCount = await this.prisma.sosRequest.count({
      where: { phone, status: { in: OPEN_SOS_STATUSES } },
    });
    if (openCount >= SOS_MAX_ACTIVE_PER_PHONE) {
      throw new ConflictException(`Số điện thoại này đang có ${openCount} yêu cầu cứu hộ đang xử lý. Vui lòng theo dõi hoặc huỷ bớt trước khi gửi mới.`);
    }
  }

  private async createInternal(opts: {
    userId: string | null;
    vehicleId: string | null;
    customerName: string;
    phone: string;
    plateNo: string | null;
    vehicleInfo: string | null;
    lat: number;
    lng: number;
    addressText: string | null;
    issueType: SosIssueType;
    description: string | null;
    customerImageIds: string[];
    ip?: string;
  }) {
    const normPhone = normalizeVnPhone(opts.phone);
    if (!normPhone) throw new BadRequestException('Số điện thoại không hợp lệ');
    await this.checkRateLimit(normPhone, opts.ip);

    const platformId = await this.platformTenantId();
    for (const fid of opts.customerImageIds) {
      await this.files.assertOwnedImage(fid, platformId);
    }

    const candidates = await this.allRescueCandidates();
    const matched = matchRescueGarages({ lat: opts.lat, lng: opts.lng }, candidates);
    const token = randomBytes(24).toString('base64url');
    const accessHash = sha256(token);
    const now = new Date();
    const searchExpiresAt = new Date(now.getTime() + SOS_SEARCH_TTL_MS);
    const plateNormalized = opts.plateNo ? normalizePlate(opts.plateNo) ?? opts.plateNo.toUpperCase().trim() : null;

    const created = await this.prisma.$transaction(async (tx) => {
      const code = sosCode(await reserveNumbers(tx, platformId, 'sos_request'));
      // Bước 1 (S6): khởi tạo ở trạng thái MOI -> chuyển DANG_TIM_GARAGE; nếu không có garage trực trong bán kính -> chuyển KHONG_CO_GARAGE ngay để hiện hotline
      const initialStatus: SosStatus = matched.length > 0 ? 'DANG_TIM_GARAGE' : 'KHONG_CO_GARAGE';
      const row = await tx.sosRequest.create({
        data: {
          code,
          status: initialStatus,
          userId: opts.userId,
          vehicleId: opts.vehicleId,
          customerName: opts.customerName.trim(),
          phone: normPhone,
          plateNo: plateNormalized,
          vehicleInfo: opts.vehicleInfo?.trim() || null,
          lat: opts.lat,
          lng: opts.lng,
          addressText: opts.addressText?.trim() || null,
          issueType: opts.issueType,
          description: opts.description?.trim() || null,
          customerImageIds: opts.customerImageIds,
          candidateTenantIds: matched.map((m) => m.tenantId),
          accessHash,
          searchExpiresAt,
          ip: opts.ip ?? null,
        },
      });
      await this.audit.log(
        {
          tenantId: platformId,
          actorId: opts.userId ?? undefined,
          action: 'sos.created',
          entity: 'sos_request',
          entityId: row.id,
          after: { code, issueType: opts.issueType, candidates: matched.length, status: initialStatus },
          ip: opts.ip,
        },
        tx,
      );
      return row;
    });

    return {
      id: created.id,
      code: created.code,
      status: created.status as SosStatus,
      statusLabel: SOS_STATUS_LABEL[created.status as SosStatus],
      token,
      trackUrl: `/cho/cuu-ho/${created.id}?t=${token}`,
      candidatesCount: matched.length,
      searchExpiresAt: created.searchExpiresAt,
    };
  }

  async createPublic(dto: PublicSosCreateDto, ip?: string) {
    return this.createInternal({
      userId: null,
      vehicleId: null,
      customerName: dto.name,
      phone: dto.phone,
      plateNo: dto.plateNo ?? null,
      vehicleInfo: dto.vehicleInfo ?? null,
      lat: dto.lat,
      lng: dto.lng,
      addressText: dto.addressText ?? null,
      issueType: dto.issueType,
      description: dto.description ?? null,
      customerImageIds: [],
      ip,
    });
  }

  private assertToken(row: { accessHash: string }, token: string) {
    const a = Buffer.from(row.accessHash, 'hex');
    const b = Buffer.from(sha256(token), 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Link theo dõi cứu hộ không hợp lệ');
    }
  }

  private async detailView(row: SosFullRow, viewer: 'CUSTOMER' | 'GARAGE' | 'PLATFORM') {
    const [assignedShop, assignedTenant, assignedBranch, assignedMember, order, allCandidates] = await Promise.all([
      row.assignedTenantId ? this.prisma.shop.findUnique({ where: { tenantId: row.assignedTenantId } }) : Promise.resolve(null),
      row.assignedTenantId ? this.prisma.tenant.findUnique({ where: { id: row.assignedTenantId }, select: { id: true, name: true, type: true } }) : Promise.resolve(null),
      row.assignedBranchId ? this.prisma.branch.findUnique({ where: { id: row.assignedBranchId }, select: { id: true, code: true, name: true, address: true, phone: true } }) : Promise.resolve(null),
      row.assignedStaffId
        ? this.prisma.membership.findUnique({ where: { id: row.assignedStaffId }, include: { user: { select: { fullName: true, phone: true } } } })
        : Promise.resolve(null),
      row.orderId ? this.prisma.repairOrder.findUnique({ where: { id: row.orderId }, select: { id: true, code: true, status: true } }) : Promise.resolve(null),
      row.status === 'KHONG_CO_GARAGE' ? this.allRescueCandidates() : Promise.resolve([]),
    ]);

    const assignedConfig = row.assignedTenantId ? await this.prisma.sosConfig.findUnique({ where: { tenantId: row.assignedTenantId } }) : null;
    const customerImages = await Promise.all(row.customerImageIds.map(async (id) => ({ id, url: await this.url(id) })));
    const sceneImages = await Promise.all(row.sceneImageIds.map(async (id) => ({ id, url: await this.url(id) })));
    const sortedTracks = [...row.tracks].sort((a, b) => a.at.getTime() - b.at.getTime());
    const lastTrack = sortedTracks.length ? sortedTracks[sortedTracks.length - 1]! : null;
    const teamDistanceKm = lastTrack ? distanceKm({ lat: row.lat, lng: row.lng }, { lat: lastTrack.lat, lng: lastTrack.lng }) : null;
    const remainingSec =
      row.status === 'DANG_TIM_GARAGE' ? Math.max(0, Math.ceil((row.searchExpiresAt.getTime() - Date.now()) / 1000)) : 0;

    return {
      id: row.id,
      code: row.code,
      status: row.status as SosStatus,
      statusLabel: SOS_STATUS_LABEL[row.status as SosStatus],
      issueType: row.issueType as SosIssueType,
      issueLabel: SOS_ISSUE_LABEL[row.issueType as SosIssueType],
      customerName: row.customerName,
      phone: viewer === 'CUSTOMER' ? row.phone : row.phone,
      plateNo: row.plateNo ? formatPlate(row.plateNo) : null,
      vehicleInfo: row.vehicleInfo,
      lat: row.lat,
      lng: row.lng,
      addressText: row.addressText,
      description: row.description,
      customerImages,
      sceneImages,
      candidatesCount: row.candidateTenantIds.length,
      searchExpiresAt: row.searchExpiresAt,
      remainingSec,
      cancellable: CUSTOMER_CANCELLABLE_SOS_STATUSES.includes(row.status as SosStatus),
      canReview: row.status === 'HOAN_THANH' && !row.review,
      etaMinutes: row.etaMinutes,
      quotedPrice: n(row.quotedPrice),
      finalPrice: n(row.finalPrice),
      sellerNote: row.sellerNote,
      cancelReason: row.cancelReason,
      acceptedAt: row.acceptedAt,
      arrivedAt: row.arrivedAt,
      completedAt: row.completedAt,
      cancelledAt: row.cancelledAt,
      createdAt: row.createdAt,
      assignedGarage: assignedTenant
        ? {
            tenantId: assignedTenant.id,
            tenantType: assignedTenant.type,
            name: assignedShop?.name ?? assignedTenant.name,
            slug: assignedShop?.slug ?? null,
            hotline: assignedConfig?.hotline ?? assignedShop?.phone ?? assignedBranch?.phone ?? null,
            address: assignedBranch?.address ?? assignedShop?.address ?? null,
            cancelPolicy: assignedShop?.cancelPolicy ?? null,
            branch: assignedBranch ? { id: assignedBranch.id, code: assignedBranch.code, name: assignedBranch.name } : null,
          }
        : null,
      assignedStaff: assignedMember
        ? {
            membershipId: assignedMember.id,
            name: assignedMember.user.fullName,
            phone: assignedMember.user.phone,
          }
        : null,
      order: order ? { id: order.id, code: order.code, status: order.status } : null,
      latestTrack: lastTrack
        ? { lat: lastTrack.lat, lng: lastTrack.lng, note: lastTrack.note, at: lastTrack.at, distanceToCustomerKm: teamDistanceKm }
        : null,
      tracks: sortedTracks.map((t) => ({ id: String(t.id), lat: t.lat, lng: t.lng, note: t.note, at: t.at })),
      fallbackHotlines: row.status === 'KHONG_CO_GARAGE' ? nearestFallbackHotlines({ lat: row.lat, lng: row.lng }, allCandidates) : [],
      review: row.review
        ? {
            id: row.review.id,
            rating: row.review.rating,
            comment: row.review.comment,
            reply: row.review.reply,
            repliedAt: row.review.repliedAt,
            createdAt: row.review.createdAt,
          }
        : null,
    };
  }

  async getPublic(id: string, token: string) {
    await expireStaleSos(this.prisma);
    const row = await this.prisma.sosRequest.findUnique({ where: { id }, include: { tracks: true, review: true } });
    if (!row) throw new NotFoundException('Không tìm thấy yêu cầu cứu hộ');
    this.assertToken(row, token);
    return this.detailView(row, 'CUSTOMER');
  }

  private async cancelInternal(row: SosFullRow, reason: string | null | undefined, actorId?: string, ip?: string) {
    const err = sosTransitionError(row.status as SosStatus, 'KHACH_HUY');
    if (err) throw new ConflictException(err);
    const updated = await this.prisma.sosRequest.updateMany({
      where: { id: row.id, status: { in: CUSTOMER_CANCELLABLE_SOS_STATUSES } },
      data: { status: 'KHACH_HUY', cancelReason: reason?.trim() || 'Khách tự huỷ', cancelledAt: new Date() },
    });
    if (!updated.count) throw new ConflictException('Trạng thái ca cứu hộ vừa thay đổi, vui lòng tải lại');
    const platformId = await this.platformTenantId();
    await this.audit.log({
      tenantId: row.assignedTenantId ?? platformId,
      actorId,
      action: 'sos.cancelled_by_customer',
      entity: 'sos_request',
      entityId: row.id,
      before: { status: row.status },
      after: { status: 'KHACH_HUY', reason: reason ?? null },
      ip,
    });
    return { status: 'KHACH_HUY' as SosStatus };
  }

  async cancelPublic(id: string, token: string, reason?: string | null, ip?: string) {
    await expireStaleSos(this.prisma);
    const row = await this.prisma.sosRequest.findUnique({ where: { id }, include: { tracks: true, review: true } });
    if (!row) throw new NotFoundException('Không tìm thấy yêu cầu cứu hộ');
    this.assertToken(row, token);
    return this.cancelInternal(row, reason, undefined, ip);
  }

  private async reviewInternal(row: SosFullRow, rating: number, comment: string | null | undefined, actorId?: string, ip?: string) {
    if (row.status !== 'HOAN_THANH' || !row.assignedTenantId) {
      throw new ConflictException('Chỉ đánh giá được sau khi ca cứu hộ hoàn thành');
    }
    if (row.review) {
      throw new ConflictException('Ca cứu hộ này đã được đánh giá');
    }
    const created = await this.prisma.sosReview.create({
      data: {
        tenantId: row.assignedTenantId,
        sosId: row.id,
        customerName: row.customerName,
        rating,
        comment: comment?.trim() || null,
      },
    });
    await this.audit.log({
      tenantId: row.assignedTenantId,
      actorId,
      action: 'sos.reviewed',
      entity: 'sos_request',
      entityId: row.id,
      after: { rating, comment: created.comment },
      ip,
    });
    return { id: created.id, rating: created.rating, comment: created.comment, createdAt: created.createdAt };
  }

  async reviewPublic(id: string, token: string, rating: number, comment?: string | null, ip?: string) {
    await expireStaleSos(this.prisma);
    const row = await this.prisma.sosRequest.findUnique({ where: { id }, include: { tracks: true, review: true } });
    if (!row) throw new NotFoundException('Không tìm thấy yêu cầu cứu hộ');
    this.assertToken(row, token);
    return this.reviewInternal(row, rating, comment, undefined, ip);
  }

  // ---------------- App chủ xe (A2.01, A2.10) ----------------

  async ownerVehiclesForSos(userId: string) {
    const links = await this.prisma.customerLink.findMany({
      where: { userId, customer: { deletedAt: null } },
      select: { customerId: true },
    });
    if (!links.length) return [];
    const own = await this.prisma.vehicleOwnership.findMany({
      where: { customerId: { in: links.map((l) => l.customerId) }, toDate: null, vehicle: { deletedAt: null } },
      include: { vehicle: { select: { id: true, plateNo: true, make: true, model: true, year: true } } },
    });
    const seen = new Set<string>();
    return own
      .filter((o) => {
        if (seen.has(o.vehicle.plateNo)) return false;
        seen.add(o.vehicle.plateNo);
        return true;
      })
      .map((o) => ({
        id: o.vehicle.id,
        plate: formatPlate(o.vehicle.plateNo),
        info: [o.vehicle.make, o.vehicle.model, o.vehicle.year].filter(Boolean).join(' ') || null,
      }));
  }

  async ownerUpload(userId: string, file: Express.Multer.File, ip?: string) {
    if (!file) throw new BadRequestException('Chọn file ảnh để tải lên');
    if (!file.mimetype?.startsWith('image/')) throw new BadRequestException('Chỉ chấp nhận file ảnh');
    const platformId = await this.platformTenantId();
    return this.files.upload(platformId, userId, file, ip);
  }

  async ownerList(userId: string) {
    await expireStaleSos(this.prisma);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true } });
    const rows = await this.prisma.sosRequest.findMany({
      where: { OR: [{ userId }, { phone: user.phone }] },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { tracks: true, review: true },
    });
    const items = await Promise.all(rows.map((r) => this.detailView(r, 'CUSTOMER')));
    return {
      active: items.find((i) => OPEN_SOS_STATUSES.includes(i.status)) ?? null,
      items,
    };
  }

  async ownerCreate(userId: string, dto: OwnerSosCreateDto, ip?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true, phone: true } });
    let plateNo = dto.plateNo ?? null;
    let vehicleInfo = dto.vehicleInfo ?? null;
    let vehicleId: string | null = null;
    if (dto.vehicleId) {
      const links = await this.prisma.customerLink.findMany({ where: { userId, customer: { deletedAt: null } }, select: { customerId: true } });
      const own = await this.prisma.vehicleOwnership.findFirst({
        where: { vehicleId: dto.vehicleId, customerId: { in: links.map((l) => l.customerId) }, toDate: null, vehicle: { deletedAt: null } },
        include: { vehicle: true },
      });
      if (!own) throw new NotFoundException('Không tìm thấy xe trong tài khoản của bạn');
      vehicleId = own.vehicle.id;
      plateNo = own.vehicle.plateNo;
      vehicleInfo = vehicleInfo ?? ([own.vehicle.make, own.vehicle.model, own.vehicle.year].filter(Boolean).join(' ') || null);
    }
    return this.createInternal({
      userId,
      vehicleId,
      customerName: user.fullName,
      phone: user.phone,
      plateNo,
      vehicleInfo,
      lat: dto.lat,
      lng: dto.lng,
      addressText: dto.addressText ?? null,
      issueType: dto.issueType,
      description: dto.description ?? null,
      customerImageIds: dto.imageFileIds,
      ip,
    });
  }

  private async loadOwnerSos(userId: string, id: string): Promise<SosFullRow> {
    await expireStaleSos(this.prisma);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true } });
    const row = await this.prisma.sosRequest.findFirst({
      where: { id, OR: [{ userId }, { phone: user.phone }] },
      include: { tracks: true, review: true },
    });
    if (!row) throw new NotFoundException('Không tìm thấy yêu cầu cứu hộ');
    return row;
  }

  async ownerGet(userId: string, id: string) {
    const row = await this.loadOwnerSos(userId, id);
    return this.detailView(row, 'CUSTOMER');
  }

  async ownerCancel(userId: string, id: string, reason?: string | null, ip?: string) {
    const row = await this.loadOwnerSos(userId, id);
    return this.cancelInternal(row, reason, userId, ip);
  }

  async ownerReview(userId: string, id: string, rating: number, comment?: string | null, ip?: string) {
    const row = await this.loadOwnerSos(userId, id);
    return this.reviewInternal(row, rating, comment, userId, ip);
  }

  // ---------------- Garage: cấu hình, nhận ca, điều đội, cập nhật tiến độ (A7.21, A3.43, A5) ----------------

  async getConfig(a: Access) {
    assertSosOperateAccess(a);
    const [cfg, shop, branches] = await Promise.all([
      this.prisma.sosConfig.findUnique({ where: { tenantId: a.tenantId } }),
      this.prisma.shop.findUnique({ where: { tenantId: a.tenantId } }),
      this.prisma.branch.findMany({ where: { tenantId: a.tenantId, deletedAt: null }, orderBy: { code: 'asc' } }),
    ]);
    const main = branches[0] ?? null;
    const branchCoord = cfg?.branchId ? branches.find((b) => b.id === cfg.branchId) : main;
    const hasCoords = (branchCoord?.lat != null && branchCoord?.lng != null) || (shop?.lat != null && shop?.lng != null);
    return {
      config: {
        enabled: cfg?.enabled ?? false,
        onDuty: cfg?.onDuty ?? true,
        hotline: cfg?.hotline ?? shop?.phone ?? main?.phone ?? '',
        radiusKm: cfg?.radiusKm ?? 30,
        basePrice: cfg ? n(cfg.basePrice)! : 300_000,
        branchId: cfg?.branchId ?? main?.id ?? null,
        note: cfg?.note ?? '',
      },
      hasCoords,
      shopCoords: shop?.lat != null && shop?.lng != null ? { lat: shop.lat, lng: shop.lng } : null,
      branches: branches
        .filter((b) => a.branchIds === 'ALL' || a.branchIds.includes(b.id))
        .map((b) => ({ id: b.id, code: b.code, name: b.name, lat: b.lat, lng: b.lng, phone: b.phone })),
    };
  }

  async saveConfig(a: Access, dto: SosConfigDto, ip?: string) {
    assertSosConfigAccess(a);
    let hotline: string | null = null;
    if (dto.hotline) {
      const p = normalizeVnPhone(dto.hotline);
      if (!p) throw new BadRequestException('Số hotline cứu hộ không hợp lệ');
      hotline = p;
    }
    if (dto.branchId) {
      if (!AccessService.canAccessBranch(a, dto.branchId)) throw new ForbiddenException('Bạn không có quyền trên chi nhánh này');
      const ok = await this.prisma.branch.findFirst({ where: { id: dto.branchId, tenantId: a.tenantId, deletedAt: null } });
      if (!ok) throw new BadRequestException('Chi nhánh trực không hợp lệ');
    }
    const data = {
      enabled: dto.enabled,
      onDuty: dto.onDuty,
      hotline,
      radiusKm: dto.radiusKm,
      basePrice: BigInt(dto.basePrice),
      branchId: a.tenantType === 'GARAGE' ? (dto.branchId ?? null) : null,
      note: dto.note ?? null,
      updatedBy: a.userId,
    };
    await this.prisma.sosConfig.upsert({
      where: { tenantId: a.tenantId },
      create: { tenantId: a.tenantId, ...data },
      update: data,
    });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'sos.config_saved',
      entity: 'sos_config',
      entityId: a.tenantId,
      after: { enabled: dto.enabled, onDuty: dto.onDuty, radiusKm: dto.radiusKm, basePrice: dto.basePrice },
      ip,
    });
    return this.getConfig(a);
  }

  async rescueStaff(a: Access, branchId?: string) {
    assertSosAcceptAccess(a);
    if (a.tenantType !== 'GARAGE') return [];
    if (branchId && !AccessService.canAccessBranch(a, branchId)) throw new ForbiddenException('Bạn không làm việc ở chi nhánh này');
    const ms = await this.prisma.membership.findMany({
      where: {
        tenantId: a.tenantId,
        status: 'ACTIVE',
        ...(branchId
          ? { roles: { some: { OR: [{ branchId }, { branchId: null }] } } }
          : a.branchIds === 'ALL'
            ? {}
            : { roles: { some: { OR: [{ branchId: { in: a.branchIds } }, { branchId: null }] } } }),
      },
      include: {
        user: { select: { fullName: true, phone: true } },
        roles: { include: { role: { select: { code: true } } } },
      },
      orderBy: { user: { fullName: 'asc' } },
    });
    return ms
      .map((m) => ({
        membershipId: m.id,
        name: m.user.fullName,
        phone: m.user.phone,
        roles: [...new Set(m.roles.map((r) => r.role.code))],
      }))
      .filter((m) => m.roles.some((r) => ['CH', 'KTV', 'QL', 'CG'].includes(r)));
  }

  private branchFilterForAssigned(a: Access, branchId?: string): Prisma.SosRequestWhereInput {
    if (a.tenantType !== 'GARAGE') return {};
    if (branchId) {
      if (!AccessService.canAccessBranch(a, branchId)) throw new ForbiddenException('Bạn không làm việc ở chi nhánh này');
      return { OR: [{ assignedBranchId: branchId }, { assignedBranchId: null }] };
    }
    if (a.branchIds === 'ALL') return {};
    return { OR: [{ assignedBranchId: { in: a.branchIds } }, { assignedBranchId: null }] };
  }

  async garageCases(a: Access, q: { tab?: string; branchId?: string; crewOnly?: string }) {
    assertSosOperateAccess(a);
    await expireStaleSos(this.prisma);

    const canAccept = a.tenantType === 'PARTNER' || a.permissions.includes('sos.manage');
    const crewMode = q.crewOnly === '1' || !canAccept;
    const branchWhere = this.branchFilterForAssigned(a, q.branchId);
    const crewScope: Prisma.SosRequestWhereInput[] = [
      branchWhere,
      { OR: [{ assignedStaffId: a.membershipId }, { assignedStaffId: null }] },
    ];

    const incomingWhere: Prisma.SosRequestWhereInput = crewMode
      ? {
          assignedTenantId: a.tenantId,
          status: 'DA_NHAN',
          AND: crewScope,
        }
      : {
          status: 'DANG_TIM_GARAGE',
          candidateTenantIds: { has: a.tenantId },
          searchExpiresAt: { gte: new Date() },
        };

    const activeWhere: Prisma.SosRequestWhereInput = crewMode
      ? {
          assignedTenantId: a.tenantId,
          status: { in: ['DANG_DEN', 'TAI_HIEN_TRUONG', 'XU_LY_TAI_CHO', 'DANG_KEO_XE', 'DA_VE_GARAGE'] },
          AND: crewScope,
        }
      : {
          assignedTenantId: a.tenantId,
          status: { in: ACTIVE_ASSIGNED_SOS_STATUSES },
          ...branchWhere,
        };

    const doneWhere: Prisma.SosRequestWhereInput = crewMode
      ? {
          assignedTenantId: a.tenantId,
          status: { in: ['HOAN_THANH', 'KHACH_HUY'] },
          AND: crewScope,
        }
      : {
          assignedTenantId: a.tenantId,
          status: { in: ['HOAN_THANH', 'KHACH_HUY'] },
          ...branchWhere,
        };

    const [incomingCount, activeCount, doneCount] = await Promise.all([
      this.prisma.sosRequest.count({ where: incomingWhere }),
      this.prisma.sosRequest.count({ where: activeWhere }),
      this.prisma.sosRequest.count({ where: doneWhere }),
    ]);

    const tab = q.tab === 'active' ? 'active' : q.tab === 'done' ? 'done' : 'incoming';
    const targetWhere = tab === 'incoming' ? incomingWhere : tab === 'active' ? activeWhere : doneWhere;

    const [rows, myShop, myConfig] = await Promise.all([
      this.prisma.sosRequest.findMany({
        where: targetWhere,
        include: { tracks: true, review: true },
        orderBy: tab === 'incoming' ? { createdAt: 'asc' } : { updatedAt: 'desc' },
        take: 100,
      }),
      this.prisma.shop.findUnique({ where: { tenantId: a.tenantId }, select: { lat: true, lng: true } }),
      this.prisma.sosConfig.findUnique({ where: { tenantId: a.tenantId }, select: { branchId: true } }),
    ]);

    let baseLat = myShop?.lat ?? null;
    let baseLng = myShop?.lng ?? null;
    if (baseLat === null || baseLng === null) {
      const b = myConfig?.branchId
        ? await this.prisma.branch.findUnique({ where: { id: myConfig.branchId }, select: { lat: true, lng: true } })
        : await this.prisma.branch.findFirst({ where: { tenantId: a.tenantId, deletedAt: null }, select: { lat: true, lng: true } });
      baseLat = b?.lat ?? null;
      baseLng = b?.lng ?? null;
    }

    const items = await Promise.all(
      rows.map(async (r) => {
        const view = await this.detailView(r, 'GARAGE');
        const distFromGarageKm = baseLat !== null && baseLng !== null ? distanceKm({ lat: baseLat, lng: baseLng }, { lat: r.lat, lng: r.lng }) : null;
        return { ...view, distanceFromGarageKm: distFromGarageKm };
      }),
    );

    return {
      counts: { incoming: incomingCount, active: activeCount, done: doneCount },
      items,
    };
  }

  private async loadAssignedForWrite(tx: Prisma.TransactionClient, a: Access, id: string) {
    await tx.$queryRaw`SELECT id FROM sos_requests WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.sosRequest.findFirst({
      where: { id, assignedTenantId: a.tenantId },
      include: { tracks: true, review: true },
    });
    if (!row) throw new NotFoundException('Không tìm thấy ca cứu hộ của garage bạn');
    if (a.tenantType === 'GARAGE' && row.assignedBranchId && !AccessService.canAccessBranch(a, row.assignedBranchId)) {
      throw new ForbiddenException('Ca cứu hộ thuộc chi nhánh khác');
    }
    return row;
  }

  /** Garage nhận ca trong 3 phút đầu: khoá dòng nguyên tử để 2 garage không nhận trùng cùng 1 ca */
  async accept(a: Access, id: string, dto: AcceptDto, ip?: string) {
    assertSosAcceptAccess(a);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
    if (tenant.type === 'PARTNER' && tenant.status !== 'HOAT_DONG') {
      throw new ForbiddenException('Gian hàng đối tác chưa ở trạng thái Hoạt động để nhận ca cứu hộ');
    }

    let branchId: string | null = null;
    if (a.tenantType === 'GARAGE') {
      if (dto.branchId) {
        if (!AccessService.canAccessBranch(a, dto.branchId)) throw new ForbiddenException('Bạn không làm việc ở chi nhánh này');
        const b = await this.prisma.branch.findFirst({ where: { id: dto.branchId, tenantId: a.tenantId, deletedAt: null } });
        if (!b) throw new BadRequestException('Chi nhánh không hợp lệ');
        branchId = b.id;
      } else {
        const cfg = await this.prisma.sosConfig.findUnique({ where: { tenantId: a.tenantId } });
        if (cfg?.branchId && AccessService.canAccessBranch(a, cfg.branchId)) {
          branchId = cfg.branchId;
        } else {
          const firstBranch = await this.prisma.branch.findFirst({
            where: { tenantId: a.tenantId, deletedAt: null, ...(a.branchIds === 'ALL' ? {} : { id: { in: a.branchIds } }) },
            orderBy: { code: 'asc' },
          });
          branchId = firstBranch?.id ?? null;
        }
      }
    }

    if (dto.assignedStaffId) {
      if (a.tenantType !== 'GARAGE') throw new BadRequestException('Đối tác không phân công nhân viên nội bộ');
      const m = await this.prisma.membership.findFirst({ where: { id: dto.assignedStaffId, tenantId: a.tenantId, status: 'ACTIVE' } });
      if (!m) throw new BadRequestException('Nhân viên cứu hộ không hợp lệ');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM sos_requests WHERE id = ${id}::uuid FOR UPDATE`;
      await expireStaleSos(tx);
      const row = await tx.sosRequest.findUnique({ where: { id } });
      if (!row || !row.candidateTenantIds.includes(a.tenantId)) {
        throw new NotFoundException('Ca cứu hộ không nằm trong phạm vi phục vụ của garage bạn');
      }
      if (row.assignedTenantId && row.assignedTenantId !== a.tenantId) {
        throw new ConflictException('Ca cứu hộ vừa được garage khác nhận');
      }
      const err = sosTransitionError(row.status as SosStatus, 'DA_NHAN');
      if (err) throw new ConflictException(row.status === 'KHONG_CO_GARAGE' ? 'Ca cứu hộ đã quá 3 phút chờ nhận' : err);

      const saved = await tx.sosRequest.update({
        where: { id },
        data: {
          status: 'DA_NHAN',
          assignedTenantId: a.tenantId,
          assignedBranchId: branchId,
          assignedStaffId: dto.assignedStaffId ?? null,
          quotedPrice: BigInt(dto.quotedPrice),
          etaMinutes: dto.etaMinutes,
          sellerNote: dto.sellerNote ?? null,
          acceptedAt: new Date(),
        },
        include: { tracks: true, review: true },
      });
      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'sos.accepted',
          entity: 'sos_request',
          entityId: id,
          before: { status: row.status },
          after: { status: 'DA_NHAN', quotedPrice: dto.quotedPrice, etaMinutes: dto.etaMinutes },
          ip,
        },
        tx,
      );
      return saved;
    });

    return this.detailView(updated, 'GARAGE');
  }

  /** Điều đội cứu hộ xuất phát (DA_NHAN -> DANG_DEN) */
  async dispatch(a: Access, id: string, dto: z.infer<typeof dispatchSchema>, ip?: string) {
    assertSosOperateAccess(a);
    if ((dto.lat == null) !== (dto.lng == null)) throw new BadRequestException('Nhập đủ vĩ độ và kinh độ xuất phát');
    if (dto.assignedStaffId) {
      if (a.tenantType !== 'GARAGE') throw new BadRequestException('Đối tác không phân công nhân viên nội bộ');
      const m = await this.prisma.membership.findFirst({ where: { id: dto.assignedStaffId, tenantId: a.tenantId, status: 'ACTIVE' } });
      if (!m) throw new BadRequestException('Nhân viên cứu hộ không hợp lệ');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.loadAssignedForWrite(tx, a, id);
      const err = sosTransitionError(row.status as SosStatus, 'DANG_DEN');
      if (err) throw new ConflictException(err);
      const nextStaffId =
        dto.assignedStaffId !== undefined
          ? dto.assignedStaffId
          : row.assignedStaffId ?? (a.tenantType === 'GARAGE' ? a.membershipId : null);

      if (dto.lat != null && dto.lng != null) {
        await tx.sosTrack.create({
          data: { sosId: id, lat: dto.lat, lng: dto.lng, note: 'Đội cứu hộ xuất phát', actorId: a.userId },
        });
      }

      const saved = await tx.sosRequest.update({
        where: { id },
        data: {
          status: 'DANG_DEN',
          assignedStaffId: nextStaffId,
          ...(dto.etaMinutes != null ? { etaMinutes: dto.etaMinutes } : {}),
          ...(dto.sellerNote !== undefined ? { sellerNote: dto.sellerNote ?? row.sellerNote } : {}),
        },
        include: { tracks: true, review: true },
      });
      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'sos.dispatched',
          entity: 'sos_request',
          entityId: id,
          before: { status: row.status },
          after: { status: 'DANG_DEN', assignedStaffId: nextStaffId },
          ip,
        },
        tx,
      );
      return saved;
    });

    return this.detailView(updated, 'GARAGE');
  }

  /** Cập nhật vị trí GPS của đội cứu hộ trên đường */
  async addTrack(a: Access, id: string, dto: z.infer<typeof trackSchema>) {
    assertSosOperateAccess(a);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.loadAssignedForWrite(tx, a, id);
      if (!TRACKABLE_SOS_STATUSES.includes(row.status as SosStatus)) {
        throw new ConflictException(`Không thể cập nhật GPS khi ca đang ở trạng thái "${SOS_STATUS_LABEL[row.status as SosStatus]}"`);
      }
      await tx.sosTrack.create({
        data: { sosId: id, lat: dto.lat, lng: dto.lng, note: dto.note ?? null, actorId: a.userId },
      });
      if (dto.etaMinutes != null) {
        await tx.sosRequest.update({ where: { id }, data: { etaMinutes: dto.etaMinutes } });
      }
      return tx.sosRequest.findUniqueOrThrow({ where: { id }, include: { tracks: true, review: true } });
    });
    return this.detailView(updated, 'GARAGE');
  }

  /** Đã tới hiện trường (DANG_DEN -> TAI_HIEN_TRUONG) */
  async arrive(a: Access, id: string, dto: z.infer<typeof sceneSchema>, ip?: string) {
    assertSosOperateAccess(a);
    if (dto.sceneImageIds?.length) {
      for (const fid of dto.sceneImageIds) await this.files.assertOwnedImage(fid, a.tenantId);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.loadAssignedForWrite(tx, a, id);
      const err = sosTransitionError(row.status as SosStatus, 'TAI_HIEN_TRUONG');
      if (err) throw new ConflictException(err);
      if (dto.lat != null && dto.lng != null) {
        await tx.sosTrack.create({
          data: { sosId: id, lat: dto.lat, lng: dto.lng, note: 'Đã tới hiện trường', actorId: a.userId },
        });
      }
      const mergedImages = dto.sceneImageIds ? [...new Set([...row.sceneImageIds, ...dto.sceneImageIds])].slice(0, 6) : row.sceneImageIds;
      const saved = await tx.sosRequest.update({
        where: { id },
        data: {
          status: 'TAI_HIEN_TRUONG',
          arrivedAt: new Date(),
          etaMinutes: 0,
          sceneImageIds: mergedImages,
          ...(dto.finalPrice != null ? { finalPrice: BigInt(dto.finalPrice) } : {}),
          ...(dto.sellerNote !== undefined ? { sellerNote: dto.sellerNote ?? row.sellerNote } : {}),
        },
        include: { tracks: true, review: true },
      });
      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'sos.arrived',
          entity: 'sos_request',
          entityId: id,
          before: { status: row.status },
          after: { status: 'TAI_HIEN_TRUONG', finalPrice: dto.finalPrice ?? n(row.finalPrice) },
          ip,
        },
        tx,
      );
      return saved;
    });
    return this.detailView(updated, 'GARAGE');
  }

  /** Cập nhật ảnh hiện trường và chốt giá khi đang ở hiện trường */
  async updateScene(a: Access, id: string, dto: z.infer<typeof sceneSchema>, ip?: string) {
    assertSosOperateAccess(a);
    if (dto.sceneImageIds?.length) {
      for (const fid of dto.sceneImageIds) await this.files.assertOwnedImage(fid, a.tenantId);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.loadAssignedForWrite(tx, a, id);
      if (!['TAI_HIEN_TRUONG', 'XU_LY_TAI_CHO', 'DANG_KEO_XE', 'DA_VE_GARAGE'].includes(row.status)) {
        throw new ConflictException('Chỉ cập nhật hiện trường / giá chốt khi đội cứu hộ đã tới nơi');
      }
      const saved = await tx.sosRequest.update({
        where: { id },
        data: {
          ...(dto.sceneImageIds ? { sceneImageIds: [...new Set(dto.sceneImageIds)].slice(0, 6) } : {}),
          ...(dto.finalPrice != null ? { finalPrice: BigInt(dto.finalPrice) } : {}),
          ...(dto.sellerNote !== undefined ? { sellerNote: dto.sellerNote } : {}),
        },
        include: { tracks: true, review: true },
      });
      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'sos.scene_updated',
          entity: 'sos_request',
          entityId: id,
          after: { finalPrice: dto.finalPrice ?? n(row.finalPrice), images: saved.sceneImageIds.length },
          ip,
        },
        tx,
      );
      return saved;
    });
    return this.detailView(updated, 'GARAGE');
  }

  /** Phương án 1: Xử lý tại chỗ (TAI_HIEN_TRUONG -> XU_LY_TAI_CHO) */
  async handleOnsite(a: Access, id: string, dto: z.infer<typeof decisionSchema>, ip?: string) {
    assertSosOperateAccess(a);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.loadAssignedForWrite(tx, a, id);
      const err = sosTransitionError(row.status as SosStatus, 'XU_LY_TAI_CHO');
      if (err) throw new ConflictException(err);
      const saved = await tx.sosRequest.update({
        where: { id },
        data: {
          status: 'XU_LY_TAI_CHO',
          ...(dto.finalPrice != null ? { finalPrice: BigInt(dto.finalPrice) } : {}),
          ...(dto.sellerNote !== undefined ? { sellerNote: dto.sellerNote ?? row.sellerNote } : {}),
        },
        include: { tracks: true, review: true },
      });
      await this.audit.log(
        { tenantId: a.tenantId, actorId: a.userId, action: 'sos.onsite', entity: 'sos_request', entityId: id, before: { status: row.status }, after: { status: 'XU_LY_TAI_CHO' }, ip },
        tx,
      );
      return saved;
    });
    return this.detailView(updated, 'GARAGE');
  }

  /** Phương án 2: Kéo xe về garage (TAI_HIEN_TRUONG -> DANG_KEO_XE) */
  async startTow(a: Access, id: string, dto: z.infer<typeof decisionSchema>, ip?: string) {
    assertSosOperateAccess(a);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.loadAssignedForWrite(tx, a, id);
      const err = sosTransitionError(row.status as SosStatus, 'DANG_KEO_XE');
      if (err) throw new ConflictException(err);
      const saved = await tx.sosRequest.update({
        where: { id },
        data: {
          status: 'DANG_KEO_XE',
          ...(dto.finalPrice != null ? { finalPrice: BigInt(dto.finalPrice) } : {}),
          ...(dto.sellerNote !== undefined ? { sellerNote: dto.sellerNote ?? row.sellerNote } : {}),
        },
        include: { tracks: true, review: true },
      });
      await this.audit.log(
        { tenantId: a.tenantId, actorId: a.userId, action: 'sos.tow_started', entity: 'sos_request', entityId: id, before: { status: row.status }, after: { status: 'DANG_KEO_XE' }, ip },
        tx,
      );
      return saved;
    });
    return this.detailView(updated, 'GARAGE');
  }

  /**
   * Đã kéo xe về tới garage (DANG_KEO_XE -> DA_VE_GARAGE).
   * Với garage PLG: tự tìm/tạo hồ sơ khách + xe và lập lệnh sửa chữa DH… tại chi nhánh nhận ca (S6, F5).
   * Với đối tác: không có CRM nên chỉ chuyển trạng thái DA_VE_GARAGE để đối tác sửa xong rồi bấm Hoàn thành.
   */
  async arriveGarage(a: Access, id: string, dto: z.infer<typeof decisionSchema>, ip?: string) {
    assertSosOperateAccess(a);
    const snapshot = await this.prisma.sosRequest.findFirst({ where: { id, assignedTenantId: a.tenantId } });
    if (!snapshot) throw new NotFoundException('Không tìm thấy ca cứu hộ của garage bạn');
    const err0 = sosTransitionError(snapshot.status as SosStatus, 'DA_VE_GARAGE');
    if (err0) throw new ConflictException(err0);

    let createdOrderId: string | null = snapshot.orderId ?? null;
    if (a.tenantType === 'GARAGE' && !createdOrderId) {
      let branchId = snapshot.assignedBranchId;
      if (!branchId) {
        const b = await this.prisma.branch.findFirst({
          where: { tenantId: a.tenantId, deletedAt: null, ...(a.branchIds === 'ALL' ? {} : { id: { in: a.branchIds } }) },
          orderBy: { code: 'asc' },
        });
        if (!b) throw new BadRequestException('Garage chưa có chi nhánh tiếp nhận xe');
        branchId = b.id;
      }
      if (!AccessService.canAccessBranch(a, branchId)) throw new ForbiddenException('Bạn không làm việc ở chi nhánh nhận xe này');

      // Tìm hoặc tạo hồ sơ khách hàng + xe trong CRM của PLG
      const { customerId, vehicleId } = await this.prisma.$transaction(async (tx) => {
        let cust = await tx.customer.findFirst({ where: { tenantId: a.tenantId, phone: snapshot.phone, deletedAt: null } });
        if (!cust) {
          const code = customerCode(await reserveNumbers(tx, a.tenantId, 'customer'));
          cust = await tx.customer.create({
            data: {
              tenantId: a.tenantId,
              code,
              name: snapshot.customerName,
              phone: snapshot.phone,
              branchId,
              source: 'SAN_CARDIY',
              createdBy: a.userId,
              searchText: searchKey(code, snapshot.customerName, snapshot.phone),
            },
          });
        }
        let vId: string | null = null;
        const normPlate = snapshot.plateNo ? normalizePlate(snapshot.plateNo) : null;
        if (normPlate) {
          let veh = await tx.vehicle.findFirst({ where: { tenantId: a.tenantId, plateNo: normPlate, deletedAt: null } });
          if (!veh) {
            veh = await tx.vehicle.create({
              data: {
                tenantId: a.tenantId,
                plateNo: normPlate,
                plateValid: isCivilPlate(normPlate),
                note: snapshot.vehicleInfo,
                createdBy: a.userId,
                searchText: searchKey(normPlate, formatPlate(normPlate), snapshot.vehicleInfo),
              },
            });
            await tx.vehicleOwnership.create({ data: { vehicleId: veh.id, customerId: cust.id } });
          }
          vId = veh.id;
        }
        return { customerId: cust.id, vehicleId: vId };
      });

      // Nếu xe đã có đơn đang mở tại PLG thì gắn vào đơn đó; chưa có thì tạo lệnh sửa chữa mới
      const existingOpen = vehicleId
        ? await this.prisma.repairOrder.findFirst({
            where: { tenantId: a.tenantId, vehicleId, status: { in: ['TIEP_NHAN', 'DANG_SUA', 'HOAN_THANH'] } },
            select: { id: true },
          })
        : null;

      if (existingOpen) {
        createdOrderId = existingOpen.id;
      } else {
        const orderReqText = `Cứu hộ ${snapshot.code} (${SOS_ISSUE_LABEL[snapshot.issueType as SosIssueType]})${snapshot.description ? `: ${snapshot.description}` : ''}`;
        const order = await this.orders.create(
          a,
          {
            branchId,
            customerId,
            vehicleId,
            request: orderReqText,
            note: snapshot.addressText ? `Kéo về từ: ${snapshot.addressText}` : 'Kéo xe về từ ca cứu hộ SOS',
          },
          ip,
        );
        createdOrderId = order.id;
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.loadAssignedForWrite(tx, a, id);
      const err = sosTransitionError(row.status as SosStatus, 'DA_VE_GARAGE');
      if (err) throw new ConflictException(err);
      const saved = await tx.sosRequest.update({
        where: { id },
        data: {
          status: 'DA_VE_GARAGE',
          ...(createdOrderId ? { orderId: createdOrderId } : {}),
          ...(dto.finalPrice != null ? { finalPrice: BigInt(dto.finalPrice) } : {}),
          ...(dto.sellerNote !== undefined ? { sellerNote: dto.sellerNote ?? row.sellerNote } : {}),
        },
        include: { tracks: true, review: true },
      });
      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'sos.arrived_garage',
          entity: 'sos_request',
          entityId: id,
          before: { status: row.status },
          after: { status: 'DA_VE_GARAGE', orderId: createdOrderId },
          ip,
        },
        tx,
      );
      return saved;
    });

    return this.detailView(updated, 'GARAGE');
  }

  /** Hoàn thành ca cứu hộ khi garage đã thu tiền trực tiếp (XU_LY_TAI_CHO | DA_VE_GARAGE -> HOAN_THANH) */
  async complete(a: Access, id: string, dto: z.infer<typeof completeSchema>, ip?: string) {
    assertSosOperateAccess(a);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.loadAssignedForWrite(tx, a, id);
      const err = sosTransitionError(row.status as SosStatus, 'HOAN_THANH');
      if (err) throw new ConflictException(err);
      const saved = await tx.sosRequest.update({
        where: { id },
        data: {
          status: 'HOAN_THANH',
          finalPrice: BigInt(dto.finalPrice),
          ...(dto.sellerNote !== undefined ? { sellerNote: dto.sellerNote ?? row.sellerNote } : {}),
          completedAt: new Date(),
        },
        include: { tracks: true, review: true },
      });
      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'sos.completed',
          entity: 'sos_request',
          entityId: id,
          before: { status: row.status },
          after: { status: 'HOAN_THANH', finalPrice: dto.finalPrice },
          ip,
        },
        tx,
      );
      return saved;
    });
    return this.detailView(updated, 'GARAGE');
  }

  /** Garage trả lời đánh giá của khách trên ca cứu hộ */
  async replyReview(a: Access, id: string, reply: string, ip?: string) {
    const ok =
      a.tenantType === 'PARTNER'
        ? a.permissions.includes('partner.review.reply') || a.permissions.includes('partner.request.manage')
        : a.tenantType === 'GARAGE' && (a.permissions.includes('sos.manage') || a.permissions.includes('order_request.manage'));
    if (!ok) throw new ForbiddenException('Bạn không có quyền trả lời đánh giá');

    const row = await this.prisma.sosRequest.findFirst({ where: { id, assignedTenantId: a.tenantId }, include: { review: true } });
    if (!row || !row.review) throw new NotFoundException('Ca cứu hộ này chưa có đánh giá của khách');
    if (row.review.reply) throw new ConflictException('Đánh giá này đã được phản hồi');

    const updated = await this.prisma.sosReview.update({
      where: { id: row.review.id },
      data: { reply: reply.trim(), repliedBy: a.userId, repliedAt: new Date() },
    });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'sos.review_replied',
      entity: 'sos_review',
      entityId: updated.id,
      after: { reply: updated.reply },
      ip,
    });
    return { reply: updated.reply, repliedAt: updated.repliedAt };
  }

  // ---------------- Admin sàn: giám sát cứu hộ toàn hệ thống (A6.61) ----------------

  async platformList(a: Access, q: { status?: string; search?: string }) {
    assertPlatformSupervisor(a);
    await expireStaleSos(this.prisma);

    const where: Prisma.SosRequestWhereInput = {};
    if (q.status === 'ACTIVE') {
      where.status = { in: ACTIVE_ASSIGNED_SOS_STATUSES };
    } else if (q.status && q.status !== 'ALL') {
      where.status = q.status as SosStatus;
    }
    if (q.search?.trim()) {
      const s = q.search.trim();
      const digits = s.replace(/\D/g, '');
      const plate = normalizePlate(s);
      where.OR = [
        { code: { contains: s.toUpperCase() } },
        { customerName: { contains: s, mode: 'insensitive' } },
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
        ...(plate ? [{ plateNo: { contains: plate } }] : []),
      ];
    }

    const [rows, grouped, acceptedSamples, rescueGarages] = await Promise.all([
      this.prisma.sosRequest.findMany({
        where,
        include: { tracks: true, review: true },
        orderBy: { createdAt: 'desc' },
        take: 150,
      }),
      this.prisma.sosRequest.groupBy({ by: ['status'], _count: true }),
      this.prisma.sosRequest.findMany({
        where: { acceptedAt: { not: null } },
        select: { createdAt: true, acceptedAt: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.allRescueCandidates(),
    ]);

    const countByStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count]));
    const activeTotal = ACTIVE_ASSIGNED_SOS_STATUSES.reduce((sum, st) => sum + (countByStatus[st] ?? 0), 0);
    const avgAcceptSec = acceptedSamples.length
      ? Math.round(acceptedSamples.reduce((s, r) => s + Math.max(0, r.acceptedAt!.getTime() - r.createdAt.getTime()) / 1000, 0) / acceptedSamples.length)
      : null;

    const items = await Promise.all(rows.map((r) => this.detailView(r, 'PLATFORM')));
    const onDutyGarages = rescueGarages.filter(
      (g) => g.enabled && g.onDuty && (g.tenantType === 'GARAGE' ? !g.tenantDeletedAt && g.tenantStatus !== 'TAM_KHOA' : !g.tenantDeletedAt && g.tenantStatus === 'HOAT_DONG'),
    );

    return {
      kpis: {
        searching: countByStatus.DANG_TIM_GARAGE ?? 0,
        active: activeTotal,
        noGarage: countByStatus.KHONG_CO_GARAGE ?? 0,
        completed: countByStatus.HOAN_THANH ?? 0,
        cancelled: countByStatus.KHACH_HUY ?? 0,
        avgAcceptSec,
        onDutyGarages: onDutyGarages.length,
      },
      garages: rescueGarages
        .filter((g) => g.enabled)
        .map((g) => ({
          tenantId: g.tenantId,
          tenantType: g.tenantType,
          name: g.name,
          slug: g.slug,
          hotline: g.hotline,
          address: g.address,
          onDuty: g.onDuty,
          radiusKm: g.radiusKm,
          basePrice: g.basePrice,
        })),
      items,
    };
  }

  async platformGet(a: Access, id: string) {
    assertPlatformSupervisor(a);
    await expireStaleSos(this.prisma);
    const row = await this.prisma.sosRequest.findUnique({ where: { id }, include: { tracks: true, review: true } });
    if (!row) throw new NotFoundException('Không tìm thấy ca cứu hộ');
    return this.detailView(row, 'PLATFORM');
  }
}

@Public()
@Controller('public/sos')
export class PublicSosController {
  constructor(private readonly sos: SosService) {}

  @Get('garages')
  garages(@Query('lat') lat?: string, @Query('lng') lng?: string) {
    return this.sos.publicRescueGarages(lat, lng);
  }

  @Post()
  create(@Body(new ZodPipe(publicSosCreateSchema)) dto: PublicSosCreateDto, @Req() req: Request) {
    return this.sos.createPublic(dto, clientIp(req));
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Query(new ZodPipe(tokenSchema)) q: { token: string }) {
    return this.sos.getPublic(id, q.token);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(publicCancelSchema)) dto: z.infer<typeof publicCancelSchema>,
    @Req() req: Request,
  ) {
    return this.sos.cancelPublic(id, dto.token, dto.reason, clientIp(req));
  }

  @Post(':id/review')
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(publicReviewSchema)) dto: z.infer<typeof publicReviewSchema>,
    @Req() req: Request,
  ) {
    return this.sos.reviewPublic(id, dto.token, dto.rating, dto.comment, clientIp(req));
  }
}

@Public()
@UseGuards(OwnerGuard)
@Controller('owner/sos')
export class OwnerSosController {
  constructor(private readonly sos: SosService) {}

  @Get('vehicles')
  vehicles(@Req() req: OwnerRequest) {
    return this.sos.ownerVehiclesForSos(req.owner!.userId);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  upload(@Req() req: OwnerRequest, @UploadedFile() file: Express.Multer.File) {
    return this.sos.ownerUpload(req.owner!.userId, file, clientIp(req));
  }

  @Get()
  list(@Req() req: OwnerRequest) {
    return this.sos.ownerList(req.owner!.userId);
  }

  @Post()
  create(@Req() req: OwnerRequest, @Body(new ZodPipe(ownerSosCreateSchema)) dto: OwnerSosCreateDto) {
    return this.sos.ownerCreate(req.owner!.userId, dto, clientIp(req));
  }

  @Get(':id')
  get(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.sos.ownerGet(req.owner!.userId, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Req() req: OwnerRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ownerCancelSchema)) dto: z.infer<typeof ownerCancelSchema>,
  ) {
    return this.sos.ownerCancel(req.owner!.userId, id, dto.reason, clientIp(req));
  }

  @Post(':id/review')
  review(
    @Req() req: OwnerRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(reviewBodySchema)) dto: z.infer<typeof reviewBodySchema>,
  ) {
    return this.sos.ownerReview(req.owner!.userId, id, dto.rating, dto.comment, clientIp(req));
  }
}

@Controller('sos')
export class GarageSosController {
  constructor(private readonly sos: SosService) {}

  @Get('config')
  getConfig(@CurrentAuth() auth: RequestAuth) {
    return this.sos.getConfig(auth.access);
  }

  @Put('config')
  saveConfig(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(sosConfigSchema)) dto: SosConfigDto, @Req() req: Request) {
    return this.sos.saveConfig(auth.access, dto, clientIp(req));
  }

  @Get('staff')
  staff(@CurrentAuth() auth: RequestAuth, @Query('branchId') branchId?: string) {
    return this.sos.rescueStaff(auth.access, branchId);
  }

  @Get('cases')
  cases(
    @CurrentAuth() auth: RequestAuth,
    @Query('tab') tab?: string,
    @Query('branchId') branchId?: string,
    @Query('crewOnly') crewOnly?: string,
  ) {
    return this.sos.garageCases(auth.access, { tab, branchId, crewOnly });
  }

  @Post('cases/:id/accept')
  @HttpCode(200)
  accept(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(acceptSchema)) dto: AcceptDto, @Req() req: Request) {
    return this.sos.accept(auth.access, id, dto, clientIp(req));
  }

  @Post('cases/:id/dispatch')
  @HttpCode(200)
  dispatch(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(dispatchSchema)) dto: z.infer<typeof dispatchSchema>,
    @Req() req: Request,
  ) {
    return this.sos.dispatch(auth.access, id, dto, clientIp(req));
  }

  @Post('cases/:id/track')
  @HttpCode(200)
  track(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(trackSchema)) dto: z.infer<typeof trackSchema>) {
    return this.sos.addTrack(auth.access, id, dto);
  }

  @Post('cases/:id/arrive')
  @HttpCode(200)
  arrive(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(sceneSchema)) dto: z.infer<typeof sceneSchema>,
    @Req() req: Request,
  ) {
    return this.sos.arrive(auth.access, id, dto, clientIp(req));
  }

  @Put('cases/:id/scene')
  updateScene(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(sceneSchema)) dto: z.infer<typeof sceneSchema>,
    @Req() req: Request,
  ) {
    return this.sos.updateScene(auth.access, id, dto, clientIp(req));
  }

  @Post('cases/:id/handle-onsite')
  @HttpCode(200)
  handleOnsite(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(decisionSchema)) dto: z.infer<typeof decisionSchema>,
    @Req() req: Request,
  ) {
    return this.sos.handleOnsite(auth.access, id, dto, clientIp(req));
  }

  @Post('cases/:id/start-tow')
  @HttpCode(200)
  startTow(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(decisionSchema)) dto: z.infer<typeof decisionSchema>,
    @Req() req: Request,
  ) {
    return this.sos.startTow(auth.access, id, dto, clientIp(req));
  }

  @Post('cases/:id/arrive-garage')
  @HttpCode(200)
  arriveGarage(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(decisionSchema)) dto: z.infer<typeof decisionSchema>,
    @Req() req: Request,
  ) {
    return this.sos.arriveGarage(auth.access, id, dto, clientIp(req));
  }

  @Post('cases/:id/complete')
  @HttpCode(200)
  complete(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(completeSchema)) dto: z.infer<typeof completeSchema>,
    @Req() req: Request,
  ) {
    return this.sos.complete(auth.access, id, dto, clientIp(req));
  }

  @Post('cases/:id/reply')
  @HttpCode(200)
  reply(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(replySchema)) dto: z.infer<typeof replySchema>,
    @Req() req: Request,
  ) {
    return this.sos.replyReview(auth.access, id, dto.reply, clientIp(req));
  }
}

@RequirePermissions('platform.report.handle')
@Controller('platform/sos')
export class PlatformSosController {
  constructor(private readonly sos: SosService) {}

  @Get()
  list(@CurrentAuth() auth: RequestAuth, @Query('status') status?: string, @Query('q') q?: string) {
    return this.sos.platformList(auth.access, { status, search: q });
  }

  @Get(':id')
  get(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.sos.platformGet(auth.access, id);
  }
}

@Module({
  imports: [FilesModule, OrdersModule, OwnerModule],
  controllers: [PublicSosController, OwnerSosController, GarageSosController, PlatformSosController],
  providers: [SosService],
  exports: [SosService],
})
export class SosModule {}
