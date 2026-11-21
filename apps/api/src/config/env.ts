import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

/** Biến môi trường của API. Thiếu hoặc sai sẽ dừng khởi động với thông báo rõ ràng. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  API_PORT: z.coerce.number().default(4000),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  /** Địa chỉ công khai của API, dùng tạo link file đã ký */
  PUBLIC_API_URL: z.string().default('http://localhost:4000'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET cần ít nhất 32 ký tự'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().default(30),
  /** Cho phép dùng lại refresh token vừa xoay vòng trong N giây (nhiều tab mở cùng lúc) */
  REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().min(0).max(300).default(30),
  BCRYPT_ROUNDS: z.coerce.number().min(4).max(14).default(11),
  /** Bắt buộc bật 2FA cho vai trò Chủ garage, Quản lý, Admin sàn */
  AUTH_ENFORCE_2FA: bool.default(true),
  LOGIN_MAX_FAILS: z.coerce.number().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().default(15),

  FILE_STORAGE: z.enum(['local', 's3']).default('local'),
  FILE_LOCAL_DIR: z.string().default('./storage'),
  FILE_MAX_MB: z.coerce.number().default(10),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('cardiy'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool.default(true),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Cấu hình môi trường không hợp lệ:\n${msg}`);
  }
  return parsed.data;
}
