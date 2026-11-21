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
import { FilesService } from '../files/files.service';
import { OrdersService } from './orders.service';
import { BANKS, vietQrPayload } from './vietqr';

const text = (max: number) => z.string().trim().max(max).optional().default('');
/** Trường thêm sau: không gửi lên = giữ mẫu mặc định (gửi chuỗi rỗng = để trống) */
const keep = (max: number) => z.string().trim().max(max).optional();

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
    // Giao diện phiếu theo mẫu của garage
    logoFileId: z.string().uuid().optional().nullable(),
    slogan: keep(120),
    tagline: keep(160),
    banner: keep(200),
    qrLink: z.string().trim().max(300).regex(/^(https?:\/\/\S+)?$/, 'Link QR phải bắt đầu bằng http:// hoặc https://').optional(),
    qrCaption: keep(40),
    warrantyTire: keep(3000),
    warrantyUnderbody: keep(3000),
    signNote: keep(500),
    inspectionNote: keep(3000),
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
  logoFileId: null,
  slogan: 'CUNG CẤP GIẢI PHÁP Ô TÔ TOÀN DIỆN',
  tagline: 'Nâng Tầm Trải Nghiệm Lái – An Toàn Trọn Hành Trình',
  banner: 'GIẢI PHÁP TOÀN DIỆN VỀ Ô TÔ — NÂNG TẦM TRẢI NGHIỆM LÁI · AN TOÀN TRỌN HÀNH TRÌNH',
  qrLink: '',
  qrCaption: 'TRỢ LÝ Ô TÔ 24/7',
  // Theo mẫu phiếu dịch vụ của garage. **chữ đậm**, mỗi dòng một ý.
  warrantyTire:
    '## ĐIỀU KHOẢN BẢO HÀNH\n✓ **Phạm vi & thời hạn:**\n– **Lốp xe:** lỗi NSX (phù, dộp, ô-van) khi độ mòn gai chưa quá 30% — gai còn từ 70% trở lên (RTD ≥ 70%), hoặc trong 12 tháng; tuỳ điều kiện nào đến trước.\n– **Cân chỉnh thước lái:** 30 ngày. **Phụ tùng thay mới:** 06 tháng hoặc 6.000 km.\n– **Mâm sơn / xi:** lỗi lớp phủ do sản xuất.\n**Giá trị bảo hành tính trên phần giá trị còn lại của lốp (theo giám định NSX):**\n> (Độ sâu gai còn lại ÷ Độ sâu gai lốp mới) × Giá niêm yết lốp tại thời điểm kích hoạt bảo hành.\n**Thời gian xử lý:** 14 – 20 ngày kể từ ngày tiếp nhận và gửi giám định NSX.',
  warrantyUnderbody:
    '## ĐIỀU KHOẢN BẢO HÀNH & BÁO GIÁ\n✓ **Phạm vi & thời hạn:**\n– **Phụ tùng thay mới:** 06 tháng hoặc 6.000 km; tuỳ điều kiện nào đến trước.\n– **Công sửa chữa:** 30 ngày kể từ ngày giao xe.\nKhông bảo hành hư hỏng do tác động bên ngoài hoặc chi tiết hao mòn trong quá trình sử dụng.\n**Điều kiện báo giá:**\n– Phụ thu 25% giá trị tiền công đối với vật tư – phụ tùng quý khách mang đến.\n– **Phát sinh:** nếu có sẽ được thông báo và xác nhận với khách hàng sau khi kiểm tra cụ thể.',
  signNote: 'Phiếu chỉ có giá trị bảo hành khi có chữ ký và số điện thoại của khách hàng. Hàng đã mua và đã lắp đặt, quý khách vui lòng không đổi trả.',
  inspectionNote:
    'Thông tin cá nhân quý khách đăng ký trên phiếu kiểm tra này (họ tên, số điện thoại, biển số xe…) sẽ được nhập vào hệ thống quản lý khách hàng của cửa hàng và được bảo mật nghiêm ngặt. Nếu quý khách đồng ý, cửa hàng sẽ gửi tới số điện thoại đã đăng ký các thông tin nhắc lịch bảo dưỡng xe, ưu đãi hoặc khuyến mãi. Khi thông tin thay đổi, quý khách có thể gọi {hotline} để yêu cầu cập nhật. Quý khách vui lòng kiểm tra kỹ nội dung phiếu; nếu có góp ý hoặc khiếu nại xin ghi rõ vào phiếu; nếu đồng ý với nội dung phiếu, xin ký xác nhận ở cuối trang.',
};

