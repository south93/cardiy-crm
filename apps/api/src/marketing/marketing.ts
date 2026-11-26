import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
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
import { formatPlate } from '@cardiy/shared';
import { Prisma, type CustomerSource, type CustomerTier } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AccessService, type Access } from '../auth/access.service';
import { CurrentAuth, Public, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { reserveNumbers } from '../crm/counters';
import { customerSearchWhere } from '../crm/customers.service';
import { OwnerModule } from '../owner/owner';
import { OwnerGuard, type OwnerRequest } from '../owner/owner-auth';
import { PrismaService } from '../prisma/prisma.service';
import {
  CAMPAIGN_CHANNEL_LABEL,
  CAMPAIGN_STATUS_LABEL,
  campaignCode,
  computeTierForPoints,
  DEFAULT_LOYALTY_CONFIG,
  partitionAudienceByConsent,
  renderCampaignTemplate,
  segmentCode,
  TIER_LABEL,
  type CampaignChannelCode,
  type CampaignStatusCode,
  type CustomerTierCode,
} from './marketing-rules';

const num = (v: bigint | number | null | undefined) => Number(v ?? 0);
const optStr = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optPosInt = (max: number) =>
  z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? null : Number(v)),
    z.number().int().min(1).max(max).nullable().optional(),
  );

const TIERS = ['THUONG', 'BAC', 'VANG', 'KIM_CUONG'] as const;
const SOURCES = [
  'ZALO',
  'FACEBOOK',
  'TIKTOK',
  'GIOI_THIEU',
  'KHACH_CU',
  'VANG_LAI',
  'WEBSITE',
  'CUOC_GOI',
  'GARA',
  'CHAM_SOC_XE',
  'DAI_LY',
  'SAN_CARDIY',
  'KHAC',
] as const;

export const segmentRulesSchema = z.object({
  tiers: z.array(z.enum(TIERS)).default([]),
  sources: z.array(z.enum(SOURCES)).default([]),
  branchId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable().optional()),
  minSpent: optPosInt(50_000_000_000),
  inactiveDays: optPosInt(3650),
  expiringWithinDays: optPosInt(365),
});
export type SegmentRulesDto = z.infer<typeof segmentRulesSchema>;

const saveSegmentSchema = z.object({
  name: z.string().trim().min(3, 'Nhập tên phân khúc tối thiểu 3 ký tự').max(120),
  description: optStr(300),
  rules: segmentRulesSchema,
});

const loyaltyConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    vndPerPoint: z.coerce.number().int().min(1_000).max(100_000_000),
    pointValueVnd: z.coerce.number().int().min(100).max(10_000_000),
    silverPoints: z.coerce.number().int().min(1).max(1_000_000),
    goldPoints: z.coerce.number().int().min(2).max(1_000_000),
    diamondPoints: z.coerce.number().int().min(3).max(1_000_000),
  })
  .refine((x) => x.silverPoints < x.goldPoints && x.goldPoints < x.diamondPoints, {
    message: 'Ngưỡng điểm phải tăng dần: Bạc < Vàng < Kim cương',
  });

const adjustLoyaltySchema = z.object({
  customerId: z.string().uuid(),
  type: z.enum(['REDEEM', 'ADJUST']),
  points: z.coerce.number().int().refine((x) => x !== 0, 'Số điểm phải khác 0'),
  note: z.string().trim().min(3, 'Nhập ghi chú giao dịch điểm').max(300),
});

const createCampaignSchema = z.object({
  name: z.string().trim().min(3, 'Nhập tên chiến dịch').max(160),
  channel: z.enum(['APP_PUSH', 'ZALO_ZNS', 'SMS']).default('APP_PUSH'),
  segmentId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable().optional()),
  voucherId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable().optional()),
  templateCode: optStr(80),
  title: z.string().trim().min(3, 'Nhập tiêu đề thông báo').max(160),
  bodyTemplate: z.string().trim().min(10, 'Nhập nội dung tối thiểu 10 ký tự').max(2000),
});

const notificationTemplateSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3)
    .max(60)
    .regex(/^[A-Z0-9_]+$/, 'Mã mẫu chỉ gồm chữ in hoa, số và dấu gạch dưới'),
  name: z.string().trim().min(3).max(120),
  channel: z.enum(['ZNS', 'SMS', 'EMAIL', 'PUSH']).default('PUSH'),
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(10).max(2000),
  active: z.boolean().default(true),
});

const ownerConsentSchema = z.object({
  granted: z.boolean(),
  channel: z.enum(['ALL', 'ZNS', 'SMS', 'EMAIL', 'PUSH']).default('ALL'),
});

interface CandidateCustomer {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  tier: CustomerTierCode;
  source: string;
  marketingConsent: boolean;
  spentTotal: number;
  pointsBalance: number;
  linkedUserId: string | null;
}

