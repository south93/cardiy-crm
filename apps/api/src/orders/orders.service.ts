import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { formatPlate, normalizePlate, searchKey } from '@cardiy/shared';
import { Prisma, type OrderItemKind, type PaymentMethod } from '@prisma/client';
import { AccessService, type Access } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import { reserveNumbers } from '../crm/counters';
import { applyMovement } from '../inventory/stock';
import { PrismaService } from '../prisma/prisma.service';
import { EDITABLE_STATUSES, lineAmount, OPEN_STATUSES, orderTotals, paymentState, STATUS_LABEL, transitionError, type OrderStatus } from './order-rules';

export const orderCode = (n: number) => `DH${String(n).padStart(6, '0')}`;

export interface OrderItemInput {
  kind: OrderItemKind;
  name: string;
  unit?: string | null;
  quantity: string | number;
  unitPrice: number;
  discount?: number;
  productId?: string | null;
}

export interface OrderCreateInput {
  branchId: string;
  customerId: string;
  vehicleId?: string | null;
  odometerKm?: number | null;
  request?: string | null;
  note?: string | null;
  promisedAt?: string | null;
  advisorId?: string | null;
  technicianId?: string | null;
  orderDiscount?: number;
  items?: OrderItemInput[];
}

export type OrderUpdateInput = Partial<Pick<OrderCreateInput, 'request' | 'note' | 'promisedAt' | 'advisorId' | 'technicianId' | 'orderDiscount'>>;

export interface OrderListQuery {
  view?: 'open' | 'done' | 'all';
  status?: OrderStatus;
  branchId?: string;
  customerId?: string;
  vehicleId?: string;
  q?: string;
  page: number;
  pageSize: number;
}

