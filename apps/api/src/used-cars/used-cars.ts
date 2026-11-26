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
import { formatPlate, normalizePlate, normalizeVnPhone, searchKey } from '@cardiy/shared';
import { Prisma, type PaymentMethod } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AccessService, type Access } from '../auth/access.service';
import { CurrentAuth, Public, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { reserveNumbers } from '../crm/counters';
import { FilesModule } from '../files/files.module';
import { FilesService } from '../files/files.service';
import { tenantListable } from '../marketplace/offer-rules';
import { OwnerModule } from '../owner/owner';
import { OwnerGuard, type OwnerRequest } from '../owner/owner-auth';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  APPRAISAL_GRADE_LABEL,
  APPRAISAL_STATUS_LABEL,
  appraisalCode,
  appraisalTransitionError,
  buildDefaultChecklist,
  canSubmitUsedCar,
  computeListingExpiry,
  DEFAULT_APPRAISAL_CHECKLIST,
  evaluateAppraisalChecklist,
  maskPlatePublic,
  USED_CAR_MAX_HOURLY_THREADS_PER_IP,
  USED_CAR_STATUS_LABEL,
  usedCarCode,
  usedCarStatusAfterEdit,
  type AppraisalChecklistItem,
  type AppraisalGrade,
  type UsedCarAppraisalStatus,
  type UsedCarListingStatus,
} from './used-car-rules';

type Db = PrismaService | Prisma.TransactionClient;
const n = (b: bigint | number | null | undefined) => (b === null || b === undefined ? null : Number(b));
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const optText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());

const moneySchema = z.coerce.number().int().min(0, 'Số tiền không hợp lệ').max(100_000_000_000);
const BODY_STYLES = ['SEDAN', 'SUV_CUV', 'HATCHBACK', 'MPV', 'PICKUP', 'OTHER'] as const;
const TRANSMISSIONS = ['TU_DONG', 'SO_SAN'] as const;
const FUELS = ['XANG', 'DAU', 'DIEN', 'HYBRID'] as const;

export const usedCarListingSchema = z.object({
  vehicleId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable().optional()),
  branchId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable().optional()),
  title: z.string().trim().min(5, 'Nhập tiêu đề tin đăng xe cũ').max(180),
  plateNo: optText(20),
  vin: optText(25),
  make: z.string().trim().min(1, 'Nhập hãng xe').max(60),
  model: z.string().trim().min(1, 'Nhập dòng xe').max(80),
  year: z.coerce.number().int().min(1990, 'Năm sản xuất không hợp lệ').max(2100),
  mileageKm: z.coerce.number().int().min(0, 'Số ODO không hợp lệ').max(2_000_000),
  bodyStyle: z.enum(BODY_STYLES).default('SEDAN'),
  transmission: z.enum(TRANSMISSIONS).default('TU_DONG'),
  fuel: z.enum(FUELS).default('XANG'),
  exteriorColor: optText(60),
  seats: z.coerce.number().int().min(2).max(50).default(5),
  ownersCount: z.coerce.number().int().min(1).max(20).default(1),
  price: z.coerce.number().int().min(10_000_000, 'Giá bán xe tối thiểu 10.000.000 đ').max(50_000_000_000),
  negotiable: z.coerce.boolean().default(true),
  province: z.string().trim().min(2, 'Nhập tỉnh / thành phố xem xe').max(100),
  addressText: optText(300),
  contactName: optText(100),
  contactPhone: optText(20),
  description: optText(4000),
  imageFileIds: z.array(z.string().uuid()).max(12, 'Tối đa 12 ảnh xe').default([]),
  docFileIds: z.array(z.string().uuid()).max(6, 'Tối đa 6 ảnh giấy tờ').default([]),
});
type UsedCarListingDto = z.infer<typeof usedCarListingSchema>;

const appraisalConfigSchema = z.object({
  enabled: z.boolean(),
  fee: moneySchema,
  branchId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable().optional()),
  note: optText(500),
});

const bookAppraisalSchema = z.object({
  tenantId: z.string().uuid('Chọn garage thực hiện kiểm định'),
  scheduledAt: z.coerce.date({ message: 'Chọn ngày giờ mang xe đi kiểm định' }),
  note: optText(500),
});

const confirmAppraisalSchema = z.object({
  scheduledAt: z.coerce.date().optional(),
  assignedMemberId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable().optional()),
  branchId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable().optional()),
});

const rejectReasonSchema = z.object({
  reason: z.string().trim().min(3, 'Nhập lý do').max(500),
});

const checklistEntrySchema = z.object({
  key: z.string().min(1).max(40),
  status: z.enum(['TOT', 'LUU_Y', 'KHONG_DAT']),
  note: optText(300),
});

const gradeAppraisalSchema = z.object({
  checklist: z.array(checklistEntrySchema).min(1),
  noMajorAccident: z.boolean().default(true),
  noFloodDamage: z.boolean().default(true),
  validDocuments: z.boolean().default(true),
  inspectedMileageKm: z.coerce.number().int().min(0).max(2_000_000).nullable().optional(),
  summary: optText(1500),
  reportImageIds: z.array(z.string().uuid()).max(10).default([]),
  finalFee: moneySchema.nullable().optional(),
  paymentMethod: z.enum(['TIEN_MAT', 'CHUYEN_KHOAN', 'THE']).default('CHUYEN_KHOAN'),
});

const publicInquirySchema = z.object({
  name: z.string().trim().min(2, 'Nhập họ tên').max(100),
  phone: z.string().trim().min(9, 'Nhập số điện thoại').max(20),
  message: z.string().trim().min(2, 'Nhập nội dung cần hỏi').max(1000),
  viewingAt: z.preprocess((v) => (!v || v === '' ? null : v), z.coerce.date().nullable().optional()),
});

const ownerInquirySchema = z.object({
  message: z.string().trim().min(2, 'Nhập nội dung cần hỏi').max(1000),
  viewingAt: z.preprocess((v) => (!v || v === '' ? null : v), z.coerce.date().nullable().optional()),
});

const tokenQuerySchema = z.object({ token: z.string().min(10).max(100) });

const publicMessageSchema = tokenQuerySchema.extend({
  content: z.string().trim().min(1, 'Nhập tin nhắn').max(1000),
  viewingAt: z.preprocess((v) => (!v || v === '' ? null : v), z.coerce.date().nullable().optional()),
});

const authMessageSchema = z.object({
  content: z.string().trim().min(1, 'Nhập tin nhắn').max(1000),
  viewingAt: z.preprocess((v) => (!v || v === '' ? null : v), z.coerce.date().nullable().optional()),
});

const viewingDecisionSchema = z.object({
  status: z.enum(['DA_XAC_NHAN', 'TU_CHOI']),
  viewingAt: z.preprocess((v) => (!v || v === '' ? null : v), z.coerce.date().nullable().optional()),
  note: optText(500),
});

const reviewNoteSchema = z.object({
  note: z.string().trim().min(3, 'Nhập lý do kiểm duyệt').max(500),
});

function assertUsedCarView(a: Access) {
  const ok =
    a.tenantType === 'PARTNER'
      ? a.permissions.some((p) => ['partner.listing.manage', 'partner.request.manage'].includes(p))
      : a.tenantType === 'GARAGE' && a.permissions.some((p) => ['used_car.manage', 'used_car.appraise'].includes(p));
  if (!ok) throw new ForbiddenException('Bạn không có quyền xem mục Xe cũ & Kiểm định');
}

function assertUsedCarManage(a: Access) {
  const ok =
    a.tenantType === 'PARTNER'
      ? a.permissions.some((p) => ['partner.listing.manage', 'partner.request.manage'].includes(p))
      : a.tenantType === 'GARAGE' && a.permissions.includes('used_car.manage');
  if (!ok) throw new ForbiddenException('Bạn không có quyền quản lý tin bán xe & lịch kiểm định');
}

function assertUsedCarAppraise(a: Access) {
  const ok =
    a.tenantType === 'PARTNER'
      ? a.permissions.includes('partner.request.manage')
      : a.tenantType === 'GARAGE' && a.permissions.some((p) => ['used_car.appraise', 'used_car.manage'].includes(p));
  if (!ok) throw new ForbiddenException('Bạn không có quyền chấm báo cáo kiểm định xe cũ');
}

function assertPlatformReviewer(a: Access) {
  if (a.tenantType !== 'PLATFORM' || !a.permissions.includes('platform.partner.review')) {
    throw new ForbiddenException('Chỉ bộ phận kiểm duyệt sàn mới thực hiện được thao tác này');
  }
}

/** Tự chuyển các tin DANG_BAN đã quá 60 ngày kể từ publishedAt sang HET_HAN (theo F8) */
export async function expireStaleUsedCars(db: Db) {
  await db.usedCarListing.updateMany({
    where: { status: 'DANG_BAN', expiresAt: { lt: new Date() } },
    data: { status: 'HET_HAN' },
  });
}

function normalizeChecklist(raw: unknown): AppraisalChecklistItem[] {
  const arr = Array.isArray(raw) ? (raw as Partial<AppraisalChecklistItem>[]) : [];
  const byKey = new Map(arr.filter((x) => x && typeof x.key === 'string').map((x) => [x.key!, x]));
  return DEFAULT_APPRAISAL_CHECKLIST.map((def) => {
    const cur = byKey.get(def.key);
    const st = cur?.status === 'TOT' || cur?.status === 'LUU_Y' || cur?.status === 'KHONG_DAT' ? cur.status : 'TOT';
    return {
      ...def,
      status: st,
      note: cur?.note ?? null,
    };
  });
}

@Injectable()
export class UsedCarsService {
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