@Injectable()
export class MarketingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertGarage(a: Access) {
    if (a.tenantType !== 'GARAGE') {
      throw new ForbiddenException('Phân hệ Marketing CRM chỉ dành cho không gian Garage PLG');
    }
  }

  private assertPlatformRead(a: Access) {
    if (a.tenantType !== 'PLATFORM' || !a.permissions.includes('platform.report.view')) {
      throw new ForbiddenException('Chỉ dành cho không gian Quản trị sàn');
    }
  }

  private assertPlatformWrite(a: Access) {
    if (a.tenantType !== 'PLATFORM' || !a.permissions.includes('platform.content.manage')) {
      throw new ForbiddenException('Chỉ bộ phận Marketing & Nội dung sàn mới được tạo mẫu tin và phát hành chiến dịch');
    }
  }

  // ---------------- Đánh giá tập khách theo bộ lọc phân khúc (tôn trọng cô lập chi nhánh) ----------------

  private branchCustomerClause(branchIds: string[]): Prisma.CustomerWhereInput {
    return {
      OR: [
        { branchId: { in: branchIds } },
        { orders: { some: { branchId: { in: branchIds } } } },
        { bookings: { some: { branchId: { in: branchIds } } } },
      ],
    };
  }

  private async evaluateGarageAudience(a: Access, rawRules: Partial<SegmentRulesDto>): Promise<CandidateCustomer[]> {
    const rules = segmentRulesSchema.parse(rawRules ?? {});
    if (rules.branchId && !AccessService.canAccessBranch(a, rules.branchId)) {
      throw new ForbiddenException('Bạn không có quyền truy cập chi nhánh này');
    }

    const andClauses: Prisma.CustomerWhereInput[] = [];
    if (rules.branchId) {
      andClauses.push(this.branchCustomerClause([rules.branchId]));
    } else if (a.branchIds !== 'ALL') {
      andClauses.push(this.branchCustomerClause(a.branchIds));
    }

    if (rules.expiringWithinDays) {
      const today = new Date();
      const limit = new Date(Date.now() + rules.expiringWithinDays * 86_400_000);
      andClauses.push({
        ownerships: {
          some: {
            toDate: null,
            vehicle: {
              deletedAt: null,
              OR: [
                { registrationExpiry: { gte: today, lte: limit } },
                { insuranceExpiry: { gte: today, lte: limit } },
              ],
            },
          },
        },
      });
    }

    const where: Prisma.CustomerWhereInput = {
      tenantId: a.tenantId,
      deletedAt: null,
      ...(rules.tiers.length ? { tier: { in: rules.tiers as CustomerTier[] } } : {}),
      ...(rules.sources.length ? { source: { in: rules.sources as CustomerSource[] } } : {}),
      ...(andClauses.length ? { AND: andClauses } : {}),
    };

    const customers = await this.prisma.customer.findMany({
      where,
      include: { appLink: { select: { userId: true } } },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    if (!customers.length) return [];

    const custIds = customers.map((c) => c.id);
    const [orderStats, pointStats] = await Promise.all([
      this.prisma.repairOrder.groupBy({
        by: ['customerId'],
        where: { tenantId: a.tenantId, customerId: { in: custIds }, status: 'DA_GIAO' },
        _sum: { total: true },
        _max: { deliveredAt: true },
      }),
      this.prisma.loyaltyTransaction.groupBy({
        by: ['customerId'],
        where: { tenantId: a.tenantId, customerId: { in: custIds } },
        _sum: { points: true },
      }),
    ]);

    const orderMap = new Map(orderStats.map((o) => [o.customerId, { spent: num(o._sum.total), lastAt: o._max.deliveredAt }]));
    const pointMap = new Map(pointStats.map((p) => [p.customerId, p._sum.points ?? 0]));
    const inactiveCutoff = rules.inactiveDays ? Date.now() - rules.inactiveDays * 86_400_000 : null;

    const matched: CandidateCustomer[] = [];
    for (const c of customers) {
      const st = orderMap.get(c.id) ?? { spent: 0, lastAt: null };
      if (rules.minSpent != null && st.spent < rules.minSpent) continue;
      if (inactiveCutoff !== null) {
        const refTime = st.lastAt ? st.lastAt.getTime() : c.createdAt.getTime();
        if (refTime > inactiveCutoff) continue;
      }
      matched.push({
        id: c.id,
        code: c.code,
        name: c.name,
        phone: c.phone,
        tier: c.tier as CustomerTierCode,
        source: c.source,
        marketingConsent: c.marketingConsent,
        spentTotal: st.spent,
        pointsBalance: pointMap.get(c.id) ?? 0,
        linkedUserId: c.appLink?.userId ?? null,
      });
    }
    return matched;
  }

  // ---------------- Tổng quan Marketing Garage PLG (A3.62) ----------------

  async garageOverview(a: Access) {
    this.assertGarage(a);
    const branchClause = a.branchIds === 'ALL' ? {} : this.branchCustomerClause(a.branchIds);
    const [totalCustomers, consentedCustomers, pointsAgg, segmentsCount, campaignsSent, activeVouchers] = await Promise.all([
      this.prisma.customer.count({ where: { tenantId: a.tenantId, deletedAt: null, ...branchClause } }),
      this.prisma.customer.count({ where: { tenantId: a.tenantId, deletedAt: null, marketingConsent: true, ...branchClause } }),
      this.prisma.loyaltyTransaction.aggregate({ where: { tenantId: a.tenantId }, _sum: { points: true } }),
      this.prisma.customerSegment.count({ where: { tenantId: a.tenantId, deletedAt: null } }),
      this.prisma.marketingCampaign.count({ where: { tenantId: a.tenantId, status: 'HOAN_THANH' } }),
      this.prisma.voucher.findMany({
        where: { tenantId: a.tenantId, active: true, endsAt: { gte: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, code: true, title: true, kind: true, value: true },
      }),
    ]);

    return {
      kpis: {
        totalCustomers,
        consentedCustomers,
        pointsCirculating: pointsAgg._sum.points ?? 0,
        segmentsCount,
        campaignsSent,
      },
      vouchers: activeVouchers,
    };
  }

  // ---------------- Cấu hình & Sổ cái tích điểm (Loyalty) ----------------

  async getLoyaltyConfig(a: Access) {
    this.assertGarage(a);
    const row = await this.prisma.loyaltyConfig.findUnique({ where: { tenantId: a.tenantId } });
    return row ?? { tenantId: a.tenantId, ...DEFAULT_LOYALTY_CONFIG };
  }

  async saveLoyaltyConfig(a: Access, dto: z.infer<typeof loyaltyConfigSchema>, ip?: string) {
    this.assertGarage(a);
    const saved = await this.prisma.loyaltyConfig.upsert({
      where: { tenantId: a.tenantId },
      create: { tenantId: a.tenantId, ...dto },
      update: dto,
    });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'loyalty_config.updated',
      entity: 'loyalty_config',
      entityId: a.tenantId,
      after: dto,
      ip,
    });
    return saved;
  }

  async listLoyaltyCustomers(a: Access, q?: string) {
    this.assertGarage(a);
    const andClauses: Prisma.CustomerWhereInput[] = [];
    if (a.branchIds !== 'ALL') andClauses.push(this.branchCustomerClause(a.branchIds));
    if (q?.trim()) andClauses.push(customerSearchWhere(q.trim()));

    const where: Prisma.CustomerWhereInput = {
      tenantId: a.tenantId,
      deletedAt: null,
      ...(andClauses.length ? { AND: andClauses } : {}),
    };
    const customers = await this.prisma.customer.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 60,
      select: { id: true, code: true, name: true, phone: true, tier: true, marketingConsent: true },
    });
    if (!customers.length) return [];

    const ids = customers.map((c) => c.id);
    const [balRows, earnRows] = await Promise.all([
      this.prisma.loyaltyTransaction.groupBy({
        by: ['customerId'],
        where: { tenantId: a.tenantId, customerId: { in: ids } },
        _sum: { points: true },
      }),
      this.prisma.loyaltyTransaction.groupBy({
        by: ['customerId'],
        where: { tenantId: a.tenantId, customerId: { in: ids }, type: 'EARN' },
        _sum: { points: true },
      }),
    ]);
    const balMap = new Map(balRows.map((r) => [r.customerId, r._sum.points ?? 0]));
    const earnMap = new Map(earnRows.map((r) => [r.customerId, r._sum.points ?? 0]));

    return customers
      .map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        phone: c.phone,
        tier: c.tier as CustomerTierCode,
        tierLabel: TIER_LABEL[c.tier as CustomerTierCode],
        marketingConsent: c.marketingConsent,
        balance: balMap.get(c.id) ?? 0,
        lifetimeEarned: earnMap.get(c.id) ?? 0,
      }))
      .sort((x, y) => y.balance - x.balance || y.lifetimeEarned - x.lifetimeEarned);
  }

  async customerLoyaltyHistory(a: Access, customerId: string) {
    this.assertGarage(a);
    const cust = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId: a.tenantId, deletedAt: null } });
    if (!cust) throw new NotFoundException('Không tìm thấy khách hàng');
    const rows = await this.prisma.loyaltyTransaction.findMany({
      where: { tenantId: a.tenantId, customerId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows;
  }

  async adjustCustomerLoyalty(a: Access, dto: z.infer<typeof adjustLoyaltySchema>, ip?: string) {
    this.assertGarage(a);
    return this.prisma.$transaction(async (tx) => {
      const cust = await tx.customer.findFirst({ where: { id: dto.customerId, tenantId: a.tenantId, deletedAt: null } });
      if (!cust) throw new NotFoundException('Không tìm thấy khách hàng');

      const delta = dto.type === 'REDEEM' ? -Math.abs(dto.points) : dto.points;
      const [balAgg, earnAgg, cfgRow] = await Promise.all([
        tx.loyaltyTransaction.aggregate({ where: { tenantId: a.tenantId, customerId: cust.id }, _sum: { points: true } }),
        tx.loyaltyTransaction.aggregate({ where: { tenantId: a.tenantId, customerId: cust.id, type: 'EARN' }, _sum: { points: true } }),
        tx.loyaltyConfig.findUnique({ where: { tenantId: a.tenantId } }),
      ]);
      const curBalance = balAgg._sum.points ?? 0;
      const balanceAfter = curBalance + delta;
      if (balanceAfter < 0) {
        throw new ConflictException(`Khách hiện có ${curBalance} điểm, không đủ để đổi ${Math.abs(delta)} điểm`);
      }

      const row = await tx.loyaltyTransaction.create({
        data: {
          tenantId: a.tenantId,
          customerId: cust.id,
          type: dto.type,
          points: delta,
          balanceAfter,
          note: dto.note,
          createdBy: a.userId,
        },
      });

      const cfg = cfgRow ?? DEFAULT_LOYALTY_CONFIG;
      const lifetime = (earnAgg._sum.points ?? 0) + (delta > 0 && dto.type === 'ADJUST' ? delta : 0);
      const nextTier = computeTierForPoints(lifetime, cust.tier as CustomerTierCode, cfg);
      if (nextTier !== cust.tier) {
        await tx.customer.update({ where: { id: cust.id }, data: { tier: nextTier } });
      }

      const link = await tx.customerLink.findUnique({ where: { customerId: cust.id }, select: { userId: true } });
      if (link) {
        await tx.ownerNotification.create({
          data: {
            userId: link.userId,
            tenantId: a.tenantId,
            kind: 'LOYALTY',
            title: delta > 0 ? `Cộng +${delta} điểm thưởng` : `Đổi ${Math.abs(delta)} điểm ưu đãi`,
            body: `${dto.note} · Số dư hiện tại: ${balanceAfter} điểm.`,
          },
        });
      }

      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: `loyalty.${dto.type.toLowerCase()}`,
          entity: 'customer',
          entityId: cust.id,
          after: { delta, balanceAfter, note: dto.note },
          ip,
        },
        tx,
      );
      return { transactionId: row.id, balanceAfter, tier: nextTier };
    });
  }

  // ---------------- Phân khúc khách hàng (PK…) ----------------

  async listSegments(a: Access) {
    this.assertGarage(a);
    const rows = await this.prisma.customerSegment.findMany({
      where: { tenantId: a.tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const out = [];
    for (const s of rows) {
      const matched = await this.evaluateGarageAudience(a, s.rules as Partial<SegmentRulesDto>);
      const { eligible, skippedNoConsent } = partitionAudienceByConsent(matched);
      out.push({
        id: s.id,
        code: s.code,
        name: s.name,
        description: s.description,
        rules: s.rules,
        totalMatched: matched.length,
        consentedCount: eligible.length,
        unconsentedCount: skippedNoConsent.length,
        createdAt: s.createdAt,
      });
    }
    return out;
  }

  async previewSegment(a: Access, rules: SegmentRulesDto) {
    this.assertGarage(a);
    const matched = await this.evaluateGarageAudience(a, rules);
    const { eligible, skippedNoConsent } = partitionAudienceByConsent(matched);
    return {
      totalMatched: matched.length,
      consentedCount: eligible.length,
      unconsentedCount: skippedNoConsent.length,
      sampleCustomers: matched.slice(0, 15).map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        phone: c.phone,
        tier: c.tier,
        tierLabel: TIER_LABEL[c.tier],
        marketingConsent: c.marketingConsent,
        spentTotal: c.spentTotal,
        pointsBalance: c.pointsBalance,
      })),
    };
  }

  async createSegment(a: Access, dto: z.infer<typeof saveSegmentSchema>, ip?: string) {
    this.assertGarage(a);
    if (dto.rules.branchId && !AccessService.canAccessBranch(a, dto.rules.branchId)) {
      throw new ForbiddenException('Bạn không có quyền tạo phân khúc cho chi nhánh này');
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const code = segmentCode(await reserveNumbers(tx, a.tenantId, 'customer_segment'));
      const row = await tx.customerSegment.create({
        data: {
          tenantId: a.tenantId,
          code,
          name: dto.name,
          description: dto.description ?? null,
          rules: dto.rules as unknown as Prisma.InputJsonValue,
          createdBy: a.userId,
        },
      });
      await this.audit.log(
        { tenantId: a.tenantId, actorId: a.userId, action: 'segment.created', entity: 'customer_segment', entityId: row.id, after: { code, name: dto.name }, ip },
        tx,
      );
      return row;
    });
    const preview = await this.previewSegment(a, dto.rules);
    return { ...created, ...preview };
  }

  // ---------------- Chiến dịch Marketing Garage PLG (CD… · A3.62) ----------------

  private campaignView(c: Prisma.MarketingCampaignGetPayload<{ include: { segment: true } }>) {
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      channel: c.channel as CampaignChannelCode,
      channelLabel: CAMPAIGN_CHANNEL_LABEL[c.channel as CampaignChannelCode],
      segmentId: c.segmentId,
      segmentName: c.segment?.name ?? 'Toàn bộ khách hàng',
      voucherId: c.voucherId,
      templateCode: c.templateCode,
      title: c.title,
      bodyTemplate: c.bodyTemplate,
      status: c.status as CampaignStatusCode,
      statusLabel: CAMPAIGN_STATUS_LABEL[c.status as CampaignStatusCode],
      sentAt: c.sentAt,
      totalMatched: c.totalMatched,
      sentCount: c.sentCount,
      skippedNoConsent: c.skippedNoConsent,
      createdAt: c.createdAt,
    };
  }

  async listGarageCampaigns(a: Access) {
    this.assertGarage(a);
    const rows = await this.prisma.marketingCampaign.findMany({
      where: { tenantId: a.tenantId },
      include: { segment: true },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });
    return rows.map((r) => this.campaignView(r));
  }

  async getGarageCampaign(a: Access, id: string) {
    this.assertGarage(a);
    const row = await this.prisma.marketingCampaign.findFirst({
      where: { id, tenantId: a.tenantId },
      include: { segment: true, deliveries: { orderBy: { createdAt: 'asc' }, take: 200 } },
    });
    if (!row) throw new NotFoundException('Không tìm thấy chiến dịch');
    return {
      ...this.campaignView(row),
      deliveries: row.deliveries,
    };
  }

  async createGarageCampaign(a: Access, dto: z.infer<typeof createCampaignSchema>, ip?: string) {
    this.assertGarage(a);
    if (dto.segmentId) {
      const seg = await this.prisma.customerSegment.findFirst({ where: { id: dto.segmentId, tenantId: a.tenantId, deletedAt: null } });
      if (!seg) throw new BadRequestException('Phân khúc khách hàng không hợp lệ');
    }
    if (dto.voucherId) {
      const v = await this.prisma.voucher.findFirst({ where: { id: dto.voucherId, tenantId: a.tenantId } });
      if (!v) throw new BadRequestException('Voucher không thuộc garage');
    }

    const saved = await this.prisma.$transaction(async (tx) => {
      const code = campaignCode(await reserveNumbers(tx, a.tenantId, 'marketing_campaign'));
      const row = await tx.marketingCampaign.create({
        data: {
          tenantId: a.tenantId,
          code,
          name: dto.name,
          channel: dto.channel,
          segmentId: dto.segmentId ?? null,
          voucherId: dto.voucherId ?? null,
          templateCode: dto.templateCode ?? null,
          title: dto.title,
          bodyTemplate: dto.bodyTemplate,
          status: 'NHAP',
          createdBy: a.userId,
        },
        include: { segment: true },
      });
      await this.audit.log(
        { tenantId: a.tenantId, actorId: a.userId, action: 'campaign.created', entity: 'marketing_campaign', entityId: row.id, after: { code, name: dto.name }, ip },
        tx,
      );
      return row;
    });
    return this.campaignView(saved);
  }

  /**
   * Phát hành chiến dịch của Garage PLG:
   * BẮT BUỘC chỉ gửi cho khách có `marketingConsent = true`; khách chưa đồng ý ghi rõ SKIPPED_NO_CONSENT.
   */
  async sendGarageCampaign(a: Access, id: string, ip?: string) {
    this.assertGarage(a);
    const camp = await this.prisma.marketingCampaign.findFirst({
      where: { id, tenantId: a.tenantId },
      include: { segment: true },
    });
    if (!camp) throw new NotFoundException('Không tìm thấy chiến dịch');
    if (camp.status !== 'NHAP' && camp.status !== 'DA_LEN_LICH') {
      throw new ConflictException('Chiến dịch đã được phát hành hoặc đã huỷ');
    }

    const [tenant, voucher] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { name: true, printSettings: true } }),
      camp.voucherId ? this.prisma.voucher.findUnique({ where: { id: camp.voucherId }, select: { code: true } }) : null,
    ]);
    const garageDisplay = (tenant.printSettings as { displayName?: string } | null)?.displayName || tenant.name;
    const rules = (camp.segment?.rules ?? {}) as Partial<SegmentRulesDto>;
    const matched = await this.evaluateGarageAudience(a, rules);
    const { eligible, skippedNoConsent } = partitionAudienceByConsent(matched);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      for (const c of eligible) {
        const vars = {
          ten_khach: c.name,
          hang_the: TIER_LABEL[c.tier],
          diem_thuong: c.pointsBalance,
          ma_voucher: voucher?.code ?? '',
          ten_garage: garageDisplay,
        };
        const renderedTitle = renderCampaignTemplate(camp.title, vars);
        const renderedBody = renderCampaignTemplate(camp.bodyTemplate, vars);

        await tx.campaignDelivery.create({
          data: {
            campaignId: camp.id,
            customerId: c.id,
            userId: c.linkedUserId,
            recipientName: c.name,
            phone: c.phone,
            status: 'SENT',
            renderedBody,
          },
        });

        if (c.linkedUserId) {
          await tx.ownerNotification.create({
            data: {
              userId: c.linkedUserId,
              tenantId: a.tenantId,
              campaignId: camp.id,
              kind: 'CAMPAIGN',
              title: renderedTitle,
              body: renderedBody,
            },
          });
        }
      }

      for (const c of skippedNoConsent) {
        await tx.campaignDelivery.create({
          data: {
            campaignId: camp.id,
            customerId: c.id,
            userId: c.linkedUserId,
            recipientName: c.name,
            phone: c.phone,
            status: 'SKIPPED_NO_CONSENT',
            reason: 'Khách chưa đồng ý nhận tin khuyến mại (marketingConsent = false)',
          },
        });
      }

      await tx.marketingCampaign.update({
        where: { id: camp.id },
        data: {
          status: 'HOAN_THANH',
          sentAt: now,
          totalMatched: matched.length,
          sentCount: eligible.length,
          skippedNoConsent: skippedNoConsent.length,
        },
      });

      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'campaign.sent',
          entity: 'marketing_campaign',
          entityId: camp.id,
          after: { totalMatched: matched.length, sentCount: eligible.length, skippedNoConsent: skippedNoConsent.length },
          ip,
        },
        tx,
      );
    });

    return this.getGarageCampaign(a, camp.id);
  }

  // ---------------- Quản trị sàn A6.63: Mẫu thông báo & Chiến dịch toàn sàn ----------------

  async platformListTemplates(a: Access) {
    this.assertPlatformRead(a);
    return this.prisma.notificationTemplate.findMany({ orderBy: { code: 'asc' } });
  }

  async platformCreateTemplate(a: Access, dto: z.infer<typeof notificationTemplateSchema>, ip?: string) {
    this.assertPlatformWrite(a);
    const dup = await this.prisma.notificationTemplate.findUnique({ where: { code: dto.code } });
    if (dup) throw new ConflictException(`Mã mẫu thông báo ${dto.code} đã tồn tại`);
    const saved = await this.prisma.notificationTemplate.create({
      data: { ...dto, updatedBy: a.userId },
    });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'notification_template.created',
      entity: 'notification_template',
      entityId: saved.id,
      after: { code: dto.code, channel: dto.channel },
      ip,
    });
    return saved;
  }

  async platformUpdateTemplate(a: Access, id: string, dto: z.infer<typeof notificationTemplateSchema>, ip?: string) {
    this.assertPlatformWrite(a);
    const cur = await this.prisma.notificationTemplate.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Không tìm thấy mẫu thông báo');
    const saved = await this.prisma.notificationTemplate.update({
      where: { id },
      data: {
        name: dto.name,
        channel: dto.channel,
        title: dto.title,
        body: dto.body,
        active: dto.active,
        updatedBy: a.userId,
      },
    });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'notification_template.updated',
      entity: 'notification_template',
      entityId: id,
      after: { code: cur.code, active: dto.active },
      ip,
    });
    return saved;
  }

  async platformListCampaigns(a: Access) {
    this.assertPlatformRead(a);
    const rows = await this.prisma.marketingCampaign.findMany({
      where: { tenantId: a.tenantId },
      include: { segment: true },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });
    return rows.map((r) => this.campaignView(r));
  }

  async platformCreateAndSendCampaign(a: Access, dto: z.infer<typeof createCampaignSchema>, ip?: string) {
    this.assertPlatformWrite(a);

    // Lấy danh sách tất cả chủ xe (users có liên kết CustomerLink) và kiểm tra Consent mới nhất
    const links = await this.prisma.customerLink.findMany({
      include: {
        user: { select: { id: true, fullName: true, phone: true } },
        customer: { select: { marketingConsent: true } },
      },
    });
    const byUser = new Map<string, { userId: string; name: string; phone: string; anyCustomerConsent: boolean }>();
    for (const l of links) {
      const prev = byUser.get(l.userId);
      byUser.set(l.userId, {
        userId: l.userId,
        name: l.user.fullName,
        phone: l.user.phone,
        anyCustomerConsent: (prev?.anyCustomerConsent ?? false) || l.customer.marketingConsent,
      });
    }

    const userIds = [...byUser.keys()];
    const consents = userIds.length
      ? await this.prisma.consent.findMany({
          where: { userId: { in: userIds }, purpose: 'MARKETING' },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const latestConsentByUser = new Map<string, boolean>();
    for (const cs of consents) {
      if (!latestConsentByUser.has(cs.userId)) latestConsentByUser.set(cs.userId, cs.granted);
    }

    const candidates = [...byUser.values()].map((u) => ({
      ...u,
      marketingConsent: latestConsentByUser.has(u.userId) ? latestConsentByUser.get(u.userId)! : u.anyCustomerConsent,
    }));
    const { eligible, skippedNoConsent } = partitionAudienceByConsent(candidates);
    const now = new Date();

    const saved = await this.prisma.$transaction(async (tx) => {
      const code = campaignCode(await reserveNumbers(tx, a.tenantId, 'marketing_campaign'));
      const camp = await tx.marketingCampaign.create({
        data: {
          tenantId: a.tenantId,
          code,
          name: dto.name,
          channel: dto.channel,
          templateCode: dto.templateCode ?? null,
          title: dto.title,
          bodyTemplate: dto.bodyTemplate,
          status: 'HOAN_THANH',
          sentAt: now,
          totalMatched: candidates.length,
          sentCount: eligible.length,
          skippedNoConsent: skippedNoConsent.length,
          createdBy: a.userId,
        },
        include: { segment: true },
      });

      for (const u of eligible) {
        const vars = { ten_khach: u.name, ten_garage: 'Sàn CARDIY' };
        const renderedTitle = renderCampaignTemplate(dto.title, vars);
        const renderedBody = renderCampaignTemplate(dto.bodyTemplate, vars);
        await tx.campaignDelivery.create({
          data: {
            campaignId: camp.id,
            userId: u.userId,
            recipientName: u.name,
            phone: u.phone,
            status: 'SENT',
            renderedBody,
          },
        });
        await tx.ownerNotification.create({
          data: {
            userId: u.userId,
            tenantId: a.tenantId,
            campaignId: camp.id,
            kind: 'CAMPAIGN',
            title: renderedTitle,
            body: renderedBody,
          },
        });
      }

      for (const u of skippedNoConsent) {
        await tx.campaignDelivery.create({
          data: {
            campaignId: camp.id,
            userId: u.userId,
            recipientName: u.name,
            phone: u.phone,
            status: 'SKIPPED_NO_CONSENT',
            reason: 'Chủ xe chưa bật đồng ý nhận tin khuyến mại',
          },
        });
      }

      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'platform_campaign.sent',
          entity: 'marketing_campaign',
          entityId: camp.id,
          after: { code, totalMatched: candidates.length, sentCount: eligible.length, skippedNoConsent: skippedNoConsent.length },
          ip,
        },
        tx,
      );
      return camp;
    });

    return this.campaignView(saved);
  }

  // ---------------- App chủ xe: Điểm thưởng & Voucher (A2.07), Thông báo (A2.12), Quyền riêng tư (A2.13) ----------------

  async ownerLoyaltyAndVouchers(userId: string) {
    const links = await this.prisma.customerLink.findMany({
      where: { userId, customer: { deletedAt: null } },
      include: { customer: true },
    });
    if (!links.length) return { wallets: [], vouchers: [] };

    const tenantIds = [...new Set(links.map((l) => l.tenantId))];
    const custIds = links.map((l) => l.customerId);
    const [tenants, txs, vouchers] = await Promise.all([
      this.prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true, printSettings: true } }),
      this.prisma.loyaltyTransaction.findMany({
        where: { customerId: { in: custIds } },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      this.prisma.voucher.findMany({
        where: { tenantId: { in: tenantIds }, active: true, endsAt: { gte: new Date() } },
        orderBy: { endsAt: 'asc' },
      }),
    ]);
    const tMap = new Map(tenants.map((t) => [t.id, (t.printSettings as { displayName?: string } | null)?.displayName || t.name]));

    const wallets = links.map((l) => {
      const myTxs = txs.filter((x) => x.customerId === l.customerId);
      const balance = myTxs.reduce((s, x) => s + x.points, 0);
      return {
        customerId: l.customerId,
        tenantId: l.tenantId,
        garageName: tMap.get(l.tenantId) ?? 'Garage',
        tier: l.customer.tier as CustomerTierCode,
        tierLabel: TIER_LABEL[l.customer.tier as CustomerTierCode],
        balance,
        recentTransactions: myTxs.slice(0, 10),
      };
    });

    return {
      wallets,
      vouchers: vouchers.map((v) => ({
        id: v.id,
        code: v.code,
        title: v.title,
        kind: v.kind,
        value: v.value,
        minOrder: num(v.minOrder),
        maxDiscount: v.maxDiscount !== null ? num(v.maxDiscount) : null,
        endsAt: v.endsAt,
        garageName: tMap.get(v.tenantId) ?? 'Garage',
      })),
    };
  }

  async ownerNotifications(userId: string) {
    const [items, unreadCount] = await Promise.all([
      this.prisma.ownerNotification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.ownerNotification.count({ where: { userId, readAt: null } }),
    ]);
    return { unreadCount, items };
  }

  async ownerMarkAllRead(userId: string) {
    await this.prisma.ownerNotification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { status: 'ok' };
  }

  async ownerGetPrivacy(userId: string) {
    const [consents, links] = await Promise.all([
      this.prisma.consent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.customerLink.findMany({ where: { userId }, include: { customer: { select: { marketingConsent: true } } } }),
    ]);
    const latest = consents.find((c) => c.purpose === 'MARKETING');
    const marketingConsent = latest ? latest.granted : links.some((l) => l.customer.marketingConsent);
    return {
      marketingConsent,
      history: consents,
    };
  }

  async ownerUpdateConsent(userId: string, dto: z.infer<typeof ownerConsentSchema>, ip?: string) {
    const links = await this.prisma.customerLink.findMany({ where: { userId }, select: { customerId: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.consent.create({
        data: {
          userId,
          channel: dto.channel,
          purpose: 'MARKETING',
          granted: dto.granted,
          ip: ip ?? null,
        },
      });
      if (links.length) {
        await tx.customer.updateMany({
          where: { id: { in: links.map((l) => l.customerId) } },
          data: { marketingConsent: dto.granted },
        });
      }
    });
    return this.ownerGetPrivacy(userId);
  }

  /** A2.13 Xuất toàn bộ dữ liệu cá nhân của chủ xe (Nghị định 13/2023 & nguyên tắc 1.4 #8) */
  async ownerExportPersonalData(userId: string) {
    const [user, links, consents, notifications] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, fullName: true, phone: true, email: true, createdAt: true },
      }),
      this.prisma.customerLink.findMany({
        where: { userId },
        include: {
          customer: {
            include: {
              ownerships: { where: { toDate: null }, include: { vehicle: true } },
            },
          },
        },
      }),
      this.prisma.consent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.ownerNotification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    ]);

    const custIds = links.map((l) => l.customerId);
    const [orders, bookings, loyalty] = custIds.length
      ? await Promise.all([
          this.prisma.repairOrder.findMany({
            where: { customerId: { in: custIds } },
            select: { code: true, status: true, total: true, paid: true, receivedAt: true, deliveredAt: true },
            orderBy: { receivedAt: 'desc' },
          }),
          this.prisma.booking.findMany({
            where: { customerId: { in: custIds } },
            select: { code: true, status: true, scheduledAt: true, service: true, note: true },
            orderBy: { scheduledAt: 'desc' },
          }),
          this.prisma.loyaltyTransaction.findMany({
            where: { customerId: { in: custIds } },
            orderBy: { createdAt: 'desc' },
          }),
        ])
      : [[], [], []];

    return {
      exportedAt: new Date().toISOString(),
      account: user,
      profiles: links.map((l) => ({
        customerCode: l.customer.code,
        name: l.customer.name,
        tier: l.customer.tier,
        marketingConsent: l.customer.marketingConsent,
        vehicles: l.customer.ownerships.map((o) => ({
          plate: formatPlate(o.vehicle.plateNo),
          make: o.vehicle.make,
          model: o.vehicle.model,
          year: o.vehicle.year,
          odometerKm: o.vehicle.odometerKm,
        })),
      })),
      repairOrders: orders.map((o) => ({ ...o, total: num(o.total), paid: num(o.paid) })),
      bookings,
      loyaltyTransactions: loyalty,
      consentHistory: consents,
      notificationsCount: notifications.length,
    };
  }
}

