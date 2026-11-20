import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { formatPlate, normalizePlate, normalizeVnPhone, searchKey } from '@cardiy/shared';
import { Prisma, type CustomerSource, type CustomerTier, type CustomerType } from '@prisma/client';
import type { Access } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { customerCode, reserveNumbers } from './counters';
import { VehiclesService, type VehicleInput } from './vehicles.service';

export interface CustomerInput {
  type?: CustomerType;
  name: string;
  phone?: string | null;
  phone2?: string | null;
  email?: string | null;
  address?: string | null;
  taxCode?: string | null;
  representative?: string | null;
  birthday?: string | null;
  tier?: CustomerTier;
  source?: CustomerSource;
  branchId?: string | null;
  note?: string | null;
  marketingConsent?: boolean;
}

export function customerSearchText(c: { code: string; name: string; phone?: string | null; phone2?: string | null; email?: string | null; taxCode?: string | null }) {
  return searchKey(c.code, c.name, c.phone, c.phone2, c.email, c.taxCode);
}

/** Điều kiện tìm: tên/mã không dấu, SĐT (chuỗi số), biển số xe hiện tại. */
export function customerSearchWhere(q: string): Prisma.CustomerWhereInput {
  const key = searchKey(q);
  const digits = q.replace(/\D/g, '');
  const plate = normalizePlate(q);
  const or: Prisma.CustomerWhereInput[] = [{ searchText: { contains: key } }];
  if (digits.length >= 3) or.push({ phone: { contains: digits } }, { phone2: { contains: digits } });
  if (plate || q.replace(/[^A-Za-z0-9]/g, '').length >= 3) {
    const p = plate ?? q.toUpperCase().replace(/[^A-Z0-9]/g, '');
    or.push({ ownerships: { some: { toDate: null, vehicle: { plateNo: { contains: p }, deletedAt: null } } } });
  }
  return { OR: or };
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly vehicles: VehiclesService,
  ) {}

  private normalize(dto: Partial<CustomerInput>) {
    const out: Partial<CustomerInput> = { ...dto };
    if (dto.phone !== undefined) {
      if (dto.phone === null || dto.phone === '') out.phone = null;
      else {
        const p = normalizeVnPhone(dto.phone);
        if (!p) throw new BadRequestException('Số điện thoại không hợp lệ');
        out.phone = p;
      }
    }
    if (dto.phone2) {
      const p = normalizeVnPhone(dto.phone2);
      if (!p) throw new BadRequestException('Số điện thoại phụ không hợp lệ');
      out.phone2 = p;
    }
    if (dto.name !== undefined) out.name = dto.name.trim();
    return out;
  }

  private async assertBranch(tenantId: string, branchId?: string | null) {
    if (!branchId) return;
    const b = await this.prisma.branch.findFirst({ where: { id: branchId, tenantId, deletedAt: null } });
    if (!b) throw new BadRequestException('Chi nhánh không hợp lệ');
  }

  async list(actor: Access, q: { q?: string; tier?: CustomerTier; source?: CustomerSource; page: number; pageSize: number }) {
    const where: Prisma.CustomerWhereInput = {
      tenantId: actor.tenantId,
      deletedAt: null,
      ...(q.tier ? { tier: q.tier } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(q.q?.trim() ? customerSearchWhere(q.q.trim()) : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { code: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { ownerships: { where: { toDate: null, vehicle: { deletedAt: null } }, include: { vehicle: { select: { id: true, plateNo: true, make: true, model: true } } } } },
      }),
    ]);
    const branchIds = [...new Set(rows.map((r) => r.branchId).filter((b): b is string => !!b))];
    const branches = new Map((await this.prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } })).map((b) => [b.id, b.name]));
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => ({
        id: r.id,
        code: r.code,
        type: r.type,
        name: r.name,
        phone: r.phone,
        tier: r.tier,
        source: r.source,
        branchName: r.branchId ? (branches.get(r.branchId) ?? null) : null,
        createdAt: r.createdAt,
        vehicles: r.ownerships.map((o) => ({ id: o.vehicle.id, plate: formatPlate(o.vehicle.plateNo), make: o.vehicle.make, model: o.vehicle.model })),
      })),
    };
  }

  async get(actor: Access, id: string) {
    const c = await this.prisma.customer.findFirst({
      where: { id, tenantId: actor.tenantId, deletedAt: null },
      include: { ownerships: { include: { vehicle: true }, orderBy: { fromDate: 'desc' } } },
    });
    if (!c) throw new NotFoundException('Không tìm thấy khách hàng');
    const branch = c.branchId ? await this.prisma.branch.findUnique({ where: { id: c.branchId }, select: { id: true, name: true } }) : null;
    const toVehicle = (o: (typeof c.ownerships)[number]) => ({
      id: o.vehicle.id,
      plate: formatPlate(o.vehicle.plateNo),
      plateValid: o.vehicle.plateValid,
      make: o.vehicle.make,
      model: o.vehicle.model,
      year: o.vehicle.year,
      odometerKm: o.vehicle.odometerKm,
      registrationExpiry: o.vehicle.registrationExpiry,
      insuranceExpiry: o.vehicle.insuranceExpiry,
      fromDate: o.fromDate,
      toDate: o.toDate,
    });
    const { ownerships, searchText: _s, openingDebt, ...rest } = c;
    return {
      ...rest,
      openingDebt: Number(openingDebt),
      branch,
      vehicles: ownerships.filter((o) => !o.toDate && !o.vehicle.deletedAt).map(toVehicle),
      pastVehicles: ownerships.filter((o) => o.toDate).map(toVehicle),
    };
  }

  async create(actor: Access, dto: CustomerInput & { vehicle?: VehicleInput | null }, ip?: string) {
    const { vehicle, ...fields } = dto;
    const data = this.normalize(fields) as CustomerInput;
    if (!data.name) throw new BadRequestException('Cần nhập tên khách hàng');
    await this.assertBranch(actor.tenantId, data.branchId);
    if (data.phone && (await this.prisma.customer.findFirst({ where: { tenantId: actor.tenantId, phone: data.phone, deletedAt: null } }))) {
      throw new ConflictException('Số điện thoại đã có khách hàng khác');
    }
    try {
      const customer = await this.prisma.$transaction(async (tx) => {
        const n = await reserveNumbers(tx, actor.tenantId, 'customer');
        const code = customerCode(n);
        const c = await tx.customer.create({
          data: {
            ...data,
            birthday: data.birthday ? new Date(data.birthday) : null,
            tenantId: actor.tenantId,
            code,
            createdBy: actor.userId,
            searchText: customerSearchText({ ...data, code }),
          },
        });
        if (vehicle) await this.vehicles.createInTx(tx, actor, { ...vehicle, customerId: c.id });
        await this.audit.log({ tenantId: actor.tenantId, actorId: actor.userId, action: 'customer.created', entity: 'customer', entityId: c.id, after: { code, name: c.name, phone: c.phone, vehicle: vehicle?.plate ?? null }, ip }, tx);
        return c;
      });
      return { id: customer.id, code: customer.code };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Số điện thoại hoặc biển số đã tồn tại');
      throw e;
    }
  }

  async update(actor: Access, id: string, dto: Partial<CustomerInput>, ip?: string) {
    const before = await this.prisma.customer.findFirst({ where: { id, tenantId: actor.tenantId, deletedAt: null } });
    if (!before) throw new NotFoundException('Không tìm thấy khách hàng');
    const data = this.normalize(dto);
    await this.assertBranch(actor.tenantId, data.branchId);
    if (data.phone && data.phone !== before.phone && (await this.prisma.customer.findFirst({ where: { tenantId: actor.tenantId, phone: data.phone, deletedAt: null, NOT: { id } } }))) {
      throw new ConflictException('Số điện thoại đã có khách hàng khác');
    }
    const merged = { ...before, ...data };
    await this.prisma.customer.update({
      where: { id },
      data: {
        ...data,
        birthday: data.birthday === undefined ? undefined : data.birthday ? new Date(data.birthday) : null,
        searchText: customerSearchText(merged),
      },
    });
    await this.audit.log({ tenantId: actor.tenantId, actorId: actor.userId, action: 'customer.updated', entity: 'customer', entityId: id, before: { name: before.name, phone: before.phone, tier: before.tier }, after: dto, ip });
    return { status: 'ok' };
  }

  /** Xoá mềm. Khách còn xe đang sở hữu thì phải chuyển xe trước. */
  async remove(actor: Access, id: string, ip?: string) {
    const c = await this.prisma.customer.findFirst({ where: { id, tenantId: actor.tenantId, deletedAt: null }, include: { ownerships: { where: { toDate: null } } } });
    if (!c) throw new NotFoundException('Không tìm thấy khách hàng');
    if (c.ownerships.length) throw new ConflictException('Khách còn xe đang sở hữu: chuyển xe sang khách khác trước khi xoá');
    await this.prisma.customer.update({ where: { id }, data: { deletedAt: new Date(), phone: null } });
    await this.audit.log({ tenantId: actor.tenantId, actorId: actor.userId, action: 'customer.deleted', entity: 'customer', entityId: id, before: { code: c.code, name: c.name, phone: c.phone }, ip });
    return { status: 'ok' };
  }
}
