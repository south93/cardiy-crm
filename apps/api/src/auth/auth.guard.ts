import { ForbiddenException, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { PermissionCode } from '@cardiy/shared';
import { ALLOW_LIMITED, IS_PUBLIC, REQUIRED_PERMISSIONS } from '../common/auth.decorators';
import type { AccessTokenPayload, AuthedRequest } from '../common/request-auth';
import { AccessService } from './access.service';

/**
 * Guard toàn cục:
 * 1. Mọi API cần đăng nhập, trừ @Public().
 * 2. Tài khoản bị giới hạn chỉ gọi được API gắn @AllowLimited().
 * 3. Kiểm tra @RequirePermissions().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly accessService: AccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Chưa đăng nhập');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(header.slice(7));
    } catch {
      throw new UnauthorizedException('Phiên đăng nhập đã hết hạn');
    }
    if (payload.typ !== 'access') throw new UnauthorizedException('Token không hợp lệ');

    const access = await this.accessService.get(payload.mid);
    if (!access || !access.active || access.userId !== payload.sub) {
      throw new UnauthorizedException('Tài khoản đã bị khoá hoặc không còn quyền truy cập');
    }

    if (payload.lim && !this.reflector.getAllAndOverride<boolean>(ALLOW_LIMITED, targets)) {
      throw new ForbiddenException({ code: 'ACCOUNT_SETUP_REQUIRED', message: 'Cần đổi mật khẩu hoặc bật xác thực 2 lớp trước' });
    }

    req.auth = { userId: payload.sub, membershipId: payload.mid, tenantId: payload.tid, limited: payload.lim, access };

    const required = this.reflector.getAllAndOverride<PermissionCode[]>(REQUIRED_PERMISSIONS, targets) ?? [];
    if (required.length && !AccessService.has(access, ...required)) {
      throw new ForbiddenException('Bạn không có quyền thực hiện thao tác này');
    }
    return true;
  }
}
