import { validateEnv } from '../config/env';
import { sniffMime } from './files.service';
import { normalizeS3Endpoint, S3Storage } from './storage';

const BASE_ENV = {
  DATABASE_URL: 'postgresql://cardiy:cardiy@localhost:5432/cardiy',
  JWT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef',
};

describe('Cloudflare R2 / S3 storage & nhận diện ảnh WebP', () => {
  it('chuẩn hoá Cloudflare R2 endpoint kể cả khi dư dấu / hoặc dính tên bucket ở cuối', () => {
    expect(
      normalizeS3Endpoint('https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/', 'cardiy'),
    ).toBe('https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com');

    expect(
      normalizeS3Endpoint('https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/cardiy/', 'cardiy'),
    ).toBe('https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com');
  });

  it('validateEnv: cho phép S3_* rỗng khi FILE_STORAGE=local, bắt buộc đủ khoá khi FILE_STORAGE=s3', () => {
    const localEnv = validateEnv({
      ...BASE_ENV,
      FILE_STORAGE: 'local',
      S3_ENDPOINT: '',
      S3_ACCESS_KEY: '',
      S3_SECRET_KEY: '',
      S3_PUBLIC_URL: '',
    });
    expect(localEnv.FILE_STORAGE).toBe('local');
    expect(localEnv.S3_ENDPOINT).toBeUndefined();

    expect(() =>
      validateEnv({
        ...BASE_ENV,
        FILE_STORAGE: 's3',
        S3_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
        S3_BUCKET: 'cardiy',
      }),
    ).toThrow(/S3_ACCESS_KEY/);

    const r2Env = validateEnv({
      ...BASE_ENV,
      FILE_STORAGE: 's3',
      S3_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
      S3_REGION: 'auto',
      S3_BUCKET: 'cardiy',
      S3_ACCESS_KEY: 'key-demo',
      S3_SECRET_KEY: 'secret-demo',
    });
    expect(r2Env.FILE_STORAGE).toBe('s3');
    expect(r2Env.S3_REGION).toBe('auto');
  });

  it('S3Storage tạo link Presigned URL mặc định hoặc link CDN khi có S3_PUBLIC_URL, và nhận diện đúng chữ ký RIFF..WEBP', async () => {
    // 12 byte đầu chuẩn RIFF....WEBP
    const fakeWebp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(16)]);
    expect(sniffMime(fakeWebp)).toBe('image/webp');

    const privateR2 = new S3Storage('cardiy', {
      endpoint: 'https://example.r2.cloudflarestorage.com',
      region: 'auto',
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
      forcePathStyle: true,
    });
    const signed = await privateR2.signedUrl('tenant-1/2026/11/anh.webp', 'f1', 3600);
    expect(signed).toContain('https://example.r2.cloudflarestorage.com/cardiy/tenant-1/2026/11/anh.webp');
    expect(signed).toContain('X-Amz-Signature=');

    const cdnR2 = new S3Storage('cardiy', {
      endpoint: 'https://example.r2.cloudflarestorage.com',
      region: 'auto',
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
      forcePathStyle: true,
      publicUrl: 'https://img.cardiy.vn/',
    });
    expect(await cdnR2.signedUrl('tenant-1/2026/11/anh.webp', 'f1', 3600)).toBe(
      'https://img.cardiy.vn/tenant-1/2026/11/anh.webp',
    );
  });
});
