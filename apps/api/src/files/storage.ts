import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Nơi lưu file thật. Đổi giữa thư mục cục bộ và S3/MinIO bằng biến FILE_STORAGE, không phải sửa code. */
export interface StorageDriver {
  put(key: string, body: Buffer, mime: string): Promise<void>;
  /** Link tải có hạn dùng, dùng thẳng trong thẻ <img>. */
  signedUrl(key: string, fileId: string, ttlSeconds: number): Promise<string>;
}

export class LocalStorage implements StorageDriver {
  constructor(
    private readonly root: string,
    private readonly publicApiUrl: string,
    private readonly secret: string,
  ) {}

  private full(key: string): string {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Đường dẫn file không hợp lệ');
    return p;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const p = this.full(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body);
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.full(key));
  }

  sign(fileId: string, exp: number): string {
    return createHmac('sha256', this.secret).update(`${fileId}.${exp}`).digest('base64url');
  }

  verify(fileId: string, exp: number, sig: string): boolean {
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
    const expected = Buffer.from(this.sign(fileId, exp));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  async signedUrl(_key: string, fileId: string, ttlSeconds: number): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    return `${this.publicApiUrl}/api/files/raw/${fileId}?exp=${exp}&sig=${this.sign(fileId, exp)}`;
  }
}

export class S3Storage implements StorageDriver {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    opts: { endpoint?: string; region: string; accessKeyId?: string; secretAccessKey?: string; forcePathStyle: boolean },
  ) {
    this.client = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region,
      forcePathStyle: opts.forcePathStyle,
      credentials: opts.accessKeyId && opts.secretAccessKey ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } : undefined,
    });
  }

  async put(key: string, body: Buffer, mime: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: mime }));
  }

  signedUrl(key: string, _fileId: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: ttlSeconds });
  }
}