@RequirePermissions('marketing.manage')
@Controller('marketing')
export class GarageMarketingController {
  constructor(private readonly svc: MarketingService) {}

  @Get('overview')
  overview(@CurrentAuth() auth: RequestAuth) {
    return this.svc.garageOverview(auth.access);
  }

  @Get('loyalty/config')
  getLoyaltyConfig(@CurrentAuth() auth: RequestAuth) {
    return this.svc.getLoyaltyConfig(auth.access);
  }

  @Put('loyalty/config')
  saveLoyaltyConfig(
    @CurrentAuth() auth: RequestAuth,
    @Body(new ZodPipe(loyaltyConfigSchema)) dto: z.infer<typeof loyaltyConfigSchema>,
    @Req() req: Request,
  ) {
    return this.svc.saveLoyaltyConfig(auth.access, dto, clientIp(req));
  }

  @Get('loyalty/customers')
  loyaltyCustomers(@CurrentAuth() auth: RequestAuth, @Query('q') q?: string) {
    return this.svc.listLoyaltyCustomers(auth.access, q);
  }

  @Get('loyalty/customers/:customerId')
  loyaltyHistory(@CurrentAuth() auth: RequestAuth, @Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.svc.customerLoyaltyHistory(auth.access, customerId);
  }

  @Post('loyalty/adjust')
  adjustLoyalty(
    @CurrentAuth() auth: RequestAuth,
    @Body(new ZodPipe(adjustLoyaltySchema)) dto: z.infer<typeof adjustLoyaltySchema>,
    @Req() req: Request,
  ) {
    return this.svc.adjustCustomerLoyalty(auth.access, dto, clientIp(req));
  }

