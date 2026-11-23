import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  GoneException,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
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

  async logout(token?: string) {
    if (token) await this.prisma.ownerSession.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }
}

const tokenParam = z.string().min(20).max(100);
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
