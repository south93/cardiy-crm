# 04 · Luồng nghiệp vụ

## F1 · Garage đăng ký làm đối tác

> **Đã làm ở vòng 3.1 (bản rút gọn):** form công khai `/dang-ky-doi-tac` → người nộp nhận link theo dõi (mã hồ sơ + mã bí mật) để tải giấy tờ, sửa hồ sơ khi được yêu cầu bổ sung → Admin sàn duyệt ở A6.10 → hệ thống tạo tenant đối tác (Đang thiết lập), tài khoản Đối tác bằng SĐT đăng ký (mật khẩu tạm, Sàn gửi tay), gói và hoá đơn phí kỳ đầu (hạn 7 ngày) → Kế toán sàn ghi nhận đã thu ở A6.50 → đối tác chuyển Hoạt động. **Chưa làm:** OTP xác thực SĐT/email khi nộp, eKYC CCCD, đối chiếu MST tự động, hợp đồng ký số, tự gửi thông tin đăng nhập (Zalo/SMS). Sơ đồ dưới là luồng đầy đủ dự kiến.

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
    API->>API: Tạo tenant đối tác + 1 tài khoản Đối tác (Cổng đối tác A7), hoá đơn phí kỳ đầu
    API->>N: Gửi thông tin đăng nhập Cổng đối tác A7 + hướng dẫn
  else Từ chối
    AV->>API: Từ chối + lý do
    API->>N: Báo kết quả
  end
  G->>API: Thiết lập gian hàng: hồ sơ, sản phẩm, dịch vụ (cứu hộ, thuê xe, kiểm định…)
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
  participant PAY as Thanh toán garage M24

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
  CX->>PAY: Trả trực tiếp cho garage: VietQR của garage / thẻ / tiền mặt
  PAY-->>API: Garage ghi nhận đã thu, vào sổ quỹ garage
  API->>API: Garage xuất hoá đơn điện tử, kích hoạt bảo hành
  BH->>CX: Giao xe
  API->>API: Tạo lịch nhắc bảo dưỡng + lịch gọi chăm sóc sau 3 ngày
  CX->>API: Đánh giá
```

## F3 · Đặt sản phẩm trên sàn + lắp tại garage

Theo mẫu trang lốp: một sản phẩm chuẩn có nhiều garage cùng bán. **Sàn chỉ chuyển yêu cầu, khách trả tiền trực tiếp cho garage.**

```mermaid
sequenceDiagram
  autonumber
  actor CX as Chủ xe
  participant W as A1/A2
  participant API as Backend M22-M23
  actor G as Đối tác A7 hoặc PLG A3

  CX->>W: Mở trang sản phẩm chuẩn, ví dụ Lốp 265/60R18
  W->>API: Lấy danh sách offer của các garage
  API-->>W: Giá, có gồm lắp đặt không, khoảng cách, đánh giá, đã bán, voucher của garage
  CX->>W: Chọn garage, năm sản xuất, số lượng, khung giờ lắp
  W->>API: Gửi yêu cầu đặt hàng + lịch lắp
  API->>API: Giữ tồn tạm của offer trong 24 giờ
  API-->>G: Yêu cầu mới, realtime + Zalo
  alt Garage xác nhận
    G->>API: Xác nhận, chốt giá cuối
    API-->>CX: Xác nhận + thông tin thanh toán của garage
  else Garage từ chối hoặc quá 24 giờ
    API->>API: Huỷ, nhả tồn
    API-->>CX: Gợi ý garage khác đang bán sản phẩm này
  end
  CX->>G: Đến garage lắp đặt
  G->>API: Tạo RO lắp đặt từ yêu cầu
  CX->>G: Thanh toán trực tiếp cho garage
  G->>API: Ghi nhận đã thu, hoàn tất
  Note over API: Sàn không nhận, không giữ tiền của khách
  CX->>API: Đánh giá sản phẩm + garage
```

## F4 · Dòng tiền

```mermaid
flowchart LR
  classDef g fill:#e3f4e6,stroke:#3e8a4f,color:#1e293b
  classDef p fill:#dce6f6,stroke:#1f4e9c,color:#1e293b
  CX["Chủ xe"] -->|"Tiền hàng, dịch vụ, cứu hộ, thuê xe<br/>VietQR của garage · thẻ · tiền mặt"| G["Garage"]:::g
  G --> SQ["Sổ quỹ garage M15<br/>garage tự xuất hoá đơn điện tử"]:::g
  G -->|"Phí gói đối tác theo kỳ"| P["Sàn CARDIY"]:::p
  P --> HD["Hoá đơn phí M25<br/>sàn xuất hoá đơn điện tử phí"]:::p
  HD -->|"Quá hạn 15 ngày"| K["Tạm ẩn gian hàng trên sàn"]
  HD -->|"Đã thanh toán"| OK["Gian hàng hoạt động bình thường"]
