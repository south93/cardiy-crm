import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, login, PHONES } from './helpers';

// s3rver không có type đi kèm
// eslint-disable-next-line @typescript-eslint/no-require-imports
const S3rver = require('s3rver') as new (opts: Record<string, unknown>) => { run(): Promise<AddressInfo>; close(): Promise<void> };

/**
 * Lưu file qua chuẩn S3 (driver dùng cho MinIO / SeaweedFS / Cloudflare R2 trên VPS).
 * Mặc định chạy với s3rver giả lập ngay trong test. Muốn thử với máy chủ S3 thật: đặt S3_TEST_ENDPOINT.
 */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

describe('Lưu file trên S3', () => {
  let app: INestApplication;
  let fake: { close(): Promise<void> } | null = null;
  let dir = '';
  let endpoint = process.env.S3_TEST_ENDPOINT ?? '';
  const accessKeyId = process.env.S3_TEST_ACCESS_KEY ?? 'S3RVER';
  const secretAccessKey = process.env.S3_TEST_SECRET_KEY ?? 'S3RVER';
  const bucket = 'cardiy-test';

  beforeAll(async () => {
    if (!endpoint) {
      dir = mkdtempSync(path.join(tmpdir(), 'cardiy-s3-'));
      const server = new S3rver({ port: 0, address: '127.0.0.1', silent: true, directory: dir });
      const addr = await server.run();
      fake = server;
      endpoint = `http://127.0.0.1:${addr.port}`;
    }
    const s3 = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (e) {
      if (!/BucketAlready/.test((e as Error).name)) throw e;
    }
    app = await createApp({ FILE_STORAGE: 's3', S3_ENDPOINT: endpoint, S3_BUCKET: bucket, S3_ACCESS_KEY: accessKeyId, S3_SECRET_KEY: secretAccessKey, S3_FORCE_PATH_STYLE: true });
  });

  afterAll(async () => {
    await app?.close();
    await fake?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('tải ảnh lên S3, link ký sẵn (presigned) tải về đúng nội dung', async () => {
    const { token } = await login(app, PHONES.owner);
    const up = await request(app.getHttpServer()).post('/api/files').set(bearer(token)).attach('file', PNG, 's3.png').expect(201);
    expect(up.body.url).toContain(`${endpoint}/${bucket}/`);
    expect(up.body.url).toContain('X-Amz-Signature=');
    const res = await fetch(up.body.url);
    expect(res.status).toBe(200);
    expect(Buffer.compare(Buffer.from(await res.arrayBuffer()), PNG)).toBe(0);
  });
});
