import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Param, ParseUUIDPipe, Put, Query, Req } from '@nestjs/common';
import { moneyToWords } from '@cardiy/shared';
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import * as QRCode from 'qrcode';
import { z } from 'zod';
import type { Access } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from './orders.service';
import { BANKS, vietQrPayload } from './vietqr';

const text = (max: number) => z.string().trim().max(max).optional().default('');

export const printSettingsSchema = z
  .object({
    displayName: text(120),
    hotline: text(30),
    email: text(120),
    website: text(120),
    bankBin: z.string().trim().regex(/^(\d{6})?$/, 'Mã BIN gồm 6 chữ số').optional().default(''),
    accountNo: z.string().trim().regex(/^([0-9A-Za-z]{4,19})?$/, 'Số tài khoản chỉ gồm chữ và số').optional().default(''),
    accountName: text(80),
    quoteValidDays: z.coerce.number().int().min(1).max(90).default(7),
    receiveTerms: text(1500),
    quoteNote: text(1500),
    invoiceNote: text(1500),
  })
  .refine((v) => !v.accountNo || (v.bankBin && v.bankBin !== '000000'), { message: 'Chọn ngân hàng (hoặc nhập mã BIN) cho số tài khoản', path: ['bankBin'] });
export type PrintSettings = z.infer<typeof printSettingsSchema>;

/** Mẫu mặc định khi garage chưa cài đặt (sửa được trong Cài đặt → Mẫu in & thanh toán) */
export const DEFAULT_PRINT: PrintSettings = {
  displayName: '',
  hotline: '',
  email: '',
  website: '',
  bankBin: '',
  accountNo: '',
  accountName: '',
  quoteValidDays: 7,
  receiveTerms:
    'Khách hàng kiểm tra và mang theo tài sản cá nhân có giá trị trước khi giao xe. Garage không chịu trách nhiệm với tài sản không được ghi nhận trong phiếu này.\nPhát sinh ngoài hạng mục đã thống nhất sẽ được báo khách trước khi làm.',
  quoteNote: 'Giá đã bao gồm công thợ (nếu có). Báo giá có thể thay đổi khi tháo kiểm tra phát sinh hư hỏng khác; garage sẽ báo khách trước khi làm.',
  invoiceNote: 'Bảo hành theo chính sách của hãng đối với phụ tùng; công sửa chữa bảo hành 3 tháng hoặc 5.000 km tuỳ điều kiện nào đến trước. Vui lòng giữ phiếu này khi bảo hành.',
};

export type PrintForm = 'tiep-nhan' | 'bao-gia' | 'hoa-don';

@Injectable()
export class PrintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
  ) {}

  async settings(tenantId: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, taxCode: true, printSettings: true } });
    const saved = (t.printSettings ?? {}) as Partial<PrintSettings>;
    return { tenantName: t.name, tenantTaxCode: t.taxCode, ...DEFAULT_PRINT, ...saved, banks: BANKS };
  }

  async save(a: Access, dto: PrintSettings, ip?: string) {
    await this.prisma.tenant.update({ where: { id: a.tenantId }, data: { printSettings: dto as unknown as Prisma.InputJsonValue } });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'settings.print', entity: 'tenant', entityId: a.tenantId, after: { ...dto, accountNo: dto.accountNo ? `…${dto.accountNo.slice(-4)}` : '' }, ip });
    return this.settings(a.tenantId);
  }

  async data(a: Access, id: string, form: PrintForm) {
    const order = await this.orders.get(a, id);
    if (form !== 'tiep-nhan' && order.total === null) throw new ForbiddenException('Bạn không xem được giá của đơn này');
    const s = await this.settings(a.tenantId);
    const total = order.total ?? 0;
    const due = order.due ?? 0;
    let qr: { dataUrl: string; amount: number; bankName: string; accountNo: string; accountName: string; note: string } | null = null;
    if (form === 'hoa-don' && due > 0 && s.bankBin && s.accountNo) {
      const note = `${order.code} ${order.vehicle?.plate.replace(/[^A-Z0-9]/gi, '') ?? ''}`.trim();
      const payload = vietQrPayload({ bin: s.bankBin, accountNo: s.accountNo, amount: due, note });
      qr = {
        dataUrl: await QRCode.toDataURL(payload, { margin: 1, width: 240, errorCorrectionLevel: 'M' }),
        amount: due,
        bankName: BANKS.find((b) => b.bin === s.bankBin)?.name ?? s.bankBin,
        accountNo: s.accountNo,
        accountName: s.accountName,
        note,
      };
    }
    const { banks: _b, ...settings } = s;
    return { form, order, settings, totalInWords: form === 'tiep-nhan' ? null : moneyToWords(total), dueInWords: form === 'hoa-don' && due > 0 ? moneyToWords(due) : null, qr, printedAt: new Date() };
  }
}

@Controller()
export class PrintController {
  constructor(private readonly print: PrintService) {}

  /** Ai in được phiếu thì đọc được thông tin in */
  @RequirePermissions('ro.view')
  @Get('print-settings')
  get(@CurrentAuth() auth: RequestAuth) {
    return this.print.settings(auth.tenantId);
  }

  @RequirePermissions('settings.manage')
  @Put('print-settings')
  save(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(printSettingsSchema)) dto: PrintSettings, @Req() req: Request) {
    return this.print.save(auth.access, dto, clientIp(req));
  }

  @RequirePermissions('ro.view')
  @Get('orders/:id/print')
  data(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Query('form') form: string) {
    if (!['tiep-nhan', 'bao-gia', 'hoa-don'].includes(form)) throw new BadRequestException('Mẫu phiếu không hợp lệ');
    return this.print.data(auth.access, id, form as PrintForm);
  }
}
