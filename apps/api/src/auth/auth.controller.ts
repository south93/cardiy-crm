import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AllowLimited, CurrentAuth, Public } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { AppConfig } from '../config/app-config';
import { AuthService, type IssuedTokens } from './auth.service';

export const REFRESH_COOKIE = 'cardiy_rt';

const loginSchema = z.object({ phone: z.string().min(9).max(20), password: z.string().min(1).max(200) });
const twoFactorSchema = z.object({ challengeToken: z.string().min(10), code: z.string().regex(/^\d{6}$/, 'Mã gồm 6 chữ số') });
const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1).max(200) });
const enable2faSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Mã gồm 6 chữ số') });
const switchSchema = z.object({ membershipId: z.string().uuid() });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  private client(req: Request) {
    return { ip: clientIp(req), userAgent: req.headers['user-agent'] };
  }

  private setRefreshCookie(res: Response, t: IssuedTokens) {
    res.cookie(REFRESH_COOKIE, t.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.isProduction,
      path: '/api/auth',
      expires: t.refreshExpiresAt,
    });
  }

  private body(t: IssuedTokens) {
    return {
      status: 'ok' as const,
      accessToken: t.accessToken,
      limited: t.limited,
      mustChangePassword: t.mustChangePassword,
      mustSetup2fa: t.mustSetup2fa,
    };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(loginSchema)) dto: z.infer<typeof loginSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto.phone, dto.password, this.client(req));
    if (result.status === '2fa_required') return result;
    this.setRefreshCookie(res, result.tokens);
    return this.body(result.tokens);
  }

  @Public()
  @Post('2fa/verify')
  @HttpCode(200)
  async verify2fa(@Body(new ZodPipe(twoFactorSchema)) dto: z.infer<typeof twoFactorSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.verifyTwoFactor(dto.challengeToken, dto.code, this.client(req));
    this.setRefreshCookie(res, tokens);
    return this.body(tokens);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!token) {
      res.status(401);
      return { message: 'Chưa đăng nhập' };
    }
    try {
      const tokens = await this.auth.refresh(token, this.client(req));
      this.setRefreshCookie(res, tokens);
      return this.body(tokens);
    } catch (e) {
      res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE] as string | undefined, undefined, clientIp(req));
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return { status: 'ok' };
  }

  @AllowLimited()
  @Post('switch')
  @HttpCode(200)
  async switch(
    @CurrentAuth() auth: RequestAuth,
    @Body(new ZodPipe(switchSchema)) dto: z.infer<typeof switchSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.switchMembership(auth.userId, dto.membershipId, req.cookies?.[REFRESH_COOKIE] as string | undefined, this.client(req));
    this.setRefreshCookie(res, tokens);
    return this.body(tokens);
  }

  @AllowLimited()
  @Post('change-password')
  @HttpCode(200)
  async changePassword(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(changePasswordSchema)) dto: z.infer<typeof changePasswordSchema>, @Req() req: Request) {
    await this.auth.changePassword(auth.userId, auth.tenantId, dto.currentPassword, dto.newPassword, clientIp(req));
    return { status: 'ok' as const, ...(await this.auth.reissueAccess(auth.userId, auth.membershipId)) };
  }

  @AllowLimited()
  @Post('2fa/setup')
  @HttpCode(200)
  setup2fa(@CurrentAuth() auth: RequestAuth) {
    return this.auth.setupTwoFactor(auth.userId);
  }

  @AllowLimited()
  @Post('2fa/enable')
  @HttpCode(200)
  async enable2fa(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(enable2faSchema)) dto: z.infer<typeof enable2faSchema>, @Req() req: Request) {
    await this.auth.enableTwoFactor(auth.userId, auth.tenantId, dto.code, clientIp(req));
    return { status: 'ok' as const, ...(await this.auth.reissueAccess(auth.userId, auth.membershipId)) };
  }
}
