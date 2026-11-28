import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const optStr = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : undefined));

/** Biến môi trường của API. Thiếu hoặc sai sẽ dừng khởi động với thông báo rõ ràng. */
export const envSchema = z
  .object({
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
    S3_ENDPOINT: optStr,
    S3_REGION: z.string().default('auto'),
    S3_BUCKET: z.string().default('cardiy'),
    S3_ACCESS_KEY: optStr,
    S3_SECRET_KEY: optStr,
    S3_FORCE_PATH_STYLE: bool.default(true),
    /** Tên miền công khai gắn vào R2/S3 (VD: https://img.tencongty.vn); để trống thì dùng link presigned tự động */
    S3_PUBLIC_URL: optStr,

    /** Ứng dụng Zalo (developers.zalo.me) của OA: gửi tin ZNS. Trống = chưa bật Zalo */
    ZALO_APP_ID: optStr,
    ZALO_APP_SECRET: optStr,
    /** fake: không gọi Zalo thật, giữ tin trong bộ nhớ (test / demo) */
    ZALO_TRANSPORT: z.enum(['http', 'fake']).default('http'),
    ZALO_OAUTH_URL: z.string().default('https://oauth.zaloapp.com/v4/oa/access_token'),
    ZALO_ZNS_URL: z.string().default('https://business.openapi.zalo.me/message/template'),

    /** Dịch vụ Trợ lý AI (Vòng 5.2 · M36): mặc định heuristic tra cứu kho & tri thức nội bộ, hoặc gọi HTTP LLM tương thích OpenAI */
    AI_PROVIDER: z.enum(['heuristic', 'http']).default('heuristic'),
    AI_API_URL: z.string().default('https://api.openai.com/v1/chat/completions'),
    AI_API_KEY: optStr,
    AI_MODEL: z.string().default('gpt-4o-mini'),
  })
  .superRefine((env, ctx) => {
    if (env.FILE_STORAGE === 's3') {
      if (!env.S3_ENDPOINT) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['S3_ENDPOINT'], message: 'Cần cấu hình S3_ENDPOINT khi FILE_STORAGE=s3 (VD: Cloudflare R2 endpoint)' });
      if (!env.S3_BUCKET?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['S3_BUCKET'], message: 'Cần cấu hình tên bucket S3_BUCKET' });
      if (!env.S3_ACCESS_KEY) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['S3_ACCESS_KEY'], message: 'Cần cấu hình S3_ACCESS_KEY khi FILE_STORAGE=s3' });
      if (!env.S3_SECRET_KEY) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['S3_SECRET_KEY'], message: 'Cần cấu hình S3_SECRET_KEY khi FILE_STORAGE=s3' });
    }
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
