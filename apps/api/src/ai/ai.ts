import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { formatPlate, searchKey, type InspectionData } from '@cardiy/shared';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AccessService, type Access } from '../auth/access.service';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { AppConfig } from '../config/app-config';
import { OrdersModule } from '../orders/orders.module';
import { OrdersService, type OrderItemInput } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildHeuristicVehicleSummary,
  matchCatalogSuggestions,
  redactPiiForAi,
  scoreKnowledgeDocs,
  type SuggestedQuoteLine,
} from './ai-rules';

const num = (v: bigint | number | null | undefined) => Number(v ?? 0);
const optStr = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());

const summarizeVehicleSchema = z.object({
  vehicleId: z.string().uuid('Chọn xe hợp lệ'),
});

const suggestQuoteSchema = z.object({
  orderId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable().optional()),
  vehicleId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable().optional()),
  branchId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().uuid().nullable().optional()),
  symptoms: z.string().trim().min(3, 'Nhập mô tả triệu chứng hoặc yêu cầu tối thiểu 3 ký tự').max(2000),
});

const askTechSchema = z.object({
  question: z.string().trim().min(5, 'Nhập câu hỏi kỹ thuật tối thiểu 5 ký tự').max(2000),
  vehicleMake: optStr(60),
});

const applySuggestionSchema = z.object({
  orderId: z.string().uuid('Chọn lệnh sửa chữa cần áp dụng'),
  selectedIndexes: z.array(z.coerce.number().int().min(0).max(50)).optional(),
});

const saveAiDocSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3)
    .max(60)
    .regex(/^[A-Z0-9_-]+$/, 'Mã tài liệu gồm chữ IN HOA, số, gạch ngang hoặc gạch dưới'),
  title: z.string().trim().min(5, 'Nhập tiêu đề tài liệu').max(200),
  category: z.enum(['BAO_DUONG', 'CHAN_DOAN', 'DAU_NHOT', 'LOP_PHANH', 'DIEN_OBD']).default('CHAN_DOAN'),
  make: optStr(60),
  content: z.string().trim().min(10, 'Nhập nội dung quy trình kỹ thuật').max(10_000),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  active: z.boolean().default(true),
});

function extractInspectionAlerts(data: InspectionData | null | undefined): { replace: string[]; attention: string[] } {
  const replace: string[] = [];
  const attention: string[] = [];
  if (!data) return { replace, attention };

  for (const [k, v] of Object.entries(data.safety ?? {})) {
    if (v === 'THAY_THE') replace.push(k);
    else if (v === 'CHU_Y') attention.push(k);
  }
  for (const [k, v] of Object.entries(data.wiper ?? {})) {
    if (v === 'THAY_THE') replace.push(k);
    else if (v === 'CHU_Y') attention.push(k);
  }
  for (const side of [data.underFront, data.underRear]) {
    for (const [k, v] of Object.entries(side ?? {})) {
      if (v?.L === 'THAY_THE' || v?.R === 'THAY_THE') replace.push(k);
      else if (v?.L === 'CHU_Y' || v?.R === 'CHU_Y') attention.push(k);
    }
  }
  return { replace, attention };
}

