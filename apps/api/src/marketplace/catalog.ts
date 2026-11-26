import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { searchKey } from '@cardiy/shared';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import type { Access } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';

export type Kind = 'PRODUCT' | 'SERVICE';
const kindSchema = z.enum(['PRODUCT', 'SERVICE']);
const optText = (max: number) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());

/** Tìm theo từng từ (mọi từ đều phải có trong tên / mã / hãng / thông số) */
export function textFilter(q: string): Prisma.CatalogItemWhereInput[] {
  return q
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .map((w) => ({ OR: [{ searchText: { contains: searchKey(w) } }, { code: { contains: w.toUpperCase() } }] }));
}

export function assertPlatform(a: Access) {
  if (a.tenantType !== 'PLATFORM') throw new ForbiddenException('Chỉ dành cho nhân sự sàn');
}
/** Người bán trên sàn: đối tác (Cổng đối tác) hoặc garage của chủ sàn (Kênh người bán) */
export function assertSeller(a: Access) {
  const ok =
    a.tenantType === 'PARTNER' ? a.permissions.includes('partner.listing.manage') || a.permissions.includes('partner.shop.manage') : a.tenantType === 'GARAGE' && a.permissions.includes('shop.manage');
  if (!ok) throw new ForbiddenException('Bạn không có quyền quản lý gian hàng');
}

export const categorySchema = z.object({
  kind: kindSchema,
  name: z.string().trim().min(2, 'Nhập tên nhóm').max(100),
  parentId: z.string().uuid().nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});
export const itemSchema = z.object({
  kind: kindSchema,
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9._/-]{2,40}$/, 'Mã 2–40 ký tự chữ, số, . _ / -'),
  name: z.string().trim().min(2, 'Nhập tên').max(200),
  categoryId: z.string().uuid().nullable().optional(),
  brand: optText(100),
  unit: optText(30),
  specs: z
    .array(z.object({ label: z.string().trim().min(1).max(60), value: z.string().trim().min(1).max(200) }))
    .max(20)
    .default([]),
  description: optText(2000),
  imageFileId: z.string().uuid().nullable().optional(),
  active: z.boolean().default(true),
});
type ItemDto = z.infer<typeof itemSchema>;

