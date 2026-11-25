import { Controller, Get, Injectable, NotFoundException, Param, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Public } from '../common/auth.decorators';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { textFilter } from './catalog';
import { availableStock, distanceKm, openNow, publicState, reviewerName, tenantListable, type OfferStatus, type OpeningDay } from './offer-rules';

const n = (b: bigint | number | null | undefined) => (b === null || b === undefined ? null : Number(b));
type Kind = 'PRODUCT' | 'SERVICE';
interface Geo {
  lat?: number;
  lng?: number;
}
const geoOf = (lat?: string, lng?: string): Geo => {
  const a = Number(lat);
  const b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 && (lat ?? '') !== '' ? { lat: a, lng: b } : {};
};

type ShopRow = Prisma.ShopGetPayload<object>;
interface ShopCard {
  tenantId: string;
  slug: string;
  name: string;
  intro: string | null;
  phone: string | null;
  address: string | null;
  province: string | null;
  lat: number | null;
  lng: number | null;
  logoUrl: string | null;
  openNow: boolean;
  rating: { avg: number; count: number } | null;
  offers: number;
  services: number;
  distanceKm: number | null;
  /** Đặt lịch qua app chủ xe (garage của chủ sàn) */
  bookingUrl: string | null;
}

/**
 * Web sàn công khai (A1): không cần đăng nhập, chỉ đọc.
 * Chỉ hiện gian hàng được phép (đối tác đang hoạt động, garage chủ sàn không bị khoá) có ít nhất 1 tin đang bán.
 */
