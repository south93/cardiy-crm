import type { INestApplication } from '@nestjs/common';

/** Cấu hình dùng chung cho cả lúc chạy thật và lúc test e2e. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });
  app.enableShutdownHooks();
}
