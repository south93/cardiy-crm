import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  ServiceUnavailableException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { normalizeVnPhone } from '@cardiy/shared';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { AccessService, type Access } from '../auth/access.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { CurrentAuth, Public, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { reserveNumbers } from '../crm/counters';
import { FilesService } from '../files/files.service';
import { generateTempPassword } from '../org/staff.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { canMove, canMovePartner, nextPeriod, overdueDays, vnDate } from './partner-rules';

type Tx = Prisma.TransactionClient;
const n = (b: bigint | number) => Number(b);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const appCode = (x: number) => `HS${String(x).padStart(6, '0')}`;
export const invoiceCode = (x: number) => `PHI${String(x).padStart(6, '0')}`;
const MAX_DOCS = 10;
const DOC_KINDS = ['GPKD', 'CCCD', 'ANH', 'KHAC'] as const;
export interface AppDoc {
  fileId: string;
  kind: (typeof DOC_KINDS)[number];
  name: string;
}

const optText = (max: number) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
export const applicationSchema = z.object({
  garageName: z.string().trim().min(2, 'Nhập tên garage').max(150),
  taxCode: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z
      .string()
      .trim()
      .regex(/^\d{10}(-\d{3})?$/, 'Mã số thuế gồm 10 số (hoặc 10 số-3 số)')
      .nullable()
      .optional(),
  ),
  address: z.string().trim().min(5, 'Nhập địa chỉ garage').max(300),
  province: optText(100),
  representative: z.string().trim().min(2, 'Nhập tên người đại diện').max(100),
  phone: z.string().trim().min(9, 'Nhập số điện thoại').max(20),
  email: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().email('Email không hợp lệ').max(150).nullable().optional()),
  planId: z.string().uuid().nullable().optional(),
  note: optText(1000),
});
export type ApplicationDto = z.infer<typeof applicationSchema>;

/** Sàn (tenant PLATFORM): nơi lưu file hồ sơ, bộ đếm mã HS / PHI */
export async function platformTenantId(prisma: PrismaService | Tx): Promise<string> {
  const t = await prisma.tenant.findFirst({ where: { type: 'PLATFORM', deletedAt: null }, orderBy: { createdAt: 'asc' } });
  if (!t) throw new ServiceUnavailableException('Sàn chưa được thiết lập');
  return t.id;
}

function assertPlatform(a: Access) {
  if (a.tenantType !== 'PLATFORM') throw new ForbiddenException('Chỉ dành cho nhân sự sàn');
}

