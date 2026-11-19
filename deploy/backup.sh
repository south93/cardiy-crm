#!/usr/bin/env bash
# Sao lưu database + file tải lên vào /opt/cardiy-backups, giữ 14 ngày.
# Chạy tự động mỗi đêm (2:30): xem docs/09-trien-khai-vps.md, mục cron.
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="${BACKUP_DIR:-/opt/cardiy-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
COMPOSE=(docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env)
mkdir -p "$DEST"

"${COMPOSE[@]}" exec -T postgres pg_dump -U cardiy -d cardiy --format=custom > "$DEST/db-$STAMP.dump"
"${COMPOSE[@]}" exec -T api tar -czf - -C /app storage > "$DEST/files-$STAMP.tar.gz"

find "$DEST" -type f -mtime +"$KEEP_DAYS" -delete
echo "Đã sao lưu: $DEST/db-$STAMP.dump, $DEST/files-$STAMP.tar.gz"
