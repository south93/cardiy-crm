# CARDIY · Phần mềm quản lý chuỗi garage ô tô

Hệ thống gồm CRM vận hành garage và sàn trung gian kết nối chủ xe với các garage đối tác.
Đặc tả: [docs/INDEX.md](docs/INDEX.md) · Lộ trình: [docs/08-lo-trinh.md](docs/08-lo-trinh.md)

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `apps/api` | Backend NestJS 11 + Prisma 6 + PostgreSQL 16 + Redis 7 |
| `apps/garage` | Web quản trị garage (A3), Next.js 15 + Tailwind |
| `packages/ui` | Design system: màu thương hiệu + pastel, thành phần dùng chung |
| `packages/shared` | Dùng chung API + web: danh mục quyền, vai trò hệ thống, chuẩn hoá số điện thoại |
| `packages/tsconfig` | Cấu hình TypeScript dùng chung |
| `docs/` | Bộ đặc tả, sơ đồ Mermaid, ảnh chụp từng vòng |
| `prototype/`, `proposal/`, `index.html` | Bản thiết kế HTML, đề xuất PDF, trang demo tĩnh |

## Chạy trên máy

Cần: Node.js 22, pnpm 10 (`corepack enable`), Docker Desktop.

```bash
cp .env.example .env
docker compose up -d          # PostgreSQL + Redis
pnpm install
pnpm db:migrate               # tạo bảng
pnpm db:seed                  # dữ liệu mẫu
pnpm dev                      # API: http://localhost:4000/api · Web: http://localhost:3000
```

## Tài khoản demo (sau `pnpm db:seed`)

Mật khẩu chung: `Cardiy2026`. **Chỉ dùng cho bản demo**: bản chính thức đặt `SEED_DEMO=false`.

| Số điện thoại | Người | Vai trò |
|---|---|---|
| 0900000001 | Chủ hệ thống PLG | Chủ garage PLG **và** Super Admin sàn (chuyển qua lại ở menu tài khoản) |
| 0900000002 | Trần Quản Lý | Quản lý chi nhánh CN1 |
| 0900000003 | Lê Bán Hàng | Bán hàng / Cố vấn dịch vụ CN1 |
| 0900000004 | Phạm Kỹ Thuật | Kỹ thuật viên CN1 |
| 0900000005 · 06 · 07 | Thủ kho · Kế toán · CSKH | Mọi chi nhánh |
| 0900000008 | Ngô Quản Lý CN2 | Quản lý chi nhánh CN2 |
| 0900000010 | Chủ Garage Minh Phát | Chủ garage của **garage đối tác demo** (không thấy dữ liệu PLG) |

`AUTH_ENFORCE_2FA=true` (mặc định khi chạy thật): Chủ garage, Quản lý, Admin sàn bắt buộc bật xác thực 2 lớp ở lần đăng nhập đầu.

## Kiểm tra

```bash
pnpm lint                     # ESLint
pnpm typecheck                # kiểm tra kiểu
pnpm test                     # unit test
pnpm build                    # build
pnpm --filter @cardiy/api test:e2e      # test API với DB thật
pnpm --filter @cardiy/garage test:e2e   # test giao diện bằng trình duyệt (cần build trước)
```

CI trên GitHub chạy đủ các bước trên và build Docker image cho mỗi Pull Request.

## Chạy bằng Docker (giống VPS)

```bash
docker compose --profile app up -d --build
```

## Quy trình

- Nhánh: `feature/*` → Pull Request vào `develop` (bản demo) → `main` (bản chính thức).
- Đổi nghiệp vụ: sửa sơ đồ trong `docs/` trước, code sau.
