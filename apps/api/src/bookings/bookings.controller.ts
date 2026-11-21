import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { OrdersModule } from '../orders/orders.module';
import { BookingsService } from './bookings.service';

const STATUSES = ['CHO_XAC_NHAN', 'DA_XAC_NHAN', 'DA_DEN', 'KHONG_DEN', 'KHACH_HUY', 'TU_CHOI'] as const;
const CHANNELS = ['GOI_DIEN', 'ZALO', 'FACEBOOK', 'TRUC_TIEP', 'WEBSITE', 'KHAC'] as const;
const when = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Ngày giờ không hợp lệ');

const createSchema = z.object({
  branchId: z.string().uuid(),
  customerId: z.string().uuid(),
  vehicleId: z.string().uuid().optional().nullable(),
  scheduledAt: when,
  durationMin: z.coerce.number().int().min(15).max(8 * 60).optional(),
  service: z.string().trim().min(1, 'Cần ghi khách cần làm gì').max(500),
  note: z.string().trim().max(1000).optional().nullable(),
  channel: z.enum(CHANNELS).optional(),
  technicianId: z.string().uuid().optional().nullable(),
});
const updateSchema = createSchema.omit({ branchId: true, customerId: true }).partial();
const listSchema = z.object({
  from: when,
  to: when,
  branchId: z.string().uuid().optional(),
  status: z.enum(STATUSES).optional(),
  customerId: z.string().uuid().optional(),
  vehicleId: z.string().uuid().optional(),
});

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @RequirePermissions('booking.view')
  @Get()
  list(@CurrentAuth() auth: RequestAuth, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.bookings.list(auth.access, q);
  }

  @RequirePermissions('booking.view')
  @Get(':id')
  get(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.get(auth.access, id);
  }

  @RequirePermissions('booking.manage')
  @Post()
  create(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(createSchema)) dto: z.infer<typeof createSchema>, @Req() req: Request) {
    return this.bookings.create(auth.access, dto, clientIp(req));
  }

  @RequirePermissions('booking.manage')
  @Patch(':id')
  update(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateSchema)) dto: z.infer<typeof updateSchema>, @Req() req: Request) {
    return this.bookings.update(auth.access, id, dto, clientIp(req));
  }

  @RequirePermissions('booking.manage')
  @Post(':id/status')
  @HttpCode(200)
  status(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ to: z.enum(STATUSES), reason: z.string().trim().max(300).optional().nullable() }))) dto: { to: (typeof STATUSES)[number]; reason?: string | null }, @Req() req: Request) {
    return this.bookings.changeStatus(auth.access, id, dto, clientIp(req));
  }

  /** Nhận xe: cần cả quyền lịch hẹn và tạo đơn */
  @RequirePermissions('booking.manage', 'ro.manage')
  @Post(':id/check-in')
  checkIn(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ odometerKm: z.coerce.number().int().min(0).max(5_000_000).optional().nullable() }))) dto: { odometerKm?: number | null }, @Req() req: Request) {
    return this.bookings.checkIn(auth.access, id, dto, clientIp(req));
  }
}

@Module({
  imports: [OrdersModule],
  controllers: [BookingsController],
  providers: [BookingsService],
})
export class BookingsModule {}
