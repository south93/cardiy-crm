import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { searchKey } from '@cardiy/shared';
import { Prisma, type CashType, type PaymentMethod } from '@prisma/client';
import { AccessService, type Access } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import { reserveNumbers } from '../crm/counters';
import { PrismaService } from '../prisma/prisma.service';
import { allocateDebt, categoryLabel, isCategory } from './finance-rules';

const METHODS: PaymentMethod[] = ['TIEN_MAT', 'CHUYEN_KHOAN', 'THE', 'BAO_HIEM'];
const num = (b: bigint | number | null | undefined) => Number(b ?? 0);
type Tx = Prisma.TransactionClient;

export interface EntryInput {
  type: CashType;
  branchId: string;
  category: string;
  amount: number;
  method: PaymentMethod;
  counterparty?: string | null;
  customerId?: string | null;
  supplierId?: string | null;
  note?: string | null;
  occurredAt?: string | null;
}

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async visibleBranches(a: Access, branchId?: string) {
    if (branchId) {
      if (!AccessService.canAccessBranch(a, branchId)) throw new ForbiddenException('Bạn không làm việc ở chi nhánh này');
      return [branchId];
    }
    if (a.branchIds !== 'ALL') return a.branchIds;
    return (await this.prisma.branch.findMany({ where: { tenantId: a.tenantId }, select: { id: true } })).map((b) => b.id);
  }

  /** Công nợ đầu kỳ còn lại của khách (công nợ nhập từ AppSheet − các phiếu thu nợ đầu kỳ) */
  private async openingLeft(db: Tx | PrismaService, tenantId: string, customerId: string) {
    const c = await db.customer.findFirst({ where: { id: customerId, tenantId, deletedAt: null }, select: { openingDebt: true } });
    if (!c) throw new NotFoundException('Không tìm thấy khách hàng');
    const paid = await db.cashEntry.aggregate({ where: { tenantId, customerId, category: 'THU_NO_DAU_KY', voidedAt: null }, _sum: { amount: true } });
    return num(c.openingDebt) - num(paid._sum.amount);
  }

  // ---------------- Sổ quỹ ----------------

  async cashbook(a: Access, q: { from: string; to: string; branchId?: string; method?: PaymentMethod }) {
    const branches = await this.visibleBranches(a, q.branchId);
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw new BadRequestException('Khoảng thời gian không hợp lệ');
    const pWhere = (range: Prisma.DateTimeFilter): Prisma.PaymentWhereInput => ({ tenantId: a.tenantId, paidAt: range, order: { branchId: { in: branches } }, ...(q.method ? { method: q.method } : {}) });
    const eWhere = (range: Prisma.DateTimeFilter): Prisma.CashEntryWhereInput => ({ tenantId: a.tenantId, occurredAt: range, branchId: { in: branches }, ...(q.method ? { method: q.method } : {}) });

    // Tồn đầu kỳ theo hình thức (tiền mặt / chuyển khoản / thẻ / bảo hiểm)
    const [pBefore, eBefore] = await Promise.all([
      this.prisma.payment.groupBy({ by: ['method'], where: { ...pWhere({ lt: from }), voidedAt: null }, _sum: { amount: true } }),
      this.prisma.cashEntry.groupBy({ by: ['method', 'type'], where: { ...eWhere({ lt: from }), voidedAt: null }, _sum: { amount: true } }),
    ]);
    const opening = Object.fromEntries(METHODS.map((m) => [m, 0])) as Record<PaymentMethod, number>;
    for (const p of pBefore) opening[p.method] += num(p._sum.amount);
    for (const e of eBefore) opening[e.method] += (e.type === 'THU' ? 1 : -1) * num(e._sum.amount);

    const [payments, entries] = await Promise.all([
      this.prisma.payment.findMany({ where: pWhere({ gte: from, lt: to }), include: { order: { select: { id: true, code: true, branch: { select: { code: true } }, customer: { select: { id: true, name: true } } } } }, orderBy: { paidAt: 'asc' }, take: 2000 }),
      this.prisma.cashEntry.findMany({ where: eWhere({ gte: from, lt: to }), orderBy: { occurredAt: 'asc' }, take: 2000 }),
    ]);
    const ids = [...payments.map((p) => p.createdBy), ...entries.map((e) => e.createdBy)].filter((x): x is string => !!x);
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    const customers = new Map((await this.prisma.customer.findMany({ where: { id: { in: entries.map((e) => e.customerId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    const bcodes = new Map((await this.prisma.branch.findMany({ where: { id: { in: branches } }, select: { id: true, code: true } })).map((b) => [b.id, b.code]));

    const rows = [
      ...payments.map((p) => ({
        id: p.id,
        source: 'ORDER' as const,
        code: p.order.code,
        type: 'THU' as CashType,
        category: p.method === 'BAO_HIEM' ? 'Bảo hiểm thanh toán đơn' : 'Thu tiền đơn hàng',
        amount: num(p.amount),
        method: p.method,
        party: p.order.customer.name,
        customerId: p.order.customer.id,
        orderId: p.order.id,
        branch: p.order.branch.code,
        note: p.note,
        at: p.paidAt,
        by: p.createdBy ? (users.get(p.createdBy) ?? null) : null,
        voided: !!p.voidedAt,
        voidReason: p.voidReason,
      })),
      ...entries.map((e) => ({
        id: e.id,
        source: 'ENTRY' as const,
        code: e.code,
        type: e.type,
        category: categoryLabel(e.category),
        amount: num(e.amount),
        method: e.method,
        party: e.counterparty ?? (e.customerId ? (customers.get(e.customerId) ?? null) : null),
        customerId: e.customerId,
        orderId: null,
        branch: bcodes.get(e.branchId) ?? '',
        note: e.note,
        at: e.occurredAt,
        by: e.createdBy ? (users.get(e.createdBy) ?? null) : null,
        voided: !!e.voidedAt,
        voidReason: e.voidReason,
      })),
    ].sort((x, y) => new Date(x.at).getTime() - new Date(y.at).getTime());

    const live = rows.filter((r) => !r.voided);
    const thu = live.filter((r) => r.type === 'THU').reduce((s, r) => s + r.amount, 0);
    const chi = live.filter((r) => r.type === 'CHI').reduce((s, r) => s + r.amount, 0);
    const openingTotal = Object.values(opening).reduce((s, v) => s + v, 0);
    const byMethod = Object.fromEntries(
      METHODS.map((m) => {
        const t = live.filter((r) => r.method === m);
        const mt = t.filter((r) => r.type === 'THU').reduce((s, r) => s + r.amount, 0);
        const mc = t.filter((r) => r.type === 'CHI').reduce((s, r) => s + r.amount, 0);
        return [m, { opening: opening[m], thu: mt, chi: mc, closing: opening[m] + mt - mc }];
      }),
    );
    return { opening: openingTotal, thu, chi, closing: openingTotal + thu - chi, byMethod, rows: rows.reverse() };
  }

  async createEntry(a: Access, dto: EntryInput, ip?: string) {
    if (!AccessService.canAccessBranch(a, dto.branchId)) throw new ForbiddenException('Bạn không làm việc ở chi nhánh này');
    if (!isCategory(dto.type, dto.category)) throw new BadRequestException('Khoản mục không hợp lệ');
    if (dto.method === 'BAO_HIEM') throw new BadRequestException('Hình thức "Bảo hiểm chuyển" chỉ dùng khi thu tiền đơn');
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.branch.findFirst({ where: { id: dto.branchId, tenantId: a.tenantId, deletedAt: null } }))) throw new BadRequestException('Chi nhánh không hợp lệ');
      if (dto.supplierId && !(await tx.supplier.findFirst({ where: { id: dto.supplierId, tenantId: a.tenantId, deletedAt: null } }))) throw new BadRequestException('Nhà cung cấp không hợp lệ');
      if (dto.customerId && !(await tx.customer.findFirst({ where: { id: dto.customerId, tenantId: a.tenantId, deletedAt: null } }))) throw new BadRequestException('Khách hàng không hợp lệ');
      if (dto.category === 'THU_NO_DAU_KY') {
        if (!dto.customerId) throw new BadRequestException('Thu nợ đầu kỳ cần chọn khách hàng');
        // Khoá theo khách để hai phiếu thu cùng lúc không thu quá
        await tx.$queryRaw`SELECT id FROM customers WHERE id = ${dto.customerId}::uuid FOR UPDATE`;
        const left = await this.openingLeft(tx, a.tenantId, dto.customerId);
        if (dto.amount > left) throw new BadRequestException(`Số tiền lớn hơn công nợ đầu kỳ còn lại (${left.toLocaleString('vi-VN')} đ)`);
      }
      if (dto.category === 'QUY_DAU_KY') {
        // Mỗi chi nhánh một phiếu quỹ đầu kỳ; nhập sai thì huỷ phiếu cũ rồi nhập lại
        await tx.$queryRaw`SELECT id FROM branches WHERE id = ${dto.branchId}::uuid FOR UPDATE`;
        const has = await tx.cashEntry.findFirst({ where: { tenantId: a.tenantId, branchId: dto.branchId, category: 'QUY_DAU_KY', voidedAt: null } });
        if (has) throw new ConflictException(`Chi nhánh đã có quỹ đầu kỳ (phiếu ${has.code}). Huỷ phiếu đó nếu muốn nhập lại.`);
      }
      if (dto.category === 'CHI_NHA_CUNG_CAP') {
        if (!dto.supplierId) throw new BadRequestException('Trả nhà cung cấp cần chọn nhà cung cấp');
        // Khoá theo NCC để hai phiếu chi cùng lúc không trả quá số nợ
        await tx.$queryRaw`SELECT id FROM suppliers WHERE id = ${dto.supplierId}::uuid FOR UPDATE`;
        const owed = (await this.supplierBalances(tx, a.tenantId, [dto.supplierId]))[0]!.balance;
        if (dto.amount > owed) throw new BadRequestException(`Số tiền lớn hơn công nợ còn lại với nhà cung cấp (${owed.toLocaleString('vi-VN')} đ)`);
      }
      const prefix = dto.type === 'THU' ? 'PT' : 'PCH';
      const code = `${prefix}${String(await reserveNumbers(tx, a.tenantId, `cash.${dto.type}`)).padStart(6, '0')}`;
      const e = await tx.cashEntry.create({
        data: {
          tenantId: a.tenantId,
          branchId: dto.branchId,
          code,
          type: dto.type,
          category: dto.category,
          amount: BigInt(dto.amount),
          method: dto.method,
          counterparty: dto.counterparty?.trim() || null,
          customerId: dto.customerId ?? null,
          supplierId: dto.supplierId ?? null,
          note: dto.note?.trim() || null,
          occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
          createdBy: a.userId,
        },
      });
      await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: `cash.${dto.type.toLowerCase()}`, entity: 'cash_entry', entityId: e.id, after: { code, category: dto.category, amount: dto.amount, method: dto.method }, ip }, tx);
      return { id: e.id, code };
    });
  }

  async voidEntry(a: Access, id: string, reason: string, ip?: string) {
    const e = await this.prisma.cashEntry.findFirst({ where: { id, tenantId: a.tenantId } });
    if (!e || !AccessService.canAccessBranch(a, e.branchId)) throw new NotFoundException('Không tìm thấy phiếu');
    if (e.voidedAt) throw new ConflictException('Phiếu đã huỷ');
    await this.prisma.cashEntry.update({ where: { id }, data: { voidedAt: new Date(), voidedBy: a.userId, voidReason: reason.trim() } });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'cash.voided', entity: 'cash_entry', entityId: id, before: { code: e.code, amount: num(e.amount) }, after: { reason }, ip });
    return { status: 'ok' };
  }

  // ---------------- Quỹ đầu kỳ chi nhánh ----------------

  async openingFund(a: Access, branchId: string) {
    if (!AccessService.canAccessBranch(a, branchId)) throw new ForbiddenException('Bạn không làm việc ở chi nhánh này');
    const e = await this.prisma.cashEntry.findFirst({ where: { tenantId: a.tenantId, branchId, category: 'QUY_DAU_KY', voidedAt: null } });
    return { fund: e ? { id: e.id, code: e.code, amount: num(e.amount), method: e.method, occurredAt: e.occurredAt, note: e.note } : null };
  }

  // ---------------- Công nợ phải trả nhà cung cấp ----------------

  /** Còn nợ NCC = nợ đầu kỳ + tổng phiếu nhập − phiếu chi "Trả nhà cung cấp" (không tính phiếu đã huỷ) */
  private async supplierBalances(db: Tx | PrismaService, tenantId: string, ids: string[]) {
    if (!ids.length) return [];
    const [sups, bought, paid] = await Promise.all([
      db.supplier.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, openingPayable: true } }),
      db.stockDocument.groupBy({ by: ['supplierId'], where: { tenantId, type: 'NHAP', supplierId: { in: ids } }, _sum: { total: true }, _count: true, _max: { createdAt: true } }),
      db.cashEntry.groupBy({ by: ['supplierId'], where: { tenantId, category: 'CHI_NHA_CUNG_CAP', voidedAt: null, supplierId: { in: ids } }, _sum: { amount: true }, _max: { occurredAt: true } }),
    ]);
    return sups.map((s) => {
      const b = bought.find((x) => x.supplierId === s.id);
      const p = paid.find((x) => x.supplierId === s.id);
      const opening = num(s.openingPayable);
      const purchased = num(b?._sum.total);
      const paidAmt = num(p?._sum.amount);
      return { id: s.id, opening, purchased, receipts: b?._count ?? 0, paid: paidAmt, balance: opening + purchased - paidAmt, lastPurchaseAt: b?._max.createdAt ?? null, lastPaidAt: p?._max.occurredAt ?? null };
    });
  }

  async payables(a: Access, q: { q?: string; all?: boolean }) {
    const text = q.q?.trim();
    const sups = await this.prisma.supplier.findMany({
      where: { tenantId: a.tenantId, deletedAt: null, ...(text ? { searchText: { contains: searchKey(text) } } : {}) },
      select: { id: true, code: true, name: true, phone: true },
      orderBy: { name: 'asc' },
      take: 500,
    });
    const bal = new Map((await this.supplierBalances(this.prisma, a.tenantId, sups.map((s) => s.id))).map((b) => [b.id, b]));
    const items = sups
      .map((s) => ({ ...s, ...bal.get(s.id)! }))
      .filter((x) => q.all || x.balance !== 0)
      .sort((x, y) => y.balance - x.balance);
    return { totalPayable: items.reduce((t, x) => t + Math.max(0, x.balance), 0), items };
  }

  /** Sổ chi tiết công nợ một NCC: nợ đầu kỳ, từng phiếu nhập (tăng nợ), từng phiếu chi trả (giảm nợ), số dư luỹ kế */
  async payable(a: Access, supplierId: string) {
    const s = await this.prisma.supplier.findFirst({ where: { id: supplierId, tenantId: a.tenantId, deletedAt: null } });
    if (!s) throw new NotFoundException('Không tìm thấy nhà cung cấp');
    const [docs, pays] = await Promise.all([
      this.prisma.stockDocument.findMany({ where: { tenantId: a.tenantId, type: 'NHAP', supplierId }, select: { id: true, code: true, refNo: true, total: true, createdAt: true, branchId: true }, orderBy: { createdAt: 'asc' } }),
      this.prisma.cashEntry.findMany({ where: { tenantId: a.tenantId, category: 'CHI_NHA_CUNG_CAP', supplierId }, orderBy: { occurredAt: 'asc' } }),
    ]);
    const bcodes = new Map((await this.prisma.branch.findMany({ where: { tenantId: a.tenantId }, select: { id: true, code: true } })).map((b) => [b.id, b.code]));
    const rows = [
      ...docs.map((d) => ({ kind: 'NHAP' as const, id: d.id, code: d.code, ref: d.refNo, at: d.createdAt, increase: num(d.total), decrease: 0, branch: bcodes.get(d.branchId) ?? '', voided: false, method: null as PaymentMethod | null, note: null as string | null })),
      ...pays.map((p) => ({ kind: 'TRA' as const, id: p.id, code: p.code, ref: null, at: p.occurredAt, increase: 0, decrease: num(p.amount), branch: bcodes.get(p.branchId) ?? '', voided: !!p.voidedAt, method: p.method, note: p.note })),
    ].sort((x, y) => x.at.getTime() - y.at.getTime());
    let run = num(s.openingPayable);
    const ledger = rows.map((r) => {
      if (!r.voided) run += r.increase - r.decrease;
      return { ...r, balance: run };
    });
    const [b] = await this.supplierBalances(this.prisma, a.tenantId, [supplierId]);
    return { supplier: { id: s.id, code: s.code, name: s.name, phone: s.phone }, ...b!, rows: ledger.reverse() };
  }

  async paySupplier(a: Access, supplierId: string, dto: { amount: number; method: PaymentMethod; branchId: string; note?: string | null }, ip?: string) {
    const s = await this.prisma.supplier.findFirst({ where: { id: supplierId, tenantId: a.tenantId, deletedAt: null } });
    if (!s) throw new NotFoundException('Không tìm thấy nhà cung cấp');
    return this.createEntry(a, { type: 'CHI', branchId: dto.branchId, category: 'CHI_NHA_CUNG_CAP', amount: dto.amount, method: dto.method, supplierId, counterparty: s.name, note: dto.note ?? null }, ip);
  }

  // ---------------- Công nợ khách ----------------

  async debts(a: Access, q: { q?: string; page: number; pageSize: number }) {
    const branches = await this.visibleBranches(a);
    const all = a.branchIds === 'ALL';
    const text = q.q?.trim() ? `%${searchKey(q.q.trim())}%` : null;
    // Chỉ tìm theo SĐT khi có từ 3 chữ số trở lên ("Nợ dd8x" không được khớp mọi số có chữ số 8)
    const d = q.q?.replace(/\D/g, '') ?? '';
    const digits = d.length >= 3 ? d : null;
    // Nợ đơn: đơn đã hoàn thành / giao chưa thu đủ ở chi nhánh được xem; nợ đầu kỳ: công nợ AppSheet còn lại
    const rows = await this.prisma.$queryRaw<{ id: string; code: string; name: string; phone: string | null; opening_left: bigint; order_debt: bigint; orders: bigint; oldest: Date | null }[]>`
      WITH od AS (
        SELECT customer_id, SUM(total - paid) AS debt, COUNT(*) AS n, MIN(COALESCE(delivered_at, completed_at)) AS oldest
        FROM repair_orders
        WHERE tenant_id = ${a.tenantId}::uuid AND status IN ('HOAN_THANH', 'DA_GIAO') AND total > paid AND branch_id = ANY(${branches}::uuid[])
        GROUP BY customer_id
      ), op AS (
        SELECT customer_id, SUM(amount) AS paid FROM cash_entries
        WHERE tenant_id = ${a.tenantId}::uuid AND category = 'THU_NO_DAU_KY' AND voided_at IS NULL
        GROUP BY customer_id
      )
      SELECT c.id, c.code, c.name, c.phone,
        CASE WHEN ${all} OR c.branch_id = ANY(${branches}::uuid[]) THEN c.opening_debt - COALESCE(op.paid, 0) ELSE 0 END AS opening_left,
        COALESCE(od.debt, 0) AS order_debt, COALESCE(od.n, 0) AS orders, od.oldest
      FROM customers c
      LEFT JOIN od ON od.customer_id = c.id
      LEFT JOIN op ON op.customer_id = c.id
      WHERE c.tenant_id = ${a.tenantId}::uuid AND c.deleted_at IS NULL
        AND (${text}::text IS NULL OR c.search_text LIKE ${text} OR (${digits}::text IS NOT NULL AND c.phone LIKE '%' || ${digits} || '%'))
        AND (COALESCE(od.debt, 0) > 0 OR (c.opening_debt - COALESCE(op.paid, 0) > 0 AND (${all} OR c.branch_id = ANY(${branches}::uuid[]))))
      ORDER BY (COALESCE(od.debt, 0) + CASE WHEN ${all} OR c.branch_id = ANY(${branches}::uuid[]) THEN c.opening_debt - COALESCE(op.paid, 0) ELSE 0 END) DESC
      LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`;
    const sum = await this.prisma.$queryRaw<{ n: bigint; total: bigint }[]>`
      WITH od AS (
        SELECT customer_id, SUM(total - paid) AS debt FROM repair_orders
        WHERE tenant_id = ${a.tenantId}::uuid AND status IN ('HOAN_THANH', 'DA_GIAO') AND total > paid AND branch_id = ANY(${branches}::uuid[])
        GROUP BY customer_id
      ), op AS (
        SELECT customer_id, SUM(amount) AS paid FROM cash_entries WHERE tenant_id = ${a.tenantId}::uuid AND category = 'THU_NO_DAU_KY' AND voided_at IS NULL GROUP BY customer_id
      ), t AS (
        SELECT COALESCE(od.debt, 0) + CASE WHEN ${all} OR c.branch_id = ANY(${branches}::uuid[]) THEN c.opening_debt - COALESCE(op.paid, 0) ELSE 0 END AS d
        FROM customers c LEFT JOIN od ON od.customer_id = c.id LEFT JOIN op ON op.customer_id = c.id
        WHERE c.tenant_id = ${a.tenantId}::uuid AND c.deleted_at IS NULL
          AND (${text}::text IS NULL OR c.search_text LIKE ${text} OR (${digits}::text IS NOT NULL AND c.phone LIKE '%' || ${digits} || '%'))
      )
      SELECT COUNT(*) FILTER (WHERE d > 0) AS n, COALESCE(SUM(d) FILTER (WHERE d > 0), 0) AS total FROM t`;
    return {
      total: num(sum[0]?.n),
      totalDebt: num(sum[0]?.total),
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, phone: r.phone, openingLeft: num(r.opening_left), orderDebt: num(r.order_debt), debt: num(r.opening_left) + num(r.order_debt), orders: num(r.orders), oldest: r.oldest })),
    };
  }

  async customerDebt(a: Access, customerId: string) {
    const branches = await this.visibleBranches(a);
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId: a.tenantId, deletedAt: null }, select: { id: true, code: true, name: true, phone: true, branchId: true } });
    if (!c) throw new NotFoundException('Không tìm thấy khách hàng');
    const orders = await this.prisma.repairOrder.findMany({
      where: { tenantId: a.tenantId, customerId, status: { in: ['HOAN_THANH', 'DA_GIAO'] }, branchId: { in: branches } },
      orderBy: [{ deliveredAt: 'asc' }, { completedAt: 'asc' }],
      select: { id: true, code: true, total: true, paid: true, deliveredAt: true, completedAt: true, branch: { select: { code: true } } },
    });
    const unpaid = orders.filter((o) => o.total > o.paid);
    const openingVisible = a.branchIds === 'ALL' || (c.branchId !== null && branches.includes(c.branchId));
    const openingLeft = openingVisible ? await this.openingLeft(this.prisma, a.tenantId, customerId) : 0;
    return {
      customer: c,
      openingLeft,
      orders: unpaid.map((o) => ({ id: o.id, code: o.code, branch: o.branch.code, total: num(o.total), paid: num(o.paid), due: num(o.total) - num(o.paid), date: o.deliveredAt ?? o.completedAt })),
      total: openingLeft + unpaid.reduce((s, o) => s + num(o.total) - num(o.paid), 0),
    };
  }

  /** Thu nợ gộp: trả các đơn nợ cũ trước, phần còn lại trừ công nợ đầu kỳ */
  async collectDebt(a: Access, customerId: string, dto: { amount: number; method: PaymentMethod; note?: string | null; branchId: string }, ip?: string) {
    if (dto.method === 'BAO_HIEM') throw new BadRequestException('Chọn tiền mặt, chuyển khoản hoặc thẻ');
    if (!AccessService.canAccessBranch(a, dto.branchId)) throw new ForbiddenException('Bạn không làm việc ở chi nhánh này');
    const branches = await this.visibleBranches(a);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId}::uuid FOR UPDATE`;
      const c = await tx.customer.findFirst({ where: { id: customerId, tenantId: a.tenantId, deletedAt: null }, select: { branchId: true } });
      if (!c) throw new NotFoundException('Không tìm thấy khách hàng');
      const orders = await tx.$queryRaw<{ id: string; total: bigint; paid: bigint }[]>`
        SELECT id, total, paid FROM repair_orders
        WHERE tenant_id = ${a.tenantId}::uuid AND customer_id = ${customerId}::uuid AND status IN ('HOAN_THANH', 'DA_GIAO') AND total > paid AND branch_id = ANY(${branches}::uuid[])
        ORDER BY COALESCE(delivered_at, completed_at) ASC
        FOR UPDATE`;
      const openingVisible = a.branchIds === 'ALL' || (c.branchId !== null && branches.includes(c.branchId));
      const openingLeft = openingVisible ? await this.openingLeft(tx, a.tenantId, customerId) : 0;
      let plan: ReturnType<typeof allocateDebt>;
      try {
        plan = allocateDebt(dto.amount, orders.map((o) => ({ id: o.id, due: num(o.total) - num(o.paid) })), openingLeft);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      for (const p of plan.toOrders) {
        await tx.payment.create({ data: { tenantId: a.tenantId, orderId: p.id, amount: BigInt(p.amount), method: dto.method, note: dto.note?.trim() || 'Thu nợ', createdBy: a.userId } });
        await tx.repairOrder.update({ where: { id: p.id }, data: { paid: { increment: BigInt(p.amount) } } });
      }
      let entry: string | null = null;
      if (plan.toOpening > 0) {
        const code = `PT${String(await reserveNumbers(tx, a.tenantId, 'cash.THU')).padStart(6, '0')}`;
        const e = await tx.cashEntry.create({ data: { tenantId: a.tenantId, branchId: dto.branchId, code, type: 'THU', category: 'THU_NO_DAU_KY', amount: BigInt(plan.toOpening), method: dto.method, customerId, note: dto.note?.trim() || 'Thu nợ đầu kỳ', createdBy: a.userId } });
        entry = e.code;
      }
      await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'debt.collected', entity: 'customer', entityId: customerId, after: { amount: dto.amount, orders: plan.toOrders.length, opening: plan.toOpening }, ip }, tx);
      return { orders: plan.toOrders.length, toOpening: plan.toOpening, entry };
    });
  }
}
