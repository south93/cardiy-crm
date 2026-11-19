# Build từ thư mục gốc repo: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache openssl
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter @cardiy/api...
RUN pnpm --filter "@cardiy/api..." build
RUN pnpm --filter @cardiy/api build:seed
RUN pnpm deploy --filter @cardiy/api --prod --legacy /out
RUN cp -r apps/api/dist /out/dist && cp -r apps/api/dist-seed /out/dist-seed

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out ./
# Thư mục lưu file tải lên (gắn volume); chạy bằng user thường, không dùng root
RUN mkdir -p /app/storage && chown -R node:node /app/storage
USER node
EXPOSE 4000
# Chạy migration rồi khởi động API. Dữ liệu mẫu: docker compose ... run --rm api node dist-seed/seed.js
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main.js"]