  @Get('segments')
  segments(@CurrentAuth() auth: RequestAuth) {
    return this.svc.listSegments(auth.access);
  }

  @Post('segments/preview')
  @HttpCode(200)
  preview(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(segmentRulesSchema)) rules: SegmentRulesDto) {
    return this.svc.previewSegment(auth.access, rules);
  }

  @Post('segments')
  createSegment(
    @CurrentAuth() auth: RequestAuth,
    @Body(new ZodPipe(saveSegmentSchema)) dto: z.infer<typeof saveSegmentSchema>,
    @Req() req: Request,
  ) {
    return this.svc.createSegment(auth.access, dto, clientIp(req));
  }

  @Get('campaigns')
  campaigns(@CurrentAuth() auth: RequestAuth) {
    return this.svc.listGarageCampaigns(auth.access);
  }

  @Get('campaigns/:id')
  campaign(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getGarageCampaign(auth.access, id);
  }

  @Post('campaigns')
  createCampaign(
    @CurrentAuth() auth: RequestAuth,
    @Body(new ZodPipe(createCampaignSchema)) dto: z.infer<typeof createCampaignSchema>,
    @Req() req: Request,
  ) {
    return this.svc.createGarageCampaign(auth.access, dto, clientIp(req));
  }

  @Post('campaigns/:id/send')
  @HttpCode(200)
  sendCampaign(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.sendGarageCampaign(auth.access, id, clientIp(req));
  }
}

