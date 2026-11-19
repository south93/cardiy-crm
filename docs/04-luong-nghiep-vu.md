# 04 · Luồng nghiệp vụ

## F1 · Garage đăng ký làm đối tác

```mermaid
sequenceDiagram
  autonumber
  actor G as Garage đăng ký
  participant W as A1 Web sàn
  participant API as Backend M20
  participant K as eKYC / Ký số
  actor AV as Admin vận hành sàn
  participant N as Notification

  G->>W: Mở "Dành cho garage", chọn gói
  W->>API: Gửi form: tên, MST, địa chỉ, chi nhánh, người đại diện, SĐT
  API->>N: Gửi OTP xác thực SĐT và email
  G->>API: Xác nhận OTP
  G->>API: Tải giấy phép kinh doanh, CCCD người đại diện, ảnh garage, tài khoản ngân hàng
  API->>K: Xác thực CCCD, đối chiếu MST
  K-->>API: Kết quả eKYC
  API-->>AV: Hồ sơ vào hàng chờ A6.10
  alt Thiếu hoặc sai giấy tờ
    AV->>API: Yêu cầu bổ sung + lý do
    API->>N: Báo garage bổ sung
    G->>API: Cập nhật hồ sơ
  else Hợp lệ
    AV->>API: Duyệt
    API->>K: Tạo hợp đồng điện tử theo gói
    G->>K: Ký số hợp đồng
    K-->>API: Đã ký
    API->>API: Tạo tenant, chi nhánh, tài khoản Chủ garage, ví người bán
    API->>N: Gửi thông tin đăng nhập A3 + hướng dẫn
  else Từ chối
    AV->>API: Từ chối + lý do
    API->>N: Báo kết quả
  end
  G->>API: Thiết lập ban đầu: nhân viên, bảng giá, dịch vụ, sản phẩm
  API-->>AV: Kiểm duyệt tin đăng đầu tiên
  API->>API: Gian hàng hiển thị trên sàn
```

## F2 · Đặt lịch → Lệnh sửa chữa → Báo giá → Thanh toán

```mermaid
sequenceDiagram
  autonumber
  actor CX as Chủ xe A2
  participant API as Backend
  actor BH as Bán hàng A3
  actor KTV as Kỹ thuật viên A4
  participant KHO as Kho M13
  participant PAY as Payment M24

  CX->>API: Đặt lịch: xe, dịch vụ, garage, giờ, mô tả lỗi
  API-->>BH: Booking mới, realtime
  BH->>API: Xác nhận lịch, giữ khoang sửa
  API-->>CX: Xác nhận + nhắc trước 2 giờ
  CX->>BH: Đến garage
  BH->>API: Check-in: km, nhiên liệu, ảnh 4 góc, đồ trong xe
  API->>API: Tạo RO từ booking
  BH->>KTV: Giao việc kiểm tra
  KTV->>API: Checklist + ảnh lỗi + đề xuất hạng mục
  BH->>API: Lập báo giá: phụ tùng từ kho + công
  API->>KHO: Kiểm tra tồn, giữ hàng tạm
  API-->>CX: Gửi báo giá qua app / Zalo
  alt Khách duyệt online
    CX->>API: Duyệt toàn bộ hoặc từng hạng mục
  else Khách từ chối
    CX->>API: Từ chối, chỉ thu phí kiểm tra
  end
  API->>KHO: Trừ tồn theo hạng mục đã duyệt
  KTV->>API: Cập nhật tiến độ, ảnh, bấm giờ
  opt Phát sinh khi sửa
    KTV->>API: Đề xuất hạng mục mới
    API-->>CX: Báo giá bổ sung, cần duyệt lại
  end
  KTV->>API: Hoàn tất
  BH->>API: Kiểm tra chất lượng + chạy thử
  API-->>CX: Xe xong, mời thanh toán
  CX->>PAY: Thanh toán VietQR / thẻ / ví / tiền mặt tại quầy
  PAY-->>API: Đã thanh toán
  API->>API: Xuất hoá đơn điện tử, kích hoạt bảo hành
  BH->>CX: Giao xe
  API->>API: Tạo lịch nhắc bảo dưỡng + lịch gọi chăm sóc sau 3 ngày
  CX->>API: Đánh giá
```

