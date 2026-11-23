import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { CATEGORIES } from './finance-rules';
import { FinanceService } from './finance.service';

const METHODS = ['TIEN_MAT', 'CHUYEN_KHOAN', 'THE', 'BAO_HIEM'] as const;
const when = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Ngày giờ không hợp lệ');
const money = z.coerce.number().int('Tiền là số nguyên (đồng)').min(1, 'Số tiền phải lớn hơn 0').max(1_000_000_000_000);

const bookSchema = z.object({ from: when, to: when, branchId: z.string().uuid().optional(), method: z.enum(METHODS).optional() });
const entrySchema = z.object({
  type: z.enum(['THU', 'CHI']),
  branchId: z.string().uuid(),
  category: z.string().max(40),
  amount: money,
  method: z.enum(METHODS),
  counterparty: z.string().trim().max(150).optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  supplierId: z.string().uuid().optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  occurredAt: when.optional().nullable(),
});
const debtList = z.object({ q: z.string().max(100).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(30) });
const collectSchema = z.object({ amount: money, method: z.enum(METHODS), note: z.string().trim().max(300).optional().nullable(), branchId: z.string().uuid() });

const payList = z.object({ q: z.string().max(100).optional(), all: z.coerce.boolean().optional() });
const paySchema = z.object({ amount: money, method: z.enum(['TIEN_MAT', 'CHUYEN_KHOAN', 'THE']), branchId: z.string().uuid(), note: z.string().trim().max(300).optional().nullable() });

@Controller('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @RequirePermissions('finance.view')
  @Get('categories')
  categories() {
    return CATEGORIES;
  }

  @RequirePermissions('finance.view')
  @Get('cashbook')
  cashbook(@CurrentAuth() auth: RequestAuth, @Query(new ZodPipe(bookSchema)) q: z.infer<typeof bookSchema>) {
    return this.finance.cashbook(auth.access, q);
  }

  @RequirePermissions('finance.manage')
  @Post('entries')
  create(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(entrySchema)) dto: z.infer<typeof entrySchema>, @Req() req: Request) {
    return this.finance.createEntry(auth.access, dto, clientIp(req));
  }

  @RequirePermissions('finance.manage')
  @Post('entries/:id/void')
  @HttpCode(200)
  void(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(3, 'Cần nhập lý do huỷ').max(300) }))) dto: { reason: string }, @Req() req: Request) {
    return this.finance.voidEntry(auth.access, id, dto.reason, clientIp(req));
  }

  @RequirePermissions('finance.view')
  @Get('opening-fund')
  openingFund(@CurrentAuth() auth: RequestAuth, @Query(new ZodPipe(z.object({ branchId: z.string().uuid() }))) q: { branchId: string }) {
    return this.finance.openingFund(auth.access, q.branchId);
  }

  @RequirePermissions('finance.view')
  @Get('payables')
  payables(@CurrentAuth() auth: RequestAuth, @Query(new ZodPipe(payList)) q: z.infer<typeof payList>) {
    return this.finance.payables(auth.access, q);
  }

  @RequirePermissions('finance.view')
  @Get('payables/:supplierId')
  payable(@CurrentAuth() auth: RequestAuth, @Param('supplierId', ParseUUIDPipe) id: string) {
    return this.finance.payable(auth.access, id);
  }

  @RequirePermissions('finance.manage')
  @Post('payables/:supplierId/pay')
  pay(@CurrentAuth() auth: RequestAuth, @Param('supplierId', ParseUUIDPipe) id: string, @Body(new ZodPipe(paySchema)) dto: z.infer<typeof paySchema>, @Req() req: Request) {
    return this.finance.paySupplier(auth.access, id, dto, clientIp(req));
  }

  @RequirePermissions('finance.view')
  @Get('debts')
  debts(@CurrentAuth() auth: RequestAuth, @Query(new ZodPipe(debtList)) q: z.infer<typeof debtList>) {
    return this.finance.debts(auth.access, q);
  }

  @RequirePermissions('finance.view')
  @Get('debts/:customerId')
  debt(@CurrentAuth() auth: RequestAuth, @Param('customerId', ParseUUIDPipe) id: string) {
    return this.finance.customerDebt(auth.access, id);
  }

  @RequirePermissions('payment.collect')
  @Post('debts/:customerId/collect')
  collect(@CurrentAuth() auth: RequestAuth, @Param('customerId', ParseUUIDPipe) id: string, @Body(new ZodPipe(collectSchema)) dto: z.infer<typeof collectSchema>, @Req() req: Request) {
    return this.finance.collectDebt(auth.access, id, dto, clientIp(req));
  }
}

@Module({ controllers: [FinanceController], providers: [FinanceService] })
export class FinanceModule {}