function daysFromNow(d: Date | null | undefined): number | null {
  if (!d) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly orders: OrdersService,
  ) {}

  private assertGarage(a: Access) {
    if (a.tenantType !== 'GARAGE') {
      throw new ForbiddenException('Trợ lý AI nội bộ chỉ dành cho không gian Garage PLG');
    }
  }

  private seesMoney(a: Access): boolean {
    return a.permissions.some((p) => ['ro.manage', 'finance.view', 'quote.manage'].includes(p));
  }

  private maskItemMoney(items: SuggestedQuoteLine[], canSeeMoney: boolean) {
    return items.map((it) => ({
      ...it,
      unitPrice: canSeeMoney ? it.unitPrice : null,
    }));
  }

  /** Gọi HTTP LLM tương thích OpenAI nếu được cấu hình; lỗi hoặc timeout tự động fallback về bộ suy luận nội bộ */
  private async callExternalLlmIfConfigured(systemPrompt: string, sanitizedUserContext: string): Promise<{ text: string; provider: 'http' } | null> {
    if (this.config.get('AI_PROVIDER') !== 'http' || !this.config.get('AI_API_KEY')) return null;
    try {
      const res = await fetch(this.config.get('AI_API_URL'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.get('AI_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.get('AI_MODEL'),
          temperature: 0.2,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: sanitizedUserContext },
          ],
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = j.choices?.[0]?.message?.content?.trim();
      return text ? { text, provider: 'http' } : null;
    } catch (e) {
      this.logger.warn(`AI HTTP fallback về heuristic: ${(e as Error).message}`);
      return null;
    }
  }

  private suggestionView(row: Prisma.AiSuggestionGetPayload<object>, canSeeMoney: boolean) {
    const rawItems = (Array.isArray(row.suggestedItems) ? row.suggestedItems : []) as unknown as SuggestedQuoteLine[];
    return {
      id: row.id,
      kind: row.kind,
      branchId: row.branchId,
      vehicleId: row.vehicleId,
      orderId: row.orderId,
      promptSummary: row.promptSummary,
      sanitizedContext: row.sanitizedContext,
      piiMaskedCount: row.piiMaskedCount,
      provider: row.provider,
      responseText: row.responseText,
      suggestedItems: this.maskItemMoney(rawItems, canSeeMoney),
      citedDocCodes: row.citedDocCodes,
      status: row.status,
      appliedItemCount: row.appliedItemCount,
      decidedAt: row.decidedAt,
      createdAt: row.createdAt,
    };
  }

  async overview(a: Access) {
    this.assertGarage(a);
    const branchWhere = a.branchIds === 'ALL' ? {} : { OR: [{ branchId: null }, { branchId: { in: a.branchIds } }] };
    const [documentsCount, suggestionsTotal, appliedCount, recent] = await Promise.all([
      this.prisma.aiDocument.count({
        where: { active: true, OR: [{ tenantId: null }, { tenantId: a.tenantId }] },
      }),
      this.prisma.aiSuggestion.count({ where: { tenantId: a.tenantId, ...branchWhere } }),
      this.prisma.aiSuggestion.count({ where: { tenantId: a.tenantId, status: 'DA_AP_DUNG', ...branchWhere } }),
      this.prisma.aiSuggestion.findMany({
        where: { tenantId: a.tenantId, ...branchWhere },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const money = this.seesMoney(a);
    return {
      provider: this.config.get('AI_PROVIDER') === 'http' && this.config.get('AI_API_KEY') ? 'http' : 'heuristic',
      documentsCount,
      suggestionsTotal,
      appliedCount,
      recentSuggestions: recent.map((r) => this.suggestionView(r, money)),
    };
  }

  // ---------------- 1. Tóm tắt lịch sử & sức khoẻ xe (che PII bắt buộc) ----------------

  async summarizeVehicle(a: Access, vehicleId: string) {
    this.assertGarage(a);
    const v = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenantId: a.tenantId, deletedAt: null },
      include: {
        ownerships: {
          include: { customer: { select: { name: true, phone: true, email: true, address: true } } },
        },
        orders: {
          where: { status: { not: 'HUY' }, ...(a.branchIds === 'ALL' ? {} : { branchId: { in: a.branchIds } }) },
          orderBy: { receivedAt: 'desc' },
          take: 10,
          include: {
            items: { orderBy: { sortOrder: 'asc' }, select: { name: true } },
            inspection: { select: { data: true } },
          },
        },
      },
    });
    if (!v) throw new NotFoundException('Không tìm thấy xe trong hệ thống');

    const secretNames = v.ownerships.map((o) => o.customer.name);
    const secretAddresses = v.ownerships.map((o) => o.customer.address);

    let totalMasked = 0;
    const cleanNote = redactPiiForAi(v.note ?? '', { names: secretNames, addresses: secretAddresses });
    totalMasked += cleanNote.maskedCount;

    const orderSummaries = v.orders.map((o) => {
      const reqRedacted = redactPiiForAi(o.request ?? '', { names: secretNames, addresses: secretAddresses });
      totalMasked += reqRedacted.maskedCount;
      const alerts = extractInspectionAlerts(o.inspection?.data as InspectionData | null);
      return {
        code: o.code,
        date: o.receivedAt.toISOString().slice(0, 10),
        km: o.odometerKm,
        status: o.status,
        request: reqRedacted.text,
        items: o.items.map((i) => i.name),
        replaceAlerts: alerts.replace,
        attentionAlerts: alerts.attention,
      };
    });

    const plateLabel = formatPlate(v.plateNo);
    const makeModelYear = [v.make, v.model, v.year].filter(Boolean).join(' ');
    const regDays = daysFromNow(v.registrationExpiry);
    const insDays = daysFromNow(v.insuranceExpiry);

    // Đóng gói ngữ cảnh sạch PII (tuyệt đối không kèm họ tên, SĐT, email, địa chỉ chủ xe)
    const sanitizedContext = JSON.stringify(
      {
        vehicleCode: plateLabel,
        spec: makeModelYear,
        odometerKm: v.odometerKm,
        vehicleNote: cleanNote.text || null,
        registrationDaysLeft: regDays,
        insuranceDaysLeft: insDays,
        repairHistory: orderSummaries,
      },
      null,
      2,
    );

    const llm = await this.callExternalLlmIfConfigured(
      'Bạn là kỹ sư cố vấn dịch vụ ô tô của CARDIY. Tóm tắt ngắn gọn lịch sử sửa chữa, hạng mục tồn đọng và khuyến nghị mốc bảo dưỡng tiếp theo bằng tiếng Việt.',
      sanitizedContext,
    );

    const responseText =
      llm?.text ??
      buildHeuristicVehicleSummary({
        plateMaskedOrCode: plateLabel,
        makeModelYear,
        odometerKm: v.odometerKm,
        registrationDaysLeft: regDays,
        insuranceDaysLeft: insDays,
        orders: orderSummaries,
      });

    const saved = await this.prisma.aiSuggestion.create({
      data: {
        tenantId: a.tenantId,
        kind: 'VEHICLE_SUMMARY',
        vehicleId: v.id,
        promptSummary: `Tóm tắt lịch sử xe ${plateLabel} (${makeModelYear || 'Chưa rõ dòng'})`,
        sanitizedContext,
        piiMaskedCount: totalMasked,
        provider: llm?.provider ?? 'heuristic',
        responseText,
        status: 'DE_XUAT',
        createdBy: a.userId,
      },
    });

    return this.suggestionView(saved, this.seesMoney(a));
  }

  // ---------------- 2. Chẩn đoán triệu chứng & Gợi ý báo giá (AI chỉ đề xuất DE_XUAT) ----------------

  async suggestQuote(a: Access, dto: z.infer<typeof suggestQuoteSchema>) {
    this.assertGarage(a);

    let order: Prisma.RepairOrderGetPayload<{
      include: {
        customer: { select: { name: true, address: true } };
        vehicle: true;
        branch: true;
      };
    }> | null = null;

    if (dto.orderId) {
      order = await this.prisma.repairOrder.findFirst({
        where: { id: dto.orderId, tenantId: a.tenantId },
        include: {
          customer: { select: { name: true, address: true } },
          vehicle: true,
          branch: true,
        },
      });
      if (!order) throw new NotFoundException('Không tìm thấy lệnh sửa chữa');
      if (!AccessService.canAccessBranch(a, order.branchId)) {
        throw new ForbiddenException('Bạn không có quyền truy cập lệnh sửa chữa của chi nhánh này');
      }
    }

    let branch = order?.branch ?? null;
    if (!branch && dto.branchId) {
      if (!AccessService.canAccessBranch(a, dto.branchId)) {
        throw new ForbiddenException('Bạn không làm việc ở chi nhánh này');
      }
      branch = await this.prisma.branch.findFirst({ where: { id: dto.branchId, tenantId: a.tenantId, deletedAt: null } });
    }
    if (!branch) {
      branch = await this.prisma.branch.findFirst({
        where: {
          tenantId: a.tenantId,
          deletedAt: null,
          ...(a.branchIds === 'ALL' ? {} : { id: { in: a.branchIds } }),
        },
        orderBy: { code: 'asc' },
      });
    }
    if (!branch) throw new BadRequestException('Không xác định được chi nhánh báo giá');

    const vehicle =
      order?.vehicle ??
      (dto.vehicleId ? await this.prisma.vehicle.findFirst({ where: { id: dto.vehicleId, tenantId: a.tenantId, deletedAt: null } }) : null);

    // Che PII trong triệu chứng do nhân viên/khách nhập và yêu cầu trên RO
    const combinedRaw = [dto.symptoms, order?.request].filter(Boolean).join(' | ');
    const redacted = redactPiiForAi(combinedRaw, {
      names: [order?.customer.name],
      addresses: [order?.customer.address],
    });

    const [docs, products] = await Promise.all([
      this.prisma.aiDocument.findMany({
        where: { active: true, OR: [{ tenantId: null }, { tenantId: a.tenantId }] },
      }),
      this.prisma.product.findMany({
        where: { tenantId: a.tenantId, deletedAt: null, active: true },
        include: { stock: { where: { branchId: branch.id } } },
        take: 300,
      }),
    ]);

    const matchedDocs = scoreKnowledgeDocs(redacted.text, docs, vehicle?.make);
    const catalogInputs = products.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      kind: p.kind,
      unit: p.unit,
      salePrice: num(p.salePrice),
      salePriceBd: p.salePriceBd !== null ? num(p.salePriceBd) : null,
      vehicleMakes: p.vehicleMakes,
      searchText: p.searchText,
      onHand: p.stock[0] ? Number(p.stock[0].quantity) : 0,
    }));

    const suggestedItems = matchCatalogSuggestions({
      symptoms: redacted.text,
      vehicleMake: vehicle?.make,
      priceZone: branch.priceZone,
      products: catalogInputs,
    });

    const sanitizedContext = JSON.stringify(
      {
        branchCode: branch.code,
        priceZone: branch.priceZone,
        vehicle: vehicle ? [vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' ') : null,
        odometerKm: order?.odometerKm ?? vehicle?.odometerKm ?? null,
        sanitizedSymptoms: redacted.text,
        matchedDocCodes: matchedDocs.map((d) => d.code),
      },
      null,
      2,
    );

    const llm = await this.callExternalLlmIfConfigured(
      'Bạn là cố vấn kỹ thuật ô tô CARDIY. Phân tích ngắn gọn nguyên nhân khả dĩ và giải thích các hạng mục kiểm tra đề xuất (tối đa 6 dòng).',
      sanitizedContext,
    );

    const docGuidance =
      matchedDocs.length > 0
        ? `\n\nTài liệu kỹ thuật tham chiếu (${matchedDocs.map((d) => d.code).join(', ')}):\n${matchedDocs
            .map((d) => `• [${d.code}] ${d.title}: ${d.content.split('\n')[0]}`)
            .join('\n')}`
        : '';

    const responseText =
      llm?.text ??
      `Chẩn đoán sơ bộ cho triệu chứng "${redacted.text}"${vehicle?.make ? ` trên dòng xe ${[vehicle.make, vehicle.model].filter(Boolean).join(' ')}` : ''} tại chi nhánh ${branch.name} (vùng giá ${branch.priceZone}):\n• Đề xuất ${suggestedItems.length} hạng mục phụ tùng / nhân công khớp danh mục kho hiện tại.\n• Lưu ý: Đây là đề xuất tự động của Trợ lý AI — cố vấn dịch vụ kiểm tra thực tế trên cầu nâng và bấm Duyệt mới ghi vào lệnh sửa chữa.${docGuidance}`;

    const saved = await this.prisma.aiSuggestion.create({
      data: {
        tenantId: a.tenantId,
        branchId: branch.id,
        kind: 'QUOTE_SUGGESTION',
        vehicleId: vehicle?.id ?? null,
        orderId: order?.id ?? null,
        promptSummary: redacted.text.slice(0, 200),
        sanitizedContext,
        piiMaskedCount: redacted.maskedCount,
        provider: llm?.provider ?? 'heuristic',
        responseText,
        suggestedItems: suggestedItems as unknown as Prisma.InputJsonValue,
        citedDocCodes: matchedDocs.map((d) => d.code),
        status: 'DE_XUAT',
        createdBy: a.userId,
      },
    });

    return this.suggestionView(saved, this.seesMoney(a));
  }

  // ---------------- 3. Hỏi đáp quy trình kỹ thuật nội bộ (TECH_QA) ----------------

  async askTech(a: Access, dto: z.infer<typeof askTechSchema>) {
    this.assertGarage(a);
    const redacted = redactPiiForAi(dto.question);

    const docs = await this.prisma.aiDocument.findMany({
      where: { active: true, OR: [{ tenantId: null }, { tenantId: a.tenantId }] },
    });
    const matched = scoreKnowledgeDocs(redacted.text, docs, dto.vehicleMake);

    const sanitizedContext = JSON.stringify(
      {
        question: redacted.text,
        vehicleMake: dto.vehicleMake ?? null,
        retrievedDocs: matched.map((d) => ({ code: d.code, title: d.title, content: d.content })),
      },
      null,
      2,
    );

    const llm = await this.callExternalLlmIfConfigured(
      'Bạn là chuyên gia kỹ thuật xưởng CARDIY. Trả lời dựa trên kho tri thức nội bộ được cung cấp và trích dẫn mã tài liệu.',
      sanitizedContext,
    );

    const responseText =
      llm?.text ??
      (matched.length > 0
        ? `Hướng dẫn kỹ thuật đối chiếu từ kho tri thức nội bộ:\n\n${matched
            .map((d) => `[${d.code}] ${d.title}\n${d.content}`)
            .join('\n\n')}`
        : `Chưa tìm thấy quy trình chuyên biệt khớp trực tiếp câu hỏi "${redacted.text}" trong kho tri thức nội bộ. Khuyến nghị kiểm tra mã lỗi OBD-II thực tế, áp suất / điện áp tiêu chuẩn hãng và cập nhật thêm quy trình vào mục Kho tri thức.`);

    const saved = await this.prisma.aiSuggestion.create({
      data: {
        tenantId: a.tenantId,
        kind: 'TECH_QA',
        promptSummary: redacted.text.slice(0, 200),
        sanitizedContext,
        piiMaskedCount: redacted.maskedCount,
        provider: llm?.provider ?? 'heuristic',
        responseText,
        citedDocCodes: matched.map((d) => d.code),
        status: 'DE_XUAT',
        createdBy: a.userId,
      },
    });

    return this.suggestionView(saved, this.seesMoney(a));
  }

  // ---------------- 4. Nhân viên có quyền ro.manage duyệt mới ghi vào Lệnh sửa chữa ----------------

  async applySuggestionToOrder(a: Access, suggestionId: string, dto: z.infer<typeof applySuggestionSchema>, ip?: string) {
    this.assertGarage(a);
    if (!a.permissions.includes('ro.manage')) {
      throw new ForbiddenException('Chỉ nhân viên có quyền quản lý lệnh sửa chữa mới được duyệt áp dụng đề xuất AI vào đơn');
    }

    const sug = await this.prisma.aiSuggestion.findFirst({
      where: { id: suggestionId, tenantId: a.tenantId },
    });
    if (!sug) throw new NotFoundException('Không tìm thấy đề xuất AI');
    if (sug.kind !== 'QUOTE_SUGGESTION') throw new BadRequestException('Chỉ áp dụng được đề xuất loại Gợi ý báo giá');
    if (sug.status === 'DA_AP_DUNG') throw new ConflictException('Đề xuất AI này đã được duyệt ghi vào đơn trước đó');

    const rawLines = (Array.isArray(sug.suggestedItems) ? sug.suggestedItems : []) as unknown as SuggestedQuoteLine[];
    const chosen =
      dto.selectedIndexes && dto.selectedIndexes.length > 0
        ? dto.selectedIndexes.map((idx) => rawLines[idx]).filter((x): x is SuggestedQuoteLine => !!x)
        : rawLines;
    if (!chosen.length) throw new BadRequestException('Chọn ít nhất 1 hạng mục đề xuất để ghi vào đơn');

    // Đọc đơn hiện tại (kiểm tra quyền chi nhánh + trạng thái cho phép sửa) rồi gộp hạng mục mới qua OrdersService
    const currentOrder = await this.orders.get(a, dto.orderId);
    const existingItems: OrderItemInput[] = currentOrder.items.map((it) => ({
      kind: it.kind,
      productId: it.productId,
      name: it.name,
      unit: it.unit,
      quantity: it.quantity,
      unitPrice: it.unitPrice ?? 0,
      discount: it.discount ?? 0,
      vatRate: it.vatRate,
      section: it.section,
    }));

    const appendedItems: OrderItemInput[] = chosen.map((c) => ({
      kind: c.kind,
      productId: c.productId,
      name: c.name,
      unit: c.unit ?? (c.kind === 'DICH_VU' ? 'lần' : 'cái'),
      quantity: c.quantity,
      unitPrice: c.unitPrice,
      discount: 0,
      vatRate: 0,
      section: 'Đề xuất AI đã duyệt',
    }));

    const totals = await this.orders.replaceItems(a, dto.orderId, [...existingItems, ...appendedItems], ip);

    await this.prisma.aiSuggestion.update({
      where: { id: sug.id },
      data: {
        status: 'DA_AP_DUNG',
        orderId: dto.orderId,
        appliedItemCount: chosen.length,
        decidedBy: a.userId,
        decidedAt: new Date(),
      },
    });

    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'ai_suggestion.applied',
      entity: 'order',
      entityId: dto.orderId,
      after: { suggestionId: sug.id, addedItems: chosen.length, newTotal: totals.total },
      ip,
    });

    return {
      status: 'DA_AP_DUNG',
      addedCount: chosen.length,
      total: totals.total,
    };
  }

  async dismissSuggestion(a: Access, suggestionId: string, ip?: string) {
    this.assertGarage(a);
    const sug = await this.prisma.aiSuggestion.findFirst({ where: { id: suggestionId, tenantId: a.tenantId } });
    if (!sug) throw new NotFoundException('Không tìm thấy đề xuất AI');
    if (sug.status === 'DA_AP_DUNG') throw new ConflictException('Đề xuất đã được áp dụng không thể bỏ qua');

    await this.prisma.aiSuggestion.update({
      where: { id: sug.id },
      data: { status: 'BO_QUA', decidedBy: a.userId, decidedAt: new Date() },
    });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'ai_suggestion.dismissed',
      entity: 'ai_suggestion',
      entityId: sug.id,
      ip,
    });
    return { status: 'BO_QUA' };
  }

  // ---------------- 5. Kho tri thức kỹ thuật nội bộ (ai_documents) ----------------

  async listDocuments(a: Access, q?: string) {
    this.assertGarage(a);
    const where: Prisma.AiDocumentWhereInput = {
      OR: [{ tenantId: null }, { tenantId: a.tenantId }],
      ...(q?.trim() ? { searchText: { contains: searchKey(q.trim()) } } : {}),
    };
    return this.prisma.aiDocument.findMany({ where, orderBy: { code: 'asc' } });
  }

  async createDocument(a: Access, dto: z.infer<typeof saveAiDocSchema>, ip?: string) {
    this.assertGarage(a);
    if (!a.permissions.includes('ai.manage')) {
      throw new ForbiddenException('Chỉ Chủ garage mới có quyền thêm quy trình vào kho tri thức kỹ thuật');
    }
    const code = dto.code.toUpperCase();
    const dup = await this.prisma.aiDocument.findFirst({ where: { tenantId: a.tenantId, code } });
    if (dup) throw new ConflictException(`Mã tài liệu kỹ thuật ${code} đã tồn tại`);

    const saved = await this.prisma.aiDocument.create({
      data: {
        tenantId: a.tenantId,
        code,
        title: dto.title,
        category: dto.category,
        make: dto.make ?? null,
        content: dto.content,
        tags: dto.tags,
        active: dto.active,
        searchText: searchKey(code, dto.title, dto.category, dto.make, dto.content, ...dto.tags),
        createdBy: a.userId,
      },
    });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'ai_document.created',
      entity: 'ai_document',
      entityId: saved.id,
      after: { code, title: dto.title },
      ip,
    });
    return saved;
  }

  async updateDocument(a: Access, id: string, dto: z.infer<typeof saveAiDocSchema>, ip?: string) {
    this.assertGarage(a);
    if (!a.permissions.includes('ai.manage')) {
      throw new ForbiddenException('Chỉ Chủ garage mới có quyền chỉnh sửa kho tri thức kỹ thuật');
    }
    const existing = await this.prisma.aiDocument.findFirst({ where: { id, tenantId: a.tenantId } });
    if (!existing) throw new NotFoundException('Không tìm thấy tài liệu kỹ thuật của garage');

    const saved = await this.prisma.aiDocument.update({
      where: { id },
      data: {
        title: dto.title,
        category: dto.category,
        make: dto.make ?? null,
        content: dto.content,
        tags: dto.tags,
        active: dto.active,
        searchText: searchKey(existing.code, dto.title, dto.category, dto.make, dto.content, ...dto.tags),
      },
    });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'ai_document.updated',
      entity: 'ai_document',
      entityId: id,
      after: { code: existing.code, active: dto.active },
      ip,
    });
    return saved;
  }
}

