# 01 · Tổng quan hệ thống CARDIY

> Nền tảng gồm **2 phía**: (1) CRM vận hành cho garage (garage PLG và các garage đối tác dùng chung, mỗi garage là một *tenant*), (2) Sàn & app cho chủ xe. Garage đối tác tự đăng ký, được duyệt, rồi đăng bán **sản phẩm** và **dịch vụ** trên sàn.

## 1.1 Sơ đồ ngữ cảnh: ai dùng ứng dụng nào

```mermaid
flowchart LR
  classDef user fill:#eceefe,stroke:#9aa2f2,color:#1e293b
  classDef app fill:#e4effd,stroke:#7fb0ef,color:#1e293b
  classDef core fill:#dce6f6,stroke:#1f4e9c,color:#1e293b
  classDef ext fill:#fff0e0,stroke:#f4ad6a,color:#1e293b

  subgraph U["NGƯỜI DÙNG"]
    U1["Khách vãng lai"]:::user
    U2["Chủ xe"]:::user
    U3["Nhân sự garage<br/>Chủ garage · Quản lý · Bán hàng<br/>Kế toán · Thủ kho · CSKH"]:::user
    U4["Kỹ thuật viên"]:::user
    U5["Đội cứu hộ"]:::user
    U6["Garage muốn làm đối tác"]:::user
    U7["Đội ngũ sàn CARDIY<br/>Admin · Kế toán sàn · Kiểm duyệt"]:::user
  end

  subgraph A["ỨNG DỤNG"]
    A1["A1 · Web công khai / Sàn<br/>SEO, tìm garage, mua hàng"]:::app
    A2["A2 · App chủ xe<br/>PWA → iOS/Android"]:::app
    A3["A3 · Web quản trị Garage<br/>CRM + Kênh người bán"]:::app
    A4["A4 · App kỹ thuật viên<br/>PWA"]:::app
    A5["A5 · App cứu hộ<br/>PWA"]:::app
    A6["A6 · Admin sàn"]:::app
  end

  U1 --> A1
  U2 --> A1 & A2
  U3 --> A3
  U4 --> A4
  U5 --> A5
  U6 -->|"Đăng ký đối tác"| A1
  U6 -.->|"Sau khi được duyệt"| A3
  U7 --> A6

  API["API Gateway<br/>REST + WebSocket realtime"]:::core
  A1 & A2 & A3 & A4 & A5 & A6 --> API
  API --> BE["Backend<br/>Modular monolith"]:::core

  X["TÍCH HỢP BÊN NGOÀI<br/>Zalo OA / ZNS · SMS · Email · Push<br/>VietQR · Cổng thanh toán<br/>Hoá đơn điện tử · Phần mềm kế toán<br/>Bản đồ · Định vị · Tổng đài<br/>eKYC · Ký số hợp đồng<br/>Dịch vụ AI / LLM"]:::ext
  BE --> X
```

## 1.2 Kiến trúc container

```mermaid
flowchart TB
  classDef app fill:#e4effd,stroke:#7fb0ef,color:#1e293b
  classDef svc fill:#dce6f6,stroke:#1f4e9c,color:#1e293b
  classDef data fill:#e3f4e6,stroke:#6fbf7f,color:#1e293b

  subgraph FE["Frontend · Next.js + TypeScript (một monorepo)"]
    W1["apps/web<br/>A1 Sàn công khai · SSR/SEO"]:::app
    W2["apps/customer<br/>A2 App chủ xe · PWA"]:::app
    W3["apps/garage<br/>A3 CRM garage + A4 KTV + A5 Cứu hộ"]:::app
    W4["apps/admin<br/>A6 Admin sàn"]:::app
    UI["packages/ui · design system dùng chung"]:::app
  end

  subgraph BE["Backend · NestJS"]
    GW["API Gateway · Xác thực JWT · Tenant guard · Rate limit"]:::svc
    WS["Realtime · WebSocket"]:::svc
    JOB["Worker tác vụ nền · BullMQ<br/>nhắc lịch, gửi tin, đối soát, đồng bộ tồn kho"]:::svc
    MOD["Các module nghiệp vụ<br/>xem mục 1.3"]:::svc
  end

  subgraph DATA["Dữ liệu"]
    PG[("PostgreSQL<br/>+ pgvector cho AI")]:::data
    RD[("Redis<br/>cache, hàng đợi, phiên")]:::data
    S3[("Object storage S3<br/>ảnh xe, chứng từ, video")]:::data
    SE[("Tìm kiếm<br/>Postgres FTS → Meilisearch")]:::data
  end

  W1 & W2 & W3 & W4 --> GW
  W2 & W3 <--> WS
  GW --> MOD
  MOD --> PG & RD & S3 & SE
  JOB --> PG & RD
  MOD -->|"phát sự kiện"| JOB
```