type ItemRow = Prisma.CatalogItemGetPayload<{ include: { category: true } }>;

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  async itemView(i: ItemRow) {
    return {
      id: i.id,
      kind: i.kind,
      code: i.code,
      name: i.name,
      categoryId: i.categoryId,
      category: i.category?.name ?? null,
      brand: i.brand,
      unit: i.unit,
      specs: i.specs as { label: string; value: string }[],
      description: i.description,
      imageFileId: i.imageFileId,
      imageUrl: i.imageFileId ? await this.files.signedUrl(i.imageFileId).catch(() => null) : null,
      active: i.active,
    };
  }

  // ---------- Nhóm ----------
  async categories(kind?: Kind) {
    const rows = await this.prisma.catalogCategory.findMany({ where: kind ? { kind } : {}, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { items: true } } } });
    return rows.map((c) => ({ id: c.id, kind: c.kind, name: c.name, parentId: c.parentId, sortOrder: c.sortOrder, items: c._count.items }));
  }

  async saveCategory(a: Access, id: string | null, dto: z.infer<typeof categorySchema>, ip?: string) {
    assertPlatform(a);
    if (dto.parentId) {
      const p = await this.prisma.catalogCategory.findUnique({ where: { id: dto.parentId } });
      if (!p || p.kind !== dto.kind || p.parentId) throw new BadRequestException('Nhóm cha không hợp lệ (chỉ 2 cấp, cùng loại)');
      if (p.id === id) throw new BadRequestException('Nhóm cha không hợp lệ');
    }
    const data = { kind: dto.kind, name: dto.name, parentId: dto.parentId ?? null, sortOrder: dto.sortOrder };
    const c = id ? await this.prisma.catalogCategory.update({ where: { id }, data }) : await this.prisma.catalogCategory.create({ data });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: id ? 'catalog.category_updated' : 'catalog.category_created', entity: 'catalog_category', entityId: c.id, after: dto, ip });
    return { id: c.id };
  }

  // ---------- SKU / dịch vụ chuẩn ----------
  async items(q: { kind?: string; q?: string; categoryId?: string; active?: boolean; take?: number }) {
    const where: Prisma.CatalogItemWhereInput = {};
    if (q.kind === 'PRODUCT' || q.kind === 'SERVICE') where.kind = q.kind;
    if (q.categoryId) where.OR = [{ categoryId: q.categoryId }, { category: { parentId: q.categoryId } }];
    if (q.active !== undefined) where.active = q.active;
    if (q.q?.trim()) where.AND = textFilter(q.q);
    const rows = await this.prisma.catalogItem.findMany({ where, include: { category: true }, orderBy: [{ name: 'asc' }], take: q.take ?? 200 });
    return Promise.all(rows.map((r) => this.itemView(r)));
  }

  private async checkImage(fileId: string | null | undefined, tenantId: string) {
    if (fileId) await this.files.assertOwnedImage(fileId, tenantId);
  }

  async saveItem(a: Access, id: string | null, dto: ItemDto, ip?: string) {
    assertPlatform(a);
    const dup = await this.prisma.catalogItem.findUnique({ where: { code: dto.code } });
    if (dup && dup.id !== id) throw new ConflictException(`Mã ${dto.code} đã có trong danh mục`);
    if (dto.categoryId) {
      const c = await this.prisma.catalogCategory.findUnique({ where: { id: dto.categoryId } });
      if (!c || c.kind !== dto.kind) throw new BadRequestException('Nhóm không đúng loại');
    }
    await this.checkImage(dto.imageFileId, a.tenantId);
    if (id) {
      const before = await this.prisma.catalogItem.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Không tìm thấy');
      if (before.kind !== dto.kind) throw new BadRequestException('Không đổi được loại sản phẩm / dịch vụ');
    }
    const data = {
      kind: dto.kind,
      code: dto.code,
      name: dto.name,
      categoryId: dto.categoryId ?? null,
      brand: dto.brand ?? null,
      unit: dto.unit ?? null,
      specs: dto.specs as Prisma.InputJsonValue,
      description: dto.description ?? null,
      imageFileId: dto.imageFileId ?? null,
      active: dto.active,
      searchText: searchKey(dto.code, dto.name, dto.brand, ...dto.specs.map((s) => s.value)),
    };
    const row = id ? await this.prisma.catalogItem.update({ where: { id }, data }) : await this.prisma.catalogItem.create({ data });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: id ? 'catalog.item_updated' : 'catalog.item_created',
      entity: 'catalog_item',
      entityId: row.id,
      after: { code: dto.code, name: dto.name, active: dto.active },
      ip,
    });
    return { id: row.id };
  }

  // ---------- Đề xuất từ garage ----------
  async propose(a: Access, dto: { kind: Kind; name: string; brand?: string | null; note?: string | null }, ip?: string) {
    assertSeller(a);
    const open = await this.prisma.catalogProposal.count({ where: { tenantId: a.tenantId, status: 'CHO_XU_LY' } });
    if (open >= 20) throw new BadRequestException('Đang có 20 đề xuất chờ sàn xử lý, vui lòng đợi');
    const p = await this.prisma.catalogProposal.create({ data: { tenantId: a.tenantId, kind: dto.kind, name: dto.name, brand: dto.brand ?? null, note: dto.note ?? null, createdBy: a.userId } });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'catalog.proposed', entity: 'catalog_proposal', entityId: p.id, after: dto, ip });
    return { id: p.id };
  }

  async myProposals(a: Access) {
    assertSeller(a);
    const rows = await this.prisma.catalogProposal.findMany({ where: { tenantId: a.tenantId }, orderBy: { createdAt: 'desc' }, take: 50 });
    const items = await this.prisma.catalogItem.findMany({ where: { id: { in: rows.map((r) => r.catalogItemId).filter((x): x is string => !!x) } }, select: { id: true, code: true, name: true } });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      brand: r.brand,
      note: r.note,
      status: r.status,
      reviewNote: r.reviewNote,
      createdAt: r.createdAt,
      item: items.find((i) => i.id === r.catalogItemId) ?? null,
    }));
  }

  async proposals(a: Access, status?: string) {
    assertPlatform(a);
    const rows = await this.prisma.catalogProposal.findMany({ where: status ? { status: status as 'CHO_XU_LY' } : {}, orderBy: { createdAt: 'desc' }, take: 200 });
    const tenants = await this.prisma.tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } }, select: { id: true, name: true } });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      brand: r.brand,
      note: r.note,
      status: r.status,
      reviewNote: r.reviewNote,
      createdAt: r.createdAt,
      garage: tenants.find((t) => t.id === r.tenantId)?.name ?? '',
    }));
  }

  /** Tạo SKU / dịch vụ chuẩn từ đề xuất (hoặc gắn vào mục đã có) */
  async acceptProposal(a: Access, id: string, dto: ItemDto | { existingItemId: string }, ip?: string) {
    assertPlatform(a);
    const p = await this.prisma.catalogProposal.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Không tìm thấy đề xuất');
    if (p.status !== 'CHO_XU_LY') throw new ConflictException('Đề xuất đã được xử lý');
    let itemId: string;
    if ('existingItemId' in dto) {
      const it = await this.prisma.catalogItem.findUnique({ where: { id: dto.existingItemId } });
      if (!it || it.kind !== p.kind) throw new BadRequestException('Mục trong danh mục không hợp lệ');
      itemId = it.id;
    } else {
      if (dto.kind !== p.kind) throw new BadRequestException('Sai loại');
      itemId = (await this.saveItem(a, null, dto, ip)).id;
    }
    await this.prisma.catalogProposal.update({ where: { id }, data: { status: 'DA_TAO', catalogItemId: itemId, reviewedBy: a.userId, reviewedAt: new Date() } });
    return { status: 'DA_TAO', catalogItemId: itemId };
  }

  async rejectProposal(a: Access, id: string, note: string, ip?: string) {
    assertPlatform(a);
    const p = await this.prisma.catalogProposal.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Không tìm thấy đề xuất');
    if (p.status !== 'CHO_XU_LY') throw new ConflictException('Đề xuất đã được xử lý');
    await this.prisma.catalogProposal.update({ where: { id }, data: { status: 'TU_CHOI', reviewNote: note, reviewedBy: a.userId, reviewedAt: new Date() } });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'catalog.proposal_rejected', entity: 'catalog_proposal', entityId: id, after: { note }, ip });
    return { status: 'TU_CHOI' };
  }
}

