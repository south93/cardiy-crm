import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
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
import { assertPlatform, assertSeller, CatalogService, textFilter } from './catalog';
import { availableStock, canMoveOffer, checkOpeningHours, EDITABLE, publicState, shopMissing, slugify, statusAfterEdit, statusOnSubmit, type OfferStatus, type OpeningDay } from './offer-rules';

const n = (b: bigint | number | null | undefined) => (b === null || b === undefined ? null : Number(b));
const optText = (max: number) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const MAX_IMAGES = 6;

const dayList = z.array(z.object({ day: z.number().int().min(0).max(6), open: z.string().max(5), close: z.string().max(5), closed: z.boolean() })).max(7);
export const shopSchema = z.object({
  name: z.string().trim().min(2, 'Nhập tên gian hàng').max(150),
  slug: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Đường dẫn chỉ gồm chữ thường không dấu, số và gạch ngang')
      .min(3)
      .max(60)
      .nullable()
      .optional(),
  ),
  intro: optText(2000),
  phone: optText(20),
  address: optText(300),
  province: optText(100),
  lat: z.coerce.number().min(-90).max(90).nullable().optional(),
  lng: z.coerce.number().min(-180).max(180).nullable().optional(),
  openingHours: dayList.default([]),
  returnPolicy: optText(3000),
  warrantyPolicy: optText(3000),
  cancelPolicy: optText(3000),
  logoFileId: z.string().uuid().nullable().optional(),
  coverFileId: z.string().uuid().nullable().optional(),
});
type ShopDto = z.infer<typeof shopSchema>;

const money = z.coerce.number().int().min(0, 'Giá không hợp lệ').max(10_000_000_000);
export const offerSchema = z.object({
  kind: z.enum(['PRODUCT', 'SERVICE']),
  catalogItemId: z.string().uuid('Chọn sản phẩm / dịch vụ trong danh mục chuẩn'),
  productId: z.string().uuid().nullable().optional(),
  manualStock: z.coerce.number().int().min(0).max(1_000_000).nullable().optional(),
  branchIds: z.array(z.string().uuid()).max(50).default([]),
  price: money,
  listPrice: money.nullable().optional(),
  priceFrom: z.boolean().default(false),
  installIncluded: z.boolean().default(false),
  mfgYear: z.coerce.number().int().min(2000).max(2100).nullable().optional(),
  durationMinutes: z.coerce
    .number()
    .int()
    .min(5)
    .max(7 * 24 * 60)
    .nullable()
    .optional(),
  note: optText(2000),
  imageFileIds: z.array(z.string().uuid()).max(MAX_IMAGES, `Tối đa ${MAX_IMAGES} ảnh`).default([]),
});
type OfferDto = z.infer<typeof offerSchema>;

type OfferRow = Prisma.OfferGetPayload<{ include: { catalogItem: { include: { category: true } } } }>;

