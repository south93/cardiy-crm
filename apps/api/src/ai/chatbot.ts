import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { formatPlate } from '@cardiy/shared';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../common/auth.decorators';
import { clientIp } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { AppConfig } from '../config/app-config';
import { availableStock, tenantListable, type OpeningDay } from '../marketplace/offer-rules';
import { expireStale, heldQty, RequestsService } from '../marketplace/requests';
import { OwnerGuard, type OwnerRequest } from '../owner/owner-auth';
import { OwnerBookingService } from '../owner/owner-booking';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { redactPiiForAi, scoreKnowledgeDocs } from './ai-rules';
import {
  buildMaintenanceChecklistByKm,
  detectBookingIntent,
  detectMaintenanceIntent,
  matchMarketplaceOffers,
  parseVehicleAndKmFromText,
  proposeOwnerBookingSlots,
  proposeShopRequestSlots,
  type ChatbotOfferCandidate,
  type MaintenancePlan,
} from './chatbot-rules';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const publicAskSchema = z.object({
  sessionToken: z
    .preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().min(16).max(120).nullable())
    .optional(),
  message: z.string().trim().min(2, 'Nhập câu hỏi hoặc nhu cầu của bạn').max(1500),
  vehicleMake: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(60).nullable()).optional(),
  vehicleModel: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(60).nullable()).optional(),
  odometerKm: z
    .preprocess(
      (v) => (v === '' || v === null || v === undefined ? null : Number(v)),
      z.number().int().min(0).max(1_000_000).nullable(),
    )
    .optional(),
  offerId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable()).optional(),
  wantBooking: z.boolean().optional().default(false),
});

const publicConfirmSchema = z.object({
  sessionToken: z.string().trim().min(16).max(120),
  scheduledAt: z.string().trim().min(10).max(50),
  name: z.string().trim().min(2, 'Nhập họ tên người đặt').max(100),
  phone: z.string().trim().min(9, 'Nhập số điện thoại liên hệ').max(20),
  plateNo: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().toUpperCase().max(15).nullable()).optional(),
  quantity: z.coerce.number().int().min(1).max(20).optional().default(1),
  voucherCode: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().toUpperCase().max(30).nullable()).optional(),
  note: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(500).nullable()).optional(),
});

const publicDismissSchema = z.object({
  sessionToken: z.string().trim().min(16).max(120),
});

const ownerAskSchema = z.object({
  message: z.string().trim().min(2, 'Nhập câu hỏi cần tư vấn').max(1500),
  vehicleId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable()).optional(),
  branchId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable()).optional(),
  odometerKm: z
    .preprocess(
      (v) => (v === '' || v === null || v === undefined ? null : Number(v)),
      z.number().int().min(0).max(1_000_000).nullable(),
    )
    .optional(),
  wantBooking: z.boolean().optional().default(false),
});

const ownerConfirmSchema = z.object({
  scheduledAt: z.string().trim().min(10).max(50),
  branchId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable()).optional(),
  vehicleId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable()).optional(),
  service: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().min(2).max(200).nullable()).optional(),
  note: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(500).nullable()).optional(),
});

export interface PublicOfferCardView {
  offerId: string;
  kind: 'PRODUCT' | 'SERVICE';
  itemCode: string;
  name: string;
  brand: string | null;
  category: string | null;
  price: number;
  priceFrom: boolean;
  installIncluded: boolean;
  durationMinutes: number | null;
  available: number | null;
  shopName: string;
  shopSlug: string;
  itemHref: string;
  bookHref: string;
}

@Injectable()
export class ChatbotService {
  private readonly log = new Logger(ChatbotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
    private readonly requests: RequestsService,
    private readonly ownerBookings: OwnerBookingService,
  ) {}

  private async checkRateLimit(ip?: string) {
    const key = `chatbot:ip:${ip ?? 'na'}`;
    const current = Number((await this.redis.client.get(key)) ?? 0);
    if (current >= 40) {
      throw new HttpException('Bạn gửi quá nhiều tin nhắn tư vấn, vui lòng thử lại sau ít phút', HttpStatus.TOO_MANY_REQUESTS);
    }
    const next = await this.redis.client.incr(key);
    if (next === 1) await this.redis.client.expire(key, 3600);
  }