const proposalSchema = z.object({ kind: kindSchema, name: z.string().trim().min(2, 'Nhập tên sản phẩm / dịch vụ').max(200), brand: optText(100), note: optText(500) });
const acceptSchema = z.union([z.object({ existingItemId: z.string().uuid() }), itemSchema]);
const noteSchema = z.object({ note: z.string().trim().min(3, 'Ghi lý do').max(500) });

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // ---- Người bán: tra danh mục chuẩn để đăng tin ----
  @Get('catalog/categories')
  sellerCategories(@CurrentAuth() auth: RequestAuth, @Query('kind') kind?: Kind) {
    assertSeller(auth.access);
    return this.catalog.categories(kind);
  }

  @Get('catalog/items')
  sellerItems(@CurrentAuth() auth: RequestAuth, @Query('kind') kind?: string, @Query('q') q?: string, @Query('categoryId') categoryId?: string) {
    assertSeller(auth.access);
    return this.catalog.items({ kind, q, categoryId: categoryId || undefined, active: true, take: 50 });
  }

  @Get('catalog/proposals')
  myProposals(@CurrentAuth() auth: RequestAuth) {
    return this.catalog.myProposals(auth.access);
  }

  @Post('catalog/proposals')
  propose(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(proposalSchema)) dto: z.infer<typeof proposalSchema>, @Req() req: Request) {
    return this.catalog.propose(auth.access, dto, clientIp(req));
  }

  // ---- Sàn: quản lý danh mục chuẩn (A6.20–A6.24) ----
  @RequirePermissions('platform.catalog.manage')
  @Get('platform/catalog/categories')
  categories(@CurrentAuth() auth: RequestAuth, @Query('kind') kind?: Kind) {
    assertPlatform(auth.access);
    return this.catalog.categories(kind);
  }

  @RequirePermissions('platform.catalog.manage')
  @Post('platform/catalog/categories')
  createCategory(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(categorySchema)) dto: z.infer<typeof categorySchema>, @Req() req: Request) {
    return this.catalog.saveCategory(auth.access, null, dto, clientIp(req));
  }

  @RequirePermissions('platform.catalog.manage')
  @Put('platform/catalog/categories/:id')
  updateCategory(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(categorySchema)) dto: z.infer<typeof categorySchema>, @Req() req: Request) {
    return this.catalog.saveCategory(auth.access, id, dto, clientIp(req));
  }

  @RequirePermissions('platform.catalog.manage')
  @Get('platform/catalog/items')
  items(@CurrentAuth() auth: RequestAuth, @Query('kind') kind?: string, @Query('q') q?: string, @Query('categoryId') categoryId?: string) {
    assertPlatform(auth.access);
    return this.catalog.items({ kind, q, categoryId: categoryId || undefined });
  }

  @RequirePermissions('platform.catalog.manage')
  @Post('platform/catalog/items')
  createItem(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(itemSchema)) dto: ItemDto, @Req() req: Request) {
    return this.catalog.saveItem(auth.access, null, dto, clientIp(req));
  }

  @RequirePermissions('platform.catalog.manage')
  @Put('platform/catalog/items/:id')
  updateItem(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(itemSchema)) dto: ItemDto, @Req() req: Request) {
    return this.catalog.saveItem(auth.access, id, dto, clientIp(req));
  }

  @RequirePermissions('platform.catalog.manage')
  @Get('platform/catalog/proposals')
  proposals(@CurrentAuth() auth: RequestAuth, @Query('status') status?: string) {
    return this.catalog.proposals(auth.access, status);
  }

  @RequirePermissions('platform.catalog.manage')
  @Post('platform/catalog/proposals/:id/accept')
  @HttpCode(200)
  accept(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(acceptSchema)) dto: z.infer<typeof acceptSchema>, @Req() req: Request) {
    return this.catalog.acceptProposal(auth.access, id, dto, clientIp(req));
  }

  @RequirePermissions('platform.catalog.manage')
  @Post('platform/catalog/proposals/:id/reject')
  @HttpCode(200)
  reject(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(noteSchema)) dto: { note: string }, @Req() req: Request) {
    return this.catalog.rejectProposal(auth.access, id, dto.note, clientIp(req));
  }
}
