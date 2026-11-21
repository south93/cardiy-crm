import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { OrdersService } from './orders.service';

const STATUSES = ['TIEP_NHAN', 'DANG_SUA', 'HOAN_THANH', 'DA_GIAO', 'HUY'] as const;
const money = z.coerce.number().int('Tiền là số nguyên (đồng)').min(0).max(1_000_000_000_000);
const text = (max: number) => z.string().trim().max(max).optional().nullable();
const isoDateTime = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Ngày giờ không hợp lệ')
  .optional()
  .nullable()
  .or(z.literal('').transform(() => null));

const item = z.object({
  kind: z.enum(['DICH_VU', 'PHU_TUNG']),
  name: z.string().trim().min(1, 'Cần nhập tên hạng mục').max(200),
  unit: text(20),
  quantity: z.union([z.string().max(20), z.number()]),
  unitPrice: money,
  discount: money.optional(),
  vatRate: z.coerce.number().int().min(0).max(100).optional(),
  section: text(60),
  productId: z.string().uuid().optional().nullable(),
});
const items = z.array(item).max(200, 'Tối đa 200 hạng mục');

const createSchema = z.object({
  branchId: z.string().uuid(),
  customerId: z.string().uuid(),
  vehicleId: z.string().uuid().optional().nullable(),
  odometerKm: z.coerce.number().int().min(0).max(5_000_000).optional().nullable(),
  request: text(2000),
  note: text(2000),
  promisedAt: isoDateTime,
  advisorId: z.string().uuid().optional().nullable(),
  technicianId: z.string().uuid().optional().nullable(),
  orderDiscount: money.optional(),
  items: items.optional(),
});
const updateSchema = createSchema.pick({ request: true, note: true, promisedAt: true, advisorId: true, technicianId: true, orderDiscount: true }).partial().extend({ insuranceAmount: money.optional() });
const listSchema = z.object({
  view: z.enum(['open', 'done', 'all']).default('all'),
  status: z.enum(STATUSES).optional(),
  branchId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  vehicleId: z.string().uuid().optional(),
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const statusSchema = z.object({ to: z.enum(STATUSES), note: text(500), reason: text(500), allowDebt: z.boolean().optional() });
const paymentSchema = z.object({ amount: money.min(1, 'Số tiền phải lớn hơn 0'), method: z.enum(['TIEN_MAT', 'CHUYEN_KHOAN', 'THE', 'BAO_HIEM']), note: text(300) });
const voidSchema = z.object({ reason: z.string().trim().min(3, 'Cần nhập lý do huỷ phiếu').max(300) });

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @RequirePermissions('ro.view')
  @Get()
  list(@CurrentAuth() auth: RequestAuth, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.orders.list(auth.access, q);
  }

  @RequirePermissions('ro.manage')
  @Get('staff-options')
  staff(@CurrentAuth() auth: RequestAuth, @Query('branchId', ParseUUIDPipe) branchId: string) {
    return this.orders.staffOptions(auth.access, branchId);
  }

  @RequirePermissions('ro.view')
  @Get(':id')
  get(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(auth.access, id);
  }

  @RequirePermissions('ro.manage')
  @Post()
  create(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(createSchema)) dto: z.infer<typeof createSchema>, @Req() req: Request) {
    return this.orders.create(auth.access, dto, clientIp(req));
  }

  @RequirePermissions('ro.manage')
  @Patch(':id')
  update(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateSchema)) dto: z.infer<typeof updateSchema>, @Req() req: Request) {
    return this.orders.update(auth.access, id, dto, clientIp(req));
  }

  @RequirePermissions('ro.manage')
  @Put(':id/items')
  replaceItems(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ items }))) dto: { items: z.infer<typeof items> }, @Req() req: Request) {
    return this.orders.replaceItems(auth.access, id, dto.items, clientIp(req));
  }

  /** Quyền chi tiết theo từng bước kiểm tra trong service (KTV được chuyển sang Đang sửa / Hoàn thành) */
  @RequirePermissions('ro.view')
  @Post(':id/status')
  @HttpCode(200)
  status(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(statusSchema)) dto: z.infer<typeof statusSchema>, @Req() req: Request) {
    return this.orders.changeStatus(auth.access, id, dto, clientIp(req));
  }

  @RequirePermissions('payment.collect')
  @Post(':id/payments')
  pay(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(paymentSchema)) dto: z.infer<typeof paymentSchema>, @Req() req: Request) {
    return this.orders.addPayment(auth.access, id, dto, clientIp(req));
  }

  @RequirePermissions('payment.collect')
  @Post(':id/payments/:paymentId/void')
  @HttpCode(200)
  voidPayment(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body(new ZodPipe(voidSchema)) dto: z.infer<typeof voidSchema>,
    @Req() req: Request,
  ) {
    return this.orders.voidPayment(auth.access, id, paymentId, dto.reason, clientIp(req));
  }
}
