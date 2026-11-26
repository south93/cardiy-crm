import type { Request } from 'express';
import type { Access } from '../auth/access.service';

export interface AccessTokenPayload {
  sub: string; // userId
  mid: string; // membershipId
  tid: string; // tenantId
  typ: 'access';
  /** Tài khoản đang bị giới hạn: phải đổi mật khẩu hoặc bật 2FA trước */
  lim: boolean;
}

export interface RequestAuth {
  userId: string;
  membershipId: string;
  tenantId: string;
  limited: boolean;
  access: Access;
}

export type AuthedRequest = Request & { auth?: RequestAuth };

/** IP người gọi. Dựa vào cấu hình "trust proxy" nên không bị giả mạo bằng header tự đặt. */
export function clientIp(req: Request): string | undefined {
  return req.ip ?? req.socket.remoteAddress ?? undefined;
}