```

> Tiền của khách **không bao giờ** đi qua sàn. Hoàn tiền, đổi trả và bảo hành do garage xử lý theo chính sách garage công bố trên gian hàng. Sàn tiếp nhận **phản ánh**, yêu cầu garage giải trình, và có thể ẩn hoặc khoá gian hàng vi phạm.

## F5 · Cứu hộ SOS: sàn kết nối, garage thực hiện

```mermaid
sequenceDiagram
  autonumber
  actor CX as Chủ xe A2
  participant API as Backend M33
  actor G as Đối tác A7 hoặc PLG A3<br/>có dịch vụ cứu hộ
  actor CH as Đội cứu hộ<br/>của đối tác hoặc PLG A5

  CX->>API: Bấm SOS: vị trí GPS, loại sự cố, ảnh
  API->>API: Tìm garage có dịch vụ cứu hộ, đang trực, trong bán kính
  API-->>G: Gửi yêu cầu cho các garage phù hợp
  alt Một garage nhận trong 3 phút
    G->>API: Nhận ca, báo giá dự kiến
    G->>CH: Điều đội cứu hộ của garage
    API-->>CX: Garage, đội, ETA, giá dự kiến
  else Không garage nào nhận
    API-->>CX: Danh sách hotline cứu hộ của các garage gần nhất để gọi trực tiếp
  end
  loop Mỗi 10 giây
    CH->>API: Cập nhật GPS
    API-->>CX: Vị trí trên bản đồ
  end
  CH->>API: Đến nơi, ảnh hiện trường, chốt giá
  alt Xử lý tại chỗ
    CH->>API: Hoàn thành
    CX->>CH: Thanh toán trực tiếp cho garage
  else Kéo về garage
    CH->>API: Kéo về garage của mình
    API->>API: Tạo RO tại garage đó
  end
  CX->>API: Đánh giá garage
  Note over API: Sàn chỉ kết nối và hiển thị. Đội, giá, thu tiền thuộc garage
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

## F7 · Đồng bộ tồn kho với tin đăng trên sàn (chỉ PLG)

> Đối tác không có CRM: nhập **số lượng tồn trực tiếp trên tin đăng** ở Cổng đối tác. Luồng dưới chỉ áp dụng cho sản phẩm PLG bán trên sàn.

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
  B -->|"Đặt kiểm định"| C["Booking kiểm định: dịch vụ của garage đối tác, khách trả cho garage"]
  C --> D["KTV chấm checklist ~150 điểm + ảnh"]
  D --> E["Báo cáo kiểm định gắn vào tin, có huy hiệu"]
  B -->|"Không"| F["Tin thường"]
  E & F --> G["Kiểm duyệt A6.31"]
  G -->|"Đạt"| H["Hiển thị trên sàn"]
  G -->|"Không đạt"| A
  H --> I["Người mua chat, hẹn xem xe"]
  I --> J["Đánh dấu đã bán / hết hạn sau 60 ngày"]
```

> **Đã làm (vòng 4.3):** Chủ xe trên App chủ xe (`A2.09`) hoặc garage PLG / Đối tác (`A3.61`, `A7.23`) tạo tin bán xe cũ (`XC…`, kèm ảnh giấy tờ riêng tư chỉ người bán – garage kiểm định – kiểm duyệt sàn xem được). Chủ xe có thể đặt lịch kiểm định tại bất kỳ garage đang bật dịch vụ kiểm định (hoặc garage tự lập phiếu kiểm định cho xe mình bán); KTV / garage chấm checklist 6 nhóm kỹ thuật (100 điểm), chụp ảnh báo cáo và thu phí trực tiếp tại garage → báo cáo gắn vào tin (huy hiệu **Đã kiểm định** khi đạt chuẩn). Mọi tin gửi duyệt qua Kiểm duyệt `A6.31` trước khi hiển thị công khai trên `/cho/xe-cu` (`A1.07`); tự động hết hạn sau 60 ngày (`expires_at`), người mua gửi tin nhắn chat & đặt lịch hẹn xem xe trực tiếp với người bán.

## F9 · Thuê xe

```mermaid
flowchart LR
  A["Garage đăng xe cho thuê của garage: giá ngày, cọc, điều kiện<br/>sàn chỉ hiển thị"] --> B["Khách tìm và đặt"]
  B --> C["Xác minh GPLX + CCCD qua eKYC"]
  C --> D["Ký hợp đồng với garage + đặt cọc cho garage"]
  D --> E["Bàn giao: km, nhiên liệu, ảnh 8 góc"]
  E --> F["Đang thuê"]
  F --> G["Trả xe: đối chiếu ảnh, km, phát sinh"]
  G --> H["Quyết toán: hoàn cọc, trừ phát sinh"]
  H --> I["Garage thu tiền trực tiếp, ghi sổ quỹ garage"]
```