## 1.3 Bản đồ module backend

```mermaid
flowchart LR
  classDef base fill:#eceefe,stroke:#5b63c7,color:#1e293b
  classDef core fill:#dce6f6,stroke:#1f4e9c,color:#1e293b
  classDef mkt fill:#e3f4e6,stroke:#3e8a4f,color:#1e293b
  classDef ext fill:#fff0e0,stroke:#b8692a,color:#1e293b

  subgraph NEN["NỀN TẢNG DÙNG CHUNG"]
    M0a["M00 Identity & Auth<br/>đăng nhập, OTP, 2FA"]:::base
    M0b["M01 Tenant & Chi nhánh<br/>multi-tenant"]:::base
    M0c["M02 Phân quyền RBAC"]:::base
    M0d["M03 Nhật ký thao tác<br/>append-only"]:::base
    M0e["M04 File & Media"]:::base
    M0f["M05 Notification<br/>Zalo, SMS, Email, Push"]:::base
  end

  subgraph LOI["VẬN HÀNH LÕI GARAGE"]
    M10["M10 Khách hàng & Xe"]:::core
    M11["M11 Booking & Smart Maintenance"]:::core
    M12["M12 Garage Operation<br/>RO, báo giá, giao việc"]:::core
    M13["M13 Kho & Phụ tùng"]:::core
    M14["M14 Nhân sự & Hoa hồng"]:::core
    M15["M15 Tài chính garage<br/>thu chi, công nợ, hoá đơn"]:::core
    M16["M16 Dashboard & Báo cáo"]:::core
  end

  subgraph SAN["SÀN & THƯƠNG MẠI"]
    M20["M20 Đối tác garage<br/>đăng ký, duyệt, gói"]:::mkt
    M21["M21 Danh mục chuẩn<br/>sản phẩm, dịch vụ, dòng xe"]:::mkt
    M22["M22 Gian hàng & Tin đăng bán"]:::mkt
    M23["M23 Giỏ hàng & Đơn hàng sàn"]:::mkt
    M24["M24 Payment & Wallet<br/>thanh toán, ví, hoàn tiền"]:::mkt
    M25["M25 Đối soát & Payout<br/>hoa hồng sàn"]:::mkt
    M26["M26 Khuyến mại & Voucher<br/>của garage và của sàn"]:::mkt
    M27["M27 Đánh giá & Khiếu nại"]:::mkt
  end

  subgraph MR["MỞ RỘNG"]
    M30["M30 Multi-Garage<br/>KPI, SLA chuỗi"]:::ext
    M31["M31 Car Rental"]:::ext
    M32["M32 Used Car Marketplace"]:::ext
    M33["M33 SOS Rescue"]:::ext
    M34["M34 Driver Community"]:::ext
    M35["M35 Marketing<br/>phân khúc, chiến dịch, điểm"]:::ext
    M36["M36 Trợ lý AI"]:::ext
  end

  NEN --> LOI & SAN & MR
  M12 --> M13 & M15 & M24
  M11 --> M12
  M23 --> M24 --> M25
  M22 --> M13
  M23 --> M11
  M33 --> M12
```

## 1.4 Nguyên tắc bắt buộc (áp dụng cho mọi module)

| # | Nguyên tắc | Cách làm |
|---|---|---|
| 1 | **Multi-tenant** | Mọi bảng nghiệp vụ có `tenant_id` (garage) và `branch_id` khi cần. Dùng Postgres Row-Level Security cùng tenant guard ở API. Garage PLG cũng là một tenant. |
| 2 | **Phân quyền RBAC** | Quyền dạng `module.action` (ví dụ `ro.approve`). Vai trò là tập quyền, gán theo phạm vi: sàn / tenant / chi nhánh / bản thân. |
| 3 | **API-first** | Mọi ứng dụng dùng chung REST API (OpenAPI) và WebSocket. Không có logic nghiệp vụ ở frontend. |
| 4 | **Realtime** | Đổi trạng thái RO, đơn hàng, SOS được đẩy qua WebSocket tới app chủ xe và CRM. |
| 5 | **Nhật ký thao tác** | Bảng `audit_log` chỉ cho thêm, không sửa hay xoá, kể cả quản trị: ai, lúc nào, giá trị cũ → mới. |
| 6 | **Sự kiện** | Mỗi thay đổi trạng thái sinh `domain_event`. Notification, đối soát và AI đều nghe sự kiện, không gọi chéo trực tiếp. |
| 7 | **Tiền** | Lưu dạng số nguyên VND (`bigint`). Mọi giao dịch đi qua sổ cái kép (`ledger_entry`). |
| 8 | **Dữ liệu cá nhân** | Lưu sự đồng ý nhận tin (`consent`). Chủ xe có quyền xuất hoặc xoá dữ liệu. Thông tin cá nhân được che trước khi gửi tới AI. |