@Controller('platform/notifications')
export class PlatformMarketingController {
  constructor(private readonly svc: MarketingService) {}

  @Get('templates')
  templates(@CurrentAuth() auth: RequestAuth) {
    return this.svc.platformListTemplates(auth.access);
  }

  @Post('templates')
  createTemplate(
    @CurrentAuth() auth: RequestAuth,
    @Body(new ZodPipe(notificationTemplateSchema)) dto: z.infer<typeof notificationTemplateSchema>,
    @Req() req: Request,
  ) {
    return this.svc.platformCreateTemplate(auth.access, dto, clientIp(req));
  }

  @Put('templates/:id')
  updateTemplate(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(notificationTemplateSchema)) dto: z.infer<typeof notificationTemplateSchema>,
    @Req() req: Request,
  ) {
    return this.svc.platformUpdateTemplate(auth.access, id, dto, clientIp(req));
  }

  @Get('campaigns')
  campaigns(@CurrentAuth() auth: RequestAuth) {
    return this.svc.platformListCampaigns(auth.access);
  }

  @Post('campaigns/send')
  sendCampaign(
    @CurrentAuth() auth: RequestAuth,
    @Body(new ZodPipe(createCampaignSchema)) dto: z.infer<typeof createCampaignSchema>,
    @Req() req: Request,
  ) {
    return this.svc.platformCreateAndSendCampaign(auth.access, dto, clientIp(req));
  }
}

