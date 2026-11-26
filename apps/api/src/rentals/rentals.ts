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
  UseGuards,
} from '@nestjs/common';
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
  checkRentalPeriod,
  computeSettlement,
  contractTransitionError,
  HOLDING_RENTAL_STATUSES,
  listingStatusAfterEdit,
  listingStatusOnSubmit,
  RENTAL_CONTRACT_TRANSITIONS,
  RENTAL_LISTING_LABEL,
  RENTAL_MAX_ACTIVE_PER_PHONE,
  RENTAL_MAX_HOURLY_PER_IP,
  RENTAL_STATUS_LABEL,
  rentalContractCode,
  rentalVehicleCode,
  suggestOverKmFee,
  type RentalContractStatus,
  type RentalListingStatus,
} from './rental-rules';

type Db = PrismaService | Prisma.TransactionClient;
const n = (b: bigint | number | null | undefined) => (b === null || b === undefined ? null : Number(b));
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const optText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());

const moneySchema = z.coerce.number().int().min(0, 'Số tiền không hợp lệ').max(10_000_000_000);

export const rentalVehicleSchema = z.object({
  title: z.string().trim().min(3, 'Nhập tiêu đề xe cho thuê').max(160),
  plateNo: z.string().trim().min(5, 'Nhập biển số xe').max(20),
  make: z.string().trim().min(1, 'Nhập hãng xe').max(60),
  model: z.string().trim().min(1, 'Nhập dòng xe').max(80),
  year: z.coerce.number().int().min(1995, 'Năm sản xuất không hợp lệ').max(2100),
  seats: z.coerce.number().int().min(2).max(50).default(5),
  transmission: z.enum(['TU_DONG', 'SO_SAN']).default('TU_DONG'),
  fuel: z.enum(['XANG', 'DAU', 'DIEN', 'HYBRID']).default('XANG'),
  ownerType: z.enum(['GARAGE', 'CONSIGN']).default('GARAGE'),
  dailyPrice: z.coerce.number().int().min(50_000, 'Giá thuê ngày tối thiểu 50.000 đ').max(500_000_000),
  deposit: moneySchema,
  kmLimitPerDay: z.coerce.number().int().min(0).max(5000).default(300),
  overKmFee: moneySchema.default(5000),
  branchId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable().optional()),
  province: optText(100),
  pickupAddress: optText(300),
  terms: optText(2000),
  description: optText(3000),
  imageFileIds: z.array(z.string().uuid()).max(8, 'Tối đa 8 ảnh xe').default([]),
});
type RentalVehicleDto = z.infer<typeof rentalVehicleSchema>;

export const publicBookRentalSchema = z.object({
  rentalVehicleId: z.string().uuid('Chọn xe cho thuê'),
  startAt: z.coerce.date({ message: 'Chọn ngày giờ nhận xe' }),
  endAt: z.coerce.date({ message: 'Chọn ngày giờ trả xe' }),
  name: z.string().trim().min(2, 'Nhập họ tên').max(100),
  phone: z.string().trim().min(9, 'Nhập số điện thoại').max(20),
  idCardNo: optText(30),
  driverLicenseNo: optText(40),
  note: optText(500),
});
type PublicBookRentalDto = z.infer<typeof publicBookRentalSchema>;

export const ownerBookRentalSchema = z.object({
  rentalVehicleId: z.string().uuid('Chọn xe cho thuê'),
  startAt: z.coerce.date({ message: 'Chọn ngày giờ nhận xe' }),
  endAt: z.coerce.date({ message: 'Chọn ngày giờ trả xe' }),
  idCardNo: optText(30),
  driverLicenseNo: optText(40),
  note: optText(500),
});
type OwnerBookRentalDto = z.infer<typeof ownerBookRentalSchema>;

const tokenSchema = z.object({ token: z.string().min(10).max(100) });
const publicCancelSchema = tokenSchema.extend({ reason: optText(300) });
const ownerCancelSchema = z.object({ reason: optText(300) });
const garageCancelSchema = z.object({ reason: z.string().trim().min(3, 'Nhập lý do huỷ đơn thuê').max(500) });

const verifyKycSchema = z.object({
  idCardNo: z.string().trim().min(6, 'Nhập số CCCD đã đối chiếu').max(30),
  driverLicenseNo: z.string().trim().min(4, 'Nhập số GPLX đã đối chiếu').max(40),
  kycNote: optText(500),
});

const depositSchema = z.object({
  depositPaid: moneySchema,
  sellerNote: optText(500),
});

const handoverSchema = z.object({
  handoverKm: z.coerce.number().int().min(0, 'Nhập số km lúc giao').max(2_000_000),
  handoverFuel: z.coerce.number().int().min(0).max(100, 'Mức nhiên liệu 0–100%'),
  handoverImageIds: z.array(z.string().uuid()).max(8, 'Tối đa 8 ảnh bàn giao').default([]),
  handoverNote: optText(500),
});

const returnSchema = z.object({
  returnKm: z.coerce.number().int().min(0, 'Nhập số km lúc trả').max(2_000_000),
  returnFuel: z.coerce.number().int().min(0).max(100, 'Mức nhiên liệu 0–100%'),
  returnImageIds: z.array(z.string().uuid()).max(8, 'Tối đa 8 ảnh nhận xe').default([]),
  extraFee: moneySchema.nullable().optional(),
  returnNote: optText(500),
});

const settleSchema = z.object({
  extraFee: moneySchema.default(0),
  discount: moneySchema.default(0),
  paymentMethod: z.enum(['TIEN_MAT', 'CHUYEN_KHOAN', 'THE']).default('CHUYEN_KHOAN'),
  sellerNote: optText(500),
});

const reviewNoteSchema = z.object({
  note: z.string().trim().min(3, 'Nhập lý do kiểm duyệt').max(500),
});

function assertRentalView(a: Access) {
  const ok =
    a.tenantType === 'PARTNER'
      ? a.permissions.some((p) => ['partner.listing.manage', 'partner.request.manage'].includes(p))
      : a.tenantType === 'GARAGE' && a.permissions.some((p) => ['rental.view', 'rental.manage'].includes(p));
  if (!ok) throw new ForbiddenException('Bạn không có quyền xem mục Thuê xe');
}

function assertRentalFleetManage(a: Access) {
  const ok =
    a.tenantType === 'PARTNER'
      ? a.permissions.some((p) => ['partner.listing.manage', 'partner.request.manage'].includes(p))
      : a.tenantType === 'GARAGE' && a.permissions.includes('rental.manage');
  if (!ok) throw new ForbiddenException('Bạn không có quyền quản lý đội xe cho thuê');
}

function assertRentalContractManage(a: Access) {
  const ok =
    a.tenantType === 'PARTNER'
      ? a.permissions.includes('partner.request.manage')
      : a.tenantType === 'GARAGE' && a.permissions.includes('rental.manage');
  if (!ok) throw new ForbiddenException('Bạn không có quyền xử lý hợp đồng thuê xe');
}

function assertPlatformReviewer(a: Access) {
  if (a.tenantType !== 'PLATFORM' || !a.permissions.includes('platform.partner.review')) {
    throw new ForbiddenException('Chỉ bộ phận kiểm duyệt sàn mới thực hiện được thao tác này');
  }
}

/** Tự chuyển các hợp đồng DANG_THUE đã quá giờ trả sang QUA_HAN (theo S8) trước mỗi lần đọc / ghi */
export async function markOverdueRentals(db: Db) {
  await db.rentalContract.updateMany({
    where: { status: 'DANG_THUE', endAt: { lt: new Date() } },
    data: { status: 'QUA_HAN' },
  });
}

