import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

/** Cần PostgreSQL + Redis thật (docker compose up -d, hoặc service trong CI). */
describe('API e2e', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health → 200, database và redis đều up', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it('migration đã chạy: bảng tenants và branches truy vấn được', async () => {
    const prisma = app.get(PrismaService);
    await expect(prisma.tenant.count()).resolves.toBeGreaterThanOrEqual(0);
    await expect(prisma.branch.count()).resolves.toBeGreaterThanOrEqual(0);
  });

  it('CORS cho phép web garage gọi API', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', 'http://localhost:3000');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('đường dẫn không tồn tại → 404', async () => {
    await request(app.getHttpServer()).get('/api/khong-ton-tai').expect(404);
  });
});