export type PrintForm = 'kiem-tra' | 'bao-gia' | 'hoa-don';

@Injectable()
export class PrintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  async settings(tenantId: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, taxCode: true, printSettings: true } });
    const saved = (t.printSettings ?? {}) as Partial<PrintSettings>;
    return { tenantName: t.name, tenantTaxCode: t.taxCode, ...DEFAULT_PRINT, ...saved, banks: BANKS };
  }

  async save(a: Access, dto: PrintSettings, ip?: string) {
    if (dto.logoFileId) await this.files.assertOwnedImage(dto.logoFileId, a.tenantId);
    await this.prisma.tenant.update({ where: { id: a.tenantId }, data: { printSettings: dto as unknown as Prisma.InputJsonValue } });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'settings.print', entity: 'tenant', entityId: a.tenantId, after: { ...dto, accountNo: dto.accountNo ? `…${dto.accountNo.slice(-4)}` : '' }, ip });
    return this.settings(a.tenantId);
  }

  async data(a: Access, id: string, form: PrintForm) {
    const order = await this.orders.get(a, id);
    if (form !== 'kiem-tra' && order.total === null) throw new ForbiddenException('Bạn không xem được giá của đơn này');
    const s = await this.settings(a.tenantId);
    const total = order.total ?? 0;
    // Khách còn phải trả = phần của khách (tổng − bảo hiểm) − số khách đã trả (không tính tiền bảo hiểm chuyển)
    const customerPaid = order.payments.filter((p) => !p.voidedAt && p.method !== 'BAO_HIEM').reduce((x, p) => x + p.amount, 0);
    const due = Math.max(0, Math.min(order.due ?? 0, (order.customerPays ?? total) - customerPaid));
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
    const logoUrl = s.logoFileId ? await this.files.signedUrl(s.logoFileId).catch(() => null) : null;
    const linkQr = s.qrLink ? await QRCode.toDataURL(s.qrLink, { margin: 0, width: 200, errorCorrectionLevel: 'M' }) : null;
    const bank = BANKS.find((b) => b.bin === s.bankBin);
    const taxBank = [s.tenantTaxCode, s.accountNo ? `${bank?.code ?? ''} ${s.accountNo}`.trim() : null].filter(Boolean).join(' · ');
    const customerPays = order.customerPays ?? total;
    return {
      form,
      order,
      settings: { ...settings, inspectionNote: (settings.inspectionNote ?? '').replace('{hotline}', settings.hotline || '______________') },
      logoUrl,
      linkQr,
      taxBank,
      totalInWords: form === 'kiem-tra' ? null : moneyToWords(customerPays),
      dueInWords: form === 'hoa-don' && due > 0 ? moneyToWords(due) : null,
      qr,
      // Tách phần khách và phần bảo hiểm trên hoá đơn
      customerPaid,
      customerDue: due,
      insuranceDue: Math.max(0, (order.due ?? 0) - due),
      printedAt: new Date(),
    };
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
    // 'tiep-nhan' (tên cũ) = phiếu kiểm tra xe
    const f = form === 'tiep-nhan' ? 'kiem-tra' : form;
    if (!['kiem-tra', 'bao-gia', 'hoa-don'].includes(f)) throw new BadRequestException('Mẫu phiếu không hợp lệ');
    return this.print.data(auth.access, id, f as PrintForm);
  }
}