type ContractWithVehicle = Prisma.RentalContractGetPayload<{ include: { rentalVehicle: true } }>;

@Injectable()
export class RentalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly redis: RedisService,
  ) {}

  private url = (id: string | null | undefined) => (id ? this.files.signedUrl(id).catch(() => null) : Promise.resolve(null));

  private async vehicleView(
    v: Prisma.RentalVehicleGetPayload<object>,
    shop?: { name: string; slug: string | null; phone: string | null; address: string | null } | null,
    branch?: { id: string; code: string; name: string } | null,
  ) {
    return {
      id: v.id,
      tenantId: v.tenantId,
      code: v.code,
      title: v.title,
      plateNo: formatPlate(v.plateNo),
      make: v.make,
      model: v.model,
      year: v.year,
      seats: v.seats,
      transmission: v.transmission,
      fuel: v.fuel,
      ownerType: v.ownerType,
      dailyPrice: n(v.dailyPrice)!,
      deposit: n(v.deposit)!,
      kmLimitPerDay: v.kmLimitPerDay,
      overKmFee: n(v.overKmFee)!,
      province: v.province,
      pickupAddress: v.pickupAddress,
      terms: v.terms,
      description: v.description,
      status: v.status as RentalListingStatus,
      statusLabel: RENTAL_LISTING_LABEL[v.status as RentalListingStatus],
      reviewNote: v.reviewNote,
      submittedAt: v.submittedAt,
      updatedAt: v.updatedAt,
      images: await Promise.all(v.imageFileIds.map(async (id) => ({ id, url: await this.url(id) }))),
      branch: branch ?? null,
      shop: shop ?? null,
    };
  }

  private async contractView(c: ContractWithVehicle) {
    const [shop, tenant, branch, cashEntry] = await Promise.all([
      this.prisma.shop.findUnique({ where: { tenantId: c.tenantId } }),
      this.prisma.tenant.findUnique({ where: { id: c.tenantId }, select: { id: true, name: true, type: true } }),
      c.branchId ? this.prisma.branch.findUnique({ where: { id: c.branchId }, select: { id: true, code: true, name: true, phone: true, address: true } }) : Promise.resolve(null),
      c.cashEntryId ? this.prisma.cashEntry.findUnique({ where: { id: c.cashEntryId }, select: { id: true, code: true, amount: true } }) : Promise.resolve(null),
    ]);

    const overKmCalc =
      c.returnKm !== null
        ? suggestOverKmFee({
            handoverKm: c.handoverKm,
            returnKm: c.returnKm,
            rentalDays: c.rentalDays,
            kmLimitPerDay: c.rentalVehicle.kmLimitPerDay,
            overKmFee: n(c.rentalVehicle.overKmFee)!,
          })
        : null;

    const previewSettle = computeSettlement({
      baseTotal: n(c.baseTotal)!,
      extraFee: n(c.extraFee)!,
      discount: n(c.discount)!,
      depositPaid: n(c.depositPaid)!,
    });

    return {
      id: c.id,
      code: c.code,
      status: c.status as RentalContractStatus,
      statusLabel: RENTAL_STATUS_LABEL[c.status as RentalContractStatus],
      allowedNext: RENTAL_CONTRACT_TRANSITIONS[c.status as RentalContractStatus],
      cancellableByCustomer: c.status === 'DAT_TRUOC',
      customerName: c.customerName,
      phone: c.phone,
      idCardNo: c.idCardNo,
      driverLicenseNo: c.driverLicenseNo,
      kycNote: c.kycNote,
      startAt: c.startAt,
      endAt: c.endAt,
      rentalDays: c.rentalDays,
      dailyPrice: n(c.dailyPrice)!,
      depositRequired: n(c.depositRequired)!,
      depositPaid: n(c.depositPaid)!,
      baseTotal: n(c.baseTotal)!,
      extraFee: n(c.extraFee)!,
      discount: n(c.discount)!,
      finalTotal: n(c.finalTotal),
      depositRefund: n(c.depositRefund),
      paymentMethod: c.paymentMethod,
      previewSettlement: previewSettle,
      overKmSummary: overKmCalc,
      cashEntry: cashEntry ? { id: cashEntry.id, code: cashEntry.code, amount: n(cashEntry.amount)! } : null,
      handover: {
        km: c.handoverKm,
        fuel: c.handoverFuel,
        note: c.handoverNote,
        at: c.handedOverAt,
        images: await Promise.all(c.handoverImageIds.map(async (id) => ({ id, url: await this.url(id) }))),
      },
      returned: {
        km: c.returnKm,
        fuel: c.returnFuel,
        note: c.returnNote,
        at: c.returnedAt,
        images: await Promise.all(c.returnImageIds.map(async (id) => ({ id, url: await this.url(id) }))),
      },
      customerNote: c.customerNote,
      sellerNote: c.sellerNote,
      cancelReason: c.cancelReason,
      verifiedAt: c.verifiedAt,
      depositSignedAt: c.depositSignedAt,
      settledAt: c.settledAt,
      cancelledAt: c.cancelledAt,
      createdAt: c.createdAt,
      vehicle: {
        id: c.rentalVehicle.id,
        code: c.rentalVehicle.code,
        title: c.rentalVehicle.title,
        plateNo: formatPlate(c.rentalVehicle.plateNo),
        seats: c.rentalVehicle.seats,
        transmission: c.rentalVehicle.transmission,
        fuel: c.rentalVehicle.fuel,
        kmLimitPerDay: c.rentalVehicle.kmLimitPerDay,
        overKmFee: n(c.rentalVehicle.overKmFee)!,
        pickupAddress: c.rentalVehicle.pickupAddress ?? branch?.address ?? shop?.address ?? null,
        terms: c.rentalVehicle.terms,
      },
      garage: {
        tenantId: c.tenantId,
        tenantType: tenant?.type ?? 'GARAGE',
        name: shop?.name ?? tenant?.name ?? '',
        slug: shop?.slug ?? null,
        phone: branch?.phone ?? shop?.phone ?? null,
        address: branch?.address ?? shop?.address ?? null,
        branch: branch ? { id: branch.id, code: branch.code, name: branch.name } : null,
      },
    };
  }

  // ---------------- Công khai trên sàn (/cho/thue-xe, A1.08) ----------------

  async publicListVehicles(q: {
    province?: string;
    seats?: string;
    transmission?: string;
    startAt?: string;
    endAt?: string;
    q?: string;
    sort?: string;
  }) {
    await markOverdueRentals(this.prisma);
    const where: Prisma.RentalVehicleWhereInput = { status: 'DANG_CHO_THUE' };
    if (q.province?.trim()) where.province = q.province.trim();
    if (q.seats && Number.isFinite(Number(q.seats))) where.seats = Number(q.seats);
    if (q.transmission === 'TU_DONG' || q.transmission === 'SO_SAN') where.transmission = q.transmission;
    if (q.q?.trim()) where.searchText = { contains: searchKey(q.q) };

    const allRows = await this.prisma.rentalVehicle.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    if (!allRows.length) return { provinces: [] as string[], estimatedDays: null as number | null, items: [] };

    const tenantIds = [...new Set(allRows.map((r) => r.tenantId))];
    const [tenants, shops, allProvinces] = await Promise.all([
      this.prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true, type: true, status: true, deletedAt: true } }),
      this.prisma.shop.findMany({ where: { tenantId: { in: tenantIds } } }),
      this.prisma.rentalVehicle.findMany({ where: { status: 'DANG_CHO_THUE', province: { not: null } }, select: { province: true }, distinct: ['province'] }),
    ]);
    const okTenants = new Map(tenants.filter(tenantListable).map((t) => [t.id, t]));
    let visible = allRows.filter((r) => okTenants.has(r.tenantId));

    let estimatedDays: number | null = null;
    if (q.startAt && q.endAt) {
      const s = new Date(q.startAt);
      const e = new Date(q.endAt);
      if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && e > s) {
        estimatedDays = Math.max(1, Math.ceil((e.getTime() - s.getTime()) / 86_400_000));
        const busy = await this.prisma.rentalContract.findMany({
          where: {
            rentalVehicleId: { in: visible.map((v) => v.id) },
            status: { in: HOLDING_RENTAL_STATUSES },
            startAt: { lt: e },
            endAt: { gt: s },
          },
          select: { rentalVehicleId: true },
        });
        const busyIds = new Set(busy.map((b) => b.rentalVehicleId));
        visible = visible.filter((v) => !busyIds.has(v.id));
      }
    }

    if (q.sort === 'gia-tang') visible.sort((a, b) => n(a.dailyPrice)! - n(b.dailyPrice)!);
    else if (q.sort === 'gia-giam') visible.sort((a, b) => n(b.dailyPrice)! - n(a.dailyPrice)!);

    const items = await Promise.all(
      visible.map(async (v) => {
        const sh = shops.find((s) => s.tenantId === v.tenantId);
        const t = okTenants.get(v.tenantId)!;
        const base = await this.vehicleView(v, {
          name: sh?.name ?? t.name,
          slug: sh?.slug ?? null,
          phone: sh?.phone ?? null,
          address: v.pickupAddress ?? sh?.address ?? null,
        });
        return {
          ...base,
          estimatedTotal: estimatedDays !== null ? estimatedDays * base.dailyPrice : null,
        };
      }),
    );

    const provinces = allProvinces
      .map((p) => p.province!)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'vi'));

    return { provinces, estimatedDays, items };
  }

  async publicGetVehicle(id: string) {
    await markOverdueRentals(this.prisma);
    const v = await this.prisma.rentalVehicle.findUnique({ where: { id } });
    if (!v || v.status !== 'DANG_CHO_THUE') throw new NotFoundException('Không tìm thấy xe cho thuê');
    const tenant = await this.prisma.tenant.findUnique({ where: { id: v.tenantId } });
    if (!tenant || !tenantListable(tenant)) throw new NotFoundException('Xe này tạm ngừng cho thuê');
    const [shop, branch, bookedSlots] = await Promise.all([
      this.prisma.shop.findUnique({ where: { tenantId: v.tenantId } }),
      v.branchId ? this.prisma.branch.findUnique({ where: { id: v.branchId }, select: { id: true, code: true, name: true, address: true, phone: true } }) : Promise.resolve(null),
      this.prisma.rentalContract.findMany({
        where: {
          rentalVehicleId: v.id,
          status: { in: HOLDING_RENTAL_STATUSES },
          endAt: { gt: new Date() },
        },
        select: { startAt: true, endAt: true },
        orderBy: { startAt: 'asc' },
        take: 20,
      }),
    ]);

    const view = await this.vehicleView(
      v,
      {
        name: shop?.name ?? tenant.name,
        slug: shop?.slug ?? null,
        phone: branch?.phone ?? shop?.phone ?? null,
        address: v.pickupAddress ?? branch?.address ?? shop?.address ?? null,
      },
      branch ? { id: branch.id, code: branch.code, name: branch.name } : null,
    );

    return { ...view, bookedSlots };
  }

  private async checkRateLimit(phone: string, ip?: string) {
    if (ip) {
      const key = `rental:ip:${ip}`;
      const hits = await this.redis.client.incr(key);
      if (hits === 1) await this.redis.client.expire(key, 3600);
      if (hits > RENTAL_MAX_HOURLY_PER_IP) {
        throw new HttpException('Bạn đã gửi quá nhiều yêu cầu đặt thuê trong giờ qua, vui lòng thử lại sau.', HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    await markOverdueRentals(this.prisma);
    const active = await this.prisma.rentalContract.count({
      where: { phone, status: { in: HOLDING_RENTAL_STATUSES } },
    });
    if (active >= RENTAL_MAX_ACTIVE_PER_PHONE) {
      throw new ConflictException(`Số điện thoại này đang có ${active} đơn thuê xe chưa kết thúc.`);
    }
  }

  private async createContractInternal(opts: {
    rentalVehicleId: string;
    renterUserId: string | null;
    customerName: string;
    phone: string;
    idCardNo: string | null;
    driverLicenseNo: string | null;
    startAt: Date;
    endAt: Date;
    note: string | null;
    ip?: string;
  }) {
    const normPhone = normalizeVnPhone(opts.phone);
    if (!normPhone) throw new BadRequestException('Số điện thoại không hợp lệ');
    const period = checkRentalPeriod(opts.startAt, opts.endAt);
    if ('error' in period) throw new BadRequestException(period.error);
    await this.checkRateLimit(normPhone, opts.ip);

    const token = randomBytes(24).toString('base64url');
    const accessHash = sha256(token);

    const created = await this.prisma.$transaction(async (tx) => {
      // Khoá xe để 2 khách đặt cùng lúc không trùng lịch
      await tx.$queryRaw`SELECT id FROM rental_vehicles WHERE id = ${opts.rentalVehicleId}::uuid FOR UPDATE`;
      await markOverdueRentals(tx);
      const vehicle = await tx.rentalVehicle.findUnique({ where: { id: opts.rentalVehicleId } });
      if (!vehicle || vehicle.status !== 'DANG_CHO_THUE') {
        throw new BadRequestException('Xe hiện không còn mở đặt thuê');
      }
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: vehicle.tenantId } });
      if (!tenantListable(tenant)) {
        throw new BadRequestException('Garage tạm ngừng nhận đặt thuê xe');
      }

      const overlap = await tx.rentalContract.findFirst({
        where: {
          rentalVehicleId: vehicle.id,
          status: { in: HOLDING_RENTAL_STATUSES },
          startAt: { lt: opts.endAt },
          endAt: { gt: opts.startAt },
        },
        select: { code: true },
      });
      if (overlap) {
        throw new ConflictException('Xe đã có khách đặt trong khoảng thời gian bạn chọn. Vui lòng chọn ngày khác hoặc xe khác.');
      }

      let customerId: string | null = null;
      if (tenant.type === 'GARAGE') {
        const existingCustomer = await tx.customer.findFirst({ where: { tenantId: tenant.id, phone: normPhone, deletedAt: null }, select: { id: true } });
        customerId = existingCustomer?.id ?? null;
      }

      const code = rentalContractCode(await reserveNumbers(tx, vehicle.tenantId, 'rental_contract'));
      const baseTotal = BigInt(period.days) * vehicle.dailyPrice;
      const row = await tx.rentalContract.create({
        data: {
          code,
          tenantId: vehicle.tenantId,
          branchId: vehicle.branchId,
          rentalVehicleId: vehicle.id,
          renterUserId: opts.renterUserId,
          customerId,
          customerName: opts.customerName.trim(),
          phone: normPhone,
          idCardNo: opts.idCardNo?.trim() || null,
          driverLicenseNo: opts.driverLicenseNo?.trim() || null,
          startAt: opts.startAt,
          endAt: opts.endAt,
          rentalDays: period.days,
          dailyPrice: vehicle.dailyPrice,
          depositRequired: vehicle.deposit,
          baseTotal,
          customerNote: opts.note?.trim() || null,
          status: 'DAT_TRUOC',
          accessHash,
          ip: opts.ip ?? null,
        },
      });
      await this.audit.log(
        {
          tenantId: vehicle.tenantId,
          actorId: opts.renterUserId ?? undefined,
          action: 'rental_contract.created',
          entity: 'rental_contract',
          entityId: row.id,
          after: { code, vehicle: vehicle.code, days: period.days, baseTotal: n(baseTotal) },
          ip: opts.ip,
        },
        tx,
      );
      return row;
    });

    return {
      id: created.id,
      code: created.code,
      status: created.status as RentalContractStatus,
      token,
      trackUrl: `/cho/thue-xe/hop-dong/${created.id}?t=${token}`,
    };
  }

  async publicBook(dto: PublicBookRentalDto, ip?: string) {
    return this.createContractInternal({
      rentalVehicleId: dto.rentalVehicleId,
      renterUserId: null,
      customerName: dto.name,
      phone: dto.phone,
      idCardNo: dto.idCardNo ?? null,
      driverLicenseNo: dto.driverLicenseNo ?? null,
      startAt: dto.startAt,
      endAt: dto.endAt,
      note: dto.note ?? null,
      ip,
    });
  }

  private assertToken(row: { accessHash: string }, token: string) {
    const a = Buffer.from(row.accessHash, 'hex');
    const b = Buffer.from(sha256(token), 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Link theo dõi hợp đồng thuê xe không hợp lệ');
    }
  }

  async publicGetContract(id: string, token: string) {
    await markOverdueRentals(this.prisma);
    const row = await this.prisma.rentalContract.findUnique({ where: { id }, include: { rentalVehicle: true } });
    if (!row) throw new NotFoundException('Không tìm thấy hợp đồng thuê xe');
    this.assertToken(row, token);
    return this.contractView(row);
  }

  private async customerCancelInternal(row: ContractWithVehicle, reason: string | null | undefined, actorId?: string, ip?: string) {
    const err = contractTransitionError(row.status as RentalContractStatus, 'HUY');
    if (err) throw new ConflictException(err);
    const upd = await this.prisma.rentalContract.updateMany({
      where: { id: row.id, status: 'DAT_TRUOC' },
      data: { status: 'HUY', cancelReason: reason?.trim() || 'Khách tự huỷ đặt trước', cancelledAt: new Date() },
    });
    if (!upd.count) throw new ConflictException('Trạng thái hợp đồng vừa thay đổi, vui lòng tải lại');
    await this.audit.log({
      tenantId: row.tenantId,
      actorId,
      action: 'rental_contract.cancelled_by_customer',
      entity: 'rental_contract',
      entityId: row.id,
      before: { status: row.status },
      after: { status: 'HUY', reason: reason ?? null },
      ip,
    });
    return { status: 'HUY' as RentalContractStatus };
  }

  async publicCancelContract(id: string, token: string, reason?: string | null, ip?: string) {
    await markOverdueRentals(this.prisma);
    const row = await this.prisma.rentalContract.findUnique({ where: { id }, include: { rentalVehicle: true } });
    if (!row) throw new NotFoundException('Không tìm thấy hợp đồng thuê xe');
    this.assertToken(row, token);
    return this.customerCancelInternal(row, reason, undefined, ip);
  }

  // ---------------- App chủ xe (/app/thue-xe, A2.08) ----------------

  async ownerListContracts(userId: string) {
    await markOverdueRentals(this.prisma);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true } });
    const rows = await this.prisma.rentalContract.findMany({
      where: { OR: [{ renterUserId: userId }, { phone: user.phone }] },
      include: { rentalVehicle: true },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });
    return Promise.all(rows.map((r) => this.contractView(r)));
  }

  async ownerBook(userId: string, dto: OwnerBookRentalDto, ip?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true, phone: true } });
    return this.createContractInternal({
      rentalVehicleId: dto.rentalVehicleId,
      renterUserId: userId,
      customerName: user.fullName,
      phone: user.phone,
      idCardNo: dto.idCardNo ?? null,
      driverLicenseNo: dto.driverLicenseNo ?? null,
      startAt: dto.startAt,
      endAt: dto.endAt,
      note: dto.note ?? null,
      ip,
    });
  }

  private async loadOwnerContract(userId: string, id: string): Promise<ContractWithVehicle> {
    await markOverdueRentals(this.prisma);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true } });
    const row = await this.prisma.rentalContract.findFirst({
      where: { id, OR: [{ renterUserId: userId }, { phone: user.phone }] },
      include: { rentalVehicle: true },
    });
    if (!row) throw new NotFoundException('Không tìm thấy hợp đồng thuê xe');
    return row;
  }

  async ownerGetContract(userId: string, id: string) {
    return this.contractView(await this.loadOwnerContract(userId, id));
  }

  async ownerCancelContract(userId: string, id: string, reason?: string | null, ip?: string) {
    return this.customerCancelInternal(await this.loadOwnerContract(userId, id), reason, userId, ip);
  }

  // ---------------- Garage: quản lý đội xe & hợp đồng thuê (A7.22, A3.60) ----------------

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

  async listGarageVehicles(a: Access, q: { status?: string; branchId?: string; q?: string }) {
    assertRentalView(a);
    const bWhere = this.branchWhereForTenant(a, q.branchId);
    const where: Prisma.RentalVehicleWhereInput = {
      tenantId: a.tenantId,
      ...bWhere,
      ...(q.status && q.status !== 'ALL' ? { status: q.status as RentalListingStatus } : {}),
      ...(q.q?.trim() ? { searchText: { contains: searchKey(q.q) } } : {}),
    };
    const [rows, counts, branches] = await Promise.all([
      this.prisma.rentalVehicle.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 200 }),
      this.prisma.rentalVehicle.groupBy({ by: ['status'], where: { tenantId: a.tenantId, ...bWhere }, _count: true }),
      this.prisma.branch.findMany({ where: { tenantId: a.tenantId, deletedAt: null }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } }),
    ]);
    const branchMap = new Map(branches.map((b) => [b.id, b]));
    return {
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
      branches: branches.filter((b) => a.branchIds === 'ALL' || a.branchIds.includes(b.id)),
      items: await Promise.all(rows.map((r) => this.vehicleView(r, null, r.branchId ? (branchMap.get(r.branchId) ?? null) : null))),
    };
  }

  private async validateVehicleDto(a: Access, dto: RentalVehicleDto) {
    const plateNo = normalizePlate(dto.plateNo);
    if (!plateNo) throw new BadRequestException('Biển số xe không hợp lệ');
    let branchId: string | null = null;
    if (a.tenantType === 'GARAGE') {
      if (dto.branchId) {
        if (!AccessService.canAccessBranch(a, dto.branchId)) throw new ForbiddenException('Bạn không làm việc ở chi nhánh này');
        const b = await this.prisma.branch.findFirst({ where: { id: dto.branchId, tenantId: a.tenantId, deletedAt: null } });
        if (!b) throw new BadRequestException('Chi nhánh không hợp lệ');
        branchId = b.id;
      } else {
        const first = await this.prisma.branch.findFirst({
          where: { tenantId: a.tenantId, deletedAt: null, ...(a.branchIds === 'ALL' ? {} : { id: { in: a.branchIds } }) },
          orderBy: { code: 'asc' },
        });
        branchId = first?.id ?? null;
      }
    }
    for (const fid of dto.imageFileIds) await this.files.assertOwnedImage(fid, a.tenantId);
    return { plateNo, branchId };
  }

  async createVehicle(a: Access, dto: RentalVehicleDto, ip?: string) {
    assertRentalFleetManage(a);
    const { plateNo, branchId } = await this.validateVehicleDto(a, dto);
    const created = await this.prisma.$transaction(async (tx) => {
      const code = rentalVehicleCode(await reserveNumbers(tx, a.tenantId, 'rental_vehicle'));
      const row = await tx.rentalVehicle.create({
        data: {
          tenantId: a.tenantId,
          branchId,
          code,
          title: dto.title,
          plateNo,
          make: dto.make,
          model: dto.model,
          year: dto.year,
          seats: dto.seats,
          transmission: dto.transmission,
          fuel: dto.fuel,
          ownerType: dto.ownerType,
          dailyPrice: BigInt(dto.dailyPrice),
          deposit: BigInt(dto.deposit),
          kmLimitPerDay: dto.kmLimitPerDay,
          overKmFee: BigInt(dto.overKmFee),
          province: dto.province ?? null,
          pickupAddress: dto.pickupAddress ?? null,
          terms: dto.terms ?? null,
          description: dto.description ?? null,
          imageFileIds: dto.imageFileIds,
          status: 'NHAP',
          searchText: searchKey(code, dto.title, plateNo, formatPlate(plateNo), dto.make, dto.model, dto.province),
          createdBy: a.userId,
        },
      });
      await this.audit.log(
        { tenantId: a.tenantId, actorId: a.userId, action: 'rental_vehicle.created', entity: 'rental_vehicle', entityId: row.id, after: { code, plateNo, dailyPrice: dto.dailyPrice }, ip },
        tx,
      );
      return row;
    });
    return this.vehicleView(created);
  }

  private async loadOwnVehicle(a: Access, id: string) {
    const v = await this.prisma.rentalVehicle.findFirst({ where: { id, tenantId: a.tenantId } });
    if (!v) throw new NotFoundException('Không tìm thấy xe cho thuê');
    if (a.tenantType === 'GARAGE' && v.branchId && !AccessService.canAccessBranch(a, v.branchId)) {
      throw new ForbiddenException('Xe cho thuê thuộc chi nhánh khác');
    }
    return v;
  }

  async updateVehicle(a: Access, id: string, dto: RentalVehicleDto, ip?: string) {
    assertRentalFleetManage(a);
    const v = await this.loadOwnVehicle(a, id);
    if (v.status === 'BI_GO') throw new ConflictException('Xe đã bị sàn gỡ, không chỉnh sửa được');
    const { plateNo, branchId } = await this.validateVehicleDto(a, dto);
    const important =
      dto.title !== v.title ||
      plateNo !== v.plateNo ||
      (dto.terms ?? null) !== v.terms ||
      (dto.description ?? null) !== v.description ||
      dto.imageFileIds.join() !== v.imageFileIds.join();
    const nextStatus = listingStatusAfterEdit(v.status as RentalListingStatus, important, a.tenantType === 'GARAGE');

    const saved = await this.prisma.rentalVehicle.update({
      where: { id },
      data: {
        branchId,
        title: dto.title,
        plateNo,
        make: dto.make,
        model: dto.model,
        year: dto.year,
        seats: dto.seats,
        transmission: dto.transmission,
        fuel: dto.fuel,
        ownerType: dto.ownerType,
        dailyPrice: BigInt(dto.dailyPrice),
        deposit: BigInt(dto.deposit),
        kmLimitPerDay: dto.kmLimitPerDay,
        overKmFee: BigInt(dto.overKmFee),
        province: dto.province ?? null,
        pickupAddress: dto.pickupAddress ?? null,
        terms: dto.terms ?? null,
        description: dto.description ?? null,
        imageFileIds: dto.imageFileIds,
        status: nextStatus,
        ...(nextStatus === 'CHO_DUYET' && v.status !== 'CHO_DUYET' ? { submittedAt: new Date(), reviewNote: null } : {}),
        searchText: searchKey(v.code, dto.title, plateNo, formatPlate(plateNo), dto.make, dto.model, dto.province),
      },
    });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'rental_vehicle.updated',
      entity: 'rental_vehicle',
      entityId: id,
      before: { status: v.status, dailyPrice: n(v.dailyPrice) },
      after: { status: nextStatus, dailyPrice: dto.dailyPrice },
      ip,
    });
    return this.vehicleView(saved);
  }

  async submitVehicle(a: Access, id: string, ip?: string) {
    assertRentalFleetManage(a);
    const v = await this.loadOwnVehicle(a, id);
    const to = listingStatusOnSubmit(v.status as RentalListingStatus, a.tenantType === 'GARAGE');
    if (!to) throw new ConflictException('Chỉ gửi duyệt / đăng lên sàn được xe ở trạng thái Nháp hoặc Bị từ chối');
    await this.prisma.rentalVehicle.update({
      where: { id },
      data: { status: to, submittedAt: new Date(), reviewNote: null },
    });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'rental_vehicle.submitted',
      entity: 'rental_vehicle',
      entityId: id,
      before: { status: v.status },
      after: { status: to },
      ip,
    });
    return { status: to };
  }

  async hideVehicle(a: Access, id: string, ip?: string) {
    assertRentalFleetManage(a);
    const v = await this.loadOwnVehicle(a, id);
    if (v.status !== 'DANG_CHO_THUE') throw new ConflictException('Chỉ tạm ẩn được xe đang mở cho thuê');
    await this.prisma.rentalVehicle.update({ where: { id }, data: { status: 'TAM_AN' } });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'rental_vehicle.hidden', entity: 'rental_vehicle', entityId: id, ip });
    return { status: 'TAM_AN' as RentalListingStatus };
  }

  async showVehicle(a: Access, id: string, ip?: string) {
    assertRentalFleetManage(a);
    const v = await this.loadOwnVehicle(a, id);
    if (v.status !== 'TAM_AN') throw new ConflictException('Chỉ mở lại được xe đang tạm ẩn');
    await this.prisma.rentalVehicle.update({ where: { id }, data: { status: 'DANG_CHO_THUE' } });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'rental_vehicle.shown', entity: 'rental_vehicle', entityId: id, ip });
    return { status: 'DANG_CHO_THUE' as RentalListingStatus };
  }

  async deleteVehicle(a: Access, id: string, ip?: string) {
    assertRentalFleetManage(a);
    const v = await this.loadOwnVehicle(a, id);
    if (v.status !== 'NHAP' && v.status !== 'BI_TU_CHOI') {
      throw new ConflictException('Chỉ xoá được xe nháp hoặc bị từ chối; xe đang cho thuê hãy bấm Tạm ẩn');
    }
    const count = await this.prisma.rentalContract.count({ where: { rentalVehicleId: id } });
    if (count > 0) throw new ConflictException('Xe đã có hợp đồng thuê trong lịch sử, không xoá được');
    await this.prisma.rentalVehicle.delete({ where: { id } });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'rental_vehicle.deleted', entity: 'rental_vehicle', entityId: id, before: { code: v.code }, ip });
    return { status: 'ok' };
  }

  // ---------------- Hợp đồng thuê xe phía garage (S8) ----------------

  async listGarageContracts(a: Access, q: { status?: string; branchId?: string; q?: string }) {
    assertRentalView(a);
    await markOverdueRentals(this.prisma);
    const bWhere = this.branchWhereForTenant(a, q.branchId);
    const where: Prisma.RentalContractWhereInput = {
      tenantId: a.tenantId,
      ...bWhere,
    };
    if (q.status === 'OPEN') {
      where.status = { in: ['DAT_TRUOC', 'DA_XAC_MINH', 'DA_KY_COC', 'DANG_THUE', 'QUA_HAN', 'DA_TRA_XE'] };
    } else if (q.status === 'DONE') {
      where.status = { in: ['DA_QUYET_TOAN', 'HUY'] };
    } else if (q.status && q.status !== 'ALL') {
      where.status = q.status as RentalContractStatus;
    }
    if (q.q?.trim()) {
      const s = q.q.trim();
      const digits = s.replace(/\D/g, '');
      const plate = normalizePlate(s);
      where.AND = [
        {
          OR: [
            { code: { contains: s.toUpperCase() } },
            { customerName: { contains: s, mode: 'insensitive' } },
            ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
            ...(plate ? [{ rentalVehicle: { plateNo: { contains: plate } } }] : []),
          ],
        },
      ];
    }

    const [rows, counts] = await Promise.all([
      this.prisma.rentalContract.findMany({
        where,
        include: { rentalVehicle: true },
        orderBy: { createdAt: 'desc' },
        take: 150,
      }),
      this.prisma.rentalContract.groupBy({ by: ['status'], where: { tenantId: a.tenantId, ...bWhere }, _count: true }),
    ]);

    return {
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
      items: await Promise.all(rows.map((r) => this.contractView(r))),
    };
  }

  private async loadContractForWrite(tx: Prisma.TransactionClient, a: Access, id: string) {
    await tx.$queryRaw`SELECT id FROM rental_contracts WHERE id = ${id}::uuid FOR UPDATE`;
    await markOverdueRentals(tx);
    const row = await tx.rentalContract.findFirst({
      where: { id, tenantId: a.tenantId },
      include: { rentalVehicle: true },
    });
    if (!row) throw new NotFoundException('Không tìm thấy hợp đồng thuê xe');
    if (a.tenantType === 'GARAGE' && row.branchId && !AccessService.canAccessBranch(a, row.branchId)) {
      throw new ForbiddenException('Hợp đồng thuộc chi nhánh khác');
    }
    return row;
  }

  /** DAT_TRUOC -> DA_XAC_MINH: Garage đối chiếu & xác minh CCCD + GPLX */
  async verifyKyc(a: Access, id: string, dto: z.infer<typeof verifyKycSchema>, ip?: string) {
    assertRentalContractManage(a);
    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await this.loadContractForWrite(tx, a, id);
      const err = contractTransitionError(row.status as RentalContractStatus, 'DA_XAC_MINH');
      if (err) throw new ConflictException(err);
      const upd = await tx.rentalContract.update({
        where: { id },
        data: {
          status: 'DA_XAC_MINH',
          idCardNo: dto.idCardNo,
          driverLicenseNo: dto.driverLicenseNo,
          kycNote: dto.kycNote ?? null,
          verifiedAt: new Date(),
          handledBy: a.userId,
        },
        include: { rentalVehicle: true },
      });
      await this.audit.log(
        { tenantId: a.tenantId, actorId: a.userId, action: 'rental_contract.verified', entity: 'rental_contract', entityId: id, before: { status: row.status }, after: { status: 'DA_XAC_MINH' }, ip },
        tx,
      );
      return upd;
    });
    return this.contractView(saved);
  }

  /** DAT_TRUOC -> HUY: Garage từ chối / huỷ đơn đặt trước */
  async garageCancel(a: Access, id: string, reason: string, ip?: string) {
    assertRentalContractManage(a);
    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await this.loadContractForWrite(tx, a, id);
      const err = contractTransitionError(row.status as RentalContractStatus, 'HUY');
      if (err) throw new ConflictException(err);
      const upd = await tx.rentalContract.update({
        where: { id },
        data: { status: 'HUY', cancelReason: reason, cancelledAt: new Date(), handledBy: a.userId },
        include: { rentalVehicle: true },
      });
      await this.audit.log(
        { tenantId: a.tenantId, actorId: a.userId, action: 'rental_contract.cancelled_by_garage', entity: 'rental_contract', entityId: id, before: { status: row.status }, after: { status: 'HUY', reason }, ip },
        tx,
      );
      return upd;
    });
    return this.contractView(saved);
  }

  /** DA_XAC_MINH -> DA_KY_COC: Ký hợp đồng thuê trực tiếp với garage + nhận tiền đặt cọc */
  async signDeposit(a: Access, id: string, dto: z.infer<typeof depositSchema>, ip?: string) {
    assertRentalContractManage(a);
    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await this.loadContractForWrite(tx, a, id);
      const err = contractTransitionError(row.status as RentalContractStatus, 'DA_KY_COC');
      if (err) throw new ConflictException(err);
      const upd = await tx.rentalContract.update({
        where: { id },
        data: {
          status: 'DA_KY_COC',
          depositPaid: BigInt(dto.depositPaid),
          ...(dto.sellerNote !== undefined ? { sellerNote: dto.sellerNote ?? row.sellerNote } : {}),
          depositSignedAt: new Date(),
          handledBy: a.userId,
        },
        include: { rentalVehicle: true },
      });
      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'rental_contract.deposit_signed',
          entity: 'rental_contract',
          entityId: id,
          before: { status: row.status },
          after: { status: 'DA_KY_COC', depositPaid: dto.depositPaid },
          ip,
        },
        tx,
      );
      return upd;
    });
    return this.contractView(saved);
  }

  /** DA_KY_COC -> DANG_THUE: Bàn giao xe (km, % nhiên liệu, ảnh trước khi giao) */
  async handover(a: Access, id: string, dto: z.infer<typeof handoverSchema>, ip?: string) {
    assertRentalContractManage(a);
    for (const fid of dto.handoverImageIds) await this.files.assertOwnedImage(fid, a.tenantId);
    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await this.loadContractForWrite(tx, a, id);
      const err = contractTransitionError(row.status as RentalContractStatus, 'DANG_THUE');
      if (err) throw new ConflictException(err);
      const upd = await tx.rentalContract.update({
        where: { id },
        data: {
          status: 'DANG_THUE',
          handoverKm: dto.handoverKm,
          handoverFuel: dto.handoverFuel,
          handoverImageIds: [...new Set(dto.handoverImageIds)],
          handoverNote: dto.handoverNote ?? null,
          handedOverAt: new Date(),
          handledBy: a.userId,
        },
        include: { rentalVehicle: true },
      });
      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'rental_contract.handed_over',
          entity: 'rental_contract',
          entityId: id,
          before: { status: row.status },
          after: { status: 'DANG_THUE', handoverKm: dto.handoverKm, handoverFuel: dto.handoverFuel },
          ip,
        },
        tx,
      );
      return upd;
    });
    return this.contractView(saved);
  }

  /** DANG_THUE | QUA_HAN -> DA_TRA_XE: Nhận trả xe, đối chiếu km & nhiên liệu, ghi phát sinh */
  async receiveReturn(a: Access, id: string, dto: z.infer<typeof returnSchema>, ip?: string) {
    assertRentalContractManage(a);
    for (const fid of dto.returnImageIds) await this.files.assertOwnedImage(fid, a.tenantId);
    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await this.loadContractForWrite(tx, a, id);
      const err = contractTransitionError(row.status as RentalContractStatus, 'DA_TRA_XE');
      if (err) throw new ConflictException(err);
      if (row.handoverKm !== null && dto.returnKm < row.handoverKm) {
        throw new BadRequestException(`Số km lúc trả (${dto.returnKm}) không được nhỏ hơn số km lúc bàn giao (${row.handoverKm})`);
      }

      const calc = suggestOverKmFee({
        handoverKm: row.handoverKm,
        returnKm: dto.returnKm,
        rentalDays: row.rentalDays,
        kmLimitPerDay: row.rentalVehicle.kmLimitPerDay,
        overKmFee: n(row.rentalVehicle.overKmFee)!,
      });
      const extra = dto.extraFee != null ? dto.extraFee : calc.suggestedFee;

      const upd = await tx.rentalContract.update({
        where: { id },
        data: {
          status: 'DA_TRA_XE',
          returnKm: dto.returnKm,
          returnFuel: dto.returnFuel,
          returnImageIds: [...new Set(dto.returnImageIds)],
          returnNote: dto.returnNote ?? null,
          extraFee: BigInt(extra),
          returnedAt: new Date(),
          handledBy: a.userId,
        },
        include: { rentalVehicle: true },
      });
      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'rental_contract.returned',
          entity: 'rental_contract',
          entityId: id,
          before: { status: row.status },
          after: { status: 'DA_TRA_XE', returnKm: dto.returnKm, extraFee: extra },
          ip,
        },
        tx,
      );
      return upd;
    });
    return this.contractView(saved);
  }

  /**
   * DA_TRA_XE -> DA_QUYET_TOAN: Quyết toán hợp đồng (hoàn cọc / trừ phát sinh).
   * Với PLG (GARAGE): tự tạo phiếu thu sổ quỹ PT… (khoản mục THU_THUE_XE) cho tổng doanh thu hợp đồng (F9).
   */
  async settle(a: Access, id: string, dto: z.infer<typeof settleSchema>, ip?: string) {
    assertRentalContractManage(a);
    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await this.loadContractForWrite(tx, a, id);
      const err = contractTransitionError(row.status as RentalContractStatus, 'DA_QUYET_TOAN');
      if (err) throw new ConflictException(err);

      const s = computeSettlement({
        baseTotal: n(row.baseTotal)!,
        extraFee: dto.extraFee,
        discount: dto.discount,
        depositPaid: n(row.depositPaid)!,
      });

      let cashEntryId = row.cashEntryId;
      if (a.tenantType === 'GARAGE' && !cashEntryId && s.finalTotal > 0) {
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
              category: 'THU_THUE_XE',
              amount: BigInt(s.finalTotal),
              method: dto.paymentMethod as PaymentMethod,
              counterparty: row.customerName,
              customerId: row.customerId,
              note: `Quyết toán hợp đồng thuê xe ${row.code} (${formatPlate(row.rentalVehicle.plateNo)})`,
              createdBy: a.userId,
            },
          });
          cashEntryId = entry.id;
        }
      }

      const upd = await tx.rentalContract.update({
        where: { id },
        data: {
          status: 'DA_QUYET_TOAN',
          extraFee: BigInt(dto.extraFee),
          discount: BigInt(dto.discount),
          finalTotal: BigInt(s.finalTotal),
          depositRefund: BigInt(s.depositRefund),
          paymentMethod: dto.paymentMethod as PaymentMethod,
          cashEntryId,
          ...(dto.sellerNote !== undefined ? { sellerNote: dto.sellerNote ?? row.sellerNote } : {}),
          settledAt: new Date(),
          handledBy: a.userId,
        },
        include: { rentalVehicle: true },
      });
      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'rental_contract.settled',
          entity: 'rental_contract',
          entityId: id,
          before: { status: row.status },
          after: { status: 'DA_QUYET_TOAN', finalTotal: s.finalTotal, depositRefund: s.depositRefund, cashEntryId },
          ip,
        },
        tx,
      );
      return upd;
    });
    return this.contractView(saved);
  }

  // ---------------- Admin sàn: kiểm duyệt xe thuê & giám sát hợp đồng ----------------

  async platformVehicles(a: Access, q: { status?: string; q?: string }) {
    assertPlatformReviewer(a);
    const statusFilter = q.status && q.status !== 'ALL' ? (q.status as RentalListingStatus) : 'CHO_DUYET';
    const where: Prisma.RentalVehicleWhereInput = {
      ...(q.status === 'ALL' ? {} : { status: statusFilter }),
      ...(q.q?.trim() ? { searchText: { contains: searchKey(q.q) } } : {}),
    };
    const [rows, counts] = await Promise.all([
      this.prisma.rentalVehicle.findMany({ where, orderBy: [{ submittedAt: 'asc' }, { updatedAt: 'desc' }], take: 200 }),
      this.prisma.rentalVehicle.groupBy({ by: ['status'], _count: true }),
    ]);
    const tenantIds = [...new Set(rows.map((r) => r.tenantId))];
    const [tenants, shops] = await Promise.all([
      this.prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true, type: true } }),
      this.prisma.shop.findMany({ where: { tenantId: { in: tenantIds } }, select: { tenantId: true, name: true, slug: true, phone: true, address: true } }),
    ]);

    const items = await Promise.all(
      rows.map(async (r) => {
        const t = tenants.find((x) => x.id === r.tenantId);
        const s = shops.find((x) => x.tenantId === r.tenantId);
        const view = await this.vehicleView(r, {
          name: s?.name ?? t?.name ?? '',
          slug: s?.slug ?? null,
          phone: s?.phone ?? null,
          address: r.pickupAddress ?? s?.address ?? null,
        });
        return { ...view, sellerType: t?.type ?? 'PARTNER' };
      }),
    );

    return {
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
      items,
    };
  }

  async platformModerateVehicle(a: Access, id: string, to: 'DANG_CHO_THUE' | 'BI_TU_CHOI' | 'BI_GO', note: string | null, ip?: string) {
    assertPlatformReviewer(a);
    const v = await this.prisma.rentalVehicle.findUnique({ where: { id } });
    if (!v) throw new NotFoundException('Không tìm thấy xe cho thuê');
    if ((to === 'DANG_CHO_THUE' || to === 'BI_TU_CHOI') && v.status !== 'CHO_DUYET') {
      throw new ConflictException('Xe không ở trạng thái chờ duyệt');
    }
    if (to === 'BI_GO' && v.status !== 'DANG_CHO_THUE' && v.status !== 'TAM_AN') {
      throw new ConflictException('Chỉ gỡ được xe đang mở cho thuê hoặc tạm ẩn');
    }
    await this.prisma.rentalVehicle.update({
      where: { id },
      data: { status: to, reviewNote: note, reviewedBy: a.userId, reviewedAt: new Date() },
    });
    const action = to === 'DANG_CHO_THUE' ? 'rental_vehicle.approved' : to === 'BI_TU_CHOI' ? 'rental_vehicle.rejected' : 'rental_vehicle.taken_down';
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action,
      entity: 'rental_vehicle',
      entityId: id,
      before: { status: v.status },
      after: { status: to, note },
      ip,
    });
    if (to !== 'DANG_CHO_THUE') {
      await this.audit.log({ tenantId: v.tenantId, actorId: a.userId, action, entity: 'rental_vehicle', entityId: id, after: { note }, ip });
    }
    return { status: to };
  }

  async platformContracts(a: Access, q: { status?: string; q?: string }) {
    assertPlatformReviewer(a);
    await markOverdueRentals(this.prisma);
    const where: Prisma.RentalContractWhereInput = {};
    if (q.status && q.status !== 'ALL') where.status = q.status as RentalContractStatus;
    if (q.q?.trim()) {
      const s = q.q.trim();
      where.OR = [
        { code: { contains: s.toUpperCase() } },
        { customerName: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s.replace(/\D/g, '') || s } },
      ];
    }
    const [rows, counts] = await Promise.all([
      this.prisma.rentalContract.findMany({ where, include: { rentalVehicle: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.rentalContract.groupBy({ by: ['status'], _count: true }),
    ]);
    return {
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
      items: await Promise.all(rows.map((r) => this.contractView(r))),
    };
  }
}

@Public()
@Controller('public/rentals')
export class PublicRentalsController {
  constructor(private readonly svc: RentalsService) {}

  @Get('vehicles')
  vehicles(
    @Query('province') province?: string,
    @Query('seats') seats?: string,
    @Query('transmission') transmission?: string,
    @Query('startAt') startAt?: string,
    @Query('endAt') endAt?: string,
    @Query('q') q?: string,
    @Query('sort') sort?: string,
  ) {
    return this.svc.publicListVehicles({ province, seats, transmission, startAt, endAt, q, sort });
  }

  @Get('vehicles/:id')
  vehicle(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.publicGetVehicle(id);
  }

  @Post('contracts')
  book(@Body(new ZodPipe(publicBookRentalSchema)) dto: PublicBookRentalDto, @Req() req: Request) {
    return this.svc.publicBook(dto, clientIp(req));
  }

  @Get('contracts/:id')
  contract(@Param('id', ParseUUIDPipe) id: string, @Query(new ZodPipe(tokenSchema)) q: { token: string }) {
    return this.svc.publicGetContract(id, q.token);
  }

  @Post('contracts/:id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(publicCancelSchema)) dto: z.infer<typeof publicCancelSchema>,
    @Req() req: Request,
  ) {
    return this.svc.publicCancelContract(id, dto.token, dto.reason, clientIp(req));
  }
}

@Public()
@UseGuards(OwnerGuard)
@Controller('owner/rentals')
export class OwnerRentalsController {
  constructor(private readonly svc: RentalsService) {}

  @Get('contracts')
  list(@Req() req: OwnerRequest) {
    return this.svc.ownerListContracts(req.owner!.userId);
  }

  @Post('contracts')
  book(@Req() req: OwnerRequest, @Body(new ZodPipe(ownerBookRentalSchema)) dto: OwnerBookRentalDto) {
    return this.svc.ownerBook(req.owner!.userId, dto, clientIp(req));
  }

  @Get('contracts/:id')
  get(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.ownerGetContract(req.owner!.userId, id);
  }

  @Post('contracts/:id/cancel')
  @HttpCode(200)
  cancel(
    @Req() req: OwnerRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ownerCancelSchema)) dto: z.infer<typeof ownerCancelSchema>,
  ) {
    return this.svc.ownerCancelContract(req.owner!.userId, id, dto.reason, clientIp(req));
  }
}

