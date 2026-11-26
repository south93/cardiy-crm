import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AppConfig } from '../src/config/app-config';
import type { Env } from '../src/config/env';
import { RedisService } from '../src/redis/redis.service';

export const DEMO_PASSWORD = 'Cardiy2026';
export const PHONES = {
  owner: '0900000001',
  managerCn1: '0900000002',
  sales: '0900000003',
  tech: '0900000004',
  storekeeper: '0900000005',
  cskh: '0900000007',
  accountant: '0900000006',
  managerCn2: '0900000008',
  rescue: '0900000009',
  partnerOwner: '0900000010',
};

/** Tạo app test. `overrides`: ghi đè cấu hình (ví dụ bật bắt buộc 2FA) mà không đổi file .env. */
export async function createApp(overrides: Partial<Env> = {}): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AppConfig)
    .useFactory({
      factory: (cs: ConfigService<Env, true>) => {
        const base = new AppConfig(cs);
        const get = <K extends keyof Env>(key: K): Env[K] => (key in overrides ? (overrides[key] as Env[K]) : base.get(key));
        return Object.assign(Object.create(base) as AppConfig, { get });
      },
      inject: [ConfigService],
    })
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  const redis = app.get(RedisService);
  await redis.ping();
  const keys = [
    ...(await redis.client.keys('login:fail:*')),
    ...(await redis.client.keys('2fa:fail:*')),
    ...(await redis.client.keys('acl:*')),
    ...(await redis.client.keys('rental:ip:*')),
    ...(await redis.client.keys('sos:ip:*')),
  ];
  if (keys.length) await redis.client.del(...keys);
  return app;
}

export async function login(app: INestApplication, phone: string, password = DEMO_PASSWORD) {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ phone, password });
  if (res.status !== 200 || !res.body.accessToken) throw new Error(`Đăng nhập ${phone} lỗi: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('cardiy_rt='))!;
  return { token: res.body.accessToken as string, cookie, body: res.body };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Số điện thoại ngẫu nhiên hợp lệ cho mỗi lần chạy test. */
export function randomPhone(): string {
  return '09' + String(Math.floor(10_000_000 + Math.random() * 89_999_999));
}

const SERIES = 'ABCDEFGHKLMNPSTUVXYZ';
/**
 * Biển số ngẫu nhiên hợp lệ (mã tỉnh 11–99 + seri + 5 số ≈ 160 triệu giá trị).
 * CSDL kiểm thử tích luỹ dữ liệu qua nhiều lần chạy: dải hẹp (VD "61C" + 5 số) sớm muộn sẽ sinh trùng biển đã có.
 */
export function randomPlate(): string {
  const province = 11 + Math.floor(Math.random() * 89);
  return `${province}${SERIES[Math.floor(Math.random() * SERIES.length)]}${10000 + Math.floor(Math.random() * 90000)}`;
}