@Injectable()
export class PartnerApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly redis: RedisService,
    private readonly auth: AuthService,
    private readonly access: AccessService,
  ) {}

  // ---------------- Công khai: người đăng ký ----------------

  async plans() {
    const rows = await this.prisma.plan.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { monthlyFee: 'asc' }] });
    return rows.map((p) => ({ id: p.id, code: p.code, name: p.name, monthlyFee: n(p.monthlyFee), billingMonths: p.billingMonths, description: p.description, features: p.features }));
  }

  private async limit(key: string, max: number, seconds: number, msg: string) {
    const r = this.redis.client;
    const c = await r.incr(key);
    if (c === 1) await r.expire(key, seconds);
    if (c > max) throw new HttpException(msg, HttpStatus.TOO_MANY_REQUESTS);
  }

  private async validPlan(planId: string | null | undefined) {
    if (!planId) return null;
    const p = await this.prisma.plan.findFirst({ where: { id: planId, active: true } });
    if (!p) throw new BadRequestException('Gói đã chọn không còn áp dụng');
    return p.id;
  }

  async submit(dto: ApplicationDto, ip?: string) {
    await this.limit(`partner-app:ip:${ip ?? 'na'}`, 5, 3600, 'Bạn gửi quá nhiều hồ sơ, vui lòng thử lại sau 1 giờ');
    const phone = normalizeVnPhone(dto.phone);
    if (!phone) throw new BadRequestException('Số điện thoại không hợp lệ');
    const planId = await this.validPlan(dto.planId);
    const open = await this.prisma.partnerApplication.findFirst({
      where: { status: { in: ['CHO_DUYET', 'CAN_BO_SUNG'] }, OR: [{ phone }, ...(dto.taxCode ? [{ taxCode: dto.taxCode }] : [])] },
    });
    if (open) throw new ConflictException(`Đã có hồ sơ ${open.code} đang xử lý với số điện thoại / mã số thuế này. Vui lòng dùng link theo dõi đã nhận.`);
    if (dto.taxCode && (await this.prisma.tenant.findUnique({ where: { taxCode: dto.taxCode } }))) throw new ConflictException('Mã số thuế này đã có trên hệ thống');
    const pid = await platformTenantId(this.prisma);
    const token = randomBytes(24).toString('base64url');
    const row = await this.prisma.$transaction(async (tx) => {
      const code = appCode(await reserveNumbers(tx, pid, 'partner_application'));
      return tx.partnerApplication.create({
        data: {
          code,
          garageName: dto.garageName,
          taxCode: dto.taxCode ?? null,
          address: dto.address,
          province: dto.province ?? null,
          representative: dto.representative,
          phone,
          email: dto.email ?? null,
          planId,
          note: dto.note ?? null,
          accessHash: sha256(token),
        },
      });
    });
    await this.audit.log({
      tenantId: pid,
      actorId: null,
      action: 'partner_application.submitted',
      entity: 'partner_application',
      entityId: row.id,
      after: { code: row.code, garageName: row.garageName, phone },
      ip,
    });
    return { code: row.code, token };
  }

  /** Hồ sơ theo mã + token trong link theo dõi */
  private async byToken(code: string, token: string | undefined) {
    const row = await this.prisma.partnerApplication.findUnique({ where: { code }, include: { plan: true } });
    const ok = row && token && timingSafeEqual(Buffer.from(sha256(token)), Buffer.from(row.accessHash));
    if (!ok) throw new NotFoundException('Không tìm thấy hồ sơ. Kiểm tra lại link theo dõi.');
    return row;
  }

  private publicView(row: Prisma.PartnerApplicationGetPayload<{ include: { plan: true } }>) {
    return {
      code: row.code,
      status: row.status,
      garageName: row.garageName,
      taxCode: row.taxCode,
      address: row.address,
      province: row.province,
      representative: row.representative,
      phone: row.phone,
      email: row.email,
      planId: row.planId,
      plan: row.plan ? { name: row.plan.name, monthlyFee: n(row.plan.monthlyFee), billingMonths: row.plan.billingMonths } : null,
      note: row.note,
      documents: (row.documents as unknown as AppDoc[]).map((d) => ({ fileId: d.fileId, kind: d.kind, name: d.name })),
      reviewNote: row.status === 'CAN_BO_SUNG' || row.status === 'TU_CHOI' ? row.reviewNote : null,
      createdAt: row.createdAt,
      reviewedAt: row.reviewedAt,
      editable: row.status === 'CHO_DUYET' || row.status === 'CAN_BO_SUNG',
    };
  }

  async view(code: string, token?: string) {
    return this.publicView(await this.byToken(code, token));
  }

  /** Người nộp sửa hồ sơ (khi đang chờ duyệt hoặc được yêu cầu bổ sung); bổ sung xong thì gửi lại chờ duyệt */
  async update(code: string, token: string | undefined, dto: ApplicationDto, ip?: string) {
    const row = await this.byToken(code, token);
    if (row.status !== 'CHO_DUYET' && row.status !== 'CAN_BO_SUNG') throw new ConflictException('Hồ sơ đã được xử lý, không sửa được');
    const phone = normalizeVnPhone(dto.phone);
    if (!phone) throw new BadRequestException('Số điện thoại không hợp lệ');
    const planId = await this.validPlan(dto.planId);
    const updated = await this.prisma.partnerApplication.update({
      where: { id: row.id },
      data: {
        garageName: dto.garageName,
        taxCode: dto.taxCode ?? null,
        address: dto.address,
        province: dto.province ?? null,
        representative: dto.representative,
        phone,
        email: dto.email ?? null,
        planId,
        note: dto.note ?? null,
        status: 'CHO_DUYET',
      },
      include: { plan: true },
    });
    await this.audit.log({
      tenantId: await platformTenantId(this.prisma),
      actorId: null,
      action: 'partner_application.updated',
      entity: 'partner_application',
      entityId: row.id,
      before: { status: row.status },
      after: { status: 'CHO_DUYET' },
      ip,
    });
    return this.publicView(updated);
  }

  async addDocument(code: string, token: string | undefined, kind: string, file: { buffer: Buffer; originalname: string; size: number }, ip?: string) {
    if (!DOC_KINDS.includes(kind as AppDoc['kind'])) throw new BadRequestException('Loại giấy tờ không hợp lệ');
    const row = await this.byToken(code, token);
    if (row.status !== 'CHO_DUYET' && row.status !== 'CAN_BO_SUNG') throw new ConflictException('Hồ sơ đã được xử lý, không thêm giấy tờ được');
    const docs = row.documents as unknown as AppDoc[];
    if (docs.length >= MAX_DOCS) throw new BadRequestException(`Tối đa ${MAX_DOCS} file mỗi hồ sơ`);
    await this.limit(`partner-app:upload:${row.id}`, 30, 86_400, 'Tải lên quá nhiều file trong ngày');
    // File lưu dưới tenant sàn, người tải = mã hồ sơ (chưa có tài khoản)
    const f = await this.files.upload(await platformTenantId(this.prisma), row.id, file, ip);
    const doc: AppDoc = { fileId: f.id, kind: kind as AppDoc['kind'], name: f.name };
    await this.prisma.partnerApplication.update({ where: { id: row.id }, data: { documents: [...docs, doc] as unknown as Prisma.InputJsonValue } });
    return { ...doc, url: f.url };
  }

  async removeDocument(code: string, token: string | undefined, fileId: string) {
    const row = await this.byToken(code, token);
    if (row.status !== 'CHO_DUYET' && row.status !== 'CAN_BO_SUNG') throw new ConflictException('Hồ sơ đã được xử lý');
    const docs = (row.documents as unknown as AppDoc[]).filter((d) => d.fileId !== fileId);
    await this.prisma.partnerApplication.update({ where: { id: row.id }, data: { documents: docs as unknown as Prisma.InputJsonValue } });
    return { status: 'ok' };
  }

  // ---------------- Sàn: duyệt hồ sơ ----------------

  async list(a: Access, q: { status?: string; q?: string }) {
    assertPlatform(a);
    const where: Prisma.PartnerApplicationWhereInput = {};
    if (q.status) where.status = q.status as Prisma.EnumApplicationStatusFilter['equals'];
    if (q.q?.trim()) {
      const s = q.q.trim();
      where.OR = [{ code: { contains: s, mode: 'insensitive' } }, { garageName: { contains: s, mode: 'insensitive' } }, { phone: { contains: s } }, { taxCode: { contains: s } }];
    }
    const [rows, counts] = await Promise.all([
      this.prisma.partnerApplication.findMany({ where, include: { plan: true }, orderBy: { createdAt: 'desc' }, take: 200 }),
      this.prisma.partnerApplication.groupBy({ by: ['status'], _count: true }),
    ]);
    return {
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
      items: rows.map((r) => ({
        id: r.id,
        code: r.code,
        status: r.status,
        garageName: r.garageName,
        phone: r.phone,
        province: r.province,
        plan: r.plan?.name ?? null,
        documents: (r.documents as unknown as AppDoc[]).length,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    };
  }

  async detail(a: Access, id: string) {
    assertPlatform(a);
    const r = await this.prisma.partnerApplication.findUnique({ where: { id }, include: { plan: true } });
    if (!r) throw new NotFoundException('Không tìm thấy hồ sơ');
    const docs = r.documents as unknown as AppDoc[];
    const files = await this.prisma.fileObject.findMany({ where: { id: { in: docs.map((d) => d.fileId) } } });
    const reviewer = r.reviewedBy ? await this.prisma.user.findUnique({ where: { id: r.reviewedBy }, select: { fullName: true } }) : null;
    return {
      id: r.id,
      ...this.publicView(r),
      reviewNote: r.reviewNote,
      reviewedBy: reviewer?.fullName ?? null,
      tenantId: r.tenantId,
      documents: await Promise.all(
        docs.map(async (d) => {
          const f = files.find((x) => x.id === d.fileId);
          return { ...d, mime: f?.mime ?? null, size: f?.size ?? 0, url: f ? await this.files.signedUrl(f.id) : null };
        }),
      ),
    };
  }

  private async move(a: Access, id: string, to: 'CAN_BO_SUNG' | 'TU_CHOI', note: string, ip?: string) {
    assertPlatform(a);
    const r = await this.prisma.partnerApplication.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Không tìm thấy hồ sơ');
    if (!canMove(r.status, to)) throw new ConflictException('Trạng thái hồ sơ không cho phép thao tác này');
    await this.prisma.partnerApplication.update({ where: { id }, data: { status: to, reviewNote: note, reviewedBy: a.userId, reviewedAt: new Date() } });
    await this.audit.log({
      tenantId: a.tenantId,
      actorId: a.userId,
      action: to === 'TU_CHOI' ? 'partner_application.rejected' : 'partner_application.info_requested',
      entity: 'partner_application',
      entityId: id,
      before: { status: r.status },
      after: { status: to, note },
      ip,
    });
    return { status: to };
  }
  requestInfo = (a: Access, id: string, note: string, ip?: string) => this.move(a, id, 'CAN_BO_SUNG', note, ip);
  reject = (a: Access, id: string, note: string, ip?: string) => this.move(a, id, 'TU_CHOI', note, ip);

  /**
   * Duyệt: tạo tenant đối tác (đang thiết lập), chi nhánh, tài khoản đối tác (mật khẩu tạm), gói và hoá đơn phí kỳ đầu.
   * Đối tác hoạt động khi kỳ phí đầu được ghi nhận đã thanh toán (hoặc sàn bật tay).
   */
  async approve(a: Access, id: string, dto: { planId: string; startDate?: string | null; note?: string | null }, ip?: string) {
    assertPlatform(a);
    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
    if (!plan) throw new BadRequestException('Chọn gói cho đối tác');
    const role = await this.prisma.role.findFirstOrThrow({ where: { tenantId: null, code: 'DT' } });
    const start = dto.startDate ? new Date(`${dto.startDate}T00:00:00Z`) : vnDate();
    const pid = a.tenantId;

    const r = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM partner_applications WHERE id = ${id}::uuid FOR UPDATE`;
      const app = await tx.partnerApplication.findUnique({ where: { id } });
      if (!app) throw new NotFoundException('Không tìm thấy hồ sơ');
      if (!canMove(app.status, 'DA_DUYET')) throw new ConflictException('Hồ sơ không ở trạng thái chờ duyệt');
      if (app.taxCode && (await tx.tenant.findUnique({ where: { taxCode: app.taxCode } }))) throw new ConflictException('Mã số thuế đã thuộc một garage / đối tác khác');

      const existing = await tx.user.findUnique({ where: { phone: app.phone } });
      const tempPassword = existing ? null : generateTempPassword();
      const user =
        existing ??
        (await tx.user.create({ data: { phone: app.phone, email: app.email, fullName: app.representative, passwordHash: await this.auth.hashPassword(tempPassword!), mustChangePassword: true } }));
      const tenant = await tx.tenant.create({ data: { type: 'PARTNER', name: app.garageName, taxCode: app.taxCode, status: 'DANG_THIET_LAP' } });
      await tx.branch.create({ data: { tenantId: tenant.id, code: 'CN1', name: app.garageName, address: app.address, phone: app.phone } });
      await tx.membership.create({ data: { userId: user.id, tenantId: tenant.id, title: 'Đối tác', roles: { create: [{ roleId: role.id, branchId: null }] } } });

      const period = nextPeriod(start, plan.billingMonths, n(plan.monthlyFee));
      const sub = await tx.subscription.create({
        data: { tenantId: tenant.id, planId: plan.id, monthlyFee: plan.monthlyFee, billingMonths: plan.billingMonths, startAt: start, paidThrough: period.periodTo },
      });
      const inv = await tx.platformInvoice.create({
        data: {
          code: invoiceCode(await reserveNumbers(tx, pid, 'platform_invoice')),
          tenantId: tenant.id,
          subscriptionId: sub.id,
          periodFrom: period.periodFrom,
          periodTo: period.periodTo,
          amount: BigInt(period.amount),
          dueDate: period.dueDate,
        },
      });
      await tx.partnerApplication.update({
        where: { id },
        data: { status: 'DA_DUYET', planId: plan.id, tenantId: tenant.id, reviewNote: dto.note?.trim() || null, reviewedBy: a.userId, reviewedAt: new Date() },
      });
      await this.audit.log(
        {
          tenantId: pid,
          actorId: a.userId,
          action: 'partner_application.approved',
          entity: 'partner_application',
          entityId: id,
          after: { tenantId: tenant.id, plan: plan.code, invoice: inv.code, amount: period.amount, existingAccount: !!existing },
          ip,
        },
        tx,
      );
      return { tenantId: tenant.id, phone: app.phone, tempPassword, existingAccount: !!existing, invoice: { code: inv.code, amount: period.amount, dueDate: period.dueDate } };
    });
    return r;
  }

  // ---------------- Sàn: danh sách đối tác ----------------

  async partners(a: Access, q: { status?: string; q?: string }) {
    assertPlatform(a);
    const where: Prisma.TenantWhereInput = { type: 'PARTNER', deletedAt: null };
    if (q.status) where.status = q.status as Prisma.EnumTenantStatusFilter['equals'];
    if (q.q?.trim()) where.name = { contains: q.q.trim(), mode: 'insensitive' };
    const tenants = await this.prisma.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: { memberships: { include: { user: { select: { phone: true, fullName: true } } }, take: 1 } },
    });
    const ids = tenants.map((t) => t.id);
    const [subs, invoices] = await Promise.all([
      this.prisma.subscription.findMany({ where: { tenantId: { in: ids }, endedAt: null }, include: { plan: true } }),
      this.prisma.platformInvoice.findMany({ where: { tenantId: { in: ids }, status: 'DA_PHAT_HANH' } }),
    ]);
    const today = vnDate();
    return tenants.map((t) => {
      const sub = subs.find((s) => s.tenantId === t.id);
      const unpaid = invoices.filter((i) => i.tenantId === t.id);
      return {
        id: t.id,
        name: t.name,
        taxCode: t.taxCode,
        status: t.status,
        createdAt: t.createdAt,
        account: t.memberships[0] ? { phone: t.memberships[0].user.phone, fullName: t.memberships[0].user.fullName } : null,
        plan: sub ? { name: sub.plan.name, monthlyFee: n(sub.monthlyFee), billingMonths: sub.billingMonths, paidThrough: sub.paidThrough } : null,
        unpaid: unpaid.reduce((s, i) => s + n(i.amount), 0),
        maxOverdueDays: Math.max(0, ...unpaid.map((i) => overdueDays(i, today))),
      };
    });
  }

  async setPartnerStatus(a: Access, tenantId: string, to: string, note: string | null | undefined, ip?: string) {
    assertPlatform(a);
    const t = await this.prisma.tenant.findFirst({ where: { id: tenantId, type: 'PARTNER' }, include: { memberships: { select: { id: true } } } });
    if (!t) throw new NotFoundException('Không tìm thấy đối tác');
    if (!canMovePartner(t.status, to)) throw new ConflictException('Không chuyển được sang trạng thái này');
    await this.prisma.$transaction(async (tx) => {
      await tx.tenant.update({ where: { id: t.id }, data: { status: to as 'HOAT_DONG' } });
      if (to === 'CHAM_DUT') await tx.subscription.updateMany({ where: { tenantId: t.id, endedAt: null }, data: { endedAt: new Date() } });
      await this.audit.log(
        { tenantId: a.tenantId, actorId: a.userId, action: 'partner.status_changed', entity: 'tenant', entityId: t.id, before: { status: t.status }, after: { status: to, note: note ?? null }, ip },
        tx,
      );
    });
    // Khoá / mở: quyền truy cập cache 60 giây, xoá để có hiệu lực ngay
    await this.access.invalidate(...t.memberships.map((m) => m.id));
    return { status: to };
  }
}

const noteSchema = z.object({ note: z.string().trim().min(3, 'Ghi rõ lý do / nội dung cần bổ sung').max(1000) });
const approveSchema = z.object({
  planId: z.string().uuid('Chọn gói'),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});
const statusSchema = z.object({ status: z.enum(['HOAT_DONG', 'TAM_KHOA', 'CHAM_DUT']), note: z.string().trim().max(500).nullable().optional() });
const UPLOAD_LIMIT = 25 * 1024 * 1024;

@Controller('public')
export class PublicPartnerController {
  constructor(private readonly apps: PartnerApplicationsService) {}

  @Public()
  @Get('plans')
  plans() {
    return this.apps.plans();
  }

  @Public()
  @Post('partner-applications')
  submit(@Body(new ZodPipe(applicationSchema)) dto: ApplicationDto, @Req() req: Request) {
    return this.apps.submit(dto, clientIp(req));
  }

  @Public()
  @Get('partner-applications/:code')
  view(@Param('code') code: string, @Query('t') t?: string) {
    return this.apps.view(code, t);
  }

  @Public()
  @Put('partner-applications/:code')
  update(@Param('code') code: string, @Query('t') t: string | undefined, @Body(new ZodPipe(applicationSchema)) dto: ApplicationDto, @Req() req: Request) {
    return this.apps.update(code, t, dto, clientIp(req));
  }

  @Public()
  @Post('partner-applications/:code/files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_LIMIT, files: 1 } }))
  upload(@Param('code') code: string, @Query('t') t: string | undefined, @Query('kind') kind: string, @UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    return this.apps.addDocument(code, t, kind, file, clientIp(req));
  }

  @Public()
  @Post('partner-applications/:code/files/:fileId/remove')
  @HttpCode(200)
  removeFile(@Param('code') code: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Query('t') t?: string) {
    return this.apps.removeDocument(code, t, fileId);
  }
}

@Controller('platform')
export class PlatformPartnersController {
  constructor(private readonly apps: PartnerApplicationsService) {}

  @RequirePermissions('platform.partner.review')
  @Get('applications')
  list(@CurrentAuth() auth: RequestAuth, @Query('status') status?: string, @Query('q') q?: string) {
    return this.apps.list(auth.access, { status, q });
  }

  @RequirePermissions('platform.partner.review')
  @Get('applications/:id')
  detail(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.apps.detail(auth.access, id);
  }

  @RequirePermissions('platform.partner.review')
  @Post('applications/:id/request-info')
  @HttpCode(200)
  requestInfo(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(noteSchema)) dto: { note: string }, @Req() req: Request) {
    return this.apps.requestInfo(auth.access, id, dto.note, clientIp(req));
  }

  @RequirePermissions('platform.partner.review')
  @Post('applications/:id/reject')
  @HttpCode(200)
  reject(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(noteSchema)) dto: { note: string }, @Req() req: Request) {
    return this.apps.reject(auth.access, id, dto.note, clientIp(req));
  }

  @RequirePermissions('platform.partner.review')
  @Post('applications/:id/approve')
  @HttpCode(200)
  approve(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(approveSchema)) dto: z.infer<typeof approveSchema>, @Req() req: Request) {
    return this.apps.approve(auth.access, id, dto, clientIp(req));
  }

  @RequirePermissions('platform.partner.review')
  @Get('partners')
  partners(@CurrentAuth() auth: RequestAuth, @Query('status') status?: string, @Query('q') q?: string) {
    return this.apps.partners(auth.access, { status, q });
  }

  @RequirePermissions('platform.partner.review')
  @Post('partners/:id/status')
  @HttpCode(200)
  setStatus(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(statusSchema)) dto: z.infer<typeof statusSchema>, @Req() req: Request) {
    return this.apps.setPartnerStatus(auth.access, id, dto.status, dto.note, clientIp(req));
  }
}