@Injectable()
export class PublicMarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  private url = (id: string | null | undefined) => (id ? this.files.signedUrl(id).catch(() => null) : Promise.resolve(null));

  /** Gian hàng đang hiện trên sàn, kèm số tin đang bán và đánh giá */
  private async visibleShops(where: Prisma.ShopWhereInput = {}) {
    const shops = await this.prisma.shop.findMany({ where, orderBy: { createdAt: 'asc' } });
    if (!shops.length)
      return {
        shops: [] as ShopRow[],
        tenants: new Map<string, { type: string }>(),
        counts: new Map<string, { PRODUCT: number; SERVICE: number }>(),
        ratings: new Map<string, { avg: number; count: number }>(),
      };
    const ids = shops.map((s) => s.tenantId);
    const [tenants, live, ratings] = await Promise.all([
      this.prisma.tenant.findMany({ where: { id: { in: ids } }, select: { id: true, type: true, status: true, deletedAt: true } }),
      this.prisma.offer.groupBy({ by: ['tenantId', 'kind'], where: { tenantId: { in: ids }, status: 'DANG_BAN' }, _count: true }),
      this.prisma.orderReview.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _avg: { rating: true }, _count: true }),
    ]);
    const counts = new Map<string, { PRODUCT: number; SERVICE: number }>();
    for (const r of live) {
      const c = counts.get(r.tenantId) ?? { PRODUCT: 0, SERVICE: 0 };
      c[r.kind] = r._count;
      counts.set(r.tenantId, c);
    }
    const okTenants = new Map(tenants.filter(tenantListable).map((t) => [t.id, { type: t.type }]));
    return {
      shops: shops.filter((s) => okTenants.has(s.tenantId) && (counts.get(s.tenantId)?.PRODUCT ?? 0) + (counts.get(s.tenantId)?.SERVICE ?? 0) > 0),
      tenants: okTenants,
      counts,
      ratings: new Map(ratings.map((r) => [r.tenantId, { avg: Math.round((r._avg.rating ?? 0) * 10) / 10, count: r._count }])),
    };
  }

  private async card(s: ShopRow, v: Awaited<ReturnType<PublicMarketService['visibleShops']>>, geo: Geo): Promise<ShopCard> {
    const c = v.counts.get(s.tenantId);
    return {
      tenantId: s.tenantId,
      slug: s.slug,
      name: s.name,
      intro: s.intro,
      phone: s.phone,
      address: s.address,
      province: s.province,
      lat: s.lat,
      lng: s.lng,
      logoUrl: await this.url(s.logoFileId),
      openNow: openNow(s.openingHours as unknown as OpeningDay[]),
      rating: v.ratings.get(s.tenantId) ?? null,
      offers: c?.PRODUCT ?? 0,
      services: c?.SERVICE ?? 0,
      distanceKm: geo.lat != null && s.lat != null && s.lng != null ? distanceKm({ lat: geo.lat, lng: geo.lng! }, { lat: s.lat, lng: s.lng }) : null,
      bookingUrl: v.tenants.get(s.tenantId)?.type === 'GARAGE' ? '/app/dat-lich' : null,
    };
  }

  // ---------- Trang chủ (A1.01) ----------
  async home() {
    const v = await this.visibleShops();
    const ids = v.shops.map((s) => s.tenantId);
    const [cats, shops, latest] = await Promise.all([
      this.categories(),
      Promise.all(v.shops.slice(0, 8).map((s) => this.card(s, v, {}))),
      this.prisma.offer.findMany({ where: { tenantId: { in: ids }, status: 'DANG_BAN', kind: 'PRODUCT' }, orderBy: { updatedAt: 'desc' }, take: 40, select: { catalogItemId: true } }),
    ]);
    const itemIds = [...new Set(latest.map((o) => o.catalogItemId))].slice(0, 8);
    const items = itemIds.length ? await this.itemCards({ id: { in: itemIds } }, ids) : [];
    return { categories: cats, shops, items, stats: { shops: v.shops.length } };
  }

  /** Nhóm có tin đang bán (đếm số mục) */
  async categories() {
    const v = await this.visibleShops();
    const live = await this.prisma.offer.findMany({
      where: { tenantId: { in: v.shops.map((s) => s.tenantId) }, status: 'DANG_BAN' },
      select: { catalogItem: { select: { id: true, categoryId: true } } },
    });
    const cats = await this.prisma.catalogCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    const itemsBy = new Map<string, Set<string>>();
    for (const o of live) {
      const c = cats.find((x) => x.id === o.catalogItem.categoryId);
      for (const key of [c?.id, c?.parentId].filter((x): x is string => !!x)) {
        if (!itemsBy.has(key)) itemsBy.set(key, new Set());
        itemsBy.get(key)!.add(o.catalogItem.id);
      }
    }
    return cats.filter((c) => itemsBy.has(c.id)).map((c) => ({ id: c.id, kind: c.kind, name: c.name, parentId: c.parentId, items: itemsBy.get(c.id)!.size }));
  }

  // ---------- Tìm garage (A1.02) ----------
  async shops(q: { q?: string; province?: string; categoryId?: string; geo: Geo; sort?: string }) {
    const v = await this.visibleShops();
    let list = v.shops;
    if (q.province) list = list.filter((s) => s.province === q.province);
    if (q.q?.trim()) {
      const words = q.q.trim().toLowerCase().split(/\s+/);
      const fold = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();
      list = list.filter((s) => words.every((w) => fold(`${s.name} ${s.address ?? ''} ${s.province ?? ''}`).includes(fold(w))));
    }
    if (q.categoryId) {
      const has = await this.prisma.offer.findMany({
        where: { tenantId: { in: list.map((s) => s.tenantId) }, status: 'DANG_BAN', catalogItem: { OR: [{ categoryId: q.categoryId }, { category: { parentId: q.categoryId } }] } },
        select: { tenantId: true },
        distinct: ['tenantId'],
      });
      const ok = new Set(has.map((h) => h.tenantId));
      list = list.filter((s) => ok.has(s.tenantId));
    }
    const cards = await Promise.all(list.map((s) => this.card(s, v, q.geo)));
    if (q.sort === 'gan' && q.geo.lat != null) cards.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
    else if (q.sort === 'danh-gia') cards.sort((a, b) => (b.rating?.avg ?? 0) - (a.rating?.avg ?? 0) || (b.rating?.count ?? 0) - (a.rating?.count ?? 0));
    else cards.sort((a, b) => b.offers + b.services - (a.offers + a.services));
    const provinces = [...new Set(v.shops.map((s) => s.province).filter((p): p is string => !!p))].sort((a, b) => a.localeCompare(b, 'vi'));
    return { provinces, items: cards };
  }

  // ---------- Trang garage (A1.03) ----------
  async shop(slug: string, geo: Geo) {
    const v = await this.visibleShops({ slug });
    const s = v.shops[0];
    if (!s) throw new NotFoundException('Không tìm thấy gian hàng');
    const [card, offers, reviews, branches] = await Promise.all([
      this.card(s, v, geo),
      this.offerRows({ tenantId: s.tenantId }),
      this.prisma.orderReview.findMany({ where: { tenantId: s.tenantId }, orderBy: { createdAt: 'desc' }, take: 10, include: { order: { select: { customer: { select: { name: true } } } } } }),
      v.tenants.get(s.tenantId)?.type === 'GARAGE'
        ? this.prisma.branch.findMany({ where: { tenantId: s.tenantId, deletedAt: null }, orderBy: { code: 'asc' }, select: { id: true, name: true, address: true, phone: true } })
        : Promise.resolve([]),
    ]);
    return {
      ...card,
      coverUrl: await this.url(s.coverFileId),
      openingHours: s.openingHours as unknown as OpeningDay[],
      policies: { warranty: s.warrantyPolicy, return: s.returnPolicy, cancel: s.cancelPolicy },
      branches: branches.map((b) => ({ name: b.name, address: b.address, phone: b.phone })),
      productOffers: offers.filter((o) => o.kind === 'PRODUCT'),
      serviceOffers: offers.filter((o) => o.kind === 'SERVICE'),
      reviews: reviews.map((r) => ({ rating: r.rating, comment: r.comment, reply: r.reply, createdAt: r.createdAt, name: reviewerName(r.order.customer?.name) })),
    };
  }

  /** Tin đang bán (đã kiểm tra gian hàng được hiện ở nơi gọi) */
  private async offerRows(where: Prisma.OfferWhereInput) {
    const rows = await this.prisma.offer.findMany({
      where: { ...where, status: 'DANG_BAN' },
      include: { catalogItem: { include: { category: true } } },
      orderBy: [{ catalogItem: { name: 'asc' } }],
      take: 500,
    });
    const productIds = [...new Set(rows.map((r) => r.productId).filter((x): x is string => !!x))];
    const levels = productIds.length ? await this.prisma.stockLevel.findMany({ where: { productId: { in: productIds } } }) : [];
    return Promise.all(
      rows.map(async (o) => {
        const stock = availableStock(
          o,
          levels.filter((l) => l.productId === o.productId).map((l) => ({ branchId: l.branchId, quantity: Number(l.quantity) })),
        );
        return {
          id: o.id,
          tenantId: o.tenantId,
          kind: o.kind as Kind,
          item: { code: o.catalogItem.code, name: o.catalogItem.name, brand: o.catalogItem.brand, category: o.catalogItem.category?.name ?? null, imageUrl: await this.url(o.catalogItem.imageFileId) },
          price: n(o.price)!,
          listPrice: n(o.listPrice),
          priceFrom: o.priceFrom,
          installIncluded: o.installIncluded,
          mfgYear: o.mfgYear,
          durationMinutes: o.durationMinutes,
          note: o.note,
          imageUrl: o.imageFileIds[0] ? await this.url(o.imageFileIds[0]) : null,
          state: publicState(o.status as OfferStatus, stock),
        };
      }),
    );
  }

  // ---------- Sản phẩm / dịch vụ (A1.04, A1.06) ----------
  private async itemCards(where: Prisma.CatalogItemWhereInput, tenantIds: string[]) {
    const items = await this.prisma.catalogItem.findMany({
      where: { ...where, offers: { some: { status: 'DANG_BAN', tenantId: { in: tenantIds } } } },
      include: { category: true },
      take: 120,
      orderBy: { name: 'asc' },
    });
    if (!items.length) return [];
    const offers = await this.offerRows({ catalogItemId: { in: items.map((i) => i.id) }, tenantId: { in: tenantIds } });
    const byCode = new Map<string, typeof offers>();
    for (const o of offers) byCode.set(o.item.code, [...(byCode.get(o.item.code) ?? []), o]);
    return Promise.all(
      items.map(async (i) => {
        const os = byCode.get(i.code) ?? [];
        const avail = os.filter((o) => o.state !== 'HET_HANG');
        return {
          code: i.code,
          kind: i.kind as Kind,
          name: i.name,
          brand: i.brand,
          category: i.category?.name ?? null,
          specs: i.specs as { label: string; value: string }[],
          imageUrl: (await this.url(i.imageFileId)) ?? os.find((o) => o.imageUrl)?.imageUrl ?? null,
          minPrice: os.length ? Math.min(...(avail.length ? avail : os).map((o) => o.price)) : null,
          sellers: new Set(os.map((o) => o.tenantId)).size,
          inStock: avail.length > 0,
        };
      }),
    );
  }

  async items(q: { kind?: string; categoryId?: string; q?: string; sort?: string }) {
    const v = await this.visibleShops();
    const where: Prisma.CatalogItemWhereInput = { kind: q.kind === 'SERVICE' ? 'SERVICE' : 'PRODUCT' };
    if (q.categoryId) where.OR = [{ categoryId: q.categoryId }, { category: { parentId: q.categoryId } }];
    if (q.q?.trim()) where.AND = textFilter(q.q);
    const cards = await this.itemCards(
      where,
      v.shops.map((s) => s.tenantId),
    );
    if (q.sort === 'gia') cards.sort((a, b) => (a.minPrice ?? 0) - (b.minPrice ?? 0));
    else cards.sort((a, b) => b.sellers - a.sellers || Number(b.inStock) - Number(a.inStock) || a.name.localeCompare(b.name, 'vi'));
    return cards;
  }

  /** A1.05 Chi tiết sản phẩm / dịch vụ: các garage đang bán, so giá, khoảng cách */
  async item(code: string, geo: Geo, sort?: string) {
    const i = await this.prisma.catalogItem.findUnique({ where: { code }, include: { category: true } });
    if (!i) throw new NotFoundException('Không tìm thấy');
    const v = await this.visibleShops();
    const offers = await this.offerRows({ catalogItemId: i.id, tenantId: { in: v.shops.map((s) => s.tenantId) } });
    if (!offers.length) throw new NotFoundException('Chưa có garage nào bán');
    const cards = new Map(await Promise.all(v.shops.filter((s) => offers.some((o) => o.tenantId === s.tenantId)).map(async (s) => [s.tenantId, await this.card(s, v, geo)] as const)));
    const sellers = offers.map((o) => ({ ...o, shop: cards.get(o.tenantId)! }));
    const stockRank = (x: (typeof sellers)[number]) => (x.state === 'HET_HANG' ? 1 : 0);
    if (sort === 'gan' && geo.lat != null) sellers.sort((a, b) => stockRank(a) - stockRank(b) || (a.shop.distanceKm ?? 1e9) - (b.shop.distanceKm ?? 1e9));
    else sellers.sort((a, b) => stockRank(a) - stockRank(b) || a.price - b.price);
    return {
      code: i.code,
      kind: i.kind as Kind,
      name: i.name,
      brand: i.brand,
      unit: i.unit,
      category: i.category ? { id: i.category.id, name: i.category.name } : null,
      specs: i.specs as { label: string; value: string }[],
      description: i.description,
      imageUrl: (await this.url(i.imageFileId)) ?? offers.find((o) => o.imageUrl)?.imageUrl ?? null,
      sellers,
    };
  }

  /** Dữ liệu sitemap.xml cho công cụ tìm kiếm */
  async sitemap() {
    const v = await this.visibleShops();
    const items = await this.prisma.catalogItem.findMany({
      where: { offers: { some: { status: 'DANG_BAN', tenantId: { in: v.shops.map((s) => s.tenantId) } } } },
      select: { code: true, kind: true, updatedAt: true },
    });
    return { shops: v.shops.map((s) => ({ slug: s.slug, updatedAt: s.updatedAt })), items };
  }
}

