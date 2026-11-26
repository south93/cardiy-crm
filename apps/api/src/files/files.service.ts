import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { LocalStorage, S3Storage, type StorageDriver } from './storage';

/** Loại file cho phép: ảnh xe/hiện trường và chứng từ PDF. */
export const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** Kiểm tra "chữ ký" đầu file, không tin vào phần mở rộng hay mime trình duyệt gửi. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  return null;
}

const URL_TTL_SECONDS = 60 * 60;

@Injectable()
export class FilesService {
  readonly driver: StorageDriver;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {
    this.driver =
      config.get('FILE_STORAGE') === 's3'
        ? new S3Storage(config.get('S3_BUCKET'), {
            endpoint: config.get('S3_ENDPOINT'),
            region: config.get('S3_REGION'),
            accessKeyId: config.get('S3_ACCESS_KEY'),
            secretAccessKey: config.get('S3_SECRET_KEY'),
            forcePathStyle: config.get('S3_FORCE_PATH_STYLE'),
          })
        : new LocalStorage(config.get('FILE_LOCAL_DIR'), config.get('PUBLIC_API_URL'), config.get('JWT_SECRET'));
  }

  get maxBytes(): number {
    return this.config.get('FILE_MAX_MB') * 1024 * 1024;
  }

  async upload(tenantId: string, userId: string, file: { buffer: Buffer; originalname: string; size: number }, ip?: string) {
    if (!file?.buffer?.length) throw new BadRequestException('Chưa chọn file');
    if (file.size > this.maxBytes) throw new BadRequestException(`File tối đa ${this.config.get('FILE_MAX_MB')} MB`);
    const mime = sniffMime(file.buffer);
    if (!mime || !ALLOWED_MIME[mime]) throw new BadRequestException('Chỉ nhận ảnh JPG, PNG, WEBP hoặc file PDF');
    const now = new Date();
    const key = `${tenantId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ALLOWED_MIME[mime]}`;
    await this.driver.put(key, file.buffer, mime);
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 200);
    const row = await this.prisma.fileObject.create({ data: { tenantId, storageKey: key, mime, size: file.size, name, uploadedBy: userId } });
    await this.audit.log({ tenantId, actorId: userId, action: 'file.uploaded', entity: 'file', entityId: row.id, after: { name, mime, size: file.size }, ip });
    return { id: row.id, name, mime, size: row.size, url: await this.driver.signedUrl(key, row.id, URL_TTL_SECONDS) };
  }

  async signedUrl(fileId: string): Promise<string> {
    const f = await this.prisma.fileObject.findUniqueOrThrow({ where: { id: fileId } });
    return this.driver.signedUrl(f.storageKey, f.id, URL_TTL_SECONDS);
  }

  /** Lấy file của đúng tenant; file tenant khác coi như không tồn tại. */
  async getForTenant(fileId: string, tenantId: string) {
    const f = await this.prisma.fileObject.findFirst({ where: { id: fileId, tenantId } });
    if (!f) throw new NotFoundException('Không tìm thấy file');
    return { id: f.id, name: f.name, mime: f.mime, size: f.size, createdAt: f.createdAt, url: await this.driver.signedUrl(f.storageKey, f.id, URL_TTL_SECONDS) };
  }

  async assertOwnedImage(fileId: string, tenantId: string): Promise<void> {
    const f = await this.prisma.fileObject.findFirst({ where: { id: fileId, tenantId } });
    if (!f) throw new NotFoundException('Không tìm thấy file');
    if (!f.mime.startsWith('image/')) throw new BadRequestException('Ảnh đại diện phải là file ảnh');
  }
}
