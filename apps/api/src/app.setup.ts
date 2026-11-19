import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

/** Cấu hình dùng chung cho cả lúc chạy thật và lúc test e2e. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });
  app.use(cookieParser());
  // Chạy sau reverse proxy (Coolify/Traefik): lấy IP thật của khách từ X-Forwarded-For
  (app as NestExpressApplication).set('trust proxy', 1);
  app.enableShutdownHooks();
}
