# Build từ thư mục gốc repo: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache openssl
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter @cardiy/api...
RUN pnpm --filter "@cardiy/api..." build
RUN pnpm deploy --filter @cardiy/api --prod --legacy /out
RUN cp -r apps/api/dist /out/dist

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out ./
EXPOSE 4000
# Chạy migration rồi khởi động API
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main.js"]