  private async callExternalLlmIfConfigured(systemPrompt: string, sanitizedPayload: string): Promise<{ text: string; provider: string } | null> {
    if (this.config.get('AI_PROVIDER') !== 'http') return null;
    const url = this.config.get('AI_API_URL');
    const key = this.config.get('AI_API_KEY');
    const model = this.config.get('AI_MODEL') ?? 'gpt-4o-mini';
    if (!url || !key) return null;

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: sanitizedPayload },
          ],
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) return null;
      const body = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
      const text = body.choices?.[0]?.message?.content?.trim();
      return text ? { text, provider: `http:${model}` } : null;
    } catch (err) {
      this.log.warn(`Chatbot external LLM fallback sang heuristic: ${(err as Error).message}`);
      return null;
    }
  }

  /** Chỉ đọc các tin đang bán (DANG_BAN) thuộc gian hàng đang hoạt động hợp lệ trên sàn */
  private async loadListableOffers(): Promise<ChatbotOfferCandidate[]> {
    await expireStale(this.prisma);
    const shops = await this.prisma.shop.findMany();
    if (!shops.length) return [];

    const tenants = await this.prisma.tenant.findMany({
      where: { id: { in: shops.map((s) => s.tenantId) } },
      select: { id: true, type: true, status: true, deletedAt: true },
    });
    const okTenantIds = new Set(tenants.filter(tenantListable).map((t) => t.id));
    const shopByTenant = new Map(shops.filter((s) => okTenantIds.has(s.tenantId)).map((s) => [s.tenantId, s]));
    if (!shopByTenant.size) return [];

    const rows = await this.prisma.offer.findMany({
      where: { tenantId: { in: [...shopByTenant.keys()] }, status: 'DANG_BAN' },
      include: { catalogItem: { include: { category: true } } },
      orderBy: { price: 'asc' },
      take: 300,
    });
    if (!rows.length) return [];

    const productIds = [...new Set(rows.map((r) => r.productId).filter((x): x is string => !!x))];
    const [levels, held] = await Promise.all([
      productIds.length ? this.prisma.stockLevel.findMany({ where: { productId: { in: productIds } } }) : Promise.resolve([]),
      heldQty(
        this.prisma,
        rows.map((r) => r.id),
      ),
    ]);

    return rows.map((o) => {
      const shop = shopByTenant.get(o.tenantId)!;
      const raw = availableStock(
        o,
        levels.filter((l) => l.productId === o.productId).map((l) => ({ branchId: l.branchId, quantity: Number(l.quantity) })),
      );
      const stock = raw === null ? null : Math.max(0, raw - (held.get(o.id) ?? 0));
      return {
        offerId: o.id,
        tenantId: o.tenantId,
        shopName: shop.name,
        shopSlug: shop.slug,
        kind: o.kind,
        itemCode: o.catalogItem.code,
        name: o.catalogItem.name,
        brand: o.catalogItem.brand,
        category: o.catalogItem.category?.name ?? null,
        price: Number(o.price),
        priceFrom: o.priceFrom,
        installIncluded: o.installIncluded,
        durationMinutes: o.durationMinutes,
        available: stock,
        openingHours: (shop.openingHours as unknown as OpeningDay[]) ?? [],
      };
    });
  }

  private toOfferCardView(c: ChatbotOfferCandidate): PublicOfferCardView {
    return {
      offerId: c.offerId,
      kind: c.kind,
      itemCode: c.itemCode,
      name: c.name,
      brand: c.brand,
      category: c.category,
      price: c.price,
      priceFrom: c.priceFrom,
      installIncluded: c.installIncluded,
      durationMinutes: c.durationMinutes,
      available: c.available,
      shopName: c.shopName,
      shopSlug: c.shopSlug,
      itemHref: `/cho/${c.kind === 'SERVICE' ? 'dich-vu' : 'san-pham'}/${encodeURIComponent(c.itemCode.toLowerCase())}`,
      bookHref: `/cho/dat?tin=${encodeURIComponent(c.offerId)}`,
    };
  }

  private proposalView(p: Prisma.ChatbotBookingProposalGetPayload<object>) {
    return {
      id: p.id,
      channel: p.channel,
      status: p.status,
      tenantId: p.tenantId,
      shopName: p.shopName,
      shopSlug: p.shopSlug,
      branchId: p.branchId,
      branchName: p.branchName,
      vehicleId: p.vehicleId,
      vehicleLabel: p.vehicleLabel,
      offerId: p.offerId,
      unitPrice: p.unitPrice !== null ? Number(p.unitPrice) : null,
      serviceName: p.serviceName,
      suggestedSlots: Array.isArray(p.suggestedSlots) ? (p.suggestedSlots as string[]) : [],
      confirmedSlot: p.confirmedSlot,
      bookingId: p.bookingId,
      bookingCode: p.bookingCode,
      orderRequestId: p.orderRequestId,
      orderRequestCode: p.orderRequestCode,
      trackingPath: p.trackingPath,
      decidedAt: p.decidedAt,
      createdAt: p.createdAt,
    };
  }

  private messageView(
    m: Prisma.ChatbotMessageGetPayload<object>,
    proposalsById: Map<string, ReturnType<ChatbotService['proposalView']>>,
  ) {
    return {
      id: m.id,
      role: m.role as 'USER' | 'ASSISTANT',
      content: m.content,
      sanitizedContext: m.sanitizedContext,
      piiMaskedCount: m.piiMaskedCount,
      provider: m.provider,
      citedDocCodes: m.citedDocCodes,
      matchedOffers: Array.isArray(m.matchedOffers) ? (m.matchedOffers as unknown as PublicOfferCardView[]) : [],
      maintenancePlan: (m.maintenancePlan as MaintenancePlan | null) ?? null,
      proposal: m.proposalId ? (proposalsById.get(m.proposalId) ?? null) : null,
      createdAt: m.createdAt,
    };
  }

  private composeHeuristicReply(opts: {
    vehicleSpec: string | null;
    odometerKm: number | null;
    maintenancePlan: MaintenancePlan | null;
    matchedDocs: { code: string; title: string; content: string }[];
    matchedOffers: PublicOfferCardView[];
    hasProposal: boolean;
    proposalTargetName?: string | null;
  }): string {
    const blocks: string[] = [];

    if (opts.maintenancePlan) {
      const carTxt = opts.vehicleSpec ? ` cho xe ${opts.vehicleSpec}` : '';
      blocks.push(
        `🔧 Khuyến nghị ${opts.maintenancePlan.tierLabel}${carTxt} (thời gian dự kiến ~${opts.maintenancePlan.estimatedMinutes} phút):\n` +
          opts.maintenancePlan.checklist.map((c) => `• ${c}`).join('\n'),
      );
    }

    if (opts.matchedDocs.length > 0) {
      const top = opts.matchedDocs[0]!;
      blocks.push(`📘 Cẩm nang tham khảo [${top.code}] — ${top.title}:\n${top.content}`);
    }

    if (opts.matchedOffers.length > 0) {
      blocks.push(
        `💰 Giá tham khảo đang niêm yết trên Sàn CARDIY (${opts.matchedOffers.length} lựa chọn phù hợp):\n` +
          opts.matchedOffers
            .map(
              (o) =>
                `• ${o.name} tại ${o.shopName}: ${o.priceFrom ? 'từ ' : ''}${o.price.toLocaleString('vi-VN')} đ${o.installIncluded ? ' (đã gồm lắp đặt)' : ''}`,
            )
            .join('\n'),
      );
    }

    if (opts.hasProposal) {
      blocks.push(
        `📅 Trợ lý AI đã chuẩn bị các khung giờ trống hợp lệ${opts.proposalTargetName ? ` tại ${opts.proposalTargetName}` : ''} bên dưới. Lưu ý: Hệ thống chưa tự đặt lịch — chỉ khi bạn chọn giờ và bấm "Xác nhận" thì lịch hẹn mới được tạo thật.`,
      );
    } else if (blocks.length === 0) {
      blocks.push(
        'Xin chào! Tôi là Trợ lý AI tư vấn bảo dưỡng & đặt lịch của CARDIY. Bạn có thể cho biết dòng xe, số km hiện tại (VD: Mazda CX-5 đi 40.000 km), sản phẩm/dịch vụ cần tra giá (dầu nhớt, lốp, ắc quy, điều hoà, phanh) hoặc yêu cầu đề xuất khung giờ đặt lịch hẹn.',
      );
    }

    return blocks.join('\n\n');
  }

  // ===================== 1. WEB SÀN CÔNG KHAI (A1 · /api/public/chatbot) =====================

  async getPublicSession(rawToken?: string) {
    const token = rawToken && rawToken.trim().length >= 16 ? rawToken.trim() : null;
    if (token) {
      const session = await this.prisma.chatbotSession.findFirst({
        where: { sessionHash: sha256(token), channel: 'PUBLIC_WEB' },
        include: {
          messages: { orderBy: { createdAt: 'asc' }, take: 60 },
          proposals: { orderBy: { createdAt: 'desc' }, take: 20 },
        },
      });
      if (session) {
        const pMap = new Map(session.proposals.map((p) => [p.id, this.proposalView(p)]));
        return {
          sessionToken: token,
          vehicleMake: session.vehicleMake,
          vehicleModel: session.vehicleModel,
          odometerKm: session.odometerKm,
          messages: session.messages.map((m) => this.messageView(m, pMap)),
        };
      }
    }

    const freshToken = randomBytes(24).toString('base64url');
    return {
      sessionToken: freshToken,
      vehicleMake: null,
      vehicleModel: null,
      odometerKm: null,
      messages: [],
    };
  }

  async askPublic(dto: z.infer<typeof publicAskSchema>, ip?: string) {
    await this.checkRateLimit(ip);

    const token = dto.sessionToken && dto.sessionToken.length >= 16 ? dto.sessionToken : randomBytes(24).toString('base64url');
    const hash = sha256(token);

    const parsed = parseVehicleAndKmFromText(dto.message);
    const existingSession = await this.prisma.chatbotSession.findFirst({
      where: { sessionHash: hash, channel: 'PUBLIC_WEB' },
    });

    const effectiveMake = dto.vehicleMake ?? parsed.make ?? existingSession?.vehicleMake ?? null;
    const effectiveModel = dto.vehicleModel ?? existingSession?.vehicleModel ?? null;
    const effectiveKm = dto.odometerKm ?? parsed.odometerKm ?? existingSession?.odometerKm ?? null;

    const session = existingSession
      ? await this.prisma.chatbotSession.update({
          where: { id: existingSession.id },
          data: {
            vehicleMake: effectiveMake,
            vehicleModel: effectiveModel,
            odometerKm: effectiveKm,
            ip: ip ?? existingSession.ip,
          },
        })
      : await this.prisma.chatbotSession.create({
          data: {
            channel: 'PUBLIC_WEB',
            sessionHash: hash,
            vehicleMake: effectiveMake,
            vehicleModel: effectiveModel,
            odometerKm: effectiveKm,
            ip: ip ?? null,
          },
        });

    // Che PII mà khách vô tình gõ vào khung chat trước khi gửi tới mô hình AI
    const redacted = redactPiiForAi(dto.message);

    // QUAN TRỌNG: Chỉ đọc cẩm nang công khai (tenantId: null), tuyệt đối không lộ quy trình nội bộ riêng của garage
    const [publicDocs, allOffers] = await Promise.all([
      this.prisma.aiDocument.findMany({ where: { active: true, tenantId: null } }),
      this.loadListableOffers(),
    ]);

    const matchedDocs = scoreKnowledgeDocs(redacted.text, publicDocs, effectiveMake);
    let matchedCandidates = matchMarketplaceOffers(redacted.text, allOffers, 4);
    if (dto.offerId) {
      const explicitOffer = allOffers.find((o) => o.offerId === dto.offerId);
      if (!explicitOffer) throw new NotFoundException('Tin đăng sản phẩm / dịch vụ không còn mở bán trên sàn');
      matchedCandidates = [explicitOffer, ...matchedCandidates.filter((x) => x.offerId !== explicitOffer.offerId)].slice(0, 4);
    }
    const matchedOffers = matchedCandidates.map((c) => this.toOfferCardView(c));

    const vehicleSpec = [effectiveMake, effectiveModel].filter(Boolean).join(' ') || null;
    const shouldBuildMaint = effectiveKm !== null && (dto.odometerKm !== null || parsed.odometerKm !== null || detectMaintenanceIntent(redacted.text));
    const maintenancePlan = shouldBuildMaint && effectiveKm !== null ? buildMaintenanceChecklistByKm(effectiveKm, vehicleSpec) : null;

    const wantsProposal = Boolean(dto.wantBooking || dto.offerId || detectBookingIntent(redacted.text));
    let createdProposal: Prisma.ChatbotBookingProposalGetPayload<object> | null = null;

    if (wantsProposal) {
      const targetCandidate =
        (dto.offerId ? allOffers.find((o) => o.offerId === dto.offerId) : null) ??
        matchedCandidates[0] ??
        allOffers.find((o) => o.kind === 'SERVICE') ??
        allOffers[0] ??
        null;

      if (targetCandidate) {
        const slots = proposeShopRequestSlots({ openingHours: targetCandidate.openingHours, count: 4 });
        if (slots.length > 0) {
          createdProposal = await this.prisma.chatbotBookingProposal.create({
            data: {
              sessionId: session.id,
              channel: 'PUBLIC_WEB',
              status: 'DE_XUAT',
              tenantId: targetCandidate.tenantId,
              shopName: targetCandidate.shopName,
              shopSlug: targetCandidate.shopSlug,
              offerId: targetCandidate.offerId,
              unitPrice: BigInt(targetCandidate.price),
              serviceName: targetCandidate.name,
              vehicleLabel: vehicleSpec,
              suggestedSlots: slots,
            },
          });
        }
      }
    }

    const sanitizedContext = JSON.stringify(
      {
        channel: 'PUBLIC_WEB',
        vehicleSpec,
        odometerKm: effectiveKm,
        sanitizedQuestion: redacted.text,
        maintenanceMilestoneKm: maintenancePlan?.milestoneKm ?? null,
        citedDocCodes: matchedDocs.map((d) => d.code),
        matchedOffers: matchedOffers.map((o) => ({ name: o.name, shop: o.shopName, price: o.price })),
      },
      null,
      2,
    );

    const llm = await this.callExternalLlmIfConfigured(
      'Bạn là Trợ lý AI tư vấn bảo dưỡng & đặt lịch của Sàn ô tô CARDIY. Trả lời ngắn gọn, hữu ích bằng tiếng Việt dựa trên dữ liệu cung cấp; nhắc rõ khách phải bấm Xác nhận mới tạo lịch hẹn.',
      sanitizedContext,
    );

    const replyText =
      llm?.text ??
      this.composeHeuristicReply({
        vehicleSpec,
        odometerKm: effectiveKm,
        maintenancePlan,
        matchedDocs,
        matchedOffers,
        hasProposal: !!createdProposal,
        proposalTargetName: createdProposal?.shopName,
      });

    const [, assistantMsg] = await this.prisma.$transaction([
      this.prisma.chatbotMessage.create({
        data: {
          sessionId: session.id,
          role: 'USER',
          content: dto.message,
          piiMaskedCount: redacted.maskedCount,
        },
      }),
      this.prisma.chatbotMessage.create({
        data: {
          sessionId: session.id,
          role: 'ASSISTANT',
          content: replyText,
          sanitizedContext,
          piiMaskedCount: redacted.maskedCount,
          provider: llm?.provider ?? 'heuristic',
          citedDocCodes: matchedDocs.map((d) => d.code),
          matchedOffers: matchedOffers as unknown as Prisma.InputJsonValue,
          maintenancePlan: (maintenancePlan as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull,
          proposalId: createdProposal?.id ?? null,
        },
      }),
    ]);

    const pView = createdProposal ? this.proposalView(createdProposal) : null;
    const pMap = new Map(pView ? [[pView.id, pView]] : []);

    return {
      sessionToken: token,
      piiMaskedCount: redacted.maskedCount,
      message: this.messageView(assistantMsg, pMap),
      proposal: pView,
    };
  }

  async confirmPublicProposal(proposalId: string, dto: z.infer<typeof publicConfirmSchema>, ip?: string) {
    const hash = sha256(dto.sessionToken);
    const proposal = await this.prisma.chatbotBookingProposal.findFirst({
      where: { id: proposalId, channel: 'PUBLIC_WEB', session: { sessionHash: hash } },
    });
    if (!proposal) throw new NotFoundException('Không tìm thấy đề xuất đặt lịch của phiên tư vấn này');
    if (proposal.status === 'DA_XAC_NHAN') throw new ConflictException('Đề xuất đặt lịch này đã được xác nhận trước đó');
    if (proposal.status === 'DA_HUY') throw new ConflictException('Đề xuất đặt lịch này đã bị huỷ');
    if (!proposal.offerId) throw new BadRequestException('Đề xuất không gắn sản phẩm / dịch vụ cụ thể trên sàn');

    const scheduledAt = new Date(dto.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) throw new BadRequestException('Khung giờ hẹn không hợp lệ');

    // Gọi trực tiếp RequestsService.submit để kế thừa 100% kiểm tra tồn kho, khoá FOR UPDATE, giờ mở cửa và AuditLog
    const created = await this.requests.submit(
      {
        items: [{ offerId: proposal.offerId, quantity: dto.quantity }],
        voucherCode: dto.voucherCode ?? null,
        scheduledAt,
        name: dto.name,
        phone: dto.phone,
        plateNo: dto.plateNo ?? null,
        note: dto.note ?? 'Đặt lịch qua Chatbot AI tư vấn trên sàn',
      },
      ip,
    );

    const trackingPath = `/cho/yeu-cau/${created.id}?t=${encodeURIComponent(created.token)}&moi=1`;
    const updated = await this.prisma.chatbotBookingProposal.update({
      where: { id: proposal.id },
      data: {
        status: 'DA_XAC_NHAN',
        confirmedSlot: scheduledAt,
        orderRequestId: created.id,
        orderRequestCode: created.code,
        trackingPath,
        decidedAt: new Date(),
      },
    });

    return {
      status: updated.status,
      orderRequestId: created.id,
      code: created.code,
      token: created.token,
      trackingPath,
      proposal: this.proposalView(updated),
    };
  }

  async dismissPublicProposal(proposalId: string, sessionToken: string) {
    const hash = sha256(sessionToken);
    const proposal = await this.prisma.chatbotBookingProposal.findFirst({
      where: { id: proposalId, channel: 'PUBLIC_WEB', session: { sessionHash: hash } },
    });
    if (!proposal) throw new NotFoundException('Không tìm thấy đề xuất đặt lịch');
    if (proposal.status === 'DA_XAC_NHAN') throw new ConflictException('Đề xuất đã xác nhận không thể huỷ ở đây');

    const updated = await this.prisma.chatbotBookingProposal.update({
      where: { id: proposal.id },
      data: { status: 'DA_HUY', decidedAt: new Date() },
    });
    return { status: updated.status, proposal: this.proposalView(updated) };
  }

  // ===================== 2. APP CHỦ XE (A2 · /api/owner/chatbot) =====================

  private async loadOwnerContext(userId: string) {
    const [user, links] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true, phone: true, email: true } }),
      this.prisma.customerLink.findMany({
        where: { userId, customer: { deletedAt: null } },
        include: {
          customer: { select: { id: true, tenantId: true, name: true, phone: true, email: true, address: true } },
        },
      }),
    ]);

    const customerIds = links.map((l) => l.customerId);
    const tenantIds = [...new Set(links.map((l) => l.tenantId))];

    const [tenants, branches, ownerships] = await Promise.all([
      tenantIds.length
        ? this.prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true, printSettings: true } })
        : Promise.resolve([]),
      tenantIds.length
        ? this.prisma.branch.findMany({
            where: { tenantId: { in: tenantIds }, deletedAt: null },
            orderBy: { code: 'asc' },
            select: { id: true, tenantId: true, code: true, name: true, address: true },
          })
        : Promise.resolve([]),
      customerIds.length
        ? this.prisma.vehicleOwnership.findMany({
            where: { customerId: { in: customerIds }, toDate: null, vehicle: { deletedAt: null } },
            include: {
              vehicle: {
                select: {
                  id: true,
                  tenantId: true,
                  plateNo: true,
                  make: true,
                  model: true,
                  year: true,
                  odometerKm: true,
                  registrationExpiry: true,
                  insuranceExpiry: true,
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    const tenantNameById = new Map(
      tenants.map((t) => [t.id, (t.printSettings as { displayName?: string } | null)?.displayName || t.name]),
    );

    const vehicles = ownerships.map((o) => ({
      id: o.vehicle.id,
      tenantId: o.vehicle.tenantId,
      garageName: tenantNameById.get(o.vehicle.tenantId) ?? 'Garage liên kết',
      plate: formatPlate(o.vehicle.plateNo),
      make: o.vehicle.make,
      model: o.vehicle.model,
      year: o.vehicle.year,
      odometerKm: o.vehicle.odometerKm,
      branches: branches.filter((b) => b.tenantId === o.vehicle.tenantId),
    }));

    return {
      user,
      secretNames: [user.fullName, ...links.map((l) => l.customer.name)],
      secretAddresses: links.map((l) => l.customer.address),
      vehicles,
      branches,
    };
  }

  async getOwnerSession(userId: string) {
    const [ctx, existing] = await Promise.all([
      this.loadOwnerContext(userId),
      this.prisma.chatbotSession.findFirst({
        where: { userId, channel: 'OWNER_APP' },
        orderBy: { updatedAt: 'desc' },
        include: {
          messages: { orderBy: { createdAt: 'asc' }, take: 60 },
          proposals: { orderBy: { createdAt: 'desc' }, take: 20 },
        },
      }),
    ]);

    const pMap = new Map((existing?.proposals ?? []).map((p) => [p.id, this.proposalView(p)]));
    return {
      vehicles: ctx.vehicles,
      selectedVehicleId: existing?.vehicleId ?? ctx.vehicles[0]?.id ?? null,
      messages: (existing?.messages ?? []).map((m) => this.messageView(m, pMap)),
    };
  }

  async askOwner(userId: string, dto: z.infer<typeof ownerAskSchema>, ip?: string) {
    await this.checkRateLimit(ip);
    const ctx = await this.loadOwnerContext(userId);

    let chosenVehicle = ctx.vehicles[0] ?? null;
    if (dto.vehicleId) {
      const found = ctx.vehicles.find((v) => v.id === dto.vehicleId);
      if (!found) throw new NotFoundException('Không tìm thấy xe thuộc tài khoản của bạn');
      chosenVehicle = found;
    }

    let chosenBranch = chosenVehicle?.branches[0] ?? null;
    if (dto.branchId) {
      const foundB = (chosenVehicle?.branches ?? ctx.branches).find((b) => b.id === dto.branchId);
      if (!foundB) throw new NotFoundException('Không tìm thấy chi nhánh thuộc garage liên kết');
      chosenBranch = foundB;
    }

    const parsed = parseVehicleAndKmFromText(dto.message);
    const effectiveMake = chosenVehicle?.make ?? parsed.make ?? null;
    const effectiveModel = chosenVehicle?.model ?? null;
    const effectiveKm = dto.odometerKm ?? parsed.odometerKm ?? chosenVehicle?.odometerKm ?? null;
    const vehicleSpec = [effectiveMake, effectiveModel, chosenVehicle?.year].filter(Boolean).join(' ') || null;

    let session = await this.prisma.chatbotSession.findFirst({
      where: { userId, channel: 'OWNER_APP' },
      orderBy: { updatedAt: 'desc' },
    });
    session = session
      ? await this.prisma.chatbotSession.update({
          where: { id: session.id },
          data: {
            vehicleId: chosenVehicle?.id ?? session.vehicleId,
            vehicleMake: effectiveMake,
            vehicleModel: effectiveModel,
            odometerKm: effectiveKm,
            ip: ip ?? session.ip,
          },
        })
      : await this.prisma.chatbotSession.create({
          data: {
            channel: 'OWNER_APP',
            userId,
            vehicleId: chosenVehicle?.id ?? null,
            vehicleMake: effectiveMake,
            vehicleModel: effectiveModel,
            odometerKm: effectiveKm,
            ip: ip ?? null,
          },
        });

    // Che sạch họ tên, địa chỉ, SĐT, email, CCCD của chủ xe trước khi gửi tới mô hình AI
    const redacted = redactPiiForAi(dto.message, {
      names: ctx.secretNames,
      addresses: ctx.secretAddresses,
    });

    const [publicDocs, allOffers] = await Promise.all([
      this.prisma.aiDocument.findMany({ where: { active: true, tenantId: null } }),
      this.loadListableOffers(),
    ]);

    const matchedDocs = scoreKnowledgeDocs(redacted.text, publicDocs, effectiveMake);
    const matchedOffers = matchMarketplaceOffers(redacted.text, allOffers, 4).map((c) => this.toOfferCardView(c));

    const shouldBuildMaint =
      effectiveKm !== null &&
      (dto.odometerKm !== null || parsed.odometerKm !== null || detectMaintenanceIntent(redacted.text));
    const maintenancePlan = shouldBuildMaint && effectiveKm !== null ? buildMaintenanceChecklistByKm(effectiveKm, vehicleSpec) : null;

    const wantsProposal = Boolean(dto.wantBooking || detectBookingIntent(redacted.text));
    let createdProposal: Prisma.ChatbotBookingProposalGetPayload<object> | null = null;

    if (wantsProposal && chosenVehicle && chosenBranch) {
      const existingBookings = await this.prisma.booking.findMany({
        where: {
          vehicleId: chosenVehicle.id,
          status: { in: ['CHO_XAC_NHAN', 'DA_XAC_NHAN'] },
          scheduledAt: { gt: new Date() },
        },
        select: { scheduledAt: true },
      });
      const slots = proposeOwnerBookingSlots({
        existingScheduledAts: existingBookings.map((b) => b.scheduledAt),
        count: 4,
      });

      if (slots.length > 0) {
        const serviceLabel =
          maintenancePlan?.tierLabel ??
          matchedOffers[0]?.name ??
          (redacted.text.length <= 120 ? redacted.text : 'Kiểm tra & bảo dưỡng theo tư vấn AI');

        createdProposal = await this.prisma.chatbotBookingProposal.create({
          data: {
            sessionId: session.id,
            channel: 'OWNER_APP',
            status: 'DE_XUAT',
            tenantId: chosenVehicle.tenantId,
            shopName: chosenVehicle.garageName,
            branchId: chosenBranch.id,
            branchName: chosenBranch.name,
            vehicleId: chosenVehicle.id,
            vehicleLabel: `${chosenVehicle.plate}${vehicleSpec ? ` · ${vehicleSpec}` : ''}`,
            serviceName: serviceLabel.slice(0, 180),
            suggestedSlots: slots,
          },
        });
      }
    }

    // Tuyệt đối không đưa biển số xe, tên chủ xe, SĐT hay địa chỉ vào sanitizedContext gửi AI
    const sanitizedContext = JSON.stringify(
      {
        channel: 'OWNER_APP',
        vehicleSpec,
        odometerKm: effectiveKm,
        sanitizedQuestion: redacted.text,
        maintenanceMilestoneKm: maintenancePlan?.milestoneKm ?? null,
        citedDocCodes: matchedDocs.map((d) => d.code),
        matchedOffers: matchedOffers.map((o) => ({ name: o.name, shop: o.shopName, price: o.price })),
      },
      null,
      2,
    );

    const llm = await this.callExternalLlmIfConfigured(
      'Bạn là Trợ lý AI riêng cho Chủ xe trên ứng dụng CARDIY. Tư vấn lịch bảo dưỡng theo dòng xe & số km, báo giá tham khảo trên sàn và nhắc chủ xe kiểm tra khung giờ đề xuất rồi bấm Xác nhận để tạo lịch hẹn.',
      sanitizedContext,
    );

    const replyText =
      llm?.text ??
      this.composeHeuristicReply({
        vehicleSpec,
        odometerKm: effectiveKm,
        maintenancePlan,
        matchedDocs,
        matchedOffers,
        hasProposal: !!createdProposal,
        proposalTargetName: chosenBranch ? `${chosenVehicle?.garageName} (${chosenBranch.name})` : chosenVehicle?.garageName,
      });

    const [, assistantMsg] = await this.prisma.$transaction([
      this.prisma.chatbotMessage.create({
        data: {
          sessionId: session.id,
          role: 'USER',
          content: dto.message,
          piiMaskedCount: redacted.maskedCount,
        },
      }),
      this.prisma.chatbotMessage.create({
        data: {
          sessionId: session.id,
          role: 'ASSISTANT',
          content: replyText,
          sanitizedContext,
          piiMaskedCount: redacted.maskedCount,
          provider: llm?.provider ?? 'heuristic',
          citedDocCodes: matchedDocs.map((d) => d.code),
          matchedOffers: matchedOffers as unknown as Prisma.InputJsonValue,
          maintenancePlan: (maintenancePlan as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull,
          proposalId: createdProposal?.id ?? null,
        },
      }),
    ]);

    const pView = createdProposal ? this.proposalView(createdProposal) : null;
    const pMap = new Map(pView ? [[pView.id, pView]] : []);

    return {
      piiMaskedCount: redacted.maskedCount,
      message: this.messageView(assistantMsg, pMap),
      proposal: pView,
    };
  }

  async confirmOwnerProposal(userId: string, proposalId: string, dto: z.infer<typeof ownerConfirmSchema>) {
    const proposal = await this.prisma.chatbotBookingProposal.findFirst({
      where: { id: proposalId, channel: 'OWNER_APP', session: { userId } },
    });
    if (!proposal) throw new NotFoundException('Không tìm thấy đề xuất đặt lịch của bạn');
    if (proposal.status === 'DA_XAC_NHAN') throw new ConflictException('Đề xuất đặt lịch này đã được xác nhận tạo lịch hẹn trước đó');
    if (proposal.status === 'DA_HUY') throw new ConflictException('Đề xuất đặt lịch này đã bị huỷ');

    const branchId = dto.branchId ?? proposal.branchId;
    const vehicleId = dto.vehicleId ?? proposal.vehicleId;
    if (!branchId || !vehicleId) throw new BadRequestException('Thiếu thông tin xe hoặc chi nhánh đặt lịch');

    // Gọi trực tiếp OwnerBookingService.create để kế thừa 100% kiểm tra BOOKING_HOURS, giới hạn 3 lịch hẹn, chống trùng ±3h và AuditLog
    const booking = await this.ownerBookings.create(userId, {
      branchId,
      vehicleId,
      scheduledAt: dto.scheduledAt,
      service: dto.service?.trim() || proposal.serviceName,
      note: dto.note ?? 'Đặt lịch qua Chatbot AI chủ xe',
    });

    const updated = await this.prisma.chatbotBookingProposal.update({
      where: { id: proposal.id },
      data: {
        status: 'DA_XAC_NHAN',
        branchId,
        vehicleId,
        confirmedSlot: new Date(dto.scheduledAt),
        bookingId: booking.id,
        bookingCode: booking.code,
        trackingPath: '/app/lich-hen',
        decidedAt: new Date(),
      },
    });

    return {
      status: updated.status,
      bookingId: booking.id,
      code: booking.code,
      trackingPath: '/app/lich-hen',
      proposal: this.proposalView(updated),
    };
  }

  async dismissOwnerProposal(userId: string, proposalId: string) {
    const proposal = await this.prisma.chatbotBookingProposal.findFirst({
      where: { id: proposalId, channel: 'OWNER_APP', session: { userId } },
    });
    if (!proposal) throw new NotFoundException('Không tìm thấy đề xuất đặt lịch');
    if (proposal.status === 'DA_XAC_NHAN') throw new ConflictException('Đề xuất đã xác nhận không thể bỏ qua');

    const updated = await this.prisma.chatbotBookingProposal.update({
      where: { id: proposal.id },
      data: { status: 'DA_HUY', decidedAt: new Date() },
    });
    return { status: updated.status, proposal: this.proposalView(updated) };
  }
}

@Public()
@Controller('public/chatbot')
export class PublicChatbotController {
  constructor(private readonly svc: ChatbotService) {}

  @Get('session')
  session(@Query('token') token?: string) {
    return this.svc.getPublicSession(token);
  }

  @Post('ask')
  @HttpCode(200)
  ask(@Body(new ZodPipe(publicAskSchema)) dto: z.infer<typeof publicAskSchema>, @Req() req: Request) {
    return this.svc.askPublic(dto, clientIp(req));
  }

  @Post('proposals/:id/confirm-request')
  @HttpCode(200)
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(publicConfirmSchema)) dto: z.infer<typeof publicConfirmSchema>,
    @Req() req: Request,
  ) {
    return this.svc.confirmPublicProposal(id, dto, clientIp(req));
  }

  @Post('proposals/:id/dismiss')
  @HttpCode(200)
  dismiss(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(publicDismissSchema)) dto: { sessionToken: string }) {
    return this.svc.dismissPublicProposal(id, dto.sessionToken);
  }
}

@Public()
@UseGuards(OwnerGuard)
@Controller('owner/chatbot')
export class OwnerChatbotController {
  constructor(private readonly svc: ChatbotService) {}

  @Get('session')
  session(@Req() req: OwnerRequest) {
    return this.svc.getOwnerSession(req.owner!.userId);
  }

  @Post('ask')
  @HttpCode(200)
  ask(@Req() req: OwnerRequest, @Body(new ZodPipe(ownerAskSchema)) dto: z.infer<typeof ownerAskSchema>) {
    return this.svc.askOwner(req.owner!.userId, dto, clientIp(req as unknown as Request));
  }

  @Post('proposals/:id/confirm-booking')
  @HttpCode(200)
  confirm(
    @Req() req: OwnerRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ownerConfirmSchema)) dto: z.infer<typeof ownerConfirmSchema>,
  ) {
    return this.svc.confirmOwnerProposal(req.owner!.userId, id, dto);
  }

  @Post('proposals/:id/dismiss')
  @HttpCode(200)
  dismiss(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.dismissOwnerProposal(req.owner!.userId, id);
  }
}
