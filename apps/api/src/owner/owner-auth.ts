import { createHash, randomBytes, randomInt } from 'node:crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  GoneException,
  HttpCode,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { checkPasswordPolicy, normalizeVnPhone } from '@cardiy/shared';
import * as bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import * as QRCode from 'qrcode';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthService, type ClientInfo } from '../auth/auth.service';
import { CurrentAuth, Public, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ZaloService } from '../zalo/zalo';

export type OtpPurpose = 'REGISTER' | 'RESET';

export const OWNER_COOKIE = 'cardiy_ort';
const INVITE_DAYS = 30;
const DUMMY_HASH = bcrypt.hashSync('khong-ton-tai-chu-xe', 10);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** 0912345678 → 0912***678 */
export const maskPhone = (p: string | null) => (p && p.length >= 7 ? `${p.slice(0, 4)}***${p.slice(-3)}` : (p ?? ''));

export interface OwnerTokenPayload {
  sub: string;
  typ: 'owner';
}
export type OwnerRequest = Request & { owner?: { userId: string } };

/** Guard cho API app chủ xe: chỉ nhận token loại "owner" (token nhân viên không dùng được ở đây và ngược lại). */
@Injectable()
export class OwnerGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<OwnerRequest>();
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw new UnauthorizedException('Chưa đăng nhập');
    let p: OwnerTokenPayload;
    try {
      p = await this.jwt.verifyAsync<OwnerTokenPayload>(h.slice(7));
    } catch {
      throw new UnauthorizedException('Phiên đăng nhập đã hết hạn');
    }
    if (p.typ !== 'owner') throw new UnauthorizedException('Token không hợp lệ');
    const u = await this.prisma.user.findUnique({ where: { id: p.sub }, select: { status: true } });
    if (!u || u.status !== 'ACTIVE') throw new UnauthorizedException('Tài khoản đã bị khoá');
    req.owner = { userId: p.sub };
    return true;
  }
}

