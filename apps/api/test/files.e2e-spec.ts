import { rmSync } from 'node:fs';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, createApp, login, PHONES } from './helpers';

/** PNG 1x1 hợp lệ */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

describe('Tải file & ảnh đại diện', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let owner: string;
  let partner: string;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    owner = (await login(app, PHONES.owner)).token;
    partner = (await login(app, PHONES.partnerOwner)).token;
  });
  afterAll(() => app.close());

  it('tải ảnh lên, nhận link có chữ ký xem được', async () => {
    const up = await request(http).post('/api/files').set(bearer(owner)).attach('file', PNG, 'xe-truoc.png').expect(201);
    expect(up.body).toMatchObject({ mime: 'image/png', name: 'xe-truoc.png' });
    const url = new URL(up.body.url);
    const raw = await request(http).get(url.pathname + url.search).expect(200);
    expect(raw.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(raw.body as Buffer, PNG)).toBe(0);
  });

  it('link sửa chữ ký hoặc hết hạn bị từ chối', async () => {
    const up = await request(http).post('/api/files').set(bearer(owner)).attach('file', PNG, 'a.png').expect(201);
    const url = new URL(up.body.url);
    await request(http).get(`${url.pathname}?exp=${url.searchParams.get('exp')}&sig=sai`).expect(403);
    await request(http).get(`${url.pathname}?exp=1000&sig=${url.searchParams.get('sig')}`).expect(403);
  });

  it('file mất khỏi ổ lưu trữ → 404, không lỗi 500', async () => {
    const up = await request(http).post('/api/files').set(bearer(owner)).attach('file', PNG, 'mat.png').expect(201);
    const row = await app.get(PrismaService).fileObject.findUniqueOrThrow({ where: { id: up.body.id } });
    rmSync(path.resolve(process.env.FILE_LOCAL_DIR ?? './storage', row.storageKey));
    const url = new URL(up.body.url);
    await request(http).get(url.pathname + url.search).expect(404);
  });

  it('từ chối file không phải ảnh/PDF dù đặt tên .png', async () => {
    await request(http).post('/api/files').set(bearer(owner)).attach('file', Buffer.from('<script>alert(1)</script>'), 'gia-mao.png').expect(400);
  });

  it('garage khác không xem được thông tin file', async () => {
    const up = await request(http).post('/api/files').set(bearer(owner)).attach('file', PNG, 'b.png').expect(201);
    await request(http).get(`/api/files/${up.body.id}`).set(bearer(partner)).expect(404);
    await request(http).get(`/api/files/${up.body.id}`).set(bearer(owner)).expect(200);
  });

  it('đặt ảnh đại diện: /me trả link ảnh; không dùng được ảnh của garage khác', async () => {
    const up = await request(http).post('/api/files').set(bearer(owner)).attach('file', PNG, 'avatar.png').expect(201);
    await request(http).patch('/api/me/avatar').set(bearer(partner)).send({ fileId: up.body.id }).expect(404);
    await request(http).patch('/api/me/avatar').set(bearer(owner)).send({ fileId: up.body.id }).expect(200);
    const me = await request(http).get('/api/me').set(bearer(owner)).expect(200);
    expect(me.body.user.avatarUrl).toContain(`/api/files/raw/${up.body.id}`);
  });
});