@Injectable()
export class ShopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly catalog: CatalogService,
  ) {}

  private url = (id: string | null | undefined) => (id ? this.files.signedUrl(id).catch(() => null) : Promise.resolve(null));

  // ---------------- Hồ sơ gian hàng (A7.10 / A3.50) ----------------

  async getShop(a: Access) {
    assertSeller(a);
    const [tenant, shop, live, branches] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: a.tenantId } }),
      this.prisma.shop.findUnique({ where: { tenantId: a.tenantId } }),
      this.prisma.offer.count({ where: { tenantId: a.tenantId, status: 'DANG_BAN' } }),
      this.prisma.branch.findMany({ where: { tenantId: a.tenantId, deletedAt: null }, orderBy: { code: 'asc' } }),
    ]);
    const main = branches[0];
    // Chưa có hồ sơ: điền sẵn từ thông tin garage / chi nhánh đầu tiên
    const view = shop
      ? { ...shop, openingHours: shop.openingHours as unknown as OpeningDay[] }
      : {
          name: tenant.name,
          slug: null,
          intro: null,
          phone: main?.phone ?? null,
          address: main?.address ?? null,
          province: null,
          lat: main?.lat ?? null,
          lng: main?.lng ?? null,
          openingHours: [] as OpeningDay[],
          returnPolicy: null,
          warrantyPolicy: null,
          cancelPolicy: null,
          logoFileId: null,
          coverFileId: null,
        };
    return {
      saved: !!shop,
      shop: { ...view, logoUrl: await this.url(view.logoFileId), coverUrl: await this.url(view.coverFileId) },
      tenantStatus: tenant.status,
      tenantType: tenant.type,
      liveOffers: live,
      missing: shopMissing(shop ? view : null, live, tenant.type === 'GARAGE' ? 'HOAT_DONG' : tenant.status),
      branches: branches.map((b) => ({ id: b.id, code: b.code, name: b.name })),
    };
  }

  private async uniqueSlug(base: string, tenantId: string) {
    const root = base || 'gian-hang';
    for (let i = 0; i < 50; i++) {
      const s = i ? `${root}-${i + 1}` : root;
      const hit = await this.prisma.shop.findUnique({ where: { slug: s } });
      if (!hit || hit.tenantId === tenantId) return s;
    }
    return `${root}-${Date.now().toString(36)}`;
  }

  async saveShop(a: Access, dto: ShopDto, ip?: string) {
    assertSeller(a);
    const err = checkOpeningHours(dto.openingHours);
    if (err) throw new BadRequestException(err);
    if ((dto.lat == null) !== (dto.lng == null)) throw new BadRequestException('Nhập đủ vĩ độ và kinh độ');
    for (const f of [dto.logoFileId, dto.coverFileId]) if (f) await this.files.assertOwnedImage(f, a.tenantId);
    const current = await this.prisma.shop.findUnique({ where: { tenantId: a.tenantId } });
    let slug: string;
    if (dto.slug) {
      const hit = await this.prisma.shop.findUnique({ where: { slug: dto.slug } });
      if (hit && hit.tenantId !== a.tenantId) throw new ConflictException('Đường dẫn này đã có gian hàng khác dùng');
      slug = dto.slug;
    } else slug = current?.slug ?? (await this.uniqueSlug(slugify(dto.name), a.tenantId));
    const data = {
      name: dto.name,
      slug,
      intro: dto.intro ?? null,
      phone: dto.phone ?? null,
      address: dto.address ?? null,
      province: dto.province ?? null,
      lat: dto.lat ?? null,
      lng: dto.lng ?? null,
      openingHours: [...dto.openingHours].sort((x, y) => x.day - y.day) as unknown as Prisma.InputJsonValue,
      returnPolicy: dto.returnPolicy ?? null,
      warrantyPolicy: dto.warrantyPolicy ?? null,
      cancelPolicy: dto.cancelPolicy ?? null,
      logoFileId: dto.logoFileId ?? null,
      coverFileId: dto.coverFileId ?? null,
    };
    await this.prisma.shop.upsert({ where: { tenantId: a.tenantId }, create: { tenantId: a.tenantId, ...data }, update: data });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: current ? 'shop.updated' : 'shop.created', entity: 'shop', entityId: a.tenantId, after: { name: dto.name, slug }, ip });
    return this.getShop(a);
  }

  // ---------------- Tin đăng (A7.11, A7.12 / A3.50) ----------------

  private async views(rows: OfferRow[]) {
    const productIds = [...new Set(rows.map((r) => r.productId).filter((x): x is string => !!x))];
    const [levels, products] = await Promise.all([
      this.prisma.stockLevel.findMany({ where: { productId: { in: productIds } } }),
      this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, code: true, name: true, salePrice: true } }),
    ]);
    return Promise.all(
      rows.map(async (o) => {
        const stock = availableStock(
          o,
          levels.filter((l) => l.productId === o.productId).map((l) => ({ branchId: l.branchId, quantity: Number(l.quantity) })),
        );
        const p = products.find((x) => x.id === o.productId);
        return {
          id: o.id,
          kind: o.kind,
          status: o.status as OfferStatus,
          catalogItem: await this.catalog.itemView(o.catalogItem),
          product: p ? { id: p.id, code: p.code, name: p.name, salePrice: n(p.salePrice) } : null,
          manualStock: o.manualStock,
          stock,
          publicState: publicState(o.status as OfferStatus, stock),
          branchIds: o.branchIds,
          price: n(o.price)!,
          listPrice: n(o.listPrice),
          priceFrom: o.priceFrom,
          installIncluded: o.installIncluded,
          mfgYear: o.mfgYear,
          durationMinutes: o.durationMinutes,
          note: o.note,
          images: await Promise.all(o.imageFileIds.map(async (id) => ({ id, url: await this.url(id) }))),
          reviewNote: o.reviewNote,
          submittedAt: o.submittedAt,
          updatedAt: o.updatedAt,
        };
      }),
    );
  }

  async offers(a: Access, q: { kind?: string; status?: string; q?: string }) {
    assertSeller(a);
    const where: Prisma.OfferWhereInput = { tenantId: a.tenantId };
    if (q.kind === 'PRODUCT' || q.kind === 'SERVICE') where.kind = q.kind;
    if (q.status) where.status = q.status as OfferStatus;
    if (q.q?.trim()) where.catalogItem = { AND: textFilter(q.q) };
    const rows = await this.prisma.offer.findMany({ where, include: { catalogItem: { include: { category: true } } }, orderBy: { updatedAt: 'desc' }, take: 300 });
    const all = await this.prisma.offer.groupBy({ by: ['status'], where: { tenantId: a.tenantId, ...(where.kind ? { kind: where.kind } : {}) }, _count: true });
    return { counts: Object.fromEntries(all.map((c) => [c.status, c._count])), items: await this.views(rows) };
  }

  private async validate(a: Access, dto: OfferDto) {
    const item = await this.prisma.catalogItem.findUnique({ where: { id: dto.catalogItemId } });
    if (!item || item.kind !== dto.kind) throw new BadRequestException('Sản phẩm / dịch vụ chuẩn không hợp lệ');
    if (dto.listPrice != null && dto.listPrice <= dto.price) throw new BadRequestException('Giá niêm yết phải cao hơn giá bán');
    if (dto.productId) {
      if (a.tenantType !== 'GARAGE') throw new BadRequestException('Đối tác nhập số lượng tồn trực tiếp');
      if (dto.kind !== 'PRODUCT') throw new BadRequestException('Dịch vụ không liên kết hàng trong kho');
      const p = await this.prisma.product.findFirst({ where: { id: dto.productId, tenantId: a.tenantId, deletedAt: null, kind: 'PHU_TUNG' } });
      if (!p) throw new BadRequestException('Không tìm thấy hàng trong kho');
    } else if (dto.kind === 'PRODUCT' && dto.manualStock == null) {
      throw new BadRequestException(a.tenantType === 'GARAGE' ? 'Liên kết hàng trong kho hoặc nhập số lượng tồn' : 'Nhập số lượng còn bán');
    }
    if (dto.branchIds.length) {
      const ok = await this.prisma.branch.count({ where: { tenantId: a.tenantId, id: { in: dto.branchIds }, deletedAt: null } });
      if (ok !== new Set(dto.branchIds).size) throw new BadRequestException('Chi nhánh không hợp lệ');
    }
    for (const f of dto.imageFileIds) await this.files.assertOwnedImage(f, a.tenantId);
    return item;
  }

  private data(dto: OfferDto) {
    const product = dto.kind === 'PRODUCT';
    return {
      catalogItemId: dto.catalogItemId,
      productId: product ? (dto.productId ?? null) : null,
      manualStock: product && !dto.productId ? (dto.manualStock ?? 0) : null,
      branchIds: [...new Set(dto.branchIds)],
      price: BigInt(dto.price),
      listPrice: dto.listPrice != null ? BigInt(dto.listPrice) : null,
      priceFrom: !product && dto.priceFrom,
      installIncluded: product && dto.installIncluded,
      mfgYear: product ? (dto.mfgYear ?? null) : null,
      durationMinutes: product ? null : (dto.durationMinutes ?? null),
      note: dto.note ?? null,
      imageFileIds: dto.imageFileIds,
    };
  }

  private async own(a: Access, id: string) {
    const o = await this.prisma.offer.findFirst({ where: { id, tenantId: a.tenantId }, include: { catalogItem: { include: { category: true } } } });
    if (!o) throw new NotFoundException('Không tìm thấy tin đăng');
    return o;
  }

  async create(a: Access, dto: OfferDto, ip?: string) {
    assertSeller(a);
    const item = await this.validate(a, dto);
    if (!item.active) throw new BadRequestException('Mục này đã ngừng trong danh mục chuẩn');
    const o = await this.prisma.offer.create({ data: { tenantId: a.tenantId, kind: dto.kind, ...this.data(dto), createdBy: a.userId }, include: { catalogItem: { include: { category: true } } } });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'offer.created', entity: 'offer', entityId: o.id, after: { item: item.code, price: dto.price }, ip });
    return (await this.views([o]))[0];
  }

  async update(a: Access, id: string, dto: OfferDto, ip?: string) {
    assertSeller(a);
    const o = await this.own(a, id);
    if (!EDITABLE.includes(o.status as OfferStatus)) throw new ConflictException('Tin đã bị sàn gỡ, không sửa được');
    if (dto.kind !== o.kind) throw new BadRequestException('Không đổi được loại tin');
    const item = await this.validate(a, dto);
    if (!item.active && item.id !== o.catalogItemId) throw new BadRequestException('Mục này đã ngừng trong danh mục chuẩn');
    const important = dto.catalogItemId !== o.catalogItemId || (dto.note ?? null) !== o.note || dto.imageFileIds.join() !== o.imageFileIds.join();
    const status = statusAfterEdit(o.status as OfferStatus, important, a.tenantType === 'GARAGE');
    const row = await this.prisma.offer.update({
      where: { id },
      data: { ...this.data(dto), status, ...(status === 'CHO_DUYET' && o.status !== 'CHO_DUYET' ? { submittedAt: new Date(), reviewNote: null } : {}) },
      include: { catalogItem: { include: { category: true } } },
    });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'offer.updated',
      entity: 'offer',
      entityId: id,
      before: { status: o.status, price: n(o.price) },
      after: { status, price: dto.price, important },
      ip,
    });
    return (await this.views([row]))[0];
  }

  private async move(a: Access, id: string, to: OfferStatus, action: string, ip?: string) {
    const o = await this.own(a, id);
    if (!canMoveOffer(o.status as OfferStatus, to)) throw new ConflictException('Trạng thái tin không cho phép thao tác này');
    await this.prisma.offer.update({ where: { id }, data: { status: to, ...(to === 'CHO_DUYET' ? { submittedAt: new Date(), reviewNote: null } : {}) } });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action, entity: 'offer', entityId: id, before: { status: o.status }, after: { status: to }, ip });
    return { status: to };
  }

  async submit(a: Access, id: string, ip?: string) {
    assertSeller(a);
    const o = await this.own(a, id);
    const to = statusOnSubmit(o.status as OfferStatus, a.tenantType === 'GARAGE');
    if (!to) throw new ConflictException('Chỉ gửi duyệt được tin nháp');
    if (!o.catalogItem.active) throw new BadRequestException('Mục này đã ngừng trong danh mục chuẩn');
    return this.move(a, id, to, 'offer.submitted', ip);
  }
  hide = (a: Access, id: string, ip?: string) => (assertSeller(a), this.move(a, id, 'TAM_AN', 'offer.hidden', ip));
  show = (a: Access, id: string, ip?: string) => (assertSeller(a), this.move(a, id, 'DANG_BAN', 'offer.shown', ip));

  async remove(a: Access, id: string, ip?: string) {
    assertSeller(a);
    const o = await this.own(a, id);
    if (o.status !== 'NHAP' && o.status !== 'BI_TU_CHOI') throw new ConflictException('Chỉ xoá được tin nháp hoặc bị từ chối; tin đang bán hãy ẩn');
    await this.prisma.offer.delete({ where: { id } });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'offer.deleted', entity: 'offer', entityId: id, before: { item: o.catalogItem.code }, ip });
    return { status: 'ok' };
  }

  // ---------------- Sàn: kiểm duyệt tin (A6.30) ----------------

  async queue(a: Access, q: { status?: string; q?: string }) {
    assertPlatform(a);
    const where: Prisma.OfferWhereInput = { status: (q.status as OfferStatus) || 'CHO_DUYET' };
    const rows = await this.prisma.offer.findMany({ where, include: { catalogItem: { include: { category: true } } }, orderBy: [{ submittedAt: 'asc' }], take: 200 });
    const [tenants, shops, counts] = await Promise.all([
      this.prisma.tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } }, select: { id: true, name: true, type: true } }),
      this.prisma.shop.findMany({ where: { tenantId: { in: [...new Set(rows.map((r) => r.tenantId))] } }, select: { tenantId: true, name: true } }),
      this.prisma.offer.groupBy({ by: ['status'], _count: true }),
    ]);
    const views = await this.views(rows);
    return {
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
      items: views.map((v, i) => {
        const t = tenants.find((x) => x.id === rows[i]!.tenantId);
        return { ...v, tenantId: rows[i]!.tenantId, seller: shops.find((s) => s.tenantId === rows[i]!.tenantId)?.name ?? t?.name ?? '', sellerType: t?.type ?? null };
      }),
    };
  }

  async review(a: Access, id: string, to: 'DANG_BAN' | 'BI_TU_CHOI' | 'BI_GO', note: string | null, ip?: string) {
    assertPlatform(a);
    const o = await this.prisma.offer.findUnique({ where: { id } });
    if (!o) throw new NotFoundException('Không tìm thấy tin đăng');
    if (to === 'DANG_BAN' && o.status !== 'CHO_DUYET') throw new ConflictException('Tin không ở trạng thái chờ duyệt');
    if (!canMoveOffer(o.status as OfferStatus, to)) throw new ConflictException('Trạng thái tin không cho phép thao tác này');
    await this.prisma.offer.update({ where: { id }, data: { status: to, reviewNote: note, reviewedBy: a.userId, reviewedAt: new Date() } });
    const action = to === 'DANG_BAN' ? 'offer.approved' : to === 'BI_TU_CHOI' ? 'offer.rejected' : 'offer.taken_down';
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action, entity: 'offer', entityId: id, before: { status: o.status }, after: { status: to, note }, ip });
    // Nhật ký phía garage để garage thấy lý do trong lịch sử của họ
    if (to !== 'DANG_BAN') await this.audit.log({ tenantId: o.tenantId, actorId: a.userId, action, entity: 'offer', entityId: id, after: { note }, ip });
    return { status: to };
  }
}