@Injectable()
export class OwnerAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    private readonly zalo: ZaloService,
  ) {}

  private appUrl() {
    return `${this.config.get('CORS_ORIGINS').split(',')[0]!.trim().replace(/\/$/, '')}/app`;
  }

  // ---------------- Phía garage (CRM) ----------------

  async status(tenantId: string, customerId: string) {
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId, deletedAt: null }, include: { appLink: { include: { user: { select: { lastLoginAt: true } } } } } });
    if (!c) throw new NotFoundException('Không tìm thấy khách hàng');
    const invite = await this.prisma.customerInvite.findFirst({ where: { customerId, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    return {
      canInvite: !!c.phone,
      linked: c.appLink ? { since: c.appLink.createdAt, lastLoginAt: c.appLink.user.lastLoginAt } : null,
      invite: invite ? { createdAt: invite.createdAt, expiresAt: invite.expiresAt } : null,
    };
  }

  /** Tạo lời mời mới (lời mời cũ chưa dùng bị thu hồi). Trả link + mã QR để gửi Zalo hoặc in cho khách quét. */
  async createInvite(a: { tenantId: string; userId: string }, customerId: string, ip?: string) {
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId: a.tenantId, deletedAt: null }, include: { appLink: true } });
    if (!c) throw new NotFoundException('Không tìm thấy khách hàng');
    if (!c.phone) throw new BadRequestException('Khách chưa có số điện thoại, không mời dùng app được');
    if (c.appLink) throw new ConflictException('Khách đã kích hoạt app');
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
    await this.prisma.$transaction(async (tx) => {
      await tx.customerInvite.updateMany({ where: { customerId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.customerInvite.create({ data: { tenantId: a.tenantId, customerId, tokenHash: sha256(token), expiresAt, createdBy: a.userId } });
      await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'customer.app_invite', entity: 'customer', entityId: customerId, ip }, tx);
    });
    const url = `${this.appUrl()}/kich-hoat/${token}`;
    return { url, expiresAt, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 280, errorCorrectionLevel: 'M' }) };
  }

  /** Garage gỡ liên kết (VD: gửi nhầm người). Chủ xe mất quyền xem xe của hồ sơ này. */
  async unlink(a: { tenantId: string; userId: string }, customerId: string, ip?: string) {
    const link = await this.prisma.customerLink.findFirst({ where: { customerId, tenantId: a.tenantId } });
    if (!link) throw new NotFoundException('Khách chưa kích hoạt app');
    await this.prisma.customerLink.delete({ where: { id: link.id } });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'customer.app_unlink', entity: 'customer', entityId: customerId, before: { userId: link.userId }, ip });
    return { status: 'ok' };
  }

  // ---------------- Phía chủ xe ----------------

  private async validInvite(token: string) {
    const inv = await this.prisma.customerInvite.findUnique({ where: { tokenHash: sha256(token) }, include: { customer: { include: { appLink: true } } } });
    if (!inv || inv.revokedAt || inv.customer.deletedAt) throw new NotFoundException('Link mời không hợp lệ. Vui lòng xin garage gửi lại.');
    if (inv.usedAt || inv.customer.appLink) throw new GoneException('Link này đã được dùng. Bạn đăng nhập bằng số điện thoại và mật khẩu.');
    if (inv.expiresAt < new Date()) throw new GoneException('Link mời đã hết hạn. Vui lòng xin garage gửi lại.');
    if (!inv.customer.phone) throw new BadRequestException('Hồ sơ chưa có số điện thoại');
    return inv;
  }

  async preview(token: string) {
    const inv = await this.validInvite(token);
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: inv.tenantId } });
    const display = (t.printSettings as { displayName?: string } | null)?.displayName || t.name;
    const user = await this.prisma.user.findUnique({ where: { phone: inv.customer.phone! }, select: { id: true } });
    return { garage: display, customerName: inv.customer.name, phone: maskPhone(inv.customer.phone), hasAccount: !!user };
  }

  /** Kích hoạt: số điện thoại đã có tài khoản thì phải nhập đúng mật khẩu đó; chưa có thì tạo tài khoản với mật khẩu khách đặt. */
  async activate(token: string, password: string, client: ClientInfo) {
    const inv = await this.validInvite(token);
    const phone = inv.customer.phone!;
    const failKey = `owner:activate:fail:${inv.id}`;
    await this.auth.assertNotLocked(failKey);
    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (existing) {
      if (!(await bcrypt.compare(password, existing.passwordHash))) {
        await this.auth.registerFail(failKey);
        throw new UnauthorizedException('Số điện thoại này đã có tài khoản. Mật khẩu không đúng.');
      }
      if (existing.status !== 'ACTIVE') throw new UnauthorizedException('Tài khoản đã bị khoá');
    } else {
      const policy = checkPasswordPolicy(password);
      if (policy) throw new BadRequestException(policy);
    }
    const passwordHash = existing ? null : await this.auth.hashPassword(password);
    const userId = await this.prisma.$transaction(async (tx) => {
      // Khoá lời mời: hai lần bấm cùng lúc chỉ một lần thành công
      const used = await tx.customerInvite.updateMany({ where: { id: inv.id, usedAt: null }, data: { usedAt: new Date() } });
      if (!used.count) throw new GoneException('Link này đã được dùng');
      const u = existing ?? (await tx.user.create({ data: { phone, fullName: inv.customer.name, passwordHash: passwordHash! } }));
      await tx.customerLink.create({ data: { userId: u.id, tenantId: inv.tenantId, customerId: inv.customerId } });
      await this.audit.log({ tenantId: inv.tenantId, actorId: u.id, action: 'owner.activated', entity: 'customer', entityId: inv.customerId, ip: client.ip }, tx);
      return u.id;
    });
    await this.auth.clearFails(failKey);
    return this.issue(userId, client);
  }

  async login(phoneInput: string, password: string, client: ClientInfo) {
    const phone = normalizeVnPhone(phoneInput);
    const failKey = `owner:login:fail:${phone ?? phoneInput}`;
    await this.auth.assertNotLocked(failKey);
    const user = phone ? await this.prisma.user.findUnique({ where: { phone }, include: { _count: { select: { customerLinks: true } } } }) : null;
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      await this.auth.registerFail(failKey);
      throw new UnauthorizedException('Số điện thoại hoặc mật khẩu không đúng');
    }
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('Tài khoản đã bị khoá');
    if (!user._count.customerLinks) throw new UnauthorizedException('Số điện thoại chưa được garage mời dùng app. Hãy xin garage gửi link kích hoạt.');
    await this.auth.clearFails(failKey);
    return this.issue(user.id, client);
  }

  private async issue(userId: string, client: ClientInfo) {
    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.get('REFRESH_TOKEN_DAYS') * 86_400_000);
    await this.prisma.ownerSession.create({ data: { userId, tokenHash: sha256(refreshToken), expiresAt, ip: client.ip, userAgent: client.userAgent?.slice(0, 300) } });
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    const payload: OwnerTokenPayload = { sub: userId, typ: 'owner' };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: this.config.get('ACCESS_TOKEN_TTL') as JwtSignOptions['expiresIn'] });
    return { accessToken, refreshToken, expiresAt };
  }

  /** Xoay vòng refresh token như phiên nhân viên; dùng lại token cũ (ngoài vài giây) → thu hồi mọi phiên app của người đó. */
  async refresh(token: string, client: ClientInfo) {
    const s = await this.prisma.ownerSession.findUnique({ where: { tokenHash: sha256(token) } });
    if (!s) throw new UnauthorizedException('Phiên đăng nhập không hợp lệ');
    if (s.revokedAt) {
      const benign = !!s.rotatedAt && Date.now() - s.rotatedAt.getTime() <= this.config.get('REFRESH_REUSE_GRACE_SECONDS') * 1000;
      if (!benign) {
        await this.prisma.ownerSession.updateMany({ where: { userId: s.userId, revokedAt: null }, data: { revokedAt: new Date() } });
        throw new UnauthorizedException('Phiên đăng nhập không hợp lệ, vui lòng đăng nhập lại');
      }
    }
    if (s.expiresAt < new Date()) throw new UnauthorizedException('Phiên đăng nhập đã hết hạn');
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: s.userId } });
    if (u.status !== 'ACTIVE') throw new UnauthorizedException('Tài khoản đã bị khoá');
    if (!s.revokedAt) await this.prisma.ownerSession.update({ where: { id: s.id }, data: { revokedAt: new Date(), rotatedAt: new Date() } });
    return this.issue(s.userId, client);
  }

  // ---------------- OTP qua Zalo: tự đăng ký / quên mật khẩu ----------------

  private otpKey(purpose: OtpPurpose, phone: string) {
    return `otp:${purpose}:${phone}`;
  }

  /** Gửi mã OTP qua Zalo ZNS của garage khách đang có hồ sơ */
  async requestOtp(phoneInput: string, purpose: OtpPurpose) {
    const phone = normalizeVnPhone(phoneInput);
    if (!phone) throw new BadRequestException('Số điện thoại không hợp lệ');
    const user = await this.prisma.user.findUnique({ where: { phone }, include: { customerLinks: { select: { tenantId: true } }, memberships: { where: { status: 'ACTIVE' }, select: { id: true } } } });
    let tenantIds: string[];
    if (purpose === 'REGISTER') {
      if (user?.customerLinks.length) throw new ConflictException('Số này đã có tài khoản app. Đăng nhập hoặc chọn "Quên mật khẩu".');
      if (user?.memberships.length) throw new ConflictException('Số này là tài khoản nhân viên. Xin garage gửi link mời để liên kết xe.');
      tenantIds = [...new Set((await this.prisma.customer.findMany({ where: { phone, deletedAt: null, appLink: null }, select: { tenantId: true } })).map((c) => c.tenantId))];
      if (!tenantIds.length) throw new NotFoundException('Số điện thoại chưa có hồ sơ khách tại garage. Vui lòng liên hệ garage.');
    } else {
      if (!user?.customerLinks.length) throw new NotFoundException('Không tìm thấy tài khoản app với số này');
      if (user.memberships.length) throw new ConflictException('Tài khoản nhân viên: liên hệ quản lý garage để đặt lại mật khẩu.');
      tenantIds = [...new Set(user.customerLinks.map((l) => l.tenantId))];
    }
    // Garage nào bật mẫu OTP thì gửi qua OA của garage đó
    let tenantId: string | null = null;
    for (const t of tenantIds) {
      const st = await this.zalo.settings(t);
      if (st.enabled && st.templates.OTP?.enabled && st.templates.OTP.templateId) {
        tenantId = t;
        break;
      }
    }
    if (!tenantId) throw new ServiceUnavailableException('Garage chưa bật gửi mã qua Zalo. Vui lòng xin garage gửi link kích hoạt.');

    const r = this.redis.client;
    if (!(await r.set(`otp:cool:${phone}`, '1', 'EX', 60, 'NX'))) throw new HttpException('Vừa gửi mã, vui lòng đợi 60 giây rồi thử lại', HttpStatus.TOO_MANY_REQUESTS);
    const day = await r.incr(`otp:day:${phone}`);
    if (day === 1) await r.expire(`otp:day:${phone}`, 86_400);
    if (day > 5) throw new HttpException('Đã gửi quá 5 mã trong ngày. Vui lòng thử lại ngày mai.', HttpStatus.TOO_MANY_REQUESTS);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await r.set(this.otpKey(purpose, phone), sha256(code), 'EX', 300);
    await r.del(`otp:try:${purpose}:${phone}`);
    try {
      await this.zalo.send(tenantId, 'OTP', phone, { otp: code, garage_name: await this.zalo.garage(tenantId) }, { strict: true });
    } catch (e) {
      await r.del(this.otpKey(purpose, phone), `otp:cool:${phone}`);
      throw e;
    }
    return { sent: true, expiresIn: 300, garage: await this.zalo.garage(tenantId) };
  }

  /** Xác nhận OTP + đặt mật khẩu: đăng ký (tạo tài khoản, liên kết mọi hồ sơ khách cùng SĐT) hoặc đặt lại mật khẩu */
  async verifyOtp(phoneInput: string, purpose: OtpPurpose, code: string, password: string, client: ClientInfo) {
    const phone = normalizeVnPhone(phoneInput);
    if (!phone) throw new BadRequestException('Số điện thoại không hợp lệ');
    const r = this.redis.client;
    const key = this.otpKey(purpose, phone);
    const tries = await r.incr(`otp:try:${purpose}:${phone}`);
    if (tries === 1) await r.expire(`otp:try:${purpose}:${phone}`, 300);
    const saved = await r.get(key);
    if (!saved) throw new BadRequestException('Mã đã hết hạn, vui lòng gửi mã mới');
    if (tries > 5) {
      await r.del(key);
      throw new HttpException('Nhập sai quá nhiều lần, vui lòng gửi mã mới', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (saved !== sha256(code.trim())) throw new BadRequestException('Mã xác nhận không đúng');
    const policy = checkPasswordPolicy(password);
    if (policy) throw new BadRequestException(policy);
    const hash = await this.auth.hashPassword(password);

    const userId = await this.prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { phone }, include: { memberships: { where: { status: 'ACTIVE' } } } });
      if (user?.memberships.length) throw new ConflictException('Tài khoản nhân viên: không đặt mật khẩu qua app chủ xe');
      if (purpose === 'RESET') {
        if (!user) throw new NotFoundException('Không tìm thấy tài khoản');
        await tx.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
        await tx.ownerSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      } else {
        const customers = await tx.customer.findMany({ where: { phone, deletedAt: null, appLink: null }, orderBy: { createdAt: 'asc' } });
        if (!customers.length && !user) throw new NotFoundException('Số điện thoại chưa có hồ sơ khách tại garage');
        user = user ? await tx.user.update({ where: { id: user.id }, data: { passwordHash: hash }, include: { memberships: true } }) : await tx.user.create({ data: { phone, fullName: customers[0]!.name, passwordHash: hash }, include: { memberships: true } });
        for (const c of customers) await tx.customerLink.create({ data: { userId: user.id, tenantId: c.tenantId, customerId: c.id } });
      }
      await this.audit.log({ actorId: user!.id, action: purpose === 'REGISTER' ? 'owner.registered_otp' : 'owner.password_reset_otp', entity: 'user', entityId: user!.id, ip: client.ip }, tx);
      return user!.id;
    });
    await r.del(key, `otp:try:${purpose}:${phone}`);
    return this.issue(userId, client);
  }

  async logout(token?: string) {
    if (token) await this.prisma.ownerSession.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }
}