@Controller('rentals')
export class GarageRentalsController {
  constructor(private readonly svc: RentalsService) {}

  @Get('vehicles')
  vehicles(@CurrentAuth() auth: RequestAuth, @Query('status') status?: string, @Query('branchId') branchId?: string, @Query('q') q?: string) {
    return this.svc.listGarageVehicles(auth.access, { status, branchId, q });
  }

  @Post('vehicles')
  createVehicle(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(rentalVehicleSchema)) dto: RentalVehicleDto, @Req() req: Request) {
    return this.svc.createVehicle(auth.access, dto, clientIp(req));
  }

  @Put('vehicles/:id')
  updateVehicle(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(rentalVehicleSchema)) dto: RentalVehicleDto,
    @Req() req: Request,
  ) {
    return this.svc.updateVehicle(auth.access, id, dto, clientIp(req));
  }

  @Post('vehicles/:id/submit')
  @HttpCode(200)
  submitVehicle(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.submitVehicle(auth.access, id, clientIp(req));
  }

  @Post('vehicles/:id/hide')
  @HttpCode(200)
  hideVehicle(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.hideVehicle(auth.access, id, clientIp(req));
  }

  @Post('vehicles/:id/show')
  @HttpCode(200)
  showVehicle(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.showVehicle(auth.access, id, clientIp(req));
  }

  @Post('vehicles/:id/delete')
  @HttpCode(200)
  deleteVehicle(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.deleteVehicle(auth.access, id, clientIp(req));
  }

  @Get('contracts')
  contracts(@CurrentAuth() auth: RequestAuth, @Query('status') status?: string, @Query('branchId') branchId?: string, @Query('q') q?: string) {
    return this.svc.listGarageContracts(auth.access, { status, branchId, q });
  }

  @Post('contracts/:id/verify')
  @HttpCode(200)
  verify(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(verifyKycSchema)) dto: z.infer<typeof verifyKycSchema>,
    @Req() req: Request,
  ) {
    return this.svc.verifyKyc(auth.access, id, dto, clientIp(req));
  }

  @Post('contracts/:id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(garageCancelSchema)) dto: { reason: string },
    @Req() req: Request,
  ) {
    return this.svc.garageCancel(auth.access, id, dto.reason, clientIp(req));
  }

  @Post('contracts/:id/deposit')
  @HttpCode(200)
  deposit(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(depositSchema)) dto: z.infer<typeof depositSchema>,
    @Req() req: Request,
  ) {
    return this.svc.signDeposit(auth.access, id, dto, clientIp(req));
  }

  @Post('contracts/:id/handover')
  @HttpCode(200)
  handover(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(handoverSchema)) dto: z.infer<typeof handoverSchema>,
    @Req() req: Request,
  ) {
    return this.svc.handover(auth.access, id, dto, clientIp(req));
  }

  @Post('contracts/:id/return')
  @HttpCode(200)
  receiveReturn(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(returnSchema)) dto: z.infer<typeof returnSchema>,
    @Req() req: Request,
  ) {
    return this.svc.receiveReturn(auth.access, id, dto, clientIp(req));
  }

  @Post('contracts/:id/settle')
  @HttpCode(200)
  settle(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(settleSchema)) dto: z.infer<typeof settleSchema>,
    @Req() req: Request,
  ) {
    return this.svc.settle(auth.access, id, dto, clientIp(req));
  }
}

