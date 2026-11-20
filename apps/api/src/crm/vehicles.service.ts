import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { formatPlate, isCivilPlate, normalizePlate, normalizeVin, searchKey } from '@cardiy/shared';
import { Prisma } from '@prisma/client';
import type { Access } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

export interface VehicleInput {
  plate: string;
  vin?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  color?: string | null;
  fuel?: string | null;
  transmission?: string | null;
  tireSize?: string | null;
  odometerKm?: number | null;
  registrationExpiry?: string | null;
  insuranceExpiry?: string | null;
  note?: string | null;
  customerId?: string | null;
}

export function vehicleSearchText(v: { plateNo: string; vin?: string | null; make?: string | null; model?: string | null }) {
  return searchKey(v.plateNo, formatPlate(v.plateNo), v.vin, v.make, v.model);
}

const toDate = (s?: string | null) => (s ? new Date(s) : s === null ? null : undefined);

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private plateOf(raw: string) {
    const plateNo = normalizePlate(raw);
    if (!plateNo) throw new BadRequestException('Biển số không hợp lệ');
    return { plateNo, plateValid: isCivilPlate(plateNo) };
  }

  private vinOf(raw?: string | null) {
    if (!raw) return raw === undefined ? undefined : null;
    const v = normalizeVin(raw);
    if (!v) throw new BadRequestException('Số VIN phải gồm 17 ký tự chữ và số (không có I, O, Q)');
    return v;
  }

  private async assertCustomer(tx: Prisma.TransactionClient, tenantId: string, customerId: string) {
    const c = await tx.customer.findFirst({ where: { id: customerId, tenantId, deletedAt: null } });
    if (!c) throw new BadRequestException('Khách hàng không hợp lệ');
  }

  async createInTx(tx: Prisma.TransactionClient, actor: Access, dto: VehicleInput) {
    const { plateNo, plateValid } = this.plateOf(dto.plate);
    if (await tx.vehicle.findFirst({ where: { tenantId: actor.tenantId, plateNo } })) throw new ConflictException(`Biển số ${formatPlate(plateNo)} đã có trong hệ thống`);
    if (dto.customerId) await this.assertCustomer(tx, actor.tenantId, dto.customerId);
    const vin = this.vinOf(dto.vin);
    const v = await tx.vehicle.create({
      data: {
        tenantId: actor.tenantId,
        plateNo,
        plateValid,
        vin,
        make: dto.make?.trim() || null,
        model: dto.model?.trim() || null,
        year: dto.year ?? null,
        color: dto.color || null,
        fuel: dto.fuel || null,
        transmission: dto.transmission || null,
        tireSize: dto.tireSize || null,
        odometerKm: dto.odometerKm ?? null,
        registrationExpiry: toDate(dto.registrationExpiry) ?? null,
        insuranceExpiry: toDate(dto.insuranceExpiry) ?? null,
        note: dto.note || null,
        createdBy: actor.userId,
        searchText: vehicleSearchText({ plateNo, vin, make: dto.make, model: dto.model }),
      },
    });
    if (dto.customerId) await tx.vehicleOwnership.create({ data: { vehicleId: v.id, customerId: dto.customerId } });
    if (dto.odometerKm) await tx.odometerReading.create({ data: { vehicleId: v.id, km: dto.odometerKm, recordedBy: actor.userId } });
    return v;
  }

  async create(actor: Access, dto: VehicleInput, ip?: string) {
    try {
      const v = await this.prisma.$transaction((tx) => this.createInTx(tx, actor, dto));
      await this.audit.log({ tenantId: actor.tenantId, actorId: actor.userId, action: 'vehicle.created', entity: 'vehicle', entityId: v.id, after: { plate: formatPlate(v.plateNo), customerId: dto.customerId ?? null }, ip });
      return { id: v.id, plate: formatPlate(v.plateNo) };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Biển số đã có trong hệ thống');
      throw e;
    }
  }

  async list(actor: Access, q: { q?: string; expiringDays?: number; needsReview?: boolean; page: number; pageSize: number }) {
    const where: Prisma.VehicleWhereInput = { tenantId: actor.tenantId, deletedAt: null };
    if (q.q?.trim()) {
      const text = q.q.trim();
      const plate = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const digits = text.replace(/\D/g, '');
      const or: Prisma.VehicleWhereInput[] = [{ searchText: { contains: searchKey(text) } }];
      if (plate.length >= 2) or.push({ plateNo: { contains: plate } });
      if (digits.length >= 3) or.push({ ownerships: { some: { toDate: null, customer: { phone: { contains: digits } } } } });
      or.push({ ownerships: { some: { toDate: null, customer: { searchText: { contains: searchKey(text) } } } } });
      where.OR = or;
    }
    if (q.expiringDays) {
      const until = new Date(Date.now() + q.expiringDays * 86_400_000);
      where.AND = [{ OR: [{ registrationExpiry: { lte: until } }, { insuranceExpiry: { lte: until } }] }];
    }
    if (q.needsReview) where.plateValid = false;
    const [total, rows] = await Promise.all([
      this.prisma.vehicle.count({ where }),
      this.prisma.vehicle.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { ownerships: { where: { toDate: null }, include: { customer: { select: { id: true, name: true, phone: true } } } } },
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((v) => ({
        id: v.id,
        plate: formatPlate(v.plateNo),
        plateValid: v.plateValid,
        make: v.make,
        model: v.model,
        year: v.year,
        odometerKm: v.odometerKm,
        registrationExpiry: v.registrationExpiry,
        insuranceExpiry: v.insuranceExpiry,
        owner: v.ownerships[0]?.customer ?? null,
      })),
    };
  }

  async get(actor: Access, id: string) {
    const v = await this.prisma.vehicle.findFirst({
      where: { id, tenantId: actor.tenantId, deletedAt: null },
      include: {
        ownerships: { include: { customer: { select: { id: true, code: true, name: true, phone: true } } }, orderBy: { fromDate: 'desc' } },
        odometers: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!v) throw new NotFoundException('Không tìm thấy xe');
    const { searchText: _s, ownerships, odometers, ...rest } = v;
    return {
      ...rest,
      plate: formatPlate(v.plateNo),
      owner: ownerships.find((o) => !o.toDate)?.customer ?? null,
      owners: ownerships.map((o) => ({ customer: o.customer, fromDate: o.fromDate, toDate: o.toDate })),
      odometers: odometers.map((o) => ({ km: o.km, source: o.source, createdAt: o.createdAt })),
    };
  }

  async update(actor: Access, id: string, dto: Partial<Omit<VehicleInput, 'customerId' | 'odometerKm'>>, ip?: string) {
    const before = await this.prisma.vehicle.findFirst({ where: { id, tenantId: actor.tenantId, deletedAt: null } });
    if (!before) throw new NotFoundException('Không tìm thấy xe');
    const plate = dto.plate ? this.plateOf(dto.plate) : null;
    if (plate && plate.plateNo !== before.plateNo && (await this.prisma.vehicle.findFirst({ where: { tenantId: actor.tenantId, plateNo: plate.plateNo } }))) {
      throw new ConflictException(`Biển số ${formatPlate(plate.plateNo)} đã có trong hệ thống`);
    }
    const vin = this.vinOf(dto.vin);
    const next = {
      plateNo: plate?.plateNo ?? before.plateNo,
      vin: vin === undefined ? before.vin : vin,
      make: dto.make === undefined ? before.make : dto.make,
      model: dto.model === undefined ? before.model : dto.model,
    };
    await this.prisma.vehicle.update({
      where: { id },
      data: {
        ...(plate ? plate : {}),
        vin,
        make: dto.make,
        model: dto.model,
        year: dto.year,
        color: dto.color,
        fuel: dto.fuel,
        transmission: dto.transmission,
        tireSize: dto.tireSize,
        note: dto.note,
        registrationExpiry: toDate(dto.registrationExpiry),
        insuranceExpiry: toDate(dto.insuranceExpiry),
        searchText: vehicleSearchText(next),
      },
    });
    await this.audit.log({ tenantId: actor.tenantId, actorId: actor.userId, action: 'vehicle.updated', entity: 'vehicle', entityId: id, before: { plate: formatPlate(before.plateNo), make: before.make, model: before.model }, after: dto, ip });
    return { status: 'ok' };
  }

  /** Chuyển chủ xe: kết thúc chủ hiện tại, ghi chủ mới. Lịch sử sửa chữa vẫn gắn với xe. */
  async transfer(actor: Access, id: string, customerId: string, ip?: string) {
    const v = await this.prisma.vehicle.findFirst({ where: { id, tenantId: actor.tenantId, deletedAt: null }, include: { ownerships: { where: { toDate: null } } } });
    if (!v) throw new NotFoundException('Không tìm thấy xe');
    const current = v.ownerships[0];
    if (current?.customerId === customerId) throw new BadRequestException('Xe đã thuộc khách này');
    await this.prisma.$transaction(async (tx) => {
      await this.assertCustomer(tx, actor.tenantId, customerId);
      const now = new Date();
      if (current) await tx.vehicleOwnership.update({ where: { id: current.id }, data: { toDate: now } });
      await tx.vehicleOwnership.create({ data: { vehicleId: id, customerId, fromDate: now } });
      await this.audit.log({ tenantId: actor.tenantId, actorId: actor.userId, action: 'vehicle.transferred', entity: 'vehicle', entityId: id, before: { customerId: current?.customerId ?? null }, after: { customerId }, ip }, tx);
    });
    return { status: 'ok' };
  }

  /** Ghi số km. Nhỏ hơn lần trước thì phải đánh dấu "sửa sai" (đồng hồ thay, nhập nhầm). */
  async addOdometer(actor: Access, id: string, km: number, correction: boolean, ip?: string) {
    const v = await this.prisma.vehicle.findFirst({ where: { id, tenantId: actor.tenantId, deletedAt: null } });
    if (!v) throw new NotFoundException('Không tìm thấy xe');
    if (v.odometerKm !== null && km < v.odometerKm && !correction) {
      throw new BadRequestException(`Số km nhỏ hơn lần ghi trước (${v.odometerKm.toLocaleString('vi-VN')} km). Nếu đúng là sửa sai, chọn "Sửa số km".`);
    }
    await this.prisma.$transaction([
      this.prisma.odometerReading.create({ data: { vehicleId: id, km, source: correction ? 'CORRECTION' : 'MANUAL', recordedBy: actor.userId } }),
      this.prisma.vehicle.update({ where: { id }, data: { odometerKm: km } }),
    ]);
    await this.audit.log({ tenantId: actor.tenantId, actorId: actor.userId, action: 'vehicle.odometer', entity: 'vehicle', entityId: id, before: { km: v.odometerKm }, after: { km, correction }, ip });
    return { status: 'ok' };
  }

  async remove(actor: Access, id: string, ip?: string) {
    const v = await this.prisma.vehicle.findFirst({ where: { id, tenantId: actor.tenantId, deletedAt: null } });
    if (!v) throw new NotFoundException('Không tìm thấy xe');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.vehicleOwnership.updateMany({ where: { vehicleId: id, toDate: null }, data: { toDate: now } }),
      // Đổi biển đã xoá thành khoá riêng để có thể tạo lại xe cùng biển
      this.prisma.vehicle.update({ where: { id }, data: { deletedAt: now, plateNo: `${v.plateNo}#xoa-${now.getTime()}` } }),
    ]);
    await this.audit.log({ tenantId: actor.tenantId, actorId: actor.userId, action: 'vehicle.deleted', entity: 'vehicle', entityId: id, before: { plate: formatPlate(v.plateNo) }, ip });
    return { status: 'ok' };
  }
}