const tokenParam = z.string().min(20).max(100);
const otpRequest = z.object({ phone: z.string().min(9).max(20), purpose: z.enum(['REGISTER', 'RESET']) });
const otpVerify = otpRequest.extend({ code: z.string().regex(/^\d{6}$/, 'Mã gồm 6 chữ số'), password: z.string().min(1).max(200) });
const activateSchema = z.object({ token: tokenParam, password: z.string().min(1).max(200) });
const loginSchema = z.object({ phone: z.string().min(9).max(20), password: z.string().min(1).max(200) });

@Controller('owner/auth')
export class OwnerAuthController {
  constructor(
    private readonly svc: OwnerAuthService,
    private readonly config: AppConfig,
  ) {}

  private client(req: Request): ClientInfo {
    return { ip: clientIp(req), userAgent: req.headers['user-agent'] };
  }
  private send(res: Response, t: { accessToken: string; refreshToken: string; expiresAt: Date }) {
    res.cookie(OWNER_COOKIE, t.refreshToken, { httpOnly: true, sameSite: 'lax', secure: this.config.isProduction, path: '/api/owner/auth', expires: t.expiresAt });
    return { status: 'ok' as const, accessToken: t.accessToken };
  }

  @Public()
  @Get('invite/:token')
  preview(@Param('token', new ZodPipe(tokenParam)) token: string) {
    return this.svc.preview(token);
  }