  private async appraisalReportView(ap: Prisma.UsedCarAppraisalGetPayload<object>) {
    const [tenant, shop, branch, cashEntry] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: ap.tenantId }, select: { id: true, name: true, type: true } }),
      this.prisma.shop.findUnique({ where: { tenantId: ap.tenantId }, select: { name: true, slug: true, phone: true, address: true } }),
      ap.branchId ? this.prisma.branch.findUnique({ where: { id: ap.branchId }, select: { id: true, code: true, name: true } }) : Promise.resolve(null),
      ap.cashEntryId ? this.prisma.cashEntry.findUnique({ where: { id: ap.cashEntryId }, select: { id: true, code: true, amount: true } }) : Promise.resolve(null),
    ]);

    let assigneeName: string | null = null;
    if (ap.assignedMemberId) {
      const m = await this.prisma.membership.findUnique({
        where: { id: ap.assignedMemberId },
        include: { user: { select: { fullName: true } } },
      });
      assigneeName = m?.user.fullName ?? null;
    }

    const checklist = normalizeChecklist(ap.checklist);

    return {
      id: ap.id,
      code: ap.code,
      listingId: ap.listingId,
      status: ap.status as UsedCarAppraisalStatus,
      statusLabel: APPRAISAL_STATUS_LABEL[ap.status as UsedCarAppraisalStatus],
      scheduledAt: ap.scheduledAt,
      quotedFee: n(ap.quotedFee)!,
      finalFee: n(ap.finalFee),
      paymentMethod: ap.paymentMethod,
      cashEntry: cashEntry ? { id: cashEntry.id, code: cashEntry.code, amount: n(cashEntry.amount)! } : null,
      checklist,
      noMajorAccident: ap.noMajorAccident,
      noFloodDamage: ap.noFloodDamage,
      validDocuments: ap.validDocuments,
      inspectedMileageKm: ap.inspectedMileageKm,
      score: ap.score,
      grade: ap.grade as AppraisalGrade | null,
      gradeLabel: ap.grade ? APPRAISAL_GRADE_LABEL[ap.grade as AppraisalGrade] : null,
      summary: ap.summary,
      customerNote: ap.customerNote,
      rejectReason: ap.rejectReason,
      completedAt: ap.completedAt,
      createdAt: ap.createdAt,
      assignedMemberId: ap.assignedMemberId,
      assigneeName,
      reportImages: await Promise.all(ap.reportImageIds.map(async (id) => ({ id, url: await this.url(id) }))),
      garage: {
        tenantId: ap.tenantId,
        name: shop?.name ?? tenant?.name ?? '',
        slug: shop?.slug ?? null,
        phone: shop?.phone ?? null,
        address: shop?.address ?? null,
        branch: branch ? { id: branch.id, code: branch.code, name: branch.name } : null,
      },
    };
  }

  private async listingView(
    l: Prisma.UsedCarListingGetPayload<object>,
    mode: 'PUBLIC' | 'PRIVILEGED',
    opts?: { savedIds?: Set<string> },
  ) {
    const [shop, tenant, branch, verifiedAp, threadsCount] = await Promise.all([
      l.sellerTenantId ? this.prisma.shop.findUnique({ where: { tenantId: l.sellerTenantId } }) : Promise.resolve(null),
      l.sellerTenantId
        ? this.prisma.tenant.findUnique({ where: { id: l.sellerTenantId }, select: { id: true, name: true, type: true } })
        : Promise.resolve(null),
      l.branchId ? this.prisma.branch.findUnique({ where: { id: l.branchId }, select: { id: true, code: true, name: true } }) : Promise.resolve(null),
      l.verifiedAppraisalId ? this.prisma.usedCarAppraisal.findUnique({ where: { id: l.verifiedAppraisalId } }) : Promise.resolve(null),
      mode === 'PRIVILEGED' ? this.prisma.usedCarThread.count({ where: { listingId: l.id } }) : Promise.resolve(0),
    ]);

    const formattedPlate = l.plateNo ? formatPlate(l.plateNo) : null;
    const appraisalReport =
      verifiedAp && verifiedAp.status === 'HOAN_THANH' ? await this.appraisalReportView(verifiedAp) : null;

    return {
      id: l.id,
      code: l.code,
      sellerType: l.sellerType,
      title: l.title,
      plateNo: mode === 'PRIVILEGED' ? formattedPlate : maskPlatePublic(formattedPlate),
      vin: mode === 'PRIVILEGED' ? l.vin : null,
      make: l.make,
      model: l.model,
      year: l.year,
      mileageKm: l.mileageKm,
      bodyStyle: l.bodyStyle,
      transmission: l.transmission,
      fuel: l.fuel,
      exteriorColor: l.exteriorColor,
      seats: l.seats,
      ownersCount: l.ownersCount,
      price: n(l.price)!,
      negotiable: l.negotiable,
      province: l.province,
      addressText: l.addressText,
      contactName: l.contactName,
      contactPhone: l.contactPhone,
      description: l.description,
      hasVerifiedBadge: l.hasVerifiedBadge,
      status: l.status as UsedCarListingStatus,
      statusLabel: USED_CAR_STATUS_LABEL[l.status as UsedCarListingStatus],
      reviewNote: mode === 'PRIVILEGED' ? l.reviewNote : null,
      publishedAt: l.publishedAt,
      expiresAt: l.expiresAt,
      soldAt: l.soldAt,
      viewsCount: l.viewsCount,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
      saved: opts?.savedIds ? opts.savedIds.has(l.id) : false,
      threadsCount,
      images: await Promise.all(l.imageFileIds.map(async (id) => ({ id, url: await this.url(id) }))),
      docImages:
        mode === 'PRIVILEGED'
          ? await Promise.all(l.docFileIds.map(async (id) => ({ id, url: await this.url(id) })))
          : [],
      branch: branch ? { id: branch.id, code: branch.code, name: branch.name } : null,
      sellerShop: l.sellerTenantId
        ? {
            tenantId: l.sellerTenantId,
            tenantType: tenant?.type ?? 'PARTNER',
            name: shop?.name ?? tenant?.name ?? l.contactName,
            slug: shop?.slug ?? null,
          }
        : null,
      appraisalReport,
    };
  }

  private async threadView(t: Prisma.UsedCarThreadGetPayload<{ include: { listing: true; messages: true } }>) {
    return {
      id: t.id,
      listingId: t.listingId,
      buyerName: t.buyerName,
      buyerPhone: t.buyerPhone,
      viewingAt: t.viewingAt,
      viewingStatus: t.viewingStatus,
      lastMessageAt: t.lastMessageAt,
      createdAt: t.createdAt,
      listing: {
        id: t.listing.id,
        code: t.listing.code,
        title: t.listing.title,
        price: n(t.listing.price)!,
        province: t.listing.province,
        contactName: t.listing.contactName,
        contactPhone: t.listing.contactPhone,
        status: t.listing.status,
        hasVerifiedBadge: t.listing.hasVerifiedBadge,
      },
      messages: [...t.messages]
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((m) => ({
          id: m.id,
          senderRole: m.senderRole,
          senderName: m.senderName,
          content: m.content,
          createdAt: m.createdAt,
        })),
    };
  }

  // ---------------- Công khai trên sàn (/cho/xe-cu, A1.07) ----------------

  async publicAppraisalGarages(province?: string) {
    const configs = await this.prisma.appraisalConfig.findMany({ where: { enabled: true } });
    if (!configs.length) return [];
    const tenantIds = configs.map((c) => c.tenantId);
    const [tenants, shops] = await Promise.all([
      this.prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true, type: true, status: true, deletedAt: true } }),
      this.prisma.shop.findMany({ where: { tenantId: { in: tenantIds } } }),
    ]);
    const ok = new Map(tenants.filter(tenantListable).map((t) => [t.id, t]));
    return configs
      .filter((c) => ok.has(c.tenantId))
      .map((c) => {
        const t = ok.get(c.tenantId)!;
        const sh = shops.find((s) => s.tenantId === c.tenantId);
        return {
          tenantId: c.tenantId,
          tenantType: t.type,
          name: sh?.name ?? t.name,
          slug: sh?.slug ?? null,
          phone: sh?.phone ?? null,
          address: sh?.address ?? null,
          province: sh?.province ?? null,
          fee: n(c.fee)!,
          note: c.note,
        };
      })
      .filter((g) => !province?.trim() || g.province === province.trim())
      .sort((a, b) => a.fee - b.fee);
  }

  async publicListUsedCars(q: {
    q?: string;
    province?: string;
    make?: string;
    bodyStyle?: string;
    transmission?: string;
    fuel?: string;
    minPrice?: string;
    maxPrice?: string;
    minYear?: string;
    verifiedOnly?: string;
    sort?: string;
  }) {
    await expireStaleUsedCars(this.prisma);
    const where: Prisma.UsedCarListingWhereInput = { status: 'DANG_BAN' };
    if (q.province?.trim()) where.province = q.province.trim();
    if (q.make?.trim()) where.make = { equals: q.make.trim(), mode: 'insensitive' };
    if (q.bodyStyle && (BODY_STYLES as readonly string[]).includes(q.bodyStyle)) where.bodyStyle = q.bodyStyle;
    if (q.transmission && (TRANSMISSIONS as readonly string[]).includes(q.transmission)) where.transmission = q.transmission;
    if (q.fuel && (FUELS as readonly string[]).includes(q.fuel)) where.fuel = q.fuel;
    if (q.verifiedOnly === 'true') where.hasVerifiedBadge = true;
    if (q.minYear && Number.isFinite(Number(q.minYear))) where.year = { gte: Number(q.minYear) };
    if ((q.minPrice && Number.isFinite(Number(q.minPrice))) || (q.maxPrice && Number.isFinite(Number(q.maxPrice)))) {
      where.price = {
        ...(q.minPrice && Number.isFinite(Number(q.minPrice)) ? { gte: BigInt(Math.round(Number(q.minPrice))) } : {}),
        ...(q.maxPrice && Number.isFinite(Number(q.maxPrice)) ? { lte: BigInt(Math.round(Number(q.maxPrice))) } : {}),
      };
    }
    if (q.q?.trim()) where.searchText = { contains: searchKey(q.q) };

    const [rows, facetRows] = await Promise.all([
      this.prisma.usedCarListing.findMany({
        where,
        orderBy: [{ hasVerifiedBadge: 'desc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
        take: 200,
      }),
      this.prisma.usedCarListing.findMany({
        where: { status: 'DANG_BAN' },
        select: { province: true, make: true },
        take: 500,
      }),
    ]);

    const sellerTenantIds = [...new Set(rows.map((r) => r.sellerTenantId).filter((x): x is string => !!x))];
    const tenants = sellerTenantIds.length
      ? await this.prisma.tenant.findMany({ where: { id: { in: sellerTenantIds } }, select: { id: true, type: true, status: true, deletedAt: true } })
      : [];
    const okTenantIds = new Set(tenants.filter(tenantListable).map((t) => t.id));
    const visible = rows.filter((r) => !r.sellerTenantId || okTenantIds.has(r.sellerTenantId));

    if (q.sort === 'gia-tang') visible.sort((a, b) => n(a.price)! - n(b.price)!);
    else if (q.sort === 'gia-giam') visible.sort((a, b) => n(b.price)! - n(a.price)!);
    else if (q.sort === 'odo-thap') visible.sort((a, b) => a.mileageKm - b.mileageKm);

    const provinces = [...new Set(facetRows.map((f) => f.province).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
    const makes = [...new Set(facetRows.map((f) => f.make).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));

    return {
      provinces,
      makes,
      items: await Promise.all(visible.map((r) => this.listingView(r, 'PUBLIC'))),
    };
  }

  async publicGetUsedCar(id: string, ip?: string) {
    await expireStaleUsedCars(this.prisma);
    const row = await this.prisma.usedCarListing.findUnique({ where: { id } });
    if (!row || row.status !== 'DANG_BAN') throw new NotFoundException('Không tìm thấy tin bán xe');
    if (row.sellerTenantId) {
      const t = await this.prisma.tenant.findUnique({ where: { id: row.sellerTenantId } });
      if (!t || !tenantListable(t)) throw new NotFoundException('Tin bán xe tạm ngừng hiển thị');
    }

    if (ip) {
      const key = `usedcar:view:${id}:${ip}`;
      const added = await this.redis.client.set(key, '1', 'EX', 1800, 'NX');
      if (added === 'OK') {
        await this.prisma.usedCarListing.update({ where: { id }, data: { viewsCount: { increment: 1 } } });
        row.viewsCount += 1;
      }
    }

    return this.listingView(row, 'PUBLIC');
  }

  private assertThreadToken(row: { accessHash: string }, token: string) {
    const a = Buffer.from(row.accessHash, 'hex');
    const b = Buffer.from(sha256(token), 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Link hội thoại xem xe không hợp lệ');
    }
  }

  private async createInquiryInternal(opts: {
    listingId: string;
    buyerUserId: string | null;
    buyerName: string;
    buyerPhone: string;
    message: string;
    viewingAt: Date | null;
    ip?: string;
  }) {
    const normPhone = normalizeVnPhone(opts.buyerPhone);
    if (!normPhone) throw new BadRequestException('Số điện thoại không hợp lệ');

    if (opts.ip) {
      const rlKey = `usedcar:ip:${opts.ip}`;
      const hits = await this.redis.client.incr(rlKey);
      if (hits === 1) await this.redis.client.expire(rlKey, 3600);
      if (hits > USED_CAR_MAX_HOURLY_THREADS_PER_IP) {
        throw new HttpException('Bạn đã gửi quá nhiều tin nhắn hỏi xe trong giờ qua, vui lòng thử lại sau.', HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    await expireStaleUsedCars(this.prisma);
    const listing = await this.prisma.usedCarListing.findUnique({ where: { id: opts.listingId } });
    if (!listing || listing.status !== 'DANG_BAN') throw new BadRequestException('Tin bán xe hiện không còn mở');
    if (opts.viewingAt && opts.viewingAt.getTime() < Date.now() - 10 * 60_000) {
      throw new BadRequestException('Thời điểm hẹn xem xe đã qua');
    }

    const token = randomBytes(24).toString('base64url');
    const accessHash = sha256(token);

    const thread = await this.prisma.$transaction(async (tx) => {
      const created = await tx.usedCarThread.create({
        data: {
          listingId: listing.id,
          buyerUserId: opts.buyerUserId,
          buyerName: opts.buyerName.trim(),
          buyerPhone: normPhone,
          viewingAt: opts.viewingAt,
          viewingStatus: opts.viewingAt ? 'CHO_XAC_NHAN' : 'NONE',
          accessHash,
          lastMessageAt: new Date(),
        },
      });
      await tx.usedCarMessage.create({
        data: {
          threadId: created.id,
          senderRole: 'BUYER',
          senderName: opts.buyerName.trim(),
          content: opts.message.trim(),
        },
      });
      return created;
    });

    return {
      threadId: thread.id,
      token,
      trackUrl: `/cho/xe-cu/hoi-mua/${thread.id}?t=${token}`,
    };
  }

  async publicCreateInquiry(listingId: string, dto: z.infer<typeof publicInquirySchema>, ip?: string) {
    return this.createInquiryInternal({
      listingId,
      buyerUserId: null,
      buyerName: dto.name,
      buyerPhone: dto.phone,
      message: dto.message,
      viewingAt: dto.viewingAt ?? null,
      ip,
    });
  }

  async publicGetInquiry(threadId: string, token: string) {
    const row = await this.prisma.usedCarThread.findUnique({
      where: { id: threadId },
      include: { listing: true, messages: true },
    });
    if (!row) throw new NotFoundException('Không tìm thấy cuộc trò chuyện');
    this.assertThreadToken(row, token);
    return this.threadView(row);
  }

  async publicPostMessage(threadId: string, dto: z.infer<typeof publicMessageSchema>) {
    const row = await this.prisma.usedCarThread.findUnique({
      where: { id: threadId },
      include: { listing: true, messages: true },
    });
    if (!row) throw new NotFoundException('Không tìm thấy cuộc trò chuyện');
    this.assertThreadToken(row, tokenOf(dto));
    if (dto.viewingAt && dto.viewingAt.getTime() < Date.now() - 10 * 60_000) {
      throw new BadRequestException('Thời điểm hẹn xem xe đã qua');
    }
    await this.prisma.$transaction([
      this.prisma.usedCarMessage.create({
        data: { threadId, senderRole: 'BUYER', senderName: row.buyerName, content: dto.content },
      }),
      this.prisma.usedCarThread.update({
        where: { id: threadId },
        data: {
          lastMessageAt: new Date(),
          ...(dto.viewingAt ? { viewingAt: dto.viewingAt, viewingStatus: 'CHO_XAC_NHAN' } : {}),
        },
      }),
    ]);
    return this.publicGetInquiry(threadId, dto.token);
  }

  // ---------------- App chủ xe (/app/xe-cu, A2.09) ----------------

  async ownerUpload(userId: string, file: Express.Multer.File, ip?: string) {
    if (!file) throw new BadRequestException('Chọn file ảnh để tải lên');
    if (!file.mimetype?.startsWith('image/')) throw new BadRequestException('Chỉ chấp nhận file ảnh');
    const platformId = await this.platformTenantId();
    return this.files.upload(platformId, userId, file, ip);
  }

  async ownerMyVehicles(userId: string) {
    const links = await this.prisma.customerLink.findMany({
      where: { userId, customer: { deletedAt: null } },
      select: { customerId: true },
    });
    if (!links.length) return [];
    const own = await this.prisma.vehicleOwnership.findMany({
      where: { customerId: { in: links.map((l) => l.customerId) }, toDate: null, vehicle: { deletedAt: null } },
      include: { vehicle: true },
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
        plateNo: formatPlate(o.vehicle.plateNo),
        vin: o.vehicle.vin,
        make: o.vehicle.make ?? '',
        model: o.vehicle.model ?? '',
        year: o.vehicle.year ?? new Date().getFullYear() - 3,
        mileageKm: o.vehicle.odometerKm ?? 0,
        color: o.vehicle.color,
      }));
  }

  async ownerListMyListings(userId: string) {
    await expireStaleUsedCars(this.prisma);
    const rows = await this.prisma.usedCarListing.findMany({
      where: { sellerUserId: userId, sellerType: 'OWNER' },
      include: { appraisals: { orderBy: { createdAt: 'desc' } } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    return Promise.all(
      rows.map(async (r) => ({
        ...(await this.listingView(r, 'PRIVILEGED')),
        appraisals: await Promise.all(r.appraisals.map((ap) => this.appraisalReportView(ap))),
      })),
    );
  }

  private async validateListingFields(opts: {
    dto: UsedCarListingDto;
    fileOwnerTenantId: string;
    fallbackName: string;
    fallbackPhone: string;
  }) {
    const plateNo = opts.dto.plateNo ? normalizePlate(opts.dto.plateNo) : null;
    if (opts.dto.plateNo && !plateNo) throw new BadRequestException('Biển số xe không hợp lệ');
    const contactPhone = normalizeVnPhone(opts.dto.contactPhone || opts.fallbackPhone);
    if (!contactPhone) throw new BadRequestException('Số điện thoại liên hệ không hợp lệ');
    const contactName = (opts.dto.contactName || opts.fallbackName).trim();
    if (!contactName) throw new BadRequestException('Nhập tên người liên hệ');

    for (const fid of opts.dto.imageFileIds) await this.files.assertOwnedImage(fid, opts.fileOwnerTenantId);
    for (const fid of opts.dto.docFileIds) await this.files.assertOwnedImage(fid, opts.fileOwnerTenantId);

    return { plateNo, contactName, contactPhone };
  }

  async ownerCreateListing(userId: string, dto: UsedCarListingDto, ip?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true, phone: true } });
    const platformId = await this.platformTenantId();
    const { plateNo, contactName, contactPhone } = await this.validateListingFields({
      dto,
      fileOwnerTenantId: platformId,
      fallbackName: user.fullName,
      fallbackPhone: user.phone,
    });

    const created = await this.prisma.$transaction(async (tx) => {
      const code = usedCarCode(await reserveNumbers(tx, platformId, 'used_car'));
      const row = await tx.usedCarListing.create({
        data: {
          code,
          sellerType: 'OWNER',
          sellerUserId: userId,
          vehicleId: dto.vehicleId ?? null,
          title: dto.title,
          plateNo,
          vin: dto.vin?.toUpperCase() ?? null,
          make: dto.make,
          model: dto.model,
          year: dto.year,
          mileageKm: dto.mileageKm,
          bodyStyle: dto.bodyStyle,
          transmission: dto.transmission,
          fuel: dto.fuel,
          exteriorColor: dto.exteriorColor ?? null,
          seats: dto.seats,
          ownersCount: dto.ownersCount,
          price: BigInt(dto.price),
          negotiable: dto.negotiable,
          province: dto.province,
          addressText: dto.addressText ?? null,
          contactName,
          contactPhone,
          description: dto.description ?? null,
          imageFileIds: dto.imageFileIds,
          docFileIds: dto.docFileIds,
          status: 'NHAP',
          searchText: searchKey(code, dto.title, dto.make, dto.model, String(dto.year), dto.province, dto.bodyStyle),
        },
      });
      await this.audit.log(
        { tenantId: platformId, actorId: userId, action: 'used_car.owner_created', entity: 'used_car_listing', entityId: row.id, after: { code, price: dto.price }, ip },
        tx,
      );
      return row;
    });
    return this.listingView(created, 'PRIVILEGED');
  }

  private async loadOwnerListing(userId: string, id: string) {
    await expireStaleUsedCars(this.prisma);
    const row = await this.prisma.usedCarListing.findFirst({ where: { id, sellerUserId: userId, sellerType: 'OWNER' } });
    if (!row) throw new NotFoundException('Không tìm thấy tin bán xe của bạn');
    return row;
  }

  async ownerUpdateListing(userId: string, id: string, dto: UsedCarListingDto, ip?: string) {
    const cur = await this.loadOwnerListing(userId, id);
    if (cur.status === 'BI_GO' || cur.status === 'DA_BAN') {
      throw new ConflictException('Tin đã bán hoặc bị gỡ, không chỉnh sửa được');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true, phone: true } });
    const platformId = await this.platformTenantId();
    const { plateNo, contactName, contactPhone } = await this.validateListingFields({
      dto,
      fileOwnerTenantId: platformId,
      fallbackName: user.fullName,
      fallbackPhone: user.phone,
    });

    const important =
      dto.title !== cur.title ||
      dto.make !== cur.make ||
      dto.model !== cur.model ||
      dto.year !== cur.year ||
      (plateNo ?? null) !== cur.plateNo ||
      (dto.vin?.toUpperCase() ?? null) !== cur.vin ||
      (dto.description ?? null) !== cur.description ||
      dto.imageFileIds.join() !== cur.imageFileIds.join() ||
      dto.docFileIds.join() !== cur.docFileIds.join();
    const nextStatus = usedCarStatusAfterEdit(cur.status as UsedCarListingStatus, important);

    const saved = await this.prisma.usedCarListing.update({
      where: { id },
      data: {
        vehicleId: dto.vehicleId ?? null,
        title: dto.title,
        plateNo,
        vin: dto.vin?.toUpperCase() ?? null,
        make: dto.make,
        model: dto.model,
        year: dto.year,
        mileageKm: dto.mileageKm,
        bodyStyle: dto.bodyStyle,
        transmission: dto.transmission,
        fuel: dto.fuel,
        exteriorColor: dto.exteriorColor ?? null,
        seats: dto.seats,
        ownersCount: dto.ownersCount,
        price: BigInt(dto.price),
        negotiable: dto.negotiable,
        province: dto.province,
        addressText: dto.addressText ?? null,
        contactName,
        contactPhone,
        description: dto.description ?? null,
        imageFileIds: dto.imageFileIds,
        docFileIds: dto.docFileIds,
        status: nextStatus,
        ...(nextStatus === 'CHO_DUYET' && cur.status !== 'CHO_DUYET' ? { submittedAt: new Date(), reviewNote: null } : {}),
        searchText: searchKey(cur.code, dto.title, dto.make, dto.model, String(dto.year), dto.province, dto.bodyStyle),
      },
    });
    await this.audit.log({
      tenantId: platformId,
      actorId: userId,
      action: 'used_car.owner_updated',
      entity: 'used_car_listing',
      entityId: id,
      before: { status: cur.status, price: n(cur.price) },
      after: { status: nextStatus, price: dto.price },
      ip,
    });
    return this.listingView(saved, 'PRIVILEGED');
  }

  private async changeListingLifecycle(
    row: Prisma.UsedCarListingGetPayload<object>,
    action: 'submit' | 'hide' | 'show' | 'sold' | 'renew',
    actorId: string,
    auditTenantId: string,
    ip?: string,
  ) {
    const cur = row.status as UsedCarListingStatus;
    let data: Prisma.UsedCarListingUpdateInput;

    if (action === 'submit') {
      if (!canSubmitUsedCar(cur)) throw new ConflictException('Chỉ gửi duyệt được tin ở trạng thái Nháp hoặc Bị từ chối');
      data = { status: 'CHO_DUYET', submittedAt: new Date(), reviewNote: null };
    } else if (action === 'hide') {
      if (cur !== 'DANG_BAN') throw new ConflictException('Chỉ tạm ẩn được tin đang đăng bán');
      data = { status: 'TAM_AN' };
    } else if (action === 'show') {
      if (cur !== 'TAM_AN') throw new ConflictException('Chỉ mở lại được tin đang tạm ẩn');
      const expired = row.expiresAt && row.expiresAt.getTime() < Date.now();
      data = { status: expired ? 'HET_HAN' : 'DANG_BAN' };
    } else if (action === 'sold') {
      if (!['DANG_BAN', 'TAM_AN', 'HET_HAN'].includes(cur)) throw new ConflictException('Chỉ đánh dấu Đã bán cho tin đã được duyệt');
      data = { status: 'DA_BAN', soldAt: new Date() };
    } else {
      if (cur !== 'HET_HAN') throw new ConflictException('Chỉ gia hạn được tin đã hết hạn 60 ngày');
      const now = new Date();
      data = { status: 'DANG_BAN', publishedAt: now, expiresAt: computeListingExpiry(now) };
    }

    const saved = await this.prisma.usedCarListing.update({ where: { id: row.id }, data });
    await this.audit.log({
      tenantId: auditTenantId,
      actorId,
      action: `used_car.${action}`,
      entity: 'used_car_listing',
      entityId: row.id,
      before: { status: cur },
      after: { status: saved.status },
      ip,
    });
    return { status: saved.status as UsedCarListingStatus };
  }

  async ownerListingAction(userId: string, id: string, action: 'submit' | 'hide' | 'show' | 'sold' | 'renew', ip?: string) {
    const row = await this.loadOwnerListing(userId, id);
    const platformId = await this.platformTenantId();
    return this.changeListingLifecycle(row, action, userId, platformId, ip);
  }

  async ownerBookAppraisal(userId: string, listingId: string, dto: z.infer<typeof bookAppraisalSchema>, ip?: string) {
    const listing = await this.loadOwnerListing(userId, listingId);
    if (listing.status === 'DA_BAN' || listing.status === 'BI_GO') {
      throw new ConflictException('Tin đã bán hoặc bị gỡ, không đặt kiểm định được');
    }
    if (dto.scheduledAt.getTime() < Date.now() - 15 * 60_000) {
      throw new BadRequestException('Thời điểm hẹn kiểm định đã qua');
    }

    const cfg = await this.prisma.appraisalConfig.findUnique({ where: { tenantId: dto.tenantId } });
    if (!cfg || !cfg.enabled) throw new BadRequestException('Garage này hiện không mở nhận kiểm định xe cũ');
    const tenant = await this.prisma.tenant.findUnique({ where: { id: dto.tenantId } });
    if (!tenant || !tenantListable(tenant)) throw new BadRequestException('Garage này tạm ngừng hoạt động trên sàn');

    const openExists = await this.prisma.usedCarAppraisal.findFirst({
      where: { listingId, status: { in: ['CHO_XAC_NHAN', 'DA_HEN', 'DANG_KIEM_DINH'] } },
      select: { code: true },
    });
    if (openExists) {
      throw new ConflictException(`Tin này đang có phiếu kiểm định ${openExists.code} chưa kết thúc.`);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const code = appraisalCode(await reserveNumbers(tx, dto.tenantId, 'appraisal'));
      const ap = await tx.usedCarAppraisal.create({
        data: {
          code,
          listingId,
          tenantId: dto.tenantId,
          branchId: cfg.branchId,
          requestedByUserId: userId,
          scheduledAt: dto.scheduledAt,
          quotedFee: cfg.fee,
          status: 'CHO_XAC_NHAN',
          checklist: buildDefaultChecklist() as unknown as Prisma.InputJsonValue,
          customerNote: dto.note ?? null,
        },
      });
      await this.audit.log(
        {
          tenantId: dto.tenantId,
          actorId: userId,
          action: 'used_car_appraisal.booked',
          entity: 'used_car_appraisal',
          entityId: ap.id,
          after: { code, listingCode: listing.code, quotedFee: n(cfg.fee) },
          ip,
        },
        tx,
      );
      return ap;
    });
    return this.appraisalReportView(created);
  }

  async ownerCancelAppraisal(userId: string, appraisalId: string, reason?: string | null, ip?: string) {
    const ap = await this.prisma.usedCarAppraisal.findUnique({
      where: { id: appraisalId },
      include: { listing: true },
    });
    if (!ap || ap.listing.sellerUserId !== userId) throw new NotFoundException('Không tìm thấy phiếu kiểm định');
    const err = appraisalTransitionError(ap.status as UsedCarAppraisalStatus, 'HUY');
    if (err) throw new ConflictException(err);

    await this.prisma.usedCarAppraisal.update({
      where: { id: appraisalId },
      data: { status: 'HUY', rejectReason: reason?.trim() || 'Chủ xe tự huỷ lịch kiểm định' },
    });
    await this.audit.log({
      tenantId: ap.tenantId,
      actorId: userId,
      action: 'used_car_appraisal.cancelled_by_owner',
      entity: 'used_car_appraisal',
      entityId: appraisalId,
      before: { status: ap.status },
      after: { status: 'HUY' },
      ip,
    });
    return { status: 'HUY' as UsedCarAppraisalStatus };
  }

  async ownerSavedListings(userId: string) {
    await expireStaleUsedCars(this.prisma);
    const saves = await this.prisma.usedCarSave.findMany({
      where: { userId, listing: { status: 'DANG_BAN' } },
      include: { listing: true },
      orderBy: { createdAt: 'desc' },
    });
    const savedSet = new Set(saves.map((s) => s.listingId));
    return Promise.all(saves.map((s) => this.listingView(s.listing, 'PUBLIC', { savedIds: savedSet })));
  }

  async ownerToggleSave(userId: string, listingId: string) {
    const listing = await this.prisma.usedCarListing.findUnique({ where: { id: listingId }, select: { id: true } });
    if (!listing) throw new NotFoundException('Không tìm thấy tin bán xe');
    const existing = await this.prisma.usedCarSave.findUnique({ where: { userId_listingId: { userId, listingId } } });
    if (existing) {
      await this.prisma.usedCarSave.delete({ where: { userId_listingId: { userId, listingId } } });
      return { saved: false };
    }
    await this.prisma.usedCarSave.create({ data: { userId, listingId } });
    return { saved: true };
  }

  async ownerCreateInquiry(userId: string, listingId: string, dto: z.infer<typeof ownerInquirySchema>, ip?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true, phone: true } });
    return this.createInquiryInternal({
      listingId,
      buyerUserId: userId,
      buyerName: user.fullName,
      buyerPhone: user.phone,
      message: dto.message,
      viewingAt: dto.viewingAt ?? null,
      ip,
    });
  }

  async ownerListThreads(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true } });
    const rows = await this.prisma.usedCarThread.findMany({
      where: {
        OR: [{ buyerUserId: userId }, { buyerPhone: user.phone }, { listing: { sellerUserId: userId, sellerType: 'OWNER' } }],
      },
      include: { listing: true, messages: true },
      orderBy: { lastMessageAt: 'desc' },
      take: 50,
    });
    return Promise.all(
      rows.map(async (r) => ({
        ...(await this.threadView(r)),
        myRole: r.listing.sellerUserId === userId && r.listing.sellerType === 'OWNER' ? 'SELLER' : 'BUYER',
      })),
    );
  }

  private async loadOwnerThread(userId: string, threadId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true, phone: true } });
    const row = await this.prisma.usedCarThread.findUnique({
      where: { id: threadId },
      include: { listing: true, messages: true },
    });
    if (!row) throw new NotFoundException('Không tìm thấy hội thoại');
    const isSeller = row.listing.sellerType === 'OWNER' && row.listing.sellerUserId === userId;
    const isBuyer = row.buyerUserId === userId || row.buyerPhone === user.phone;
    if (!isSeller && !isBuyer) throw new ForbiddenException('Bạn không thuộc hội thoại này');
    return { row, user, role: isSeller ? ('SELLER' as const) : ('BUYER' as const) };
  }

  async ownerGetThread(userId: string, threadId: string) {
    const { row, role } = await this.loadOwnerThread(userId, threadId);
    return { ...(await this.threadView(row)), myRole: role };
  }

  async ownerPostMessage(userId: string, threadId: string, dto: z.infer<typeof authMessageSchema>) {
    const { row, user, role } = await this.loadOwnerThread(userId, threadId);
    await this.prisma.$transaction([
      this.prisma.usedCarMessage.create({
        data: { threadId, senderRole: role, senderName: user.fullName, content: dto.content },
      }),
      this.prisma.usedCarThread.update({
        where: { id: threadId },
        data: {
          lastMessageAt: new Date(),
          ...(role === 'BUYER' && dto.viewingAt ? { viewingAt: dto.viewingAt, viewingStatus: 'CHO_XAC_NHAN' } : {}),
        },
      }),
    ]);
    const refreshed = await this.prisma.usedCarThread.findUniqueOrThrow({
      where: { id: threadId },
      include: { listing: true, messages: true },
    });
    return { ...(await this.threadView(refreshed)), myRole: role, prevCount: row.messages.length };
  }

  async ownerUpdateViewing(userId: string, threadId: string, dto: z.infer<typeof viewingDecisionSchema>) {
    const { row, user, role } = await this.loadOwnerThread(userId, threadId);
    if (role !== 'SELLER') throw new ForbiddenException('Chỉ người bán mới xác nhận lịch hẹn xem xe');
    const msgText =
      dto.status === 'DA_XAC_NHAN'
        ? `Đã xác nhận lịch hẹn xem xe${dto.note ? `: ${dto.note}` : ''}`
        : `Từ chối lịch hẹn xem xe${dto.note ? `: ${dto.note}` : ''}`;

    await this.prisma.$transaction([
      this.prisma.usedCarThread.update({
        where: { id: threadId },
        data: {
          viewingStatus: dto.status,
          ...(dto.viewingAt ? { viewingAt: dto.viewingAt } : {}),
          lastMessageAt: new Date(),
        },
      }),
      this.prisma.usedCarMessage.create({
        data: { threadId, senderRole: 'SELLER', senderName: user.fullName, content: msgText },
      }),
    ]);
    return this.ownerGetThread(userId, row.id);
  }

  // ---------------- Garage PLG & Đối tác (/xe-cu A3.61, /doi-tac/kiem-dinh A7.23) ----------------

  private branchWhereForTenant(
    a: Access,
    branchId?: string,
  ): { branchId?: string; OR?: ({ branchId: { in: string[] } } | { branchId: null })[] } {
    if (a.tenantType !== 'GARAGE') return {};
    if (branchId) {
      if (!AccessService.canAccessBranch(a, branchId)) throw new ForbiddenException('Bạn không làm việc ở chi nhánh này');
      return { branchId };
    }
    if (a.branchIds === 'ALL') return {};
    return { OR: [{ branchId: { in: a.branchIds } }, { branchId: null }] };
  }

  async getGarageConfig(a: Access) {
    assertUsedCarView(a);
    const [cfg, branches, techs] = await Promise.all([
      this.prisma.appraisalConfig.findUnique({ where: { tenantId: a.tenantId } }),
      this.prisma.branch.findMany({
        where: { tenantId: a.tenantId, deletedAt: null },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, name: true },
      }),
      a.tenantType === 'GARAGE'
        ? this.prisma.membership.findMany({
            where: {
              tenantId: a.tenantId,
              status: 'ACTIVE',
              roles: { some: { role: { code: { in: ['KTV', 'QL', 'CG'] } } } },
            },
            include: { user: { select: { fullName: true, phone: true } }, roles: { include: { role: { select: { code: true } } } } },
          })
        : Promise.resolve([]),
    ]);

    return {
      enabled: cfg?.enabled ?? false,
      fee: n(cfg?.fee) ?? 500_000,
      branchId: cfg?.branchId ?? null,
      note: cfg?.note ?? null,
      branches: branches.filter((b) => a.branchIds === 'ALL' || a.branchIds.includes(b.id)),
      technicians: techs.map((m) => ({
        membershipId: m.id,
        fullName: m.user.fullName,
        phone: m.user.phone,
        roles: m.roles.map((r) => r.role.code),
      })),
    };
  }

  async saveGarageConfig(a: Access, dto: z.infer<typeof appraisalConfigSchema>, ip?: string) {
    assertUsedCarManage(a);
    let branchId: string | null = null;
    if (a.tenantType === 'GARAGE' && dto.branchId) {
      if (!AccessService.canAccessBranch(a, dto.branchId)) throw new ForbiddenException('Bạn không làm việc ở chi nhánh này');
      const b = await this.prisma.branch.findFirst({ where: { id: dto.branchId, tenantId: a.tenantId, deletedAt: null } });
      if (!b) throw new BadRequestException('Chi nhánh không hợp lệ');
      branchId = b.id;
    }
    const data = {
      enabled: dto.enabled,
      fee: BigInt(dto.fee),
      branchId,
      note: dto.note ?? null,
    };
    await this.prisma.appraisalConfig.upsert({
      where: { tenantId: a.tenantId },
      create: { tenantId: a.tenantId, ...data },
      update: data,
    });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'appraisal_config.saved',
      entity: 'appraisal_config',
      entityId: a.tenantId,
      after: { enabled: dto.enabled, fee: dto.fee, branchId },
      ip,
    });
    return this.getGarageConfig(a);
  }

  async listGarageListings(a: Access, q: { status?: string; branchId?: string; q?: string }) {
    assertUsedCarView(a);
    await expireStaleUsedCars(this.prisma);
    const bWhere = this.branchWhereForTenant(a, q.branchId);
    const where: Prisma.UsedCarListingWhereInput = {
      sellerTenantId: a.tenantId,
      ...bWhere,
      ...(q.status && q.status !== 'ALL' ? { status: q.status as UsedCarListingStatus } : {}),
      ...(q.q?.trim() ? { searchText: { contains: searchKey(q.q) } } : {}),
    };
    const rows = await this.prisma.usedCarListing.findMany({
      where,
      include: { appraisals: { orderBy: { createdAt: 'desc' } } },
      orderBy: { updatedAt: 'desc' },
      take: 150,
    });
    return Promise.all(
      rows.map(async (r) => ({
        ...(await this.listingView(r, 'PRIVILEGED')),
        appraisals: await Promise.all(r.appraisals.map((ap) => this.appraisalReportView(ap))),
      })),
    );
  }

  private async resolveGarageBranch(a: Access, requestedBranchId?: string | null) {
    if (a.tenantType !== 'GARAGE') return null;
    if (requestedBranchId) {
      if (!AccessService.canAccessBranch(a, requestedBranchId)) throw new ForbiddenException('Bạn không làm việc ở chi nhánh này');
      const b = await this.prisma.branch.findFirst({ where: { id: requestedBranchId, tenantId: a.tenantId, deletedAt: null } });
      if (!b) throw new BadRequestException('Chi nhánh không hợp lệ');
      return b.id;
    }
    const first = await this.prisma.branch.findFirst({
      where: { tenantId: a.tenantId, deletedAt: null, ...(a.branchIds === 'ALL' ? {} : { id: { in: a.branchIds } }) },
      orderBy: { code: 'asc' },
    });
    return first?.id ?? null;
  }

  async createGarageListing(a: Access, dto: UsedCarListingDto, ip?: string) {
    assertUsedCarManage(a);
    const [tenant, shop, user, platformId, branchId] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: a.tenantId } }),
      this.prisma.shop.findUnique({ where: { tenantId: a.tenantId } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: a.userId }, select: { phone: true } }),
      this.platformTenantId(),
      this.resolveGarageBranch(a, dto.branchId),
    ]);
    const { plateNo, contactName, contactPhone } = await this.validateListingFields({
      dto,
      fileOwnerTenantId: a.tenantId,
      fallbackName: shop?.name ?? tenant.name,
      fallbackPhone: shop?.phone ?? user.phone,
    });

    const created = await this.prisma.$transaction(async (tx) => {
      const code = usedCarCode(await reserveNumbers(tx, platformId, 'used_car'));
      const row = await tx.usedCarListing.create({
        data: {
          code,
          sellerType: 'GARAGE',
          sellerUserId: a.userId,
          sellerTenantId: a.tenantId,
          branchId,
          vehicleId: dto.vehicleId ?? null,
          title: dto.title,
          plateNo,
          vin: dto.vin?.toUpperCase() ?? null,
          make: dto.make,
          model: dto.model,
          year: dto.year,
          mileageKm: dto.mileageKm,
          bodyStyle: dto.bodyStyle,
          transmission: dto.transmission,
          fuel: dto.fuel,
          exteriorColor: dto.exteriorColor ?? null,
          seats: dto.seats,
          ownersCount: dto.ownersCount,
          price: BigInt(dto.price),
          negotiable: dto.negotiable,
          province: dto.province,
          addressText: dto.addressText ?? shop?.address ?? null,
          contactName,
          contactPhone,
          description: dto.description ?? null,
          imageFileIds: dto.imageFileIds,
          docFileIds: dto.docFileIds,
          status: 'NHAP',
          searchText: searchKey(code, dto.title, dto.make, dto.model, String(dto.year), dto.province, dto.bodyStyle),
        },
      });
      await this.audit.log(
        { tenantId: a.tenantId, actorId: a.userId, action: 'used_car.garage_created', entity: 'used_car_listing', entityId: row.id, after: { code, price: dto.price }, ip },
        tx,
      );
      return row;
    });
    return this.listingView(created, 'PRIVILEGED');
  }

  private async loadOwnGarageListing(a: Access, id: string) {
    await expireStaleUsedCars(this.prisma);
    const row = await this.prisma.usedCarListing.findFirst({ where: { id, sellerTenantId: a.tenantId } });
    if (!row) throw new NotFoundException('Không tìm thấy tin bán xe của garage');
    if (a.tenantType === 'GARAGE' && row.branchId && !AccessService.canAccessBranch(a, row.branchId)) {
      throw new ForbiddenException('Tin bán xe thuộc chi nhánh khác');
    }
    return row;
  }

  async updateGarageListing(a: Access, id: string, dto: UsedCarListingDto, ip?: string) {
    assertUsedCarManage(a);
    const cur = await this.loadOwnGarageListing(a, id);
    if (cur.status === 'BI_GO' || cur.status === 'DA_BAN') {
      throw new ConflictException('Tin đã bán hoặc bị gỡ, không chỉnh sửa được');
    }
    const [tenant, shop, user, branchId] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: a.tenantId } }),
      this.prisma.shop.findUnique({ where: { tenantId: a.tenantId } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: a.userId }, select: { phone: true } }),
      this.resolveGarageBranch(a, dto.branchId ?? cur.branchId),
    ]);
    const { plateNo, contactName, contactPhone } = await this.validateListingFields({
      dto,
      fileOwnerTenantId: a.tenantId,
      fallbackName: shop?.name ?? tenant.name,
      fallbackPhone: shop?.phone ?? user.phone,
    });

    const important =
      dto.title !== cur.title ||
      dto.make !== cur.make ||
      dto.model !== cur.model ||
      dto.year !== cur.year ||
      (plateNo ?? null) !== cur.plateNo ||
      (dto.vin?.toUpperCase() ?? null) !== cur.vin ||
      (dto.description ?? null) !== cur.description ||
      dto.imageFileIds.join() !== cur.imageFileIds.join() ||
      dto.docFileIds.join() !== cur.docFileIds.join();
    const nextStatus = usedCarStatusAfterEdit(cur.status as UsedCarListingStatus, important);

    const saved = await this.prisma.usedCarListing.update({
      where: { id },
      data: {
        branchId,
        title: dto.title,
        plateNo,
        vin: dto.vin?.toUpperCase() ?? null,
        make: dto.make,
        model: dto.model,
        year: dto.year,
        mileageKm: dto.mileageKm,
        bodyStyle: dto.bodyStyle,
        transmission: dto.transmission,
        fuel: dto.fuel,
        exteriorColor: dto.exteriorColor ?? null,
        seats: dto.seats,
        ownersCount: dto.ownersCount,
        price: BigInt(dto.price),
        negotiable: dto.negotiable,
        province: dto.province,
        addressText: dto.addressText ?? null,
        contactName,
        contactPhone,
        description: dto.description ?? null,
        imageFileIds: dto.imageFileIds,
        docFileIds: dto.docFileIds,
        status: nextStatus,
        ...(nextStatus === 'CHO_DUYET' && cur.status !== 'CHO_DUYET' ? { submittedAt: new Date(), reviewNote: null } : {}),
        searchText: searchKey(cur.code, dto.title, dto.make, dto.model, String(dto.year), dto.province, dto.bodyStyle),
      },
    });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'used_car.garage_updated',
      entity: 'used_car_listing',
      entityId: id,
      before: { status: cur.status, price: n(cur.price) },
      after: { status: nextStatus, price: dto.price },
      ip,
    });
    return this.listingView(saved, 'PRIVILEGED');
  }

  async garageListingAction(a: Access, id: string, action: 'submit' | 'hide' | 'show' | 'sold' | 'renew', ip?: string) {
    assertUsedCarManage(a);
    const row = await this.loadOwnGarageListing(a, id);
    return this.changeListingLifecycle(row, action, a.userId, a.tenantId, ip);
  }

  /** Garage tạo phiếu kiểm định nội bộ (phí 0đ) cho chính tin bán xe cũ của mình để chấm checklist & gắn huy hiệu */
  async createSelfAppraisal(a: Access, listingId: string, ip?: string) {
    assertUsedCarManage(a);
    const listing = await this.loadOwnGarageListing(a, listingId);
    const open = await this.prisma.usedCarAppraisal.findFirst({
      where: { listingId, status: { in: ['CHO_XAC_NHAN', 'DA_HEN', 'DANG_KIEM_DINH'] } },
    });
    if (open) throw new ConflictException(`Tin này đang có phiếu kiểm định ${open.code} chưa kết thúc`);

    const created = await this.prisma.$transaction(async (tx) => {
      const code = appraisalCode(await reserveNumbers(tx, a.tenantId, 'appraisal'));
      const ap = await tx.usedCarAppraisal.create({
        data: {
          code,
          listingId,
          tenantId: a.tenantId,
          branchId: listing.branchId,
          requestedByUserId: a.userId,
          scheduledAt: new Date(),
          quotedFee: 0n,
          status: 'DA_HEN',
          checklist: buildDefaultChecklist() as unknown as Prisma.InputJsonValue,
          customerNote: 'Kiểm định xe bán tại garage',
        },
      });
      await this.audit.log(
        { tenantId: a.tenantId, actorId: a.userId, action: 'used_car_appraisal.self_created', entity: 'used_car_appraisal', entityId: ap.id, after: { code }, ip },
        tx,
      );
      return ap;
    });
    return this.appraisalReportView(created);
  }

  // ---------------- Xử lý phiếu kiểm định tại garage (A7.23, A3.61) ----------------

  async listGarageAppraisals(a: Access, q: { status?: string; branchId?: string; q?: string }) {
    assertUsedCarView(a);
    const bWhere = this.branchWhereForTenant(a, q.branchId);
    const isTechOnly = a.tenantType === 'GARAGE' && !a.permissions.includes('used_car.manage');

    const where: Prisma.UsedCarAppraisalWhereInput = {
      tenantId: a.tenantId,
      ...bWhere,
      ...(isTechOnly ? { OR: [{ assignedMemberId: a.membershipId }, { assignedMemberId: null }] } : {}),
    };
    if (q.status === 'OPEN') {
      where.status = { in: ['CHO_XAC_NHAN', 'DA_HEN', 'DANG_KIEM_DINH'] };
    } else if (q.status === 'DONE') {
      where.status = { in: ['HOAN_THANH', 'TU_CHOI', 'HUY'] };
    } else if (q.status && q.status !== 'ALL') {
      where.status = q.status as UsedCarAppraisalStatus;
    }
    if (q.q?.trim()) {
      const s = q.q.trim();
      where.AND = [
        {
          OR: [
            { code: { contains: s.toUpperCase() } },
            { listing: { code: { contains: s.toUpperCase() } } },
            { listing: { title: { contains: s, mode: 'insensitive' } } },
            { listing: { contactPhone: { contains: s.replace(/\D/g, '') || s } } },
          ],
        },
      ];
    }

    const [rows, counts] = await Promise.all([
      this.prisma.usedCarAppraisal.findMany({
        where,
        include: { listing: true },
        orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }],
        take: 150,
      }),
      this.prisma.usedCarAppraisal.groupBy({ by: ['status'], where: { tenantId: a.tenantId, ...bWhere }, _count: true }),
    ]);

    const items = await Promise.all(
      rows.map(async (r) => ({
        ...(await this.appraisalReportView(r)),
        listing: await this.listingView(r.listing, 'PRIVILEGED'),
      })),
    );

    return {
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
      items,
    };
  }

  private async loadAppraisalForGarage(tx: Prisma.TransactionClient, a: Access, id: string) {
    await tx.$queryRaw`SELECT id FROM used_car_appraisals WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.usedCarAppraisal.findFirst({
      where: { id, tenantId: a.tenantId },
      include: { listing: true },
    });
    if (!row) throw new NotFoundException('Không tìm thấy phiếu kiểm định');
    if (a.tenantType === 'GARAGE' && row.branchId && !AccessService.canAccessBranch(a, row.branchId)) {
      throw new ForbiddenException('Phiếu kiểm định thuộc chi nhánh khác');
    }
    const isTechOnly = a.tenantType === 'GARAGE' && !a.permissions.includes('used_car.manage');
    if (isTechOnly && row.assignedMemberId && row.assignedMemberId !== a.membershipId) {
      throw new ForbiddenException('Phiếu kiểm định này đang giao cho kỹ thuật viên khác');
    }
    return row;
  }

  async confirmAppraisal(a: Access, id: string, dto: z.infer<typeof confirmAppraisalSchema>, ip?: string) {
    assertUsedCarManage(a);
    let branchId: string | undefined;
    if (a.tenantType === 'GARAGE' && dto.branchId) {
      if (!AccessService.canAccessBranch(a, dto.branchId)) throw new ForbiddenException('Bạn không làm việc ở chi nhánh này');
      branchId = dto.branchId;
    }
    if (dto.assignedMemberId && a.tenantType === 'GARAGE') {
      const m = await this.prisma.membership.findFirst({ where: { id: dto.assignedMemberId, tenantId: a.tenantId, status: 'ACTIVE' } });
      if (!m) throw new BadRequestException('Kỹ thuật viên phân công không hợp lệ');
    }

    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await this.loadAppraisalForGarage(tx, a, id);
      const err = appraisalTransitionError(row.status as UsedCarAppraisalStatus, 'DA_HEN');
      if (err && row.status !== 'DA_HEN') throw new ConflictException(err);

      const upd = await tx.usedCarAppraisal.update({
        where: { id },
        data: {
          status: 'DA_HEN',
          ...(dto.scheduledAt ? { scheduledAt: dto.scheduledAt } : {}),
          ...(dto.assignedMemberId !== undefined ? { assignedMemberId: dto.assignedMemberId } : {}),
          ...(branchId !== undefined ? { branchId } : {}),
        },
      });
      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'used_car_appraisal.confirmed',
          entity: 'used_car_appraisal',
          entityId: id,
          after: { status: 'DA_HEN', assignedMemberId: upd.assignedMemberId },
          ip,
        },
        tx,
      );
      return upd;
    });
    return this.appraisalReportView(saved);
  }

  async rejectAppraisal(a: Access, id: string, reason: string, ip?: string) {
    assertUsedCarManage(a);
    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await this.loadAppraisalForGarage(tx, a, id);
      const err = appraisalTransitionError(row.status as UsedCarAppraisalStatus, 'TU_CHOI');
      if (err) throw new ConflictException(err);
      const upd = await tx.usedCarAppraisal.update({
        where: { id },
        data: { status: 'TU_CHOI', rejectReason: reason },
      });
      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'used_car_appraisal.rejected',
          entity: 'used_car_appraisal',
          entityId: id,
          after: { status: 'TU_CHOI', reason },
          ip,
        },
        tx,
      );
      return upd;
    });
    return this.appraisalReportView(saved);
  }

  async saveDraftChecklist(a: Access, id: string, dto: z.infer<typeof gradeAppraisalSchema>, ip?: string) {
    assertUsedCarAppraise(a);
    for (const fid of dto.reportImageIds) await this.files.assertOwnedImage(fid, a.tenantId);

    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await this.loadAppraisalForGarage(tx, a, id);
      if (!['CHO_XAC_NHAN', 'DA_HEN', 'DANG_KIEM_DINH'].includes(row.status)) {
        throw new ConflictException('Phiếu kiểm định đã kết thúc, không sửa checklist được nữa');
      }
      const normalized = normalizeChecklist(dto.checklist);
      const evalRes = evaluateAppraisalChecklist(normalized, {
        noMajorAccident: dto.noMajorAccident,
        noFloodDamage: dto.noFloodDamage,
        validDocuments: dto.validDocuments,
      });

      const upd = await tx.usedCarAppraisal.update({
        where: { id },
        data: {
          status: 'DANG_KIEM_DINH',
          checklist: normalized as unknown as Prisma.InputJsonValue,
          noMajorAccident: dto.noMajorAccident,
          noFloodDamage: dto.noFloodDamage,
          validDocuments: dto.validDocuments,
          inspectedMileageKm: dto.inspectedMileageKm ?? row.listing.mileageKm,
          score: evalRes.score,
          grade: evalRes.grade,
          summary: dto.summary ?? null,
          reportImageIds: [...new Set(dto.reportImageIds)],
        },
      });
      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'used_car_appraisal.draft_saved',
          entity: 'used_car_appraisal',
          entityId: id,
          after: { status: 'DANG_KIEM_DINH', score: evalRes.score, grade: evalRes.grade },
          ip,
        },
        tx,
      );
      return upd;
    });
    return this.appraisalReportView(saved);
  }

  /**
   * Hoàn tất chấm kiểm định xe cũ -> xuất báo cáo gắn lên tin (huy hiệu Đã kiểm định nếu DAT_CHUAN).
   * Với PLG (GARAGE): nếu có thu phí kiểm định (finalFee > 0), tự ghi phiếu thu sổ quỹ PT… (THU_KIEM_DINH).
   */
  async completeAppraisal(a: Access, id: string, dto: z.infer<typeof gradeAppraisalSchema>, ip?: string) {
    assertUsedCarAppraise(a);
    for (const fid of dto.reportImageIds) await this.files.assertOwnedImage(fid, a.tenantId);

    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await this.loadAppraisalForGarage(tx, a, id);
      if (!['DA_HEN', 'DANG_KIEM_DINH', 'CHO_XAC_NHAN'].includes(row.status)) {
        throw new ConflictException('Phiếu kiểm định đã kết thúc');
      }

      const normalized = normalizeChecklist(dto.checklist);
      const evalRes = evaluateAppraisalChecklist(normalized, {
        noMajorAccident: dto.noMajorAccident,
        noFloodDamage: dto.noFloodDamage,
        validDocuments: dto.validDocuments,
      });

      const finalFee = dto.finalFee != null ? dto.finalFee : n(row.quotedFee)!;
      let cashEntryId = row.cashEntryId;

      if (a.tenantType === 'GARAGE' && !cashEntryId && finalFee > 0) {
        let entryBranchId = row.branchId;
        if (!entryBranchId) {
          const b = await tx.branch.findFirst({
            where: { tenantId: a.tenantId, deletedAt: null, ...(a.branchIds === 'ALL' ? {} : { id: { in: a.branchIds } }) },
            orderBy: { code: 'asc' },
          });
          entryBranchId = b?.id ?? null;
        }
        if (entryBranchId) {
          const ptCode = `PT${String(await reserveNumbers(tx, a.tenantId, 'cash.THU')).padStart(6, '0')}`;
          const entry = await tx.cashEntry.create({
            data: {
              tenantId: a.tenantId,
              branchId: entryBranchId,
              code: ptCode,
              type: 'THU',
              category: 'THU_KIEM_DINH',
              amount: BigInt(finalFee),
              method: dto.paymentMethod as PaymentMethod,
              counterparty: row.listing.contactName,
              note: `Thu phí kiểm định xe cũ ${row.code} (${row.listing.code})`,
              createdBy: a.userId,
            },
          });
          cashEntryId = entry.id;
        }
      }

      const upd = await tx.usedCarAppraisal.update({
        where: { id },
        data: {
          status: 'HOAN_THANH',
          checklist: normalized as unknown as Prisma.InputJsonValue,
          noMajorAccident: dto.noMajorAccident,
          noFloodDamage: dto.noFloodDamage,
          validDocuments: dto.validDocuments,
          inspectedMileageKm: dto.inspectedMileageKm ?? row.listing.mileageKm,
          score: evalRes.score,
          grade: evalRes.grade,
          summary: dto.summary ?? null,
          reportImageIds: [...new Set(dto.reportImageIds)],
          finalFee: BigInt(finalFee),
          paymentMethod: dto.paymentMethod as PaymentMethod,
          cashEntryId,
          completedAt: new Date(),
          completedBy: a.userId,
        },
      });

      // Gắn báo cáo kiểm định vào tin xe cũ; cấp huy hiệu Đã kiểm định nếu đạt chuẩn (F8)
      await tx.usedCarListing.update({
        where: { id: row.listingId },
        data: {
          verifiedAppraisalId: upd.id,
          hasVerifiedBadge: evalRes.earnsVerifiedBadge,
          ...(dto.inspectedMileageKm != null ? { mileageKm: dto.inspectedMileageKm } : {}),
        },
      });

      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'used_car_appraisal.completed',
          entity: 'used_car_appraisal',
          entityId: id,
          before: { status: row.status },
          after: {
            status: 'HOAN_THANH',
            score: evalRes.score,
            grade: evalRes.grade,
            badge: evalRes.earnsVerifiedBadge,
            finalFee,
            cashEntryId,
          },
          ip,
        },
        tx,
      );
      return upd;
    });

    return this.appraisalReportView(saved);
  }

  // ---------------- Tin nhắn & lịch hẹn xem xe phía Garage ----------------

  async listGarageThreads(a: Access, branchId?: string) {
    assertUsedCarManage(a);
    const bWhere = this.branchWhereForTenant(a, branchId);
    const rows = await this.prisma.usedCarThread.findMany({
      where: { listing: { sellerTenantId: a.tenantId, ...bWhere } },
      include: { listing: true, messages: true },
      orderBy: { lastMessageAt: 'desc' },
      take: 80,
    });
    return Promise.all(rows.map((r) => this.threadView(r)));
  }

  private async loadGarageThread(a: Access, threadId: string) {
    assertUsedCarManage(a);
    const row = await this.prisma.usedCarThread.findUnique({
      where: { id: threadId },
      include: { listing: true, messages: true },
    });
    if (!row || row.listing.sellerTenantId !== a.tenantId) throw new NotFoundException('Không tìm thấy cuộc trò chuyện');
    if (a.tenantType === 'GARAGE' && row.listing.branchId && !AccessService.canAccessBranch(a, row.listing.branchId)) {
      throw new ForbiddenException('Cuộc trò chuyện thuộc chi nhánh khác');
    }
    return row;
  }

  async garagePostMessage(a: Access, threadId: string, dto: z.infer<typeof authMessageSchema>) {
    const row = await this.loadGarageThread(a, threadId);
    const shop = await this.prisma.shop.findUnique({ where: { tenantId: a.tenantId }, select: { name: true } });
    const senderName = shop?.name ?? row.listing.contactName;
    await this.prisma.$transaction([
      this.prisma.usedCarMessage.create({
        data: { threadId, senderRole: 'SELLER', senderName, content: dto.content },
      }),
      this.prisma.usedCarThread.update({ where: { id: threadId }, data: { lastMessageAt: new Date() } }),
    ]);
    return this.threadView(await this.loadGarageThread(a, threadId));
  }

  async garageUpdateViewing(a: Access, threadId: string, dto: z.infer<typeof viewingDecisionSchema>) {
    const row = await this.loadGarageThread(a, threadId);
    const shop = await this.prisma.shop.findUnique({ where: { tenantId: a.tenantId }, select: { name: true } });
    const senderName = shop?.name ?? row.listing.contactName;
    const msgText =
      dto.status === 'DA_XAC_NHAN'
        ? `Garage đã xác nhận lịch hẹn xem xe${dto.note ? `: ${dto.note}` : ''}`
        : `Garage từ chối lịch hẹn xem xe${dto.note ? `: ${dto.note}` : ''}`;

    await this.prisma.$transaction([
      this.prisma.usedCarThread.update({
        where: { id: threadId },
        data: {
          viewingStatus: dto.status,
          ...(dto.viewingAt ? { viewingAt: dto.viewingAt } : {}),
          lastMessageAt: new Date(),
        },
      }),
      this.prisma.usedCarMessage.create({
        data: { threadId, senderRole: 'SELLER', senderName, content: msgText },
      }),
    ]);
    return this.threadView(await this.loadGarageThread(a, threadId));
  }

  // ---------------- Admin sàn: Kiểm duyệt tin xe cũ (/san/xe-cu, A6.31) ----------------

  async platformListings(a: Access, q: { status?: string; q?: string }) {
    assertPlatformReviewer(a);
    await expireStaleUsedCars(this.prisma);
    const statusFilter = q.status && q.status !== 'ALL' ? (q.status as UsedCarListingStatus) : 'CHO_DUYET';
    const where: Prisma.UsedCarListingWhereInput = {
      ...(q.status === 'ALL' ? {} : { status: statusFilter }),
      ...(q.q?.trim() ? { searchText: { contains: searchKey(q.q) } } : {}),
    };
    const [rows, counts] = await Promise.all([
      this.prisma.usedCarListing.findMany({ where, orderBy: [{ submittedAt: 'asc' }, { updatedAt: 'desc' }], take: 200 }),
      this.prisma.usedCarListing.groupBy({ by: ['status'], _count: true }),
    ]);

    return {
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
      items: await Promise.all(rows.map((r) => this.listingView(r, 'PRIVILEGED'))),
    };
  }

  async platformModerateListing(a: Access, id: string, to: 'DANG_BAN' | 'BI_TU_CHOI' | 'BI_GO', note: string | null, ip?: string) {
    assertPlatformReviewer(a);
    const l = await this.prisma.usedCarListing.findUnique({ where: { id } });
    if (!l) throw new NotFoundException('Không tìm thấy tin bán xe cũ');
    if ((to === 'DANG_BAN' || to === 'BI_TU_CHOI') && l.status !== 'CHO_DUYET') {
      throw new ConflictException('Tin không ở trạng thái chờ duyệt');
    }
    if (to === 'BI_GO' && !['DANG_BAN', 'TAM_AN'].includes(l.status)) {
      throw new ConflictException('Chỉ gỡ được tin đang đăng bán hoặc tạm ẩn');
    }

    const now = new Date();
    await this.prisma.usedCarListing.update({
      where: { id },
      data: {
        status: to,
        reviewNote: note,
        reviewedBy: a.userId,
        reviewedAt: now,
        ...(to === 'DANG_BAN' ? { publishedAt: now, expiresAt: computeListingExpiry(now) } : {}),
      },
    });

    const action = to === 'DANG_BAN' ? 'used_car.approved' : to === 'BI_TU_CHOI' ? 'used_car.rejected' : 'used_car.taken_down';
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action,
      entity: 'used_car_listing',
      entityId: id,
      before: { status: l.status },
      after: { status: to, note },
      ip,
    });
    return { status: to };
  }

  async platformAppraisals(a: Access, q: { status?: string; q?: string }) {
    assertPlatformReviewer(a);
    const where: Prisma.UsedCarAppraisalWhereInput = {};
    if (q.status && q.status !== 'ALL') where.status = q.status as UsedCarAppraisalStatus;
    if (q.q?.trim()) {
      const s = q.q.trim();
      where.OR = [
        { code: { contains: s.toUpperCase() } },
        { listing: { code: { contains: s.toUpperCase() } } },
        { listing: { title: { contains: s, mode: 'insensitive' } } },
      ];
    }
    const [rows, counts] = await Promise.all([
      this.prisma.usedCarAppraisal.findMany({ where, include: { listing: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.usedCarAppraisal.groupBy({ by: ['status'], _count: true }),
    ]);
    const items = await Promise.all(
      rows.map(async (r) => ({
        ...(await this.appraisalReportView(r)),
        listing: { id: r.listing.id, code: r.listing.code, title: r.listing.title, price: n(r.listing.price)! },
      })),
    );
    return {
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
      items,
    };
  }
}

const tokenOf = (dto: { token: string }) => dto.token;

@Public()
@Controller('public/used-cars')
export class PublicUsedCarsController {
  constructor(private readonly svc: UsedCarsService) {}

  @Get('garages')
  garages(@Query('province') province?: string) {
    return this.svc.publicAppraisalGarages(province);
  }

  @Get()
  list(
    @Query('q') q?: string,
    @Query('province') province?: string,
    @Query('make') make?: string,
    @Query('bodyStyle') bodyStyle?: string,
    @Query('transmission') transmission?: string,
    @Query('fuel') fuel?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('minYear') minYear?: string,
    @Query('verifiedOnly') verifiedOnly?: string,
    @Query('sort') sort?: string,
  ) {
    return this.svc.publicListUsedCars({ q, province, make, bodyStyle, transmission, fuel, minPrice, maxPrice, minYear, verifiedOnly, sort });
  }

  @Get('inquiries/:threadId')
  getInquiry(@Param('threadId', ParseUUIDPipe) threadId: string, @Query(new ZodPipe(tokenQuerySchema)) q: { token: string }) {
    return this.svc.publicGetInquiry(threadId, q.token);
  }

  @Post('inquiries/:threadId/messages')
  postMessage(@Param('threadId', ParseUUIDPipe) threadId: string, @Body(new ZodPipe(publicMessageSchema)) dto: z.infer<typeof publicMessageSchema>) {
    return this.svc.publicPostMessage(threadId, dto);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.publicGetUsedCar(id, clientIp(req));
  }

  @Post(':id/inquiries')
  inquire(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(publicInquirySchema)) dto: z.infer<typeof publicInquirySchema>,
    @Req() req: Request,
  ) {
    return this.svc.publicCreateInquiry(id, dto, clientIp(req));
  }
}

@Public()
@UseGuards(OwnerGuard)
@Controller('owner/used-cars')
export class OwnerUsedCarsController {
  constructor(private readonly svc: UsedCarsService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  upload(@Req() req: OwnerRequest, @UploadedFile() file: Express.Multer.File) {
    return this.svc.ownerUpload(req.owner!.userId, file, clientIp(req));
  }

  @Get('my-vehicles')
  myVehicles(@Req() req: OwnerRequest) {
    return this.svc.ownerMyVehicles(req.owner!.userId);
  }

  @Get('listings')
  listings(@Req() req: OwnerRequest) {
    return this.svc.ownerListMyListings(req.owner!.userId);
  }

  @Post('listings')
  create(@Req() req: OwnerRequest, @Body(new ZodPipe(usedCarListingSchema)) dto: UsedCarListingDto) {
    return this.svc.ownerCreateListing(req.owner!.userId, dto, clientIp(req));
  }

  @Put('listings/:id')
  update(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(usedCarListingSchema)) dto: UsedCarListingDto) {
    return this.svc.ownerUpdateListing(req.owner!.userId, id, dto, clientIp(req));
  }

  @Post('listings/:id/submit')
  @HttpCode(200)
  submit(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.ownerListingAction(req.owner!.userId, id, 'submit', clientIp(req));
  }

  @Post('listings/:id/hide')
  @HttpCode(200)
  hide(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.ownerListingAction(req.owner!.userId, id, 'hide', clientIp(req));
  }

  @Post('listings/:id/show')
  @HttpCode(200)
  show(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.ownerListingAction(req.owner!.userId, id, 'show', clientIp(req));
  }

  @Post('listings/:id/sold')
  @HttpCode(200)
  sold(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.ownerListingAction(req.owner!.userId, id, 'sold', clientIp(req));
  }

  @Post('listings/:id/renew')
  @HttpCode(200)
  renew(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.ownerListingAction(req.owner!.userId, id, 'renew', clientIp(req));
  }

  @Post('listings/:id/appraisals')
  bookAppraisal(
    @Req() req: OwnerRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(bookAppraisalSchema)) dto: z.infer<typeof bookAppraisalSchema>,
  ) {
    return this.svc.ownerBookAppraisal(req.owner!.userId, id, dto, clientIp(req));
  }

  @Post('appraisals/:id/cancel')
  @HttpCode(200)
  cancelAppraisal(
    @Req() req: OwnerRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(z.object({ reason: optText(300) }))) dto: { reason?: string | null },
  ) {
    return this.svc.ownerCancelAppraisal(req.owner!.userId, id, dto.reason, clientIp(req));
  }

  @Get('saves')
  saves(@Req() req: OwnerRequest) {
    return this.svc.ownerSavedListings(req.owner!.userId);
  }

  @Post('saves/:listingId')
  @HttpCode(200)
  toggleSave(@Req() req: OwnerRequest, @Param('listingId', ParseUUIDPipe) listingId: string) {
    return this.svc.ownerToggleSave(req.owner!.userId, listingId);
  }

  @Post('listings/:id/inquiries')
  createInquiry(
    @Req() req: OwnerRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ownerInquirySchema)) dto: z.infer<typeof ownerInquirySchema>,
  ) {
    return this.svc.ownerCreateInquiry(req.owner!.userId, id, dto, clientIp(req));
  }

  @Get('threads')
  threads(@Req() req: OwnerRequest) {
    return this.svc.ownerListThreads(req.owner!.userId);
  }

  @Get('threads/:id')
  thread(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.ownerGetThread(req.owner!.userId, id);
  }

  @Post('threads/:id/messages')
  sendMessage(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(authMessageSchema)) dto: z.infer<typeof authMessageSchema>) {
    return this.svc.ownerPostMessage(req.owner!.userId, id, dto);
  }

  @Post('threads/:id/viewing')
  @HttpCode(200)
  viewing(
    @Req() req: OwnerRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(viewingDecisionSchema)) dto: z.infer<typeof viewingDecisionSchema>,
  ) {
    return this.svc.ownerUpdateViewing(req.owner!.userId, id, dto);
  }
}

@Controller('used-cars')
export class GarageUsedCarsController {
  constructor(private readonly svc: UsedCarsService) {}

  @Get('config')
  config(@CurrentAuth() auth: RequestAuth) {
    return this.svc.getGarageConfig(auth.access);
  }

  @Put('config')
  saveConfig(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(appraisalConfigSchema)) dto: z.infer<typeof appraisalConfigSchema>, @Req() req: Request) {
    return this.svc.saveGarageConfig(auth.access, dto, clientIp(req));
  }

  @Get('listings')
  listings(@CurrentAuth() auth: RequestAuth, @Query('status') status?: string, @Query('branchId') branchId?: string, @Query('q') q?: string) {
    return this.svc.listGarageListings(auth.access, { status, branchId, q });
  }

  @Post('listings')
  createListing(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(usedCarListingSchema)) dto: UsedCarListingDto, @Req() req: Request) {
    return this.svc.createGarageListing(auth.access, dto, clientIp(req));
  }

  @Put('listings/:id')
  updateListing(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(usedCarListingSchema)) dto: UsedCarListingDto,
    @Req() req: Request,
  ) {
    return this.svc.updateGarageListing(auth.access, id, dto, clientIp(req));
  }

  @Post('listings/:id/submit')
  @HttpCode(200)
  submit(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.garageListingAction(auth.access, id, 'submit', clientIp(req));
  }

  @Post('listings/:id/hide')
  @HttpCode(200)
  hide(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.garageListingAction(auth.access, id, 'hide', clientIp(req));
  }

  @Post('listings/:id/show')
  @HttpCode(200)
  show(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.garageListingAction(auth.access, id, 'show', clientIp(req));
  }

  @Post('listings/:id/sold')
  @HttpCode(200)
  sold(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.garageListingAction(auth.access, id, 'sold', clientIp(req));
  }

  @Post('listings/:id/renew')
  @HttpCode(200)
  renew(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.garageListingAction(auth.access, id, 'renew', clientIp(req));
  }

  @Post('listings/:id/self-appraisal')
  selfAppraisal(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.createSelfAppraisal(auth.access, id, clientIp(req));
  }

  @Get('appraisals')
  appraisals(@CurrentAuth() auth: RequestAuth, @Query('status') status?: string, @Query('branchId') branchId?: string, @Query('q') q?: string) {
    return this.svc.listGarageAppraisals(auth.access, { status, branchId, q });
  }

  @Post('appraisals/:id/confirm')
  @HttpCode(200)
  confirm(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(confirmAppraisalSchema)) dto: z.infer<typeof confirmAppraisalSchema>,
    @Req() req: Request,
  ) {
    return this.svc.confirmAppraisal(auth.access, id, dto, clientIp(req));
  }

  @Post('appraisals/:id/reject')
  @HttpCode(200)
  reject(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(rejectReasonSchema)) dto: { reason: string },
    @Req() req: Request,
  ) {
    return this.svc.rejectAppraisal(auth.access, id, dto.reason, clientIp(req));
  }

  @Post('appraisals/:id/save-checklist')
  @HttpCode(200)
  saveChecklist(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(gradeAppraisalSchema)) dto: z.infer<typeof gradeAppraisalSchema>,
    @Req() req: Request,
  ) {
    return this.svc.saveDraftChecklist(auth.access, id, dto, clientIp(req));
  }

  @Post('appraisals/:id/complete')
  @HttpCode(200)
  complete(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(gradeAppraisalSchema)) dto: z.infer<typeof gradeAppraisalSchema>,
    @Req() req: Request,
  ) {
    return this.svc.completeAppraisal(auth.access, id, dto, clientIp(req));
  }

  @Get('threads')
  threads(@CurrentAuth() auth: RequestAuth, @Query('branchId') branchId?: string) {
    return this.svc.listGarageThreads(auth.access, branchId);
  }

  @Post('threads/:id/messages')
  sendMessage(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(authMessageSchema)) dto: z.infer<typeof authMessageSchema>) {
    return this.svc.garagePostMessage(auth.access, id, dto);
  }

  @Post('threads/:id/viewing')
  @HttpCode(200)
  viewing(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(viewingDecisionSchema)) dto: z.infer<typeof viewingDecisionSchema>,
  ) {
    return this.svc.garageUpdateViewing(auth.access, id, dto);
  }
}

@RequirePermissions('platform.partner.review')
@Controller('platform/used-cars')
export class PlatformUsedCarsController {
  constructor(private readonly svc: UsedCarsService) {}

  @Get('listings')
  listings(@CurrentAuth() auth: RequestAuth, @Query('status') status?: string, @Query('q') q?: string) {
    return this.svc.platformListings(auth.access, { status, q });
  }

  @Post('listings/:id/approve')
  @HttpCode(200)
  approve(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.platformModerateListing(auth.access, id, 'DANG_BAN', null, clientIp(req));
  }

  @Post('listings/:id/reject')
  @HttpCode(200)
  reject(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(reviewNoteSchema)) dto: { note: string },
    @Req() req: Request,
  ) {
    return this.svc.platformModerateListing(auth.access, id, 'BI_TU_CHOI', dto.note, clientIp(req));
  }

  @Post('listings/:id/takedown')
  @HttpCode(200)
  takedown(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(reviewNoteSchema)) dto: { note: string },
    @Req() req: Request,
  ) {
    return this.svc.platformModerateListing(auth.access, id, 'BI_GO', dto.note, clientIp(req));
  }

  @Get('appraisals')
  appraisals(@CurrentAuth() auth: RequestAuth, @Query('status') status?: string, @Query('q') q?: string) {
    return this.svc.platformAppraisals(auth.access, { status, q });
  }
}

@Module({
  imports: [FilesModule, OwnerModule],
  controllers: [PublicUsedCarsController, OwnerUsedCarsController, GarageUsedCarsController, PlatformUsedCarsController],
  providers: [UsedCarsService],
  exports: [UsedCarsService],
})
export class UsedCarsModule {}