@Controller('public/market')
export class PublicMarketController {
  constructor(private readonly market: PublicMarketService) {}

  @Public()
  @Get('home')
  home() {
    return this.market.home();
  }

  @Public()
  @Get('categories')
  categories() {
    return this.market.categories();
  }

  @Public()
  @Get('shops')
  shops(@Query('q') q?: string, @Query('province') province?: string, @Query('categoryId') categoryId?: string, @Query('lat') lat?: string, @Query('lng') lng?: string, @Query('sort') sort?: string) {
    return this.market.shops({ q, province: province || undefined, categoryId: categoryId || undefined, geo: geoOf(lat, lng), sort });
  }

  @Public()
  @Get('shops/:slug')
  shop(@Param('slug') slug: string, @Query('lat') lat?: string, @Query('lng') lng?: string) {
    return this.market.shop(slug, geoOf(lat, lng));
  }

  @Public()
  @Get('items')
  items(@Query('kind') kind?: string, @Query('categoryId') categoryId?: string, @Query('q') q?: string, @Query('sort') sort?: string) {
    return this.market.items({ kind, categoryId: categoryId || undefined, q, sort });
  }

  @Public()
  @Get('items/:code')
  item(@Param('code') code: string, @Query('lat') lat?: string, @Query('lng') lng?: string, @Query('sort') sort?: string) {
    return this.market.item(code.toUpperCase(), geoOf(lat, lng), sort);
  }

  @Public()
  @Get('sitemap')
  sitemap() {
    return this.market.sitemap();
  }
}