  @Public()
  @Post('activate')
  @HttpCode(200)
  async activate(@Body(new ZodPipe(activateSchema)) dto: z.infer<typeof activateSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.send(res, await this.svc.activate(dto.token, dto.password, this.client(req)));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(loginSchema)) dto: z.infer<typeof loginSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.send(res, await this.svc.login(dto.phone, dto.password, this.client(req)));
  }

  @Public()
  @Post('otp/request')
  @HttpCode(200)
  requestOtp(@Body(new ZodPipe(otpRequest)) dto: z.infer<typeof otpRequest>) {
    return this.svc.requestOtp(dto.phone, dto.purpose);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(@Body(new ZodPipe(otpVerify)) dto: z.infer<typeof otpVerify>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.send(res, await this.svc.verifyOtp(dto.phone, dto.purpose, dto.code, dto.password, this.client(req)));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[OWNER_COOKIE] as string | undefined;
    if (!token) throw new UnauthorizedException('Chưa đăng nhập');
    try {
      return this.send(res, await this.svc.refresh(token, this.client(req)));
    } catch (e) {
      res.clearCookie(OWNER_COOKIE, { path: '/api/owner/auth' });
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.svc.logout(req.cookies?.[OWNER_COOKIE] as string | undefined);
    res.clearCookie(OWNER_COOKIE, { path: '/api/owner/auth' });
    return { status: 'ok' };
  }
}

/** Phía CRM: mời khách dùng app, xem trạng thái, gỡ liên kết */
@Controller('customers')
export class CustomerAppController {
  constructor(private readonly svc: OwnerAuthService) {}

  @RequirePermissions('customer.view')
  @Get(':id/app')
  status(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.status(auth.tenantId, id);
  }

  @RequirePermissions('customer.manage')
  @Post(':id/app/invite')
  invite(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.createInvite(auth, id, clientIp(req));
  }

  @RequirePermissions('customer.manage')
  @Post(':id/app/unlink')
  @HttpCode(200)
  unlink(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.unlink(auth, id, clientIp(req));
  }
}
