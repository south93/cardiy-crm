import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, login, PHONES } from './helpers';

/**
 * Lưu file qua S3/MinIO. Chỉ chạy khi có MinIO thật (CI bật S3_TEST_ENDPOINT).
 * Chạy trên máy: docker run -p 9000:9000 -e MINIO_ROOT_USER=cardiy -e MINIO_ROOT_PASSWORD=cardiy-secret minio/minio server /data
 */
const endpoint = process.env.S3_TEST_ENDPOINT;
const d = endpoint ? describe : describe.skip;

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

d('Lưu file trên S3 / MinIO', () => {
  let app: INestApplication;
  const accessKeyId = process.env.S3_TEST_ACCESS_KEY ?? 'cardiy';
  const secretAccessKey = process.env.S3_TEST_SECRET_KEY ?? 'cardiy-secret';
  const bucket = 'cardiy-test';

  beforeAll(async () => {
    const s3 = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (e) {
      if (!/BucketAlready/.test((e as Error).name)) throw e;
    }
    app = await createApp({ FILE_STORAGE: 's3', S3_ENDPOINT: endpoint, S3_BUCKET: bucket, S3_ACCESS_KEY: accessKeyId, S3_SECRET_KEY: secretAccessKey, S3_FORCE_PATH_STYLE: true });
  });
  afterAll(() => app?.close());

  it('tải ảnh lên MinIO, link ký sẵn (presigned) tải về đúng nội dung', async () => {
    const { token } = await login(app, PHONES.owner);
    const up = await request(app.getHttpServer()).post('/api/files').set(bearer(token)).attach('file', PNG, 's3.png').expect(201);
    expect(up.body.url).toContain(`${endpoint}/${bucket}/`);
    expect(up.body.url).toContain('X-Amz-Signature=');
    const res = await fetch(up.body.url);
    expect(res.status).toBe(200);
    expect(Buffer.compare(Buffer.from(await res.arrayBuffer()), PNG)).toBe(0);
  });
});