const noteSchema = z.object({ note: z.string().trim().min(3, 'Ghi lý do').max(500) });

@Controller()
export class ShopController {
  constructor(private readonly shops: ShopService) {}

  @Get('shop')
  get(@CurrentAuth() auth: RequestAuth) {
    return this.shops.getShop(auth.access);
  }

  @Put('shop')
  save(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(shopSchema)) dto: ShopDto, @Req() req: Request) {
    return this.shops.saveShop(auth.access, dto, clientIp(req));
  }

  @Get('shop/offers')
  offers(@CurrentAuth() auth: RequestAuth, @Query('kind') kind?: string, @Query('status') status?: string, @Query('q') q?: string) {
    return this.shops.offers(auth.access, { kind, status, q });
  }

  @Post('shop/offers')
  create(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(offerSchema)) dto: OfferDto, @Req() req: Request) {
    return this.shops.create(auth.access, dto, clientIp(req));
  }

  @Put('shop/offers/:id')
  update(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(offerSchema)) dto: OfferDto, @Req() req: Request) {
    return this.shops.update(auth.access, id, dto, clientIp(req));
  }

  @Post('shop/offers/:id/submit')
  @HttpCode(200)
  submit(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.shops.submit(auth.access, id, clientIp(req));
  }

  @Post('shop/offers/:id/hide')
  @HttpCode(200)
  hide(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.shops.hide(auth.access, id, clientIp(req));
  }

  @Post('shop/offers/:id/show')
  @HttpCode(200)
  show(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.shops.show(auth.access, id, clientIp(req));
  }

  @Post('shop/offers/:id/delete')
  @HttpCode(200)
  remove(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.shops.remove(auth.access, id, clientIp(req));
  }

  // ---- Sàn: kiểm duyệt tin đăng ----
  @RequirePermissions('platform.partner.review')
  @Get('platform/offers')
  queue(@CurrentAuth() auth: RequestAuth, @Query('status') status?: string, @Query('q') q?: string) {
    return this.shops.queue(auth.access, { status, q });
  }

  @RequirePermissions('platform.partner.review')
  @Post('platform/offers/:id/approve')
  @HttpCode(200)
  approve(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.shops.review(auth.access, id, 'DANG_BAN', null, clientIp(req));
  }

  @RequirePermissions('platform.partner.review')
  @Post('platform/offers/:id/reject')
  @HttpCode(200)
  reject(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(noteSchema)) dto: { note: string }, @Req() req: Request) {
    return this.shops.review(auth.access, id, 'BI_TU_CHOI', dto.note, clientIp(req));
  }

  @RequirePermissions('platform.partner.review')
  @Post('platform/offers/:id/takedown')
  @HttpCode(200)
  takedown(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(noteSchema)) dto: { note: string }, @Req() req: Request) {
    return this.shops.review(auth.access, id, 'BI_GO', dto.note, clientIp(req));
  }
}