## F3 · Mua sản phẩm trên sàn + lắp tại garage

Theo mẫu trang lốp: một sản phẩm chuẩn có nhiều garage cùng bán.

```mermaid
sequenceDiagram
  autonumber
  actor CX as Chủ xe
  participant W as A1/A2
  participant API as Backend M22-M23
  participant PROMO as Voucher M26
  participant PAY as Payment M24
  actor G as Garage bán A3

  CX->>W: Mở trang sản phẩm chuẩn, ví dụ Lốp 265/60R18
  W->>API: Lấy danh sách offer của các garage
  API-->>W: Giá, có gồm lắp đặt không, khoảng cách, đánh giá, đã bán, voucher
  CX->>W: Chọn garage, năm sản xuất, số lượng
  W->>PROMO: Áp voucher garage + voucher sàn
  PROMO-->>W: Giá cuối
  CX->>W: Chọn khung giờ lắp đặt
  W->>API: Tạo đơn hàng + booking lắp đặt
  API->>API: Giữ tồn kho của offer
  CX->>PAY: Thanh toán trước, hoặc trả tại garage nếu được bật
  PAY-->>API: Tiền vào tài khoản tạm giữ của sàn
  API-->>G: Đơn mới
  G->>API: Xác nhận, chuẩn bị hàng
  CX->>G: Đến lắp đặt
  G->>API: Tạo RO lắp đặt từ đơn, hoàn tất
  API->>API: Đơn hoàn thành, tính hoa hồng sàn
  Note over API: Sau thời gian khiếu nại, ví dụ 3 ngày, tiền chuyển sang "có thể rút" của garage
  CX->>API: Đánh giá sản phẩm + garage
```

## F4 · Dòng tiền: thanh toán, tạm giữ, đối soát, chi trả

```mermaid
flowchart LR
  classDef m fill:#e3f4e6,stroke:#3e8a4f,color:#1e293b
  classDef w fill:#fff0e0,stroke:#b8692a,color:#1e293b
  CX["Chủ xe thanh toán"] --> GW["Cổng thanh toán / VietQR"]
  GW --> ESC["Tài khoản tạm giữ của sàn"]:::w
  ESC -->|"đơn hoàn thành + hết hạn khiếu nại"| SPLIT{"Chia tiền"}
  SPLIT -->|"Giá trị đơn − hoa hồng − phí cổng"| WS["Ví người bán: số dư chờ"]:::m
  SPLIT -->|"Hoa hồng theo danh mục"| REV["Doanh thu sàn"]
  SPLIT -->|"Voucher sàn tài trợ"| PROMO["Chi phí khuyến mại sàn"]
  WS -->|"kỳ đối soát T+7"| AV["Ví người bán: có thể rút"]:::m
  AV -->|"Garage yêu cầu rút"| KS{"Kế toán sàn duyệt"}
  KS -->|"Duyệt"| BANK["Chuyển khoản ngân hàng garage"]
  KS -->|"Từ chối / giữ lại"| AV
  ESC -->|"Huỷ / hoàn tiền"| REF["Hoàn tiền về ví hoặc nguồn"]
  CASH["Thanh toán tại garage: RO thường"] --> GL["Sổ quỹ garage, không qua sàn"]
  GL -->|"Đơn từ sàn trả tại garage"| DEBT["Công nợ hoa hồng garage → sàn<br/>trừ vào kỳ đối soát"]
```

## F5 · Cứu hộ SOS

```mermaid
sequenceDiagram
  autonumber
  actor CX as Chủ xe A2
  participant API as Backend M33
  actor DP as Điều phối A6 / Garage A3
  actor CH as Cứu hộ A5

  CX->>API: Bấm SOS: vị trí GPS, loại sự cố, ảnh
  API->>API: Tìm garage hoặc đội cứu hộ gần nhất đang trực
  API-->>CH: Mời nhận ca, đồng thời gửi vài đội trong bán kính
  alt Có đội nhận trong 2 phút
    CH->>API: Nhận ca
  else Không ai nhận
    API-->>DP: Chuyển điều phối thủ công
    DP->>CH: Gán ca
  end
  API-->>CX: Thông tin đội, ETA, giá dự kiến
  loop Mỗi 10 giây
    CH->>API: Cập nhật GPS
    API-->>CX: Vị trí trên bản đồ
  end
  CH->>API: Đến nơi, ảnh hiện trường, chốt giá
  alt Xử lý tại chỗ
    CH->>API: Hoàn thành, thu tiền
  else Kéo về garage
    CH->>API: Kéo về garage
    API->>API: Tạo booking / RO tại garage nhận xe
  end
  CX->>API: Đánh giá
```

