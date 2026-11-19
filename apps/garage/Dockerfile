# Build từ thư mục gốc repo: docker build -f apps/garage/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.vn .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY . .
RUN pnpm install --frozen-lockfile --filter @cardiy/garage...
RUN pnpm --filter @cardiy/garage build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/garage/.next/standalone ./
COPY --from=build /repo/apps/garage/.next/static ./apps/garage/.next/static
EXPOSE 3000
CMD ["node", "apps/garage/server.js"]