@RequirePermissions('ai.use')
@Controller('ai')
export class GarageAiController {
  constructor(private readonly svc: AiService) {}

  @Get('overview')
  overview(@CurrentAuth() auth: RequestAuth) {
    return this.svc.overview(auth.access);
  }

  @Post('summarize-vehicle')
  @HttpCode(200)
  summarizeVehicle(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(summarizeVehicleSchema)) dto: { vehicleId: string }) {
    return this.svc.summarizeVehicle(auth.access, dto.vehicleId);
  }

  @Post('suggest-quote')
  @HttpCode(200)
  suggestQuote(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(suggestQuoteSchema)) dto: z.infer<typeof suggestQuoteSchema>) {
    return this.svc.suggestQuote(auth.access, dto);
  }

  @Post('ask-tech')
  @HttpCode(200)
  askTech(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(askTechSchema)) dto: z.infer<typeof askTechSchema>) {
    return this.svc.askTech(auth.access, dto);
  }

  @Post('suggestions/:id/apply-to-order')
  @HttpCode(200)
  applyToOrder(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(applySuggestionSchema)) dto: z.infer<typeof applySuggestionSchema>,
    @Req() req: Request,
  ) {
    return this.svc.applySuggestionToOrder(auth.access, id, dto, clientIp(req));
  }

  @Post('suggestions/:id/dismiss')
  @HttpCode(200)
  dismiss(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.dismissSuggestion(auth.access, id, clientIp(req));
  }

  @Get('documents')
  documents(@CurrentAuth() auth: RequestAuth, @Query('q') q?: string) {
    return this.svc.listDocuments(auth.access, q);
  }

  @Post('documents')
  createDocument(
    @CurrentAuth() auth: RequestAuth,
    @Body(new ZodPipe(saveAiDocSchema)) dto: z.infer<typeof saveAiDocSchema>,
    @Req() req: Request,
  ) {
    return this.svc.createDocument(auth.access, dto, clientIp(req));
  }

  @Put('documents/:id')
  updateDocument(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(saveAiDocSchema)) dto: z.infer<typeof saveAiDocSchema>,
    @Req() req: Request,
  ) {
    return this.svc.updateDocument(auth.access, id, dto, clientIp(req));
  }
}

@Module({
  imports: [OrdersModule],
  controllers: [GarageAiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