## F6 · Bảo dưỡng thông minh & Lịch gọi

```mermaid
flowchart TB
  A["Nguồn km:<br/>check-in RO · chủ xe nhập · ước tính theo lịch sử"] --> B["Tính km trung bình mỗi ngày của xe"]
  B --> C["Lấy lịch bảo dưỡng theo hãng / dòng / đời xe"]
  C --> D{"Mốc tiếp theo còn ≤ 1.000 km<br/>hoặc ≤ 14 ngày?"}
  D -->|"Không"| E["Chờ lần tính lại hằng đêm"]
  D -->|"Có"| F["Tạo nhắc nhở cho chủ xe"]
  F --> G["Push / Zalo ZNS, nếu khách đã đồng ý"]
  F --> H["Tạo việc trong Lịch gọi A3.41 cho CSKH garage gần nhất"]
  G --> I{"Khách đặt lịch trong 3 ngày?"}
  I -->|"Có"| J["Đóng việc, ghi nhận chuyển đổi"]
  I -->|"Không"| H
  H --> K["CSKH gọi, ghi kết quả:<br/>đã đặt · hẹn lại · từ chối · không liên lạc được"]
  K --> L["Dữ liệu cho Marketing và AI dự đoán khách bỏ đi"]
  M["Hạn đăng kiểm / bảo hiểm còn 30 ngày"] --> F
```

## F7 · Đồng bộ tồn kho với tin đăng trên sàn

```mermaid
flowchart LR
  K["Tồn kho chi nhánh M13"] -->|"Liên kết SKU nội bộ ↔ SKU chuẩn"| O["Offer trên sàn M22"]
  O --> V{"Tồn khả dụng = tồn − đang giữ cho RO/đơn − tồn an toàn"}
  V -->|"> 0"| S["Hiển thị: còn hàng"]
  V -->|"= 0"| H["Tự ẩn hoặc báo hết hàng"]
  RO["RO dùng phụ tùng"] -->|"trừ tồn"| K
  OD["Đơn sàn"] -->|"giữ tồn khi đặt, trừ khi lắp"| K
  NH["Phiếu nhập hàng"] -->|"cộng tồn"| K
```

## F8 · Đăng bán xe cũ

```mermaid
flowchart TB
  A["Chủ xe hoặc garage tạo tin: ảnh, giá, giấy tờ"] --> B{"Có kiểm định?"}
  B -->|"Đặt kiểm định"| C["Booking kiểm định tại garage đối tác"]
  C --> D["KTV chấm checklist ~150 điểm + ảnh"]
  D --> E["Báo cáo kiểm định gắn vào tin, có huy hiệu"]
  B -->|"Không"| F["Tin thường"]
  E & F --> G["Kiểm duyệt A6.31"]
  G -->|"Đạt"| H["Hiển thị trên sàn"]
  G -->|"Không đạt"| A
  H --> I["Người mua chat, hẹn xem xe"]
  I --> J["Đánh dấu đã bán / hết hạn sau 60 ngày"]
```

## F9 · Thuê xe

```mermaid
flowchart LR
  A["Garage đăng xe cho thuê: giá ngày, cọc, điều kiện"] --> B["Khách tìm và đặt"]
  B --> C["Xác minh GPLX + CCCD qua eKYC"]
  C --> D["Ký hợp đồng điện tử + đặt cọc"]
  D --> E["Bàn giao: km, nhiên liệu, ảnh 8 góc"]
  E --> F["Đang thuê"]
  F --> G["Trả xe: đối chiếu ảnh, km, phát sinh"]
  G --> H["Quyết toán: hoàn cọc, trừ phát sinh"]
  H --> I["Chia doanh thu: garage, chủ xe ký gửi, sàn"]
```
