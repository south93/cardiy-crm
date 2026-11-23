import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { formatPlate, inspectionSummary, type InspectionData } from '@cardiy/shared';
import { z } from 'zod';
import { Public } from '../common/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { STATUS_LABEL, paymentState } from '../orders/order-rules';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerAppController, OwnerAuthController, OwnerAuthService, OwnerGuard, maskPhone, type OwnerRequest } from './owner-auth';

const n = (b: bigint | number) => Number(b);
const garageName = (t: { name: string; printSettings: unknown }) => (t.printSettings as { displayName?: string } | null)?.displayName || t.name;

/**
 * Dữ liệu app chủ xe. Chủ xe chỉ thấy:
 *  - xe hiện đang đứng tên các hồ sơ khách đã liên kết với tài khoản;
 *  - đơn của chính hồ sơ khách đó (không thấy đơn của chủ xe trước).
 */
@Injectable()
export class OwnerService {
  constructor(private readonly prisma: PrismaService) {}

  private async links(userId: string) {
    return this.prisma.customerLink.findMany({ where: { userId, customer: { deletedAt: null } }, include: { customer: { select: { id: true, name: true, tenantId: true } } } });
  }

  private async customerIds(userId: string) {
    return (await this.links(userId)).map((l) => l.customerId);
  }

