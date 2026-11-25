# 09 · Triển khai lên VPS (Docker Compose + Caddy)

Mô hình: **một tên miền**. Caddy trên VPS tự cấp HTTPS và chia đường dẫn: `/api/*` vào API (cổng 4000), còn lại vào web (cổng 3000). PostgreSQL, Redis chạy trong Docker, **không mở ra Internet**.

```
Internet ──HTTPS──▶ Caddy (VPS) ──┬── /api/* ──▶ 127.0.0.1:4000  API (Docker)
                                   └── còn lại ─▶ 127.0.0.1:3000  Web (Docker)
                                                   PostgreSQL, Redis: mạng nội bộ Docker
```

Yêu cầu: Ubuntu 22.04/24.04, đã cài Docker (kèm `docker compose`) và Caddy. Mọi lệnh chạy bằng `root` (hoặc thêm `sudo`).

---

## Bước 0 · Tên miền

- **Có tên miền:** tạo bản ghi **A** `demo` → IP VPS (VD `demo.tencongty.vn`). Chờ vài phút, kiểm tra: `ping demo.tencongty.vn` ra đúng IP.
- **Chưa có tên miền:** dùng tạm `<IP-nối-bằng-gạch>.sslip.io`, VD IP `203.0.113.10` → `203-0-113-10.sslip.io`. Không cần cấu hình gì thêm.

## Bước 1 · Tường lửa

```bash
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable && ufw status
```

## Bước 2 · Lấy mã nguồn

Repo đang **public**:

```bash
git clone https://github.com/south93/cardiy-crm.git /opt/cardiy && cd /opt/cardiy && git checkout develop
```

Nếu đã chuyển repo sang **private**, tạo khoá chỉ-đọc cho VPS:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/cardiy_deploy -N "" && cat ~/.ssh/cardiy_deploy.pub
```

Dán nội dung vừa in vào GitHub → repo → Settings → Deploy keys → Add deploy key (không tick "Allow write access"), rồi:

```bash
GIT_SSH_COMMAND="ssh -i ~/.ssh/cardiy_deploy" git clone git@github.com:south93/cardiy-crm.git /opt/cardiy && cd /opt/cardiy && git config core.sshCommand "ssh -i ~/.ssh/cardiy_deploy" && git checkout develop
```

## Bước 3 · Cấu hình

Thay `demo.tencongty.vn` bằng tên miền của bạn ở lệnh dưới (một lệnh, tự sinh mật khẩu ngẫu nhiên):

```bash
cd /opt/cardiy && cp deploy/.env.example deploy/.env && sed -i "s|^DOMAIN=.*|DOMAIN=demo.tencongty.vn|; s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|; s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 48)|" deploy/.env && chmod 600 deploy/.env && cat deploy/.env
```

## Bước 4 · Build và chạy

Lần đầu mất khoảng 5–10 phút:

```bash
cd /opt/cardiy && docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
```

Kiểm tra (chờ API khởi động khoảng 20 giây):

```bash
curl -s http://127.0.0.1:4000/api/health
```

Kết quả đúng: `{"status":"ok", ... "database":"up","redis":"up"}`.

## Bước 5 · Tạo tài khoản demo

Chỉ cho **bản demo**. Mật khẩu chung `Cardiy2026`:

```bash
cd /opt/cardiy && docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env run --rm api node dist-seed/seed.js
```

## Bước 6 · Caddy (HTTPS)

Tự lấy tên miền từ `deploy/.env`:

```bash
D=$(grep ^DOMAIN= /opt/cardiy/deploy/.env | cut -d= -f2) && sed "s|demo.tencongty.vn|$D|" /opt/cardiy/deploy/Caddyfile > /etc/caddy/Caddyfile && mkdir -p /var/log/caddy && chown caddy:caddy /var/log/caddy && caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
```

Nếu VPS đã có website khác trong Caddy, **không chép đè**: dán khối `demo.tencongty.vn { … }` trong `deploy/Caddyfile` vào cuối file `/etc/caddy/Caddyfile` hiện có.

Mở `https://<tên-miền>` → đăng nhập `0900000001` / `Cardiy2026`.

## Bước 7 · Sao lưu tự động mỗi đêm

Lưu database và file tải lên vào `/opt/cardiy-backups`, giữ 14 ngày:

```bash
(crontab -l 2>/dev/null; echo "30 2 * * * cd /opt/cardiy && bash deploy/backup.sh >> /var/log/cardiy-backup.log 2>&1") | crontab - && bash /opt/cardiy/deploy/backup.sh
```

Nên chép thêm thư mục sao lưu ra ngoài VPS (Google Drive, máy tính) định kỳ. VPS hỏng thì bản sao lưu trên chính nó cũng mất.

## Cập nhật phiên bản mới

Mỗi khi một vòng được gộp vào `develop` (tự sao lưu trước khi cập nhật):

```bash
cd /opt/cardiy && bash deploy/update.sh
```