@RequirePermissions('platform.partner.review')
@Controller('platform/rentals')
export class PlatformRentalsController {
  constructor(private readonly svc: RentalsService) {}

  @Get('vehicles')
  vehicles(@CurrentAuth() auth: RequestAuth, @Query('status') status?: string, @Query('q') q?: string) {
    return this.svc.platformVehicles(auth.access, { status, q });
  }

  @Post('vehicles/:id/approve')
  @HttpCode(200)
  approve(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.platformModerateVehicle(auth.access, id, 'DANG_CHO_THUE', null, clientIp(req));
  }

  @Post('vehicles/:id/reject')
  @HttpCode(200)
  reject(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(reviewNoteSchema)) dto: { note: string },
    @Req() req: Request,
  ) {
    return this.svc.platformModerateVehicle(auth.access, id, 'BI_TU_CHOI', dto.note, clientIp(req));
  }

  @Post('vehicles/:id/takedown')
  @HttpCode(200)
  takedown(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(reviewNoteSchema)) dto: { note: string },
    @Req() req: Request,
  ) {
    return this.svc.platformModerateVehicle(auth.access, id, 'BI_GO', dto.note, clientIp(req));
  }

  @Get('contracts')
  contracts(@CurrentAuth() auth: RequestAuth, @Query('status') status?: string, @Query('q') q?: string) {
    return this.svc.platformContracts(auth.access, { status, q });
  }
}

@Module({
  imports: [FilesModule, OwnerModule],
  controllers: [PublicRentalsController, OwnerRentalsController, GarageRentalsController, PlatformRentalsController],
  providers: [RentalsService],
  exports: [RentalsService],
})
export class RentalsModule {}
