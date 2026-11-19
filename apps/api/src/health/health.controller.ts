import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export type CheckState = 'up' | 'down';

export interface HealthReport {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
  checks: { database: CheckState; redis: CheckState };
}

/**
 * GET /api/health: dùng cho giám sát (Uptime Kuma, Coolify) và cho web hiển thị trạng thái.
 * Trả 200 khi mọi thành phần chạy, 503 khi có thành phần lỗi.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const [db, redis] = await Promise.all([this.prisma.ping(), this.redis.ping()]);
    const report: HealthReport = {
      status: db && redis ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? '0.1.0',
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database: db ? 'up' : 'down', redis: redis ? 'up' : 'down' },
    };
    res.status(report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}
