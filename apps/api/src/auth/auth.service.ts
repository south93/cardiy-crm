import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { checkPasswordPolicy, normalizeVnPhone } from '@cardiy/shared';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { AuditService } from '../audit/audit.service';
import type { AccessTokenPayload } from '../common/request-auth';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AccessService } from './access.service';

/** Băm giả để so sánh khi không tìm thấy tài khoản: tránh lộ số điện thoại nào có tồn tại qua thời gian phản hồi. */
const DUMMY_HASH = bcrypt.hashSync('khong-ton-tai-0000', 10);

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  limited: boolean;
  mustChangePassword: boolean;
  mustSetup2fa: boolean;
}

export type LoginResult = { status: 'ok'; tokens: IssuedTokens } | { status: '2fa_required'; challengeToken: string };

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {
    authenticator.options = { window: 1 };
  }

  hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.config.get('BCRYPT_ROUNDS'));
  }

  // ---------------- Đăng nhập ----------------

  async login(phoneInput: string, password: string, client: ClientInfo): Promise<LoginResult> {
    const phone = normalizeVnPhone(phoneInput);
    const failKey = `login:fail:${phone ?? phoneInput}`;
    await this.assertNotLocked(failKey);

    const user = phone ? await this.prisma.user.findUnique({ where: { phone } }) : null;
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      await this.registerFail(failKey);
      await this.audit.log({ actorId: user?.id, action: 'auth.login_failed', entity: 'user', entityId: user?.id, after: { phone: phone ?? phoneInput }, ip: client.ip });
      throw new UnauthorizedException('Số điện thoại hoặc mật khẩu không đúng');
    }
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('Tài khoản đã bị khoá. Liên hệ quản lý garage.');

    const membership = await this.pickMembership(user.id);
    await this.clearFails(failKey);

    if (user.totpEnabled) {
      const challengeToken = await this.jwt.signAsync({ sub: user.id, mid: membership.id, typ: '2fa' }, { expiresIn: '5m' });
      return { status: '2fa_required', challengeToken };
    }
    return { status: 'ok', tokens: await this.completeLogin(user.id, membership.id, client) };
  }

  async verifyTwoFactor(challengeToken: string, code: string, client: ClientInfo): Promise<IssuedTokens> {
    let payload: { sub: string; mid: string; typ: string };
    try {
      payload = await this.jwt.verifyAsync(challengeToken);
    } catch {
      throw new UnauthorizedException('Phiên xác thực đã hết hạn, vui lòng đăng nhập lại');
    }
    if (payload.typ !== '2fa') throw new UnauthorizedException('Token không hợp lệ');
    const failKey = `2fa:fail:${payload.sub}`;
    await this.assertNotLocked(failKey);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: payload.sub } });
    if (!user.totpSecret || !authenticator.check(code, user.totpSecret)) {
      await this.registerFail(failKey);
      throw new UnauthorizedException('Mã xác thực không đúng');
    }
    await this.clearFails(failKey);
    return this.completeLogin(user.id, payload.mid, client);
  }

  private async completeLogin(userId: string, membershipId: string, client: ClientInfo): Promise<IssuedTokens> {
    const tokens = await this.issueSession(userId, membershipId, client);
    const m = await this.prisma.membership.findUniqueOrThrow({ where: { id: membershipId } });
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ tenantId: m.tenantId, actorId: userId, action: 'auth.login', entity: 'user', entityId: userId, ip: client.ip });
    return tokens;
  }

  private async pickMembership(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    for (const m of memberships) {
      const a = await this.access.get(m.id);
      if (a?.active) return m;
    }
    throw new UnauthorizedException('Tài khoản chưa được gán vào garage nào đang hoạt động');
  }

  // ---------------- Phiên & token ----------------

  private async issueSession(userId: string, membershipId: string, client: ClientInfo): Promise<IssuedTokens> {
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + this.config.get('REFRESH_TOKEN_DAYS') * 86_400_000);
    await this.prisma.session.create({
      data: { userId, membershipId, tokenHash: sha256(refreshToken), expiresAt: refreshExpiresAt, ip: client.ip, userAgent: client.userAgent?.slice(0, 300) },
    });
    return { ...(await this.signAccess(userId, membershipId)), refreshToken, refreshExpiresAt };
  }

  private async signAccess(userId: string, membershipId: string) {
    const [user, access] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.access.get(membershipId),
    ]);
    if (!access?.active) throw new UnauthorizedException('Không còn quyền truy cập garage này');
    const mustChangePassword = user.mustChangePassword;
    const mustSetup2fa = this.config.get('AUTH_ENFORCE_2FA') && access.require2fa && !user.totpEnabled;
    const limited = mustChangePassword || mustSetup2fa;
    const payload: AccessTokenPayload = { sub: userId, mid: membershipId, tid: access.tenantId, typ: 'access', lim: limited };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: this.config.get('ACCESS_TOKEN_TTL') as JwtSignOptions['expiresIn'] });
    return { accessToken, limited, mustChangePassword, mustSetup2fa };
  }

  /** Làm mới: thu hồi refresh token cũ, cấp cặp mới (xoay vòng). Dùng lại token cũ → thu hồi mọi phiên của người dùng. */
  async refresh(refreshToken: string, client: ClientInfo): Promise<IssuedTokens> {
    const session = await this.prisma.session.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!session) throw new UnauthorizedException('Phiên đăng nhập không hợp lệ');
    if (session.revokedAt) {
      // Nhiều tab cùng làm mới một lúc: token vừa xoay vòng trong vài giây → vẫn cấp phiên mới.
      const graceMs = this.config.get('REFRESH_REUSE_GRACE_SECONDS') * 1000;
      const benign = !!session.rotatedAt && Date.now() - session.rotatedAt.getTime() <= graceMs;
      if (!benign) {
        await this.prisma.session.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date() } });
        this.logger.warn(`Phát hiện dùng lại refresh token của user ${session.userId}: đã thu hồi mọi phiên`);
        throw new UnauthorizedException('Phiên đăng nhập không hợp lệ, vui lòng đăng nhập lại');
      }
    }
    if (session.expiresAt < new Date()) throw new UnauthorizedException('Phiên đăng nhập đã hết hạn');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('Tài khoản đã bị khoá');
    if (!session.revokedAt) {
      const now = new Date();
      await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: now, rotatedAt: now } });
    }
    return this.issueSession(session.userId, session.membershipId, client);
  }

  async logout(refreshToken: string | undefined, actor?: { userId: string; tenantId: string }, ip?: string): Promise<void> {
    if (refreshToken) {
      await this.prisma.session.updateMany({ where: { tokenHash: sha256(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
    }
    if (actor) await this.audit.log({ tenantId: actor.tenantId, actorId: actor.userId, action: 'auth.logout', entity: 'user', entityId: actor.userId, ip });
  }

  /** Chuyển sang không gian làm việc khác (garage khác hoặc sàn) mà người dùng là thành viên. */
  async switchMembership(userId: string, membershipId: string, oldRefresh: string | undefined, client: ClientInfo): Promise<IssuedTokens> {
    const m = await this.prisma.membership.findFirst({ where: { id: membershipId, userId, status: 'ACTIVE' } });
    if (!m) throw new NotFoundException('Không tìm thấy không gian làm việc');
    if (oldRefresh) await this.logout(oldRefresh);
    return this.issueSession(userId, membershipId, client);
  }

  // ---------------- Mật khẩu & 2FA ----------------

  async changePassword(userId: string, tenantId: string, current: string, next: string, ip?: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(current, user.passwordHash))) throw new BadRequestException('Mật khẩu hiện tại không đúng');
    const policy = checkPasswordPolicy(next);
    if (policy) throw new BadRequestException(policy);
    if (current === next) throw new BadRequestException('Mật khẩu mới phải khác mật khẩu cũ');
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await this.hashPassword(next), mustChangePassword: false } });
    await this.audit.log({ tenantId, actorId: userId, action: 'auth.password_changed', entity: 'user', entityId: userId, ip });
  }

  async setupTwoFactor(userId: string): Promise<{ secret: string; otpauthUrl: string; qrDataUrl: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpEnabled) throw new BadRequestException('Xác thực 2 lớp đã được bật');
    const secret = authenticator.generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: secret } });
    const otpauthUrl = authenticator.keyuri(user.phone, 'Booking Cardiy', secret);
    return { secret, otpauthUrl, qrDataUrl: await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 }) };
  }

  async enableTwoFactor(userId: string, tenantId: string, code: string, ip?: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpSecret) throw new BadRequestException('Chưa khởi tạo xác thực 2 lớp');
    if (!authenticator.check(code, user.totpSecret)) throw new BadRequestException('Mã xác thực không đúng');
    await this.prisma.user.update({ where: { id: userId }, data: { totpEnabled: true } });
    await this.audit.log({ tenantId, actorId: userId, action: 'auth.2fa_enabled', entity: 'user', entityId: userId, ip });
  }

  /** Cấp lại access token sau khi người dùng hoàn tất đổi mật khẩu / bật 2FA. */
  reissueAccess(userId: string, membershipId: string) {
    return this.signAccess(userId, membershipId);
  }

  // ---------------- Chống dò mật khẩu ----------------

  async assertNotLocked(key: string): Promise<void> {
    try {
      const fails = Number((await this.redis.client.get(key)) ?? 0);
      if (fails >= this.config.get('LOGIN_MAX_FAILS')) {
        throw new HttpException(
          `Nhập sai quá nhiều lần. Vui lòng thử lại sau ${this.config.get('LOGIN_LOCK_MINUTES')} phút.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.logger.warn(`Không kiểm tra được giới hạn đăng nhập: ${(e as Error).message}`);
    }
  }

  async registerFail(key: string): Promise<void> {
    try {
      const n = await this.redis.client.incr(key);
      if (n === 1) await this.redis.client.expire(key, this.config.get('LOGIN_LOCK_MINUTES') * 60);
    } catch {
      /* Redis lỗi: bỏ qua */
    }
  }

  async clearFails(key: string): Promise<void> {
    try {
      await this.redis.client.del(key);
    } catch {
      /* bỏ qua */
    }
  }
}
