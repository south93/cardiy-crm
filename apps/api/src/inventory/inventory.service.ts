import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { searchKey } from '@cardiy/shared';
import { Prisma, type OrderItemKind, type StockDocType } from '@prisma/client';
import { AccessService, type Access } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import { reserveNumbers } from '../crm/counters';
import { PrismaService } from '../prisma/prisma.service';
import { applyMovement, COMMON_MAKES, currentQty, DEFAULT_CATEGORIES } from './stock';

export interface ProductInput {
  code?: string | null;
  name: string;
  kind: OrderItemKind;
  categoryId?: string | null;
  brand?: string | null;
  unit?: string | null;
  salePrice: number;
  costPrice?: number;
  vehicleMakes?: string[];
  minStock?: number | null;
  note?: string | null;
  active?: boolean;
}

export interface ProductQuery {
  q?: string;
  categoryId?: string;
  kind?: OrderItemKind;
  make?: string;
  branchId?: string;
  lowStock?: boolean;
  active?: boolean;
  page: number;
  pageSize: number;
}

export interface SupplierInput {
  name: string;
  phone?: string | null;
  address?: string | null;
  taxCode?: string | null;
  note?: string | null;
}

export interface DocInput {
  type: StockDocType;
  branchId: string;
  toBranchId?: string | null;
  supplierId?: string | null;
  refNo?: string | null;
  note?: string | null;
  /** NHAP: quantity + unitCost · CHUYEN: quantity · DIEU_CHINH: countedQty (số đếm thực tế) */
  lines: { productId: string; quantity?: string | number; unitCost?: number; countedQty?: string | number }[];
}

const DOC_PREFIX: Record<StockDocType, string> = { NHAP: 'PN', CHUYEN: 'PC', DIEU_CHINH: 'PK' };
const num = (d: Prisma.Decimal | null | undefined) => (d ? Number(d) : 0);
const makesOf = (list?: string[]) => [...new Set((list ?? []).map((m) => m.trim()).filter(Boolean))];