@Public()
@UseGuards(OwnerGuard)
@Controller('owner')
export class OwnerMarketingController {
  constructor(private readonly svc: MarketingService) {}

  @Get('loyalty')
  loyalty(@Req() req: OwnerRequest) {
    return this.svc.ownerLoyaltyAndVouchers(req.owner!.userId);
  }

  @Get('notifications')
  notifications(@Req() req: OwnerRequest) {
    return this.svc.ownerNotifications(req.owner!.userId);
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  readAll(@Req() req: OwnerRequest) {
    return this.svc.ownerMarkAllRead(req.owner!.userId);
  }

  @Get('privacy')
  privacy(@Req() req: OwnerRequest) {
    return this.svc.ownerGetPrivacy(req.owner!.userId);
  }

  @Put('privacy/consent')
  updateConsent(@Req() req: OwnerRequest, @Body(new ZodPipe(ownerConsentSchema)) dto: z.infer<typeof ownerConsentSchema>) {
    return this.svc.ownerUpdateConsent(req.owner!.userId, dto, clientIp(req));
  }

  @Get('privacy/export')
  exportData(@Req() req: OwnerRequest) {
    return this.svc.ownerExportPersonalData(req.owner!.userId);
  }
}

@Module({
  imports: [OwnerModule],
  controllers: [GarageMarketingController, PlatformMarketingController, OwnerMarketingController],
  providers: [MarketingService],
  exports: [MarketingService],
})
export class MarketingModule {}
