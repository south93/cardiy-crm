import { HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { HealthController } from './health.controller';

function makeRes() {
  const res = { status: jest.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response & { status: jest.Mock };
}

async function build(db: boolean, redis: boolean) {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      { provide: PrismaService, useValue: { ping: jest.fn().mockResolvedValue(db) } },
      { provide: RedisService, useValue: { ping: jest.fn().mockResolvedValue(redis) } },
    ],
  }).compile();
  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  it('trả ok + 200 khi database và redis đều chạy', async () => {
    const res = makeRes();
    const report = await (await build(true, true)).check(res);
    expect(report.status).toBe('ok');
    expect(report.checks).toEqual({ database: 'up', redis: 'up' });
    expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
  });

  it('trả degraded + 503 khi database lỗi', async () => {
    const res = makeRes();
    const report = await (await build(false, true)).check(res);
    expect(report.status).toBe('degraded');
    expect(report.checks.database).toBe('down');
    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('trả degraded + 503 khi redis lỗi', async () => {
    const res = makeRes();
    const report = await (await build(true, false)).check(res);
    expect(report.checks.redis).toBe('down');
    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });
});