const num = (b: bigint | number) => Number(b);
type Tx = Prisma.TransactionClient;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Người không có quyền về tiền (vd. KTV) không thấy giá. */
  private seesMoney(a: Access) {
    return ['ro.manage', 'payment.collect', 'finance.view'].some((p) => a.permissions.includes(p as never));
  }

  private branchWhere(a: Access): Prisma.RepairOrderWhereInput {
    return a.branchIds === 'ALL' ? {} : { branchId: { in: a.branchIds } };
  }

  private async loadForWrite(tx: Tx, a: Access, id: string) {
    // Khoá dòng: thu tiền / sửa hạng mục / đổi trạng thái cùng lúc không làm lệch số tiền
    await tx.$queryRaw`SELECT id FROM repair_orders WHERE id = ${id}::uuid FOR UPDATE`;
    const o = await tx.repairOrder.findFirst({ where: { id, tenantId: a.tenantId, ...this.branchWhere(a) } });
    if (!o) throw new NotFoundException('Không tìm thấy đơn hàng');
    return o;
  }

  private async assertStaff(tx: Tx, tenantId: string, membershipId?: string | null) {
    if (!membershipId) return;
    const m = await tx.membership.findFirst({ where: { id: membershipId, tenantId, status: 'ACTIVE' } });
    if (!m) throw new BadRequestException('Nhân viên không hợp lệ');
  }

  private checkedItems(items: OrderItemInput[]) {
    return items.map((it, i) => {
      if (!it.name?.trim()) throw new BadRequestException(`Dòng ${i + 1}: cần nhập tên hạng mục`);
      try {
        return { ...it, name: it.name.trim(), amount: lineAmount(it) };
      } catch (e) {
        throw new BadRequestException(`Dòng ${i + 1} (${it.name}): ${(e as Error).message}`);
      }
    });
  }

  /** Hạng mục chọn từ danh mục: sản phẩm phải thuộc garage */
  private async assertProducts(tx: Tx, tenantId: string, items: OrderItemInput[]) {
    const ids = [...new Set(items.map((i) => i.productId).filter((x): x is string => !!x))];
    if (!ids.length) return;
    const n = await tx.product.count({ where: { id: { in: ids }, tenantId, deletedAt: null } });
    if (n !== ids.length) throw new BadRequestException('Có hạng mục chọn sản phẩm không hợp lệ');
  }

  private totals(items: OrderItemInput[], orderDiscount: number) {
    try {
      return orderTotals(items, orderDiscount);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  private searchTextOf(code: string, customer: { name: string; phone: string | null }, plateNo?: string | null) {
    return searchKey(code, customer.name, customer.phone, plateNo);
  }

  // ---------------- Đọc ----------------

  async list(a: Access, q: OrderListQuery) {
    const statusFilter: Prisma.RepairOrderWhereInput = q.status
      ? { status: q.status }
      : q.view === 'open'
        ? { status: { in: OPEN_STATUSES } }
        : q.view === 'done'
          ? { status: { in: ['DA_GIAO', 'HUY'] } }
          : {};
    const text = q.q?.trim();
    if (q.branchId && !AccessService.canAccessBranch(a, q.branchId)) throw new ForbiddenException('Bạn không làm việc ở chi nhánh này');
    const where: Prisma.RepairOrderWhereInput = {
      tenantId: a.tenantId,
      // Lọc chi nhánh đã kiểm tra quyền ở trên; không có thì giới hạn theo phạm vi người dùng
      ...(q.branchId ? { branchId: q.branchId } : this.branchWhere(a)),
      ...statusFilter,
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.vehicleId ? { vehicleId: q.vehicleId } : {}),
      ...(text
        ? {
            OR: [
              { searchText: { contains: searchKey(text) } },
              ...(normalizePlate(text) ? [{ vehicle: { plateNo: { contains: normalizePlate(text)! } } }] : []),
              ...(text.replace(/\D/g, '').length >= 3 ? [{ customer: { phone: { contains: text.replace(/\D/g, '') } } }] : []),
            ],
          }
        : {}),
    };
    const done = q.view === 'done';
    const [total, rows, counts] = await Promise.all([
      this.prisma.repairOrder.count({ where }),
      this.prisma.repairOrder.findMany({
        where,
        orderBy: done ? [{ deliveredAt: { sort: 'desc', nulls: 'last' } }, { receivedAt: 'desc' }] : [{ receivedAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          vehicle: { select: { id: true, plateNo: true, make: true, model: true } },
          branch: { select: { id: true, code: true, name: true } },
          _count: { select: { items: true } },
        },
      }),
      // Đếm theo trạng thái cho thanh lọc (cùng điều kiện, bỏ lọc trạng thái)
      this.prisma.repairOrder.groupBy({ by: ['status'], where: { ...where, status: undefined }, _count: true }),
    ]);
    const money = this.seesMoney(a);
    const techIds = [...new Set(rows.map((r) => r.technicianId).filter((x): x is string => !!x))];
    const names = await this.staffNames(techIds);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
      items: rows.map((r) => ({
        id: r.id,
        code: r.code,
        status: r.status,
        branch: r.branch,
        customer: r.customer,
        vehicle: r.vehicle ? { id: r.vehicle.id, plate: formatPlate(r.vehicle.plateNo), make: r.vehicle.make, model: r.vehicle.model } : null,
        request: r.request,
        technician: r.technicianId ? (names.get(r.technicianId) ?? null) : null,
        itemCount: r._count.items,
        total: money ? num(r.total) : null,
        paid: money ? num(r.paid) : null,
        paymentState: money ? paymentState(num(r.total), num(r.paid)) : null,
        receivedAt: r.receivedAt,
        promisedAt: r.promisedAt,
        completedAt: r.completedAt,
        deliveredAt: r.deliveredAt,
      })),
    };
  }

  private async staffNames(ids: string[]) {
    if (!ids.length) return new Map<string, { id: string; name: string }>();
    const ms = await this.prisma.membership.findMany({ where: { id: { in: ids } }, include: { user: { select: { fullName: true } } } });
    return new Map(ms.map((m) => [m.id, { id: m.id, name: m.user.fullName }]));
  }

  async get(a: Access, id: string) {
    const o = await this.prisma.repairOrder.findFirst({
      where: { id, tenantId: a.tenantId, ...this.branchWhere(a) },
      include: {
        customer: { select: { id: true, code: true, name: true, phone: true, type: true, tier: true } },
        vehicle: { select: { id: true, plateNo: true, make: true, model: true, year: true, odometerKm: true } },
        branch: { select: { id: true, code: true, name: true, address: true, phone: true } },
        items: { orderBy: { sortOrder: 'asc' } },
        payments: { orderBy: { paidAt: 'asc' } },
        history: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!o) throw new NotFoundException('Không tìm thấy đơn hàng');
    const money = this.seesMoney(a);
    const people = await this.staffNamesByUserOrMembership(o);
    return {
      id: o.id,
      code: o.code,
      status: o.status,
      statusLabel: STATUS_LABEL[o.status],
      branch: o.branch,
      customer: o.customer,
      vehicle: o.vehicle ? { ...o.vehicle, plate: formatPlate(o.vehicle.plateNo) } : null,
      odometerKm: o.odometerKm,
      request: o.request,
      note: o.note,
      advisor: o.advisorId ? (people.members.get(o.advisorId) ?? null) : null,
      createdBy: o.createdBy ? (people.users.get(o.createdBy) ?? null) : null,
      technician: o.technicianId ? (people.members.get(o.technicianId) ?? null) : null,
      receivedAt: o.receivedAt,
      promisedAt: o.promisedAt,
      completedAt: o.completedAt,
      deliveredAt: o.deliveredAt,
      cancelledAt: o.cancelledAt,
      cancelReason: o.cancelReason,
      editable: EDITABLE_STATUSES.includes(o.status),
      items: o.items.map((i) => ({
        id: i.id,
        kind: i.kind,
        productId: i.productId,
        name: i.name,
        unit: i.unit,
        quantity: i.quantity.toString(),
        unitPrice: money ? num(i.unitPrice) : null,
        discount: money ? num(i.discount) : null,
        amount: money ? num(i.amount) : null,
      })),
      subtotal: money ? num(o.subtotal) : null,
      orderDiscount: money ? num(o.orderDiscount) : null,
      total: money ? num(o.total) : null,
      paid: money ? num(o.paid) : null,
      due: money ? num(o.total) - num(o.paid) : null,
      paymentState: money ? paymentState(num(o.total), num(o.paid)) : null,
      payments: money
        ? o.payments.map((p) => ({
            id: p.id,
            amount: num(p.amount),
            method: p.method,
            note: p.note,
            paidAt: p.paidAt,
            by: p.createdBy ? (people.users.get(p.createdBy) ?? null) : null,
            voidedAt: p.voidedAt,
            voidReason: p.voidReason,
          }))
        : [],
      history: o.history.map((h) => ({ from: h.fromStatus, to: h.toStatus, note: h.note, at: h.createdAt, by: h.actorId ? (people.users.get(h.actorId) ?? null) : null })),
    };
  }

  private async staffNamesByUserOrMembership(o: { advisorId: string | null; technicianId: string | null; createdBy: string | null; payments: { createdBy: string | null }[]; history: { actorId: string | null }[] }) {
    const members = await this.staffNames([o.advisorId, o.technicianId].filter((x): x is string => !!x));
    const userIds = [...new Set([o.createdBy, ...o.payments.map((p) => p.createdBy), ...o.history.map((h) => h.actorId)].filter((x): x is string => !!x))];
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    return { members, users };
  }

  /** Nhân viên của chi nhánh để chọn người phụ trách / KTV */
  async staffOptions(a: Access, branchId: string) {
    if (!AccessService.canAccessBranch(a, branchId)) throw new ForbiddenException('Bạn không làm việc ở chi nhánh này');
    const ms = await this.prisma.membership.findMany({
      where: { tenantId: a.tenantId, status: 'ACTIVE', roles: { some: { OR: [{ branchId }, { branchId: null }] } } },
      include: { user: { select: { fullName: true } }, roles: { include: { role: { select: { code: true } } } } },
      orderBy: { user: { fullName: 'asc' } },
    });
    return ms
      .map((m) => ({ id: m.id, name: m.user.fullName, roles: [...new Set(m.roles.map((r) => r.role.code))] }))
      .filter((m) => m.roles.some((r) => ['KTV', 'BH', 'QL', 'CG'].includes(r)));
  }

  /** Tổng công nợ của khách từ các đơn đã hoàn thành / đã giao (chưa thu đủ) */
  async customerDebt(tenantId: string, customerId: string) {
    const r = await this.prisma.repairOrder.aggregate({
      where: { tenantId, customerId, status: { in: ['HOAN_THANH', 'DA_GIAO'] } },
      _sum: { total: true, paid: true },
    });
    return num(r._sum.total ?? 0n) - num(r._sum.paid ?? 0n);
  }

  // ---------------- Ghi ----------------

  async create(a: Access, dto: OrderCreateInput, ip?: string) {
    if (!AccessService.canAccessBranch(a, dto.branchId)) throw new ForbiddenException('Bạn không làm việc ở chi nhánh này');
    const items = this.checkedItems(dto.items ?? []);
    const orderDiscount = dto.orderDiscount ?? 0;
    const { subtotal, total } = this.totals(items, orderDiscount);

    const created = await this.prisma.$transaction(async (tx) => {
      const branch = await tx.branch.findFirst({ where: { id: dto.branchId, tenantId: a.tenantId, deletedAt: null } });
      if (!branch) throw new BadRequestException('Chi nhánh không hợp lệ');
      const customer = await tx.customer.findFirst({ where: { id: dto.customerId, tenantId: a.tenantId, deletedAt: null } });
      if (!customer) throw new BadRequestException('Khách hàng không hợp lệ');
      const vehicle = dto.vehicleId ? await tx.vehicle.findFirst({ where: { id: dto.vehicleId, tenantId: a.tenantId, deletedAt: null } }) : null;
      if (dto.vehicleId && !vehicle) throw new BadRequestException('Xe không hợp lệ');
      if (vehicle) {
        const open = await tx.repairOrder.findFirst({ where: { tenantId: a.tenantId, vehicleId: vehicle.id, status: { in: OPEN_STATUSES } }, select: { code: true } });
        if (open) throw new ConflictException(`Xe ${formatPlate(vehicle.plateNo)} đang có đơn ${open.code} chưa giao`);
      }
      await this.assertStaff(tx, a.tenantId, dto.advisorId);
      await this.assertStaff(tx, a.tenantId, dto.technicianId);
      await this.assertProducts(tx, a.tenantId, items);

      // Số km lúc tiếp nhận
      if (vehicle && dto.odometerKm != null) {
        if (vehicle.odometerKm !== null && dto.odometerKm < vehicle.odometerKm) {
          throw new BadRequestException(`Số km nhỏ hơn lần ghi trước (${vehicle.odometerKm.toLocaleString('vi-VN')} km)`);
        }
        await tx.odometerReading.create({ data: { vehicleId: vehicle.id, km: dto.odometerKm, source: 'RO', recordedBy: a.userId } });
        await tx.vehicle.update({ where: { id: vehicle.id }, data: { odometerKm: dto.odometerKm } });
      }

      const code = orderCode(await reserveNumbers(tx, a.tenantId, 'order'));
      const o = await tx.repairOrder.create({
        data: {
          tenantId: a.tenantId,
          branchId: branch.id,
          code,
          customerId: customer.id,
          vehicleId: vehicle?.id ?? null,
          odometerKm: dto.odometerKm ?? null,
          request: dto.request?.trim() || null,
          note: dto.note?.trim() || null,
          promisedAt: dto.promisedAt ? new Date(dto.promisedAt) : null,
          advisorId: dto.advisorId ?? (a.membershipId || null),
          technicianId: dto.technicianId ?? null,
          subtotal: BigInt(subtotal),
          orderDiscount: BigInt(orderDiscount),
          total: BigInt(total),
          createdBy: a.userId,
          searchText: this.searchTextOf(code, customer, vehicle?.plateNo),
          items: { create: items.map((it, i) => this.itemRow(it, i)) },
          history: { create: { toStatus: 'TIEP_NHAN', actorId: a.userId } },
        },
      });
      await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'order.created', entity: 'order', entityId: o.id, after: { code, customer: customer.name, plate: vehicle?.plateNo ?? null, total }, ip }, tx);
      return o;
    });
    return { id: created.id, code: created.code };
  }

  private itemRow(it: OrderItemInput & { amount: number }, i: number) {
    return {
      kind: it.kind,
      productId: it.productId ?? null,
      name: it.name,
      unit: it.unit?.trim() || null,
      quantity: new Prisma.Decimal(String(it.quantity).replace(',', '.')),
      unitPrice: BigInt(it.unitPrice),
      discount: BigInt(it.discount ?? 0),
      amount: BigInt(it.amount),
      sortOrder: i,
    };
  }

  async update(a: Access, id: string, dto: OrderUpdateInput, ip?: string) {
    await this.prisma.$transaction(async (tx) => {
      const o = await this.loadForWrite(tx, a, id);
      if (!EDITABLE_STATUSES.includes(o.status)) throw new ConflictException(`Đơn "${STATUS_LABEL[o.status]}" không sửa được nữa`);
      await this.assertStaff(tx, a.tenantId, dto.advisorId);
      await this.assertStaff(tx, a.tenantId, dto.technicianId);
      const data: Prisma.RepairOrderUpdateInput = {
        ...(dto.request !== undefined ? { request: dto.request?.trim() || null } : {}),
        ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
        ...(dto.promisedAt !== undefined ? { promisedAt: dto.promisedAt ? new Date(dto.promisedAt) : null } : {}),
        ...(dto.advisorId !== undefined ? { advisorId: dto.advisorId } : {}),
        ...(dto.technicianId !== undefined ? { technicianId: dto.technicianId } : {}),
      };
      if (dto.orderDiscount !== undefined) {
        const subtotal = num(o.subtotal);
        if (dto.orderDiscount < 0 || dto.orderDiscount > subtotal) throw new BadRequestException('Giảm giá đơn không được lớn hơn tổng tiền hàng');
        const total = subtotal - dto.orderDiscount;
        if (total < num(o.paid)) throw new ConflictException('Tổng tiền mới nhỏ hơn số đã thu. Huỷ bớt phiếu thu trước.');
        Object.assign(data, { orderDiscount: BigInt(dto.orderDiscount), total: BigInt(total) });
      }
      await tx.repairOrder.update({ where: { id }, data });
      await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'order.updated', entity: 'order', entityId: id, after: dto as Prisma.InputJsonValue, ip }, tx);
    });
    return { status: 'ok' };
  }

  /** Ghi lại toàn bộ danh sách hạng mục (màn hình gửi cả danh sách) */
  async replaceItems(a: Access, id: string, input: OrderItemInput[], ip?: string) {
    const items = this.checkedItems(input);
    const res = await this.prisma.$transaction(async (tx) => {
      const o = await this.loadForWrite(tx, a, id);
      if (!EDITABLE_STATUSES.includes(o.status)) throw new ConflictException(`Đơn "${STATUS_LABEL[o.status]}" không sửa được nữa`);
      const subtotal = items.reduce((s, i) => s + i.amount, 0);
      // Giảm giá đơn lớn hơn tổng mới thì hạ xuống bằng tổng
      const orderDiscount = Math.min(num(o.orderDiscount), subtotal);
      const total = subtotal - orderDiscount;
      if (total < num(o.paid)) throw new ConflictException('Tổng tiền mới nhỏ hơn số đã thu. Huỷ bớt phiếu thu trước.');
      await this.assertProducts(tx, a.tenantId, items);
      await tx.orderItem.deleteMany({ where: { orderId: id } });
      await tx.orderItem.createMany({ data: items.map((it, i) => ({ ...this.itemRow(it, i), orderId: id })) });
      await tx.repairOrder.update({ where: { id }, data: { subtotal: BigInt(subtotal), orderDiscount: BigInt(orderDiscount), total: BigInt(total) } });
      await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'order.items', entity: 'order', entityId: id, before: { total: num(o.total) }, after: { total, items: items.length }, ip }, tx);
      return { subtotal, total };
    });
    return res;
  }

  async changeStatus(a: Access, id: string, dto: { to: OrderStatus; note?: string | null; reason?: string | null; allowDebt?: boolean }, ip?: string) {
    await this.prisma.$transaction(async (tx) => {
      const o = await this.loadForWrite(tx, a, id);
      if (o.status === dto.to) return;
      const err = transitionError(o.status, dto.to, new Set(a.permissions));
      if (err) throw (err.includes('quyền') ? new ForbiddenException(err) : new ConflictException(err));
      const now = new Date();
      const data: Prisma.RepairOrderUpdateInput = { status: dto.to };
      if (dto.to === 'HUY') {
        if (!dto.reason?.trim()) throw new BadRequestException('Cần nhập lý do huỷ');
        if (num(o.paid) > 0) throw new ConflictException('Đơn đã thu tiền: huỷ các phiếu thu trước khi huỷ đơn');
        Object.assign(data, { cancelledAt: now, cancelReason: dto.reason.trim() });
      }
      if (dto.to === 'HOAN_THANH') {
        const n = await tx.orderItem.count({ where: { orderId: id } });
        if (!n) throw new BadRequestException('Đơn chưa có hạng mục nào');
        data.completedAt = now;
      }
      if (dto.to === 'DANG_SUA' && o.status === 'HOAN_THANH') data.completedAt = null;
      if (dto.to === 'DA_GIAO') {
        const due = num(o.total) - num(o.paid);
        if (due > 0 && !dto.allowDebt) throw new ConflictException(`Khách còn nợ ${due.toLocaleString('vi-VN')} đ. Thu đủ hoặc xác nhận ghi công nợ.`);
        data.deliveredAt = now;
        // Giao xe: trừ kho chi nhánh cho phụ tùng chọn từ danh mục
        const stocked = await tx.orderItem.findMany({ where: { orderId: id, kind: 'PHU_TUNG', product: { kind: 'PHU_TUNG' } } });
        for (const it of stocked) {
          await applyMovement(tx, { tenantId: a.tenantId, branchId: o.branchId, productId: it.productId!, kind: 'XUAT_BAN', quantity: it.quantity.neg(), orderId: id, note: `Xuất bán theo đơn ${o.code}`, actorId: a.userId });
        }
      }
      await tx.repairOrder.update({ where: { id }, data });
      const note = dto.to === 'HUY' ? dto.reason!.trim() : dto.to === 'DA_GIAO' && num(o.total) > num(o.paid) ? `Ghi công nợ ${(num(o.total) - num(o.paid)).toLocaleString('vi-VN')} đ` : dto.note?.trim() || null;
      await tx.orderStatusHistory.create({ data: { orderId: id, fromStatus: o.status, toStatus: dto.to, note, actorId: a.userId } });
      await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'order.status', entity: 'order', entityId: id, before: { status: o.status }, after: { status: dto.to, note }, ip }, tx);
    });
    return { status: 'ok' };
  }

  async addPayment(a: Access, id: string, dto: { amount: number; method: PaymentMethod; note?: string | null }, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const o = await this.loadForWrite(tx, a, id);
      if (o.status === 'HUY') throw new ConflictException('Đơn đã huỷ');
      const due = num(o.total) - num(o.paid);
      if (due <= 0) throw new ConflictException('Đơn đã thu đủ tiền');
      if (dto.amount > due) throw new BadRequestException(`Số tiền lớn hơn số còn phải thu (${due.toLocaleString('vi-VN')} đ)`);
      const p = await tx.payment.create({ data: { tenantId: a.tenantId, orderId: id, amount: BigInt(dto.amount), method: dto.method, note: dto.note?.trim() || null, createdBy: a.userId } });
      await tx.repairOrder.update({ where: { id }, data: { paid: { increment: BigInt(dto.amount) } } });
      await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'payment.created', entity: 'order', entityId: id, after: { paymentId: p.id, amount: dto.amount, method: dto.method }, ip }, tx);
      return { id: p.id, due: due - dto.amount };
    });
  }

  async voidPayment(a: Access, id: string, paymentId: string, reason: string, ip?: string) {
    await this.prisma.$transaction(async (tx) => {
      const o = await this.loadForWrite(tx, a, id);
      if (o.status === 'DA_GIAO' && !a.permissions.includes('ro.approve')) throw new ForbiddenException('Đơn đã giao: cần Quản lý huỷ phiếu thu');
      const p = await tx.payment.findFirst({ where: { id: paymentId, orderId: id } });
      if (!p) throw new NotFoundException('Không tìm thấy phiếu thu');
      if (p.voidedAt) throw new ConflictException('Phiếu thu đã huỷ');
      await tx.payment.update({ where: { id: paymentId }, data: { voidedAt: new Date(), voidedBy: a.userId, voidReason: reason.trim() } });
      await tx.repairOrder.update({ where: { id }, data: { paid: { decrement: p.amount } } });
      await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'payment.voided', entity: 'order', entityId: id, before: { paymentId, amount: num(p.amount) }, after: { reason }, ip }, tx);
    });
    return { status: 'ok' };
  }
}