## Bật gửi tin Zalo (ZNS)

Dùng cho: mã OTP đăng ký / quên mật khẩu app chủ xe, báo lịch hẹn đã xác nhận, báo giá chờ duyệt, xe sửa xong, nhắc bảo dưỡng / đăng kiểm.

1. **OA đã xác thực** và **bật dịch vụ ZNS**, nạp tiền vào tài khoản ZNS (mỗi tin có phí).
2. Vào <https://developers.zalo.me> → tạo / mở **ứng dụng** liên kết với OA → lấy **App ID** và **Khoá bí mật (Secret key)**. Đăng nhập CRM bằng tài khoản Chủ garage → **Cài đặt → Zalo → Ứng dụng Zalo** → nhập App ID + Secret key → **Lưu ứng dụng** (secret được mã hoá, không hiển thị lại).
   *Cách khác:* điền `ZALO_APP_ID`, `ZALO_APP_SECRET` vào `deploy/.env` rồi chạy `bash deploy/update.sh` (giá trị nhập trên CRM được ưu tiên).
3. Lấy **Refresh token** của OA (developers.zalo.me → *Công cụ → API Explorer*, loại **OA Access Token**, chọn OA, cấp quyền gửi tin). Ở **Cài đặt → Zalo → Kết nối Zalo OA** → dán Refresh token → **Kết nối**. Hệ thống tự làm mới token (token mới được lưu mã hoá); nếu báo lỗi token, lấy refresh token mới và kết nối lại.
4. Tạo **mẫu ZNS** trong trang quản trị ZNS và chờ Zalo duyệt. Với mỗi mẫu đã duyệt: ở **Cài đặt → Zalo**, bật sự kiện, nhập **mã mẫu (template ID)** và ghép **tên tham số** của mẫu với dữ liệu CRM (tên khách, biển số, mã đơn, giờ hẹn, mã OTP…).
5. Để chế độ **Thử nghiệm** (chỉ gửi tới SĐT quản trị OA, không mất phí) → bấm **Gửi thử** từng mẫu. Ổn thì chuyển **Chính thức** và bật **Bật gửi tin Zalo**.

Mọi tin gửi / lỗi xem ở **Cài đặt → Zalo → Tin đã gửi gần đây**.

## Lệnh hay dùng

| Việc | Lệnh |
|---|---|
| Xem trạng thái | `cd /opt/cardiy && docker compose -f deploy/docker-compose.prod.yml ps` |
| Xem log API | `cd /opt/cardiy && docker compose -f deploy/docker-compose.prod.yml logs api --tail 100 -f` |
| Xem log web | `cd /opt/cardiy && docker compose -f deploy/docker-compose.prod.yml logs garage --tail 100 -f` |
| Khởi động lại | `cd /opt/cardiy && docker compose -f deploy/docker-compose.prod.yml restart` |
| Khôi phục database từ bản sao lưu | `cd /opt/cardiy && docker compose -f deploy/docker-compose.prod.yml exec -T postgres pg_restore -U cardiy -d cardiy --clean --if-exists < /opt/cardiy-backups/db-<ngày>.dump` |

## Bảo mật VPS (nên làm)

- **Không** chạy `do-release-upgrade` lúc này. Ubuntu đang dùng vẫn được hỗ trợ; nâng cấp lên bản mới để sau, khi đã có sao lưu.
- Cập nhật bảo mật hệ điều hành: `apt update && apt upgrade -y`
- Đăng nhập SSH bằng khoá thay cho mật khẩu, rồi tắt đăng nhập bằng mật khẩu (`PasswordAuthentication no` trong `/etc/ssh/sshd_config`). **Chỉ tắt sau khi đã thử đăng nhập bằng khoá thành công**, nếu không sẽ tự khoá mình ngoài VPS.
- Bản chính thức: trong `deploy/.env` đặt `AUTH_ENFORCE_2FA=true`, **không** chạy lệnh tạo tài khoản demo, và đổi `SEED_DEMO=false`.

## Web sàn công khai (vòng 3.3)

- Địa chỉ: `https://<DOMAIN>/cho` (chung tên miền, không cần sửa Caddyfile). Trang quản trị, app chủ xe không bị lập chỉ mục (`robots.txt` chỉ mở `/cho` và `/dang-ky-doi-tac`); `sitemap.xml` liệt kê gian hàng và sản phẩm đang bán.
- Web dựng trang sàn phía máy chủ, gọi API qua mạng nội bộ docker (`API_INTERNAL_URL=http://api:4000`, đã có trong `docker-compose.prod.yml`).
- Gian hàng hiện trên sàn khi: đối tác đang hoạt động (đã nộp phí kỳ đầu) hoặc garage PLG, đã lưu hồ sơ gian hàng, có ít nhất 1 tin đang bán.
- Muốn đưa lên Google: vào Google Search Console, thêm tên miền, gửi `https://<DOMAIN>/sitemap.xml`.
