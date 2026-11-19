#!/usr/bin/env bash
# Cập nhật bản demo lên code mới nhất của một nhánh (mặc định develop).
#   bash deploy/update.sh            # nhánh develop
#   bash deploy/update.sh main       # nhánh main
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH="${1:-develop}"

echo "==> Lấy code mới nhất nhánh $BRANCH"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "==> Sao lưu database trước khi cập nhật"
bash deploy/backup.sh || echo "(Bỏ qua sao lưu: database chưa chạy)"

echo "==> Build và khởi động lại"
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build

echo "==> Dọn image cũ"
docker image prune -f >/dev/null

echo "==> Kiểm tra sức khoẻ"
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:4000/api/health >/dev/null; then
    curl -s http://127.0.0.1:4000/api/health; echo
    echo "==> Xong. Phiên bản: $(git log -1 --format='%h %s')"
    exit 0
  fi
  sleep 2
done
echo "!! API chưa sẵn sàng sau 2 phút. Xem log: docker compose -f deploy/docker-compose.prod.yml logs api --tail 100"
exit 1
