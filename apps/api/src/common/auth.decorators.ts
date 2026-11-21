import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { PermissionCode } from '@cardiy/shared';
import type { AuthedRequest, RequestAuth } from './request-auth';

export const IS_PUBLIC = 'cardiy:public';
export const ALLOW_LIMITED = 'cardiy:allowLimited';
export const REQUIRED_PERMISSIONS = 'cardiy:permissions';

/** Không cần đăng nhập. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Cho phép cả khi tài khoản đang bị giới hạn (chưa đổi mật khẩu / chưa bật 2FA). */
export const AllowLimited = () => SetMetadata(ALLOW_LIMITED, true);

/** Cần có TẤT CẢ các quyền liệt kê. */
export const RequirePermissions = (...codes: PermissionCode[]) => SetMetadata(REQUIRED_PERMISSIONS, codes);

/** Thông tin người đang gọi API. */
export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestAuth => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return req.auth!;
});