function qtyOf(v: string | number | undefined, allowZero = false) {
  const s = String(v ?? '').trim().replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const d = new Prisma.Decimal(s);
  return allowZero || d.gt(0) ? d : null;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private seesCost(a: Access) {
    return a.permissions.includes('inventory.manage') || a.permissions.includes('finance.view');
  }

  private branchIds(a: Access, branches: { id: string }[]) {
    return a.branchIds === 'ALL' ? branches.map((b) => b.id) : a.branchIds;
  }

  // ---------------- Nhóm sản phẩm ----------------

  async categories(a: Access) {
    let rows = await this.prisma.productCategory.findMany({ where: { tenantId: a.tenantId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    if (!rows.length) {
      // Lần đầu: tạo bộ nhóm mẫu theo yêu cầu garage
      await this.prisma.$transaction(async (tx) => {
        if (await tx.productCategory.count({ where: { tenantId: a.tenantId } })) return;
        for (const [i, [name, children]] of DEFAULT_CATEGORIES.entries()) {
          const p = await tx.productCategory.create({ data: { tenantId: a.tenantId, name, sortOrder: i } });
          await tx.productCategory.createMany({ data: children.map((c, j) => ({ tenantId: a.tenantId, parentId: p.id, name: c, sortOrder: j })) });
        }
      });
      rows = await this.prisma.productCategory.findMany({ where: { tenantId: a.tenantId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    }
    const counts = new Map((await this.prisma.product.groupBy({ by: ['categoryId'], where: { tenantId: a.tenantId, deletedAt: null }, _count: true })).map((c) => [c.categoryId, c._count]));
    const top = rows.filter((r) => !r.parentId);
    return top.map((t) => {
      const children = rows.filter((r) => r.parentId === t.id).map((c) => ({ id: c.id, name: c.name, count: counts.get(c.id) ?? 0 }));
      return { id: t.id, name: t.name, count: (counts.get(t.id) ?? 0) + children.reduce((s, c) => s + c.count, 0), children };
    });
  }

  async createCategory(a: Access, dto: { name: string; parentId?: string | null }) {
    if (dto.parentId) {
      const p = await this.prisma.productCategory.findFirst({ where: { id: dto.parentId, tenantId: a.tenantId } });
      if (!p) throw new BadRequestException('Nhóm cha không hợp lệ');
      if (p.parentId) throw new BadRequestException('Chỉ chia tối đa 2 cấp nhóm');
    }
    const dup = await this.prisma.productCategory.findFirst({ where: { tenantId: a.tenantId, parentId: dto.parentId ?? null, name: { equals: dto.name.trim(), mode: 'insensitive' } } });
    if (dup) throw new ConflictException('Nhóm này đã có');
    return this.prisma.productCategory.create({ data: { tenantId: a.tenantId, parentId: dto.parentId ?? null, name: dto.name.trim(), sortOrder: 99 } });
  }

  async renameCategory(a: Access, id: string, name: string) {
    const c = await this.prisma.productCategory.findFirst({ where: { id, tenantId: a.tenantId } });
    if (!c) throw new NotFoundException('Không tìm thấy nhóm');
    await this.prisma.productCategory.update({ where: { id }, data: { name: name.trim() } });
    return { status: 'ok' };
  }

  // ---------------- Sản phẩm ----------------

  private async assertCategory(tenantId: string, id?: string | null) {
    if (!id) return;
    if (!(await this.prisma.productCategory.findFirst({ where: { id, tenantId } }))) throw new BadRequestException('Nhóm sản phẩm không hợp lệ');
  }

  async list(a: Access, q: ProductQuery) {
    const branches = await this.prisma.branch.findMany({ where: { tenantId: a.tenantId, deletedAt: null }, select: { id: true, code: true, name: true } });
    const visible = this.branchIds(a, branches);
    if (q.branchId && !visible.includes(q.branchId)) throw new ForbiddenException('Bạn không làm việc ở chi nhánh này');
    let categoryIds: string[] | undefined;
    if (q.categoryId) categoryIds = [q.categoryId, ...(await this.prisma.productCategory.findMany({ where: { tenantId: a.tenantId, parentId: q.categoryId }, select: { id: true } })).map((c) => c.id)];
    const text = q.q?.trim();
    const where: Prisma.ProductWhereInput = {
      tenantId: a.tenantId,
      deletedAt: null,
      ...(q.active === undefined ? {} : { active: q.active }),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
      // Theo hãng xe: sản phẩm gắn hãng đó hoặc dùng chung mọi hãng
      ...(q.make ? { OR: [{ vehicleMakes: { has: q.make } }, { vehicleMakes: { isEmpty: true } }] } : {}),
      ...(text ? { AND: [{ OR: [{ searchText: { contains: searchKey(text) } }, { code: { contains: text.toUpperCase() } }] }] } : {}),
    };
    if (q.lowStock) {
      // Tồn ≤ mức tối thiểu tại chi nhánh đang xem (hoặc bất kỳ chi nhánh được phép)
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id FROM products p
        LEFT JOIN stock_levels s ON s.product_id = p.id AND s.branch_id = ANY(${q.branchId ? [q.branchId] : visible}::uuid[])
        WHERE p.tenant_id = ${a.tenantId}::uuid AND p.deleted_at IS NULL AND p.kind = 'PHU_TUNG' AND p.min_stock IS NOT NULL
        GROUP BY p.id, p.min_stock HAVING COALESCE(MIN(s.quantity), 0) <= p.min_stock`;
      where.id = { in: rows.map((r) => r.id) };
    }
    const [total, rows] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { category: { select: { id: true, name: true, parent: { select: { name: true } } } }, stock: { where: { branchId: { in: visible } } } },
      }),
    ]);
    const cost = this.seesCost(a);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((p) => {
        const at = q.branchId ? p.stock.find((s) => s.branchId === q.branchId) : null;
        const all = p.stock.reduce((s, x) => s + num(x.quantity), 0);
        return {
          id: p.id,
          code: p.code,
          name: p.name,
          kind: p.kind,
          brand: p.brand,
          unit: p.unit,
          category: p.category ? { id: p.category.id, name: p.category.parent ? `${p.category.parent.name} › ${p.category.name}` : p.category.name } : null,
          salePrice: Number(p.salePrice),
          costPrice: cost ? Number(p.costPrice) : null,
          vehicleMakes: p.vehicleMakes,
          active: p.active,
          minStock: p.minStock === null ? null : num(p.minStock),
          stock: p.kind === 'DICH_VU' ? null : q.branchId ? num(at?.quantity) : all,
        };
      }),
    };
  }

  async get(a: Access, id: string) {
    const p = await this.prisma.product.findFirst({ where: { id, tenantId: a.tenantId, deletedAt: null }, include: { category: { include: { parent: true } }, stock: true } });
    if (!p) throw new NotFoundException('Không tìm thấy sản phẩm');
    const branches = await this.prisma.branch.findMany({ where: { tenantId: a.tenantId, deletedAt: null }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } });
    const visible = this.branchIds(a, branches);
    const moves = await this.prisma.stockMovement.findMany({
      where: { productId: id, branchId: { in: visible } },
      orderBy: { seq: 'desc' },
      take: 50,
      include: { document: { select: { id: true, code: true } } },
    });
    const orderCodes = new Map(
      (await this.prisma.repairOrder.findMany({ where: { id: { in: moves.map((m) => m.orderId).filter((x): x is string => !!x) } }, select: { id: true, code: true } })).map((o) => [o.id, o.code]),
    );
    const cost = this.seesCost(a);
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      kind: p.kind,
      categoryId: p.categoryId,
      category: p.category ? (p.category.parent ? `${p.category.parent.name} › ${p.category.name}` : p.category.name) : null,
      brand: p.brand,
      unit: p.unit,
      salePrice: Number(p.salePrice),
      costPrice: cost ? Number(p.costPrice) : null,
      vehicleMakes: p.vehicleMakes,
      minStock: p.minStock === null ? null : num(p.minStock),
      note: p.note,
      active: p.active,
      stock: branches.filter((b) => visible.includes(b.id)).map((b) => ({ branch: b, quantity: num(p.stock.find((s) => s.branchId === b.id)?.quantity) })),
      movements: moves.map((m) => ({
        id: m.id,
        kind: m.kind,
        branchId: m.branchId,
        quantity: num(m.quantity),
        balance: num(m.balance),
        unitCost: cost && m.unitCost !== null ? Number(m.unitCost) : null,
        document: m.document,
        order: m.orderId ? { id: m.orderId, code: orderCodes.get(m.orderId) ?? '' } : null,
        note: m.note,
        at: m.createdAt,
      })),
    };
  }

  private productSearch(p: { code: string; name: string; brand?: string | null; vehicleMakes?: string[] }) {
    return searchKey(p.code, p.name, p.brand, ...(p.vehicleMakes ?? []));
  }

  async create(a: Access, dto: ProductInput, ip?: string) {
    await this.assertCategory(a.tenantId, dto.categoryId);
    const p = await this.prisma.$transaction(async (tx) => {
      let code = dto.code?.trim().toUpperCase();
      if (code) {
        if (await tx.product.findFirst({ where: { tenantId: a.tenantId, code } })) throw new ConflictException(`Mã hàng ${code} đã có`);
      } else {
        code = `${dto.kind === 'DICH_VU' ? 'DV' : 'SP'}${String(await reserveNumbers(tx, a.tenantId, dto.kind === 'DICH_VU' ? 'service' : 'product')).padStart(6, '0')}`;
      }
      const vehicleMakes = makesOf(dto.vehicleMakes);
      return tx.product.create({
        data: {
          tenantId: a.tenantId,
          code,
          name: dto.name.trim(),
          kind: dto.kind,
          categoryId: dto.categoryId ?? null,
          brand: dto.brand?.trim() || null,
          unit: dto.unit?.trim() || null,
          salePrice: BigInt(dto.salePrice),
          costPrice: BigInt(dto.costPrice ?? 0),
          vehicleMakes,
          minStock: dto.minStock == null ? null : new Prisma.Decimal(dto.minStock),
          note: dto.note?.trim() || null,
          active: dto.active ?? true,
          createdBy: a.userId,
          searchText: this.productSearch({ code, name: dto.name, brand: dto.brand, vehicleMakes }),
        },
      });
    });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'product.created', entity: 'product', entityId: p.id, after: { code: p.code, name: p.name, salePrice: dto.salePrice }, ip });
    return { id: p.id, code: p.code };
  }

  async update(a: Access, id: string, dto: Partial<ProductInput>, ip?: string) {
    const before = await this.prisma.product.findFirst({ where: { id, tenantId: a.tenantId, deletedAt: null } });
    if (!before) throw new NotFoundException('Không tìm thấy sản phẩm');
    await this.assertCategory(a.tenantId, dto.categoryId);
    const code = dto.code?.trim().toUpperCase() || before.code;
    if (code !== before.code && (await this.prisma.product.findFirst({ where: { tenantId: a.tenantId, code, NOT: { id } } }))) throw new ConflictException(`Mã hàng ${code} đã có`);
    if (dto.kind && dto.kind !== before.kind && (await this.prisma.stockMovement.count({ where: { productId: id } }))) {
      throw new ConflictException('Sản phẩm đã có xuất nhập kho, không đổi loại hàng hoá / dịch vụ được');
    }
    const vehicleMakes = dto.vehicleMakes ? makesOf(dto.vehicleMakes) : before.vehicleMakes;
    const name = dto.name?.trim() ?? before.name;
    const brand = dto.brand === undefined ? before.brand : dto.brand?.trim() || null;
    await this.prisma.product.update({
      where: { id },
      data: {
        code,
        name,
        brand,
        vehicleMakes,
        ...(dto.kind ? { kind: dto.kind } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.unit !== undefined ? { unit: dto.unit?.trim() || null } : {}),
        ...(dto.salePrice !== undefined ? { salePrice: BigInt(dto.salePrice) } : {}),
        ...(dto.costPrice !== undefined ? { costPrice: BigInt(dto.costPrice) } : {}),
        ...(dto.minStock !== undefined ? { minStock: dto.minStock === null ? null : new Prisma.Decimal(dto.minStock) } : {}),
        ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        searchText: this.productSearch({ code, name, brand, vehicleMakes }),
      },
    });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'product.updated', entity: 'product', entityId: id, before: { name: before.name, salePrice: Number(before.salePrice) }, after: dto as Prisma.InputJsonValue, ip });
    return { status: 'ok' };
  }

  async remove(a: Access, id: string, ip?: string) {
    const p = await this.prisma.product.findFirst({ where: { id, tenantId: a.tenantId, deletedAt: null }, include: { stock: true } });
    if (!p) throw new NotFoundException('Không tìm thấy sản phẩm');
    if (p.stock.some((s) => !s.quantity.isZero())) throw new ConflictException('Sản phẩm còn tồn kho: điều chỉnh tồn về 0 hoặc ngừng bán (bỏ chọn "Đang bán") thay vì xoá');
    await this.prisma.product.update({ where: { id }, data: { deletedAt: new Date(), code: `${p.code}#xoa-${Date.now()}` } });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'product.deleted', entity: 'product', entityId: id, before: { code: p.code, name: p.name }, ip });
    return { status: 'ok' };
  }

  async makes(a: Access) {
    const rows = await this.prisma.vehicle.groupBy({ by: ['make'], where: { tenantId: a.tenantId, deletedAt: null, make: { not: null } }, _count: true, orderBy: { _count: { make: 'desc' } }, take: 30 });
    const fromVehicles = rows.map((r) => r.make!.trim()).filter(Boolean);
    const seen = new Set<string>();
    return [...COMMON_MAKES, ...fromVehicles].filter((m) => (seen.has(m.toLowerCase()) ? false : (seen.add(m.toLowerCase()), true)));
  }

  // ---------------- Nhà cung cấp ----------------

  async suppliers(a: Access, q?: string) {
    const text = q?.trim();
    const rows = await this.prisma.supplier.findMany({
      where: { tenantId: a.tenantId, deletedAt: null, ...(text ? { OR: [{ searchText: { contains: searchKey(text) } }, { phone: { contains: text.replace(/\D/g, '') || '§' } }] } : {}) },
      orderBy: { name: 'asc' },
      take: 200,
    });
    const totals = new Map(
      (await this.prisma.stockDocument.groupBy({ by: ['supplierId'], where: { tenantId: a.tenantId, type: 'NHAP', supplierId: { in: rows.map((r) => r.id) } }, _sum: { total: true }, _count: true })).map((t) => [
        t.supplierId,
        { total: Number(t._sum.total ?? 0n), count: t._count },
      ]),
    );
    return rows.map(({ searchText: _s, deletedAt: _d, ...r }) => ({ ...r, purchased: totals.get(r.id)?.total ?? 0, receipts: totals.get(r.id)?.count ?? 0 }));
  }

  async saveSupplier(a: Access, id: string | null, dto: SupplierInput, ip?: string) {
    const data = {
      name: dto.name.trim(),
      phone: dto.phone?.replace(/[^\d+]/g, '') || null,
      address: dto.address?.trim() || null,
      taxCode: dto.taxCode?.trim() || null,
      note: dto.note?.trim() || null,
    };
    const searchText = searchKey(data.name, data.phone, data.taxCode);
    if (id) {
      const s = await this.prisma.supplier.findFirst({ where: { id, tenantId: a.tenantId, deletedAt: null } });
      if (!s) throw new NotFoundException('Không tìm thấy nhà cung cấp');
      await this.prisma.supplier.update({ where: { id }, data: { ...data, searchText: searchKey(s.code, data.name, data.phone, data.taxCode) } });
      await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'supplier.updated', entity: 'supplier', entityId: id, after: data, ip });
      return { id };
    }
    const s = await this.prisma.$transaction(async (tx) => {
      const code = `NCC${String(await reserveNumbers(tx, a.tenantId, 'supplier')).padStart(4, '0')}`;
      return tx.supplier.create({ data: { ...data, tenantId: a.tenantId, code, searchText: `${searchKey(code)} ${searchText}` } });
    });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'supplier.created', entity: 'supplier', entityId: s.id, after: data, ip });
    return { id: s.id, code: s.code };
  }

  // ---------------- Phiếu kho ----------------

  async createDocument(a: Access, dto: DocInput, ip?: string) {
    const need = dto.type === 'DIEU_CHINH' ? 'inventory.adjust.approve' : 'inventory.manage';
    if (!AccessService.has(a, need)) throw new ForbiddenException(dto.type === 'DIEU_CHINH' ? 'Điều chỉnh tồn cần Quản lý / Chủ garage duyệt' : 'Bạn không có quyền nhập / chuyển kho');
    if (!AccessService.canAccessBranch(a, dto.branchId)) throw new ForbiddenException('Bạn không làm việc ở chi nhánh này');
    if (!dto.lines.length) throw new BadRequestException('Phiếu chưa có dòng hàng nào');
    if (new Set(dto.lines.map((l) => l.productId)).size !== dto.lines.length) throw new BadRequestException('Một sản phẩm chỉ ghi một dòng trên phiếu');

    const doc = await this.prisma.$transaction(async (tx) => {
      const branch = await tx.branch.findFirst({ where: { id: dto.branchId, tenantId: a.tenantId, deletedAt: null } });
      if (!branch) throw new BadRequestException('Chi nhánh không hợp lệ');
      if (dto.type === 'CHUYEN') {
        if (!dto.toBranchId || dto.toBranchId === dto.branchId) throw new BadRequestException('Chọn chi nhánh nhận khác chi nhánh chuyển');
        if (!(await tx.branch.findFirst({ where: { id: dto.toBranchId, tenantId: a.tenantId, deletedAt: null } }))) throw new BadRequestException('Chi nhánh nhận không hợp lệ');
      }
      if (dto.supplierId && !(await tx.supplier.findFirst({ where: { id: dto.supplierId, tenantId: a.tenantId, deletedAt: null } }))) throw new BadRequestException('Nhà cung cấp không hợp lệ');
      const products = await tx.product.findMany({ where: { id: { in: dto.lines.map((l) => l.productId) }, tenantId: a.tenantId, deletedAt: null } });
      const byId = new Map(products.map((p) => [p.id, p]));

      const lines = dto.lines.map((l, i) => {
        const p = byId.get(l.productId);
        if (!p) throw new BadRequestException(`Dòng ${i + 1}: sản phẩm không hợp lệ`);
        if (p.kind === 'DICH_VU') throw new BadRequestException(`Dòng ${i + 1} (${p.name}): dịch vụ không có tồn kho`);
        const qty = dto.type === 'DIEU_CHINH' ? qtyOf(l.countedQty, true) : qtyOf(l.quantity);
        if (!qty) throw new BadRequestException(`Dòng ${i + 1} (${p.name}): số lượng không hợp lệ`);
        const unitCost = dto.type === 'NHAP' ? (l.unitCost ?? Number(p.costPrice)) : null;
        return { p, qty, unitCost };
      });

      const code = `${DOC_PREFIX[dto.type]}${String(await reserveNumbers(tx, a.tenantId, `stockdoc.${dto.type}`)).padStart(6, '0')}`;
      const total = dto.type === 'NHAP' ? lines.reduce((s, l) => s + Math.round(Number(l.qty) * (l.unitCost ?? 0)), 0) : 0;
      const d = await tx.stockDocument.create({
        data: { tenantId: a.tenantId, code, type: dto.type, branchId: dto.branchId, toBranchId: dto.toBranchId ?? null, supplierId: dto.supplierId ?? null, refNo: dto.refNo?.trim() || null, note: dto.note?.trim() || null, total: BigInt(total), createdBy: a.userId },
      });
      const base = { tenantId: a.tenantId, documentId: d.id, actorId: a.userId };
      let changed = 0;
      for (const l of lines) {
        if (dto.type === 'NHAP') {
          await applyMovement(tx, { ...base, branchId: dto.branchId, productId: l.p.id, kind: 'NHAP_HANG', quantity: l.qty, unitCost: l.unitCost });
          await tx.product.update({ where: { id: l.p.id }, data: { costPrice: BigInt(l.unitCost ?? 0) } });
          changed++;
        } else if (dto.type === 'CHUYEN') {
          await applyMovement(tx, { ...base, branchId: dto.branchId, productId: l.p.id, kind: 'CHUYEN_DI', quantity: l.qty.neg() });
          await applyMovement(tx, { ...base, branchId: dto.toBranchId!, productId: l.p.id, kind: 'CHUYEN_DEN', quantity: l.qty });
          changed++;
        } else {
          // Kiểm kê: ghi chênh lệch giữa số đếm và tồn trên sổ
          const delta = l.qty.minus(await currentQty(tx, l.p.id, dto.branchId));
          if (delta.isZero()) continue;
          await applyMovement(tx, { ...base, branchId: dto.branchId, productId: l.p.id, kind: 'DIEU_CHINH', quantity: delta, note: `Kiểm kê: đếm được ${l.qty.toString()}` });
          changed++;
        }
      }
      if (!changed) throw new BadRequestException('Số đếm khớp tồn trên sổ, không có gì để điều chỉnh');
      return d;
    });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: `stock.${dto.type.toLowerCase()}`, entity: 'stock_document', entityId: doc.id, after: { code: doc.code, lines: dto.lines.length, total: Number(doc.total) }, ip });
    return { id: doc.id, code: doc.code };
  }

  async documents(a: Access, q: { type?: StockDocType; branchId?: string; page: number; pageSize: number }) {
    const branches = await this.prisma.branch.findMany({ where: { tenantId: a.tenantId }, select: { id: true, code: true, name: true } });
    const visible = this.branchIds(a, branches);
    const where: Prisma.StockDocumentWhereInput = {
      tenantId: a.tenantId,
      ...(q.type ? { type: q.type } : {}),
      ...(q.branchId ? { OR: [{ branchId: q.branchId }, { toBranchId: q.branchId }] } : { OR: [{ branchId: { in: visible } }, { toBranchId: { in: visible } }] }),
    };
    if (q.branchId && !visible.includes(q.branchId)) throw new ForbiddenException('Bạn không làm việc ở chi nhánh này');
    const [total, rows] = await Promise.all([
      this.prisma.stockDocument.count({ where }),
      this.prisma.stockDocument.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { supplier: { select: { name: true } }, _count: { select: { movements: true } } } }),
    ]);
    const bmap = new Map(branches.map((b) => [b.id, b]));
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.createdBy).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    const cost = this.seesCost(a);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((d) => ({
        id: d.id,
        code: d.code,
        type: d.type,
        branch: bmap.get(d.branchId) ?? null,
        toBranch: d.toBranchId ? (bmap.get(d.toBranchId) ?? null) : null,
        supplier: d.supplier?.name ?? null,
        refNo: d.refNo,
        note: d.note,
        lines: d.type === 'CHUYEN' ? d._count.movements / 2 : d._count.movements,
        total: cost ? Number(d.total) : null,
        createdBy: d.createdBy ? (users.get(d.createdBy) ?? null) : null,
        createdAt: d.createdAt,
      })),
    };
  }

  async document(a: Access, id: string) {
    const d = await this.prisma.stockDocument.findFirst({
      where: { id, tenantId: a.tenantId },
      include: { supplier: true, movements: { include: { product: { select: { id: true, code: true, name: true, unit: true } } }, orderBy: { seq: 'asc' } } },
    });
    if (!d) throw new NotFoundException('Không tìm thấy phiếu');
    if (![d.branchId, d.toBranchId].some((b) => b && AccessService.canAccessBranch(a, b))) throw new NotFoundException('Không tìm thấy phiếu');
    const branches = new Map((await this.prisma.branch.findMany({ where: { tenantId: a.tenantId }, select: { id: true, code: true, name: true } })).map((b) => [b.id, b]));
    const user = d.createdBy ? await this.prisma.user.findUnique({ where: { id: d.createdBy }, select: { fullName: true } }) : null;
    const cost = this.seesCost(a);
    const lines = d.movements.filter((m) => m.kind !== 'CHUYEN_DEN');
    return {
      id: d.id,
      code: d.code,
      type: d.type,
      branch: branches.get(d.branchId) ?? null,
      toBranch: d.toBranchId ? (branches.get(d.toBranchId) ?? null) : null,
      supplier: d.supplier ? { id: d.supplier.id, name: d.supplier.name, phone: d.supplier.phone } : null,
      refNo: d.refNo,
      note: d.note,
      total: cost ? Number(d.total) : null,
      createdBy: user?.fullName ?? null,
      createdAt: d.createdAt,
      lines: lines.map((m) => ({
        product: m.product,
        quantity: Math.abs(num(m.quantity)),
        delta: num(m.quantity),
        balance: num(m.balance),
        unitCost: cost && m.unitCost !== null ? Number(m.unitCost) : null,
        note: m.note,
      })),
    };
  }
}