  async me(userId: string) {
    const [u, links] = await Promise.all([this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true, phone: true } }), this.links(userId)]);
    const tenants = await this.prisma.tenant.findMany({ where: { id: { in: links.map((l) => l.tenantId) } }, select: { id: true, name: true, printSettings: true } });
    return {
      name: u.fullName,
      phone: maskPhone(u.phone),
      garages: links.map((l) => ({ garage: garageName(tenants.find((t) => t.id === l.tenantId)!), customerName: l.customer.name })),
    };
  }

  async vehicles(userId: string) {
    const ids = await this.customerIds(userId);
    if (!ids.length) return [];
    const own = await this.prisma.vehicleOwnership.findMany({
      where: { customerId: { in: ids }, toDate: null, vehicle: { deletedAt: null } },
      include: { vehicle: true },
      orderBy: { fromDate: 'asc' },
    });
    const tenants = await this.prisma.tenant.findMany({ where: { id: { in: [...new Set(own.map((o) => o.vehicle.tenantId))] } }, select: { id: true, name: true, printSettings: true } });
    const vids = own.map((o) => o.vehicleId);
    const orders = await this.prisma.repairOrder.findMany({
      where: { vehicleId: { in: vids }, customerId: { in: ids }, status: { not: 'HUY' } },
      orderBy: { receivedAt: 'desc' },
      select: { id: true, code: true, status: true, vehicleId: true, receivedAt: true, deliveredAt: true, promisedAt: true, odometerKm: true },
    });
    return own.map(({ vehicle: v }) => {
      const mine = orders.filter((o) => o.vehicleId === v.id);
      const open = mine.find((o) => ['TIEP_NHAN', 'DANG_SUA', 'HOAN_THANH'].includes(o.status));
      const last = mine.find((o) => o.status === 'DA_GIAO');
      return {
        id: v.id,
        plate: formatPlate(v.plateNo),
        make: v.make,
        model: v.model,
        year: v.year,
        color: v.color,
        odometerKm: v.odometerKm,
        registrationExpiry: v.registrationExpiry,
        insuranceExpiry: v.insuranceExpiry,
        garage: garageName(tenants.find((t) => t.id === v.tenantId)!),
        visits: mine.filter((o) => o.status === 'DA_GIAO').length,
        lastVisit: last ? { date: last.deliveredAt, km: last.odometerKm } : null,
        openOrder: open ? { id: open.id, code: open.code, status: open.status, statusLabel: STATUS_LABEL[open.status], promisedAt: open.promisedAt } : null,
      };
    });
  }

  private async ownedVehicle(userId: string, vehicleId: string) {
    const ids = await this.customerIds(userId);
    const own = await this.prisma.vehicleOwnership.findFirst({ where: { vehicleId, customerId: { in: ids }, toDate: null, vehicle: { deletedAt: null } }, include: { vehicle: true } });
    if (!own) throw new NotFoundException('Không tìm thấy xe');
    return { vehicle: own.vehicle, customerIds: ids };
  }

  async vehicle(userId: string, vehicleId: string) {
    const { vehicle: v, customerIds } = await this.ownedVehicle(userId, vehicleId);
    const [orders, odo] = await Promise.all([
      this.prisma.repairOrder.findMany({
        where: { vehicleId, customerId: { in: customerIds }, status: { not: 'HUY' } },
        orderBy: { receivedAt: 'desc' },
        include: { branch: { select: { name: true } }, items: { orderBy: { sortOrder: 'asc' }, select: { name: true } } },
      }),
      this.prisma.odometerReading.findMany({ where: { vehicleId }, orderBy: { createdAt: 'desc' }, take: 10, select: { km: true, source: true, createdAt: true } }),
    ]);
    return {
      id: v.id,
      plate: formatPlate(v.plateNo),
      make: v.make,
      model: v.model,
      year: v.year,
      color: v.color,
      vin: v.vin,
      fuel: v.fuel,
      transmission: v.transmission,
      tireSize: v.tireSize,
      odometerKm: v.odometerKm,
      registrationExpiry: v.registrationExpiry,
      insuranceExpiry: v.insuranceExpiry,
      odometers: odo,
      orders: orders.map((o) => ({
        id: o.id,
        code: o.code,
        status: o.status,
        statusLabel: STATUS_LABEL[o.status],
        branch: o.branch.name,
        receivedAt: o.receivedAt,
        deliveredAt: o.deliveredAt,
        odometerKm: o.odometerKm,
        total: n(o.total),
        items: o.items.map((i) => i.name),
      })),
    };
  }

  /** Chủ xe tự cập nhật số km (không được nhỏ hơn số đang có) */
  async addOdometer(userId: string, vehicleId: string, km: number) {
    const { vehicle: v } = await this.ownedVehicle(userId, vehicleId);
    if (v.odometerKm !== null && km < v.odometerKm) throw new BadRequestException(`Số km không được nhỏ hơn ${v.odometerKm.toLocaleString('vi-VN')} km đang lưu`);
    await this.prisma.$transaction([
      this.prisma.odometerReading.create({ data: { vehicleId, km, source: 'OWNER', recordedBy: userId } }),
      this.prisma.vehicle.update({ where: { id: vehicleId }, data: { odometerKm: km } }),
    ]);
    return { odometerKm: km };
  }

  async order(userId: string, orderId: string) {
    const ids = await this.customerIds(userId);
    const o = await this.prisma.repairOrder.findFirst({
      where: { id: orderId, customerId: { in: ids } },
      include: {
        branch: { select: { name: true, address: true, phone: true } },
        vehicle: { select: { id: true, plateNo: true, make: true, model: true } },
        items: { orderBy: { sortOrder: 'asc' } },
        payments: { where: { voidedAt: null }, orderBy: { paidAt: 'asc' } },
        history: { orderBy: { createdAt: 'asc' }, select: { toStatus: true, createdAt: true } },
        inspection: { select: { data: true, completedAt: true } },
      },
    });
    if (!o) throw new NotFoundException('Không tìm thấy đơn');
    const d = (o.inspection?.data ?? null) as InspectionData | null;
    const total = n(o.total);
    const paid = n(o.paid);
    return {
      id: o.id,
      code: o.code,
      status: o.status,
      statusLabel: STATUS_LABEL[o.status],
      branch: o.branch,
      vehicle: o.vehicle ? { id: o.vehicle.id, plate: formatPlate(o.vehicle.plateNo), make: o.vehicle.make, model: o.vehicle.model } : null,
      request: o.request,
      odometerKm: o.odometerKm,
      receivedAt: o.receivedAt,
      promisedAt: o.promisedAt,
      completedAt: o.completedAt,
      deliveredAt: o.deliveredAt,
      items: o.items.map((i) => ({
        kind: i.kind,
        name: i.name,
        unit: i.unit,
        quantity: Number(i.quantity),
        unitPrice: n(i.unitPrice),
        discount: n(i.discount),
        amount: n(i.amount),
        vatRate: i.vatRate,
      })),
      subtotal: n(o.subtotal),
      orderDiscount: n(o.orderDiscount),
      vatTotal: n(o.vatTotal),
      total,
      paid,
      due: Math.max(0, total - paid),
      paymentState: paymentState(total, paid),
      payments: o.payments.map((p) => ({ amount: n(p.amount), method: p.method, paidAt: p.paidAt })),
      history: o.history.map((h) => ({ status: h.toStatus, label: STATUS_LABEL[h.toStatus], at: h.createdAt })),
      inspection:
        o.inspection?.completedAt && d ? { completedAt: o.inspection.completedAt, ...inspectionSummary(d), recommendation: d.recommendation ?? null, suggestions: d.suggestions ?? null } : null,
    };
  }
}

const odoSchema = z.object({ km: z.coerce.number().int('Số km là số nguyên').min(0).max(5_000_000) });

@Public()
@UseGuards(OwnerGuard)
@Controller('owner')
export class OwnerController {
  constructor(private readonly svc: OwnerService) {}

  @Get('me')
  me(@Req() req: OwnerRequest) {
    return this.svc.me(req.owner!.userId);
  }

  @Get('vehicles')
  vehicles(@Req() req: OwnerRequest) {
    return this.svc.vehicles(req.owner!.userId);
  }

  @Get('vehicles/:id')
  vehicle(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.vehicle(req.owner!.userId, id);
  }

  @Post('vehicles/:id/odometer')
  odometer(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(odoSchema)) dto: z.infer<typeof odoSchema>) {
    return this.svc.addOdometer(req.owner!.userId, id, dto.km);
  }

  @Get('orders/:id')
  order(@Req() req: OwnerRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.order(req.owner!.userId, id);
  }
}

@Module({ controllers: [OwnerAuthController, OwnerController, CustomerAppController], providers: [OwnerAuthService, OwnerService, OwnerGuard] })
export class OwnerModule {}
