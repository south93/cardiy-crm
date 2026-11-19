# 03 · Sơ đồ màn hình (sitemap) từng ứng dụng

> Mỗi nút lá là **một màn hình hoặc một tab**. Mã màn hình (ví dụ `A3.12`) dùng xuyên suốt khi giao việc cho AI và khi kiểm thử.

## A1 · Web công khai / Sàn (SEO, không cần đăng nhập để xem)

```mermaid
mindmap
  root((A1 Sàn CARDIY))
    A1.01 Trang chủ
      Tìm theo xe của bạn
      Dịch vụ nổi bật
      Garage gần bạn
      Khuyến mại
    A1.02 Tìm garage
      Bản đồ + danh sách
      Lọc dịch vụ, khoảng cách, đánh giá, giá
    A1.03 Trang garage
      Giới thiệu, giờ mở cửa, chi nhánh
      Bảng giá dịch vụ
      Sản phẩm đang bán
      Đánh giá
      Nút Đặt lịch
    A1.04 Sản phẩm
      Danh mục: Lốp, Ắc quy, Dầu nhớt, Phụ tùng, Phụ kiện
      Tìm theo dòng xe / kích cỡ
      A1.05 Chi tiết sản phẩm
        Thông số, Mô tả, Đánh giá
        Danh sách garage đang bán
        Sắp xếp: giá tốt, gần nhất, bán chạy
        Giá, gồm lắp đặt hay không, voucher garage, voucher sàn
        Chọn năm sản xuất, số lượng
        Mua & đặt lịch lắp
    A1.06 Dịch vụ
      Bảo dưỡng, Sửa chữa, Đồng sơn, Chăm sóc xe, Đăng kiểm hộ
      Chi tiết dịch vụ: so sánh giá giữa các garage
    A1.07 Xe cũ
      Tìm và lọc
      Chi tiết xe + báo cáo kiểm định
      Chat với người bán
    A1.08 Thuê xe
      Tìm xe theo ngày, địa điểm
      Chi tiết + đặt thuê
    A1.09 Cứu hộ SOS
    A1.10 Cộng đồng
      Blog, Sách nói, Playlist, Hỏi đáp
    A1.11 Dành cho garage
      Giới thiệu chương trình đối tác
      Bảng giá gói
      Form đăng ký đối tác
    A1.12 Tài khoản
      Đăng nhập OTP / Google / Zalo
      Đăng ký
```

## A2 · App chủ xe (PWA, sau làm app iOS/Android)

```mermaid
mindmap
  root((A2 App chủ xe))
    A2.01 Trang chủ
      Xe đang chọn + km hiện tại
      Nhắc nhở sắp tới
      Đơn đang xử lý realtime
      Nút SOS nổi
    A2.02 Garage của tôi
      Danh sách xe
      A2.03 Hồ sơ xe
        Thông tin, giấy tờ, bảo hiểm, đăng kiểm
        Cập nhật km
        Lịch sử sửa chữa
        Lịch bảo dưỡng thông minh
    A2.04 Đặt lịch
      Chọn xe, dịch vụ, garage, khung giờ
      Mô tả triệu chứng + ảnh/ghi âm
    A2.05 Đơn sửa chữa
      Theo dõi tiến độ + ảnh trước/sau
      Duyệt / từ chối báo giá, hạng mục phát sinh
      Thanh toán
      Đánh giá
    A2.06 Mua sắm
      Giỏ hàng
      Thanh toán + chọn garage lắp
      Đơn hàng của tôi
    A2.07 Ví & Thanh toán
      Số dư ví, nạp tiền
      Phương thức thanh toán
      Lịch sử giao dịch
      Hoá đơn
      Hoàn tiền
      Voucher & Điểm thưởng
    A2.08 Thuê xe
      Đơn thuê, hợp đồng, bàn giao
    A2.09 Xe cũ
      Tin đăng của tôi
      Đăng bán + đặt kiểm định
      Tin đã lưu, chat
    A2.10 SOS
      Gửi yêu cầu + vị trí GPS
      Theo dõi xe cứu hộ, ETA, giá
    A2.11 Cộng đồng
    A2.12 Thông báo
    A2.13 Tài khoản
      Hồ sơ, Bảo mật
      Đồng ý nhận tin
      Xuất / xoá dữ liệu
      Doanh nghiệp: quản lý tài xế
```

## A3 · Web quản trị Garage (CRM + Kênh người bán)

```mermaid
mindmap
  root((A3 CRM Garage))
    A3.01 Tổng quan
    A3.02 Trang chủ lưới chức năng
    Kinh doanh
      A3.10 Tiếp nhận xe / Tạo RO
      A3.11 Đơn đang xử lý Kanban
      A3.12 Chi tiết RO
        Hạng mục, Báo giá, Giao việc
        Ảnh & checklist, Phát sinh
        Thanh toán, Bảo hành, In phiếu
      A3.13 Đơn hoàn thành
      A3.14 Báo giá nhanh
    Kho hàng
      A3.20 Danh mục sản phẩm
      A3.21 Tồn kho chi nhánh
      A3.22 Phiếu nhập / xuất / chuyển kho
      A3.23 Kiểm kê
      A3.24 Nhà cung cấp & Đặt hàng
    Đối tác
      A3.30 Khách hàng
      A3.31 Hồ sơ khách hàng
      A3.32 Xe
      A3.33 Khách doanh nghiệp / Đội xe
    Dịch vụ
      A3.40 Lịch sửa chữa theo khoang, KTV
      A3.41 Lịch gọi / Chăm sóc
      A3.42 Booking từ sàn
      A3.43 Ca cứu hộ
    Kênh người bán
      A3.50 Hồ sơ gian hàng
      A3.51 Sản phẩm đăng bán
      A3.52 Dịch vụ đăng bán + bảng giá
      A3.53 Đơn hàng từ sàn
      A3.54 Khuyến mại & Voucher
      A3.55 Đánh giá & phản hồi
      A3.56 Đối soát & Rút tiền
    Mở rộng
      A3.60 Thuê xe: đội xe, hợp đồng
      A3.61 Xe cũ: tin đăng, kiểm định
      A3.62 Marketing: phân khúc, chiến dịch
      A3.63 Trợ lý AI
    Nhân sự & Tài chính
      A3.70 Nhân viên & Vai trò
      A3.71 Chấm công & Hoa hồng
      A3.72 Thu chi / Sổ quỹ
      A3.73 Công nợ phải thu, phải trả
      A3.74 Hoá đơn điện tử
    A3.80 Báo cáo
      Doanh thu, Lợi nhuận, Năng suất KTV
      Tồn kho, Khách quay lại, Sàn
    A3.90 Cài đặt
      Thông tin garage, Chi nhánh, Khoang sửa
      Bảng giá công, Mẫu in, Thuế
      Tích hợp, Gói dịch vụ đang dùng
      Nhật ký thao tác
```

## A4 · App kỹ thuật viên & A5 · App cứu hộ (PWA, tối ưu điện thoại)

```mermaid
mindmap
  root((A4 KTV · A5 Cứu hộ))
    A4 Kỹ thuật viên
      A4.01 Việc của tôi hôm nay
      A4.02 Chi tiết công việc
        Bắt đầu / tạm dừng / xong, bấm giờ
        Checklist kiểm tra
        Chụp ảnh, quay video trước và sau
        Đề xuất hạng mục phát sinh
        Yêu cầu xuất phụ tùng
      A4.03 Quét biển số / VIN
      A4.04 Chấm công
      A4.05 Thu nhập & hoa hồng
    A5 Cứu hộ
      A5.01 Ca chờ nhận
      A5.02 Ca đang chạy
        Dẫn đường, cập nhật GPS
        Ảnh hiện trường
        Chốt giá, thu tiền
        Chuyển xe về garage, tạo RO
      A5.03 Lịch sử ca
```

## A6 · Admin sàn

```mermaid
mindmap
  root((A6 Admin sàn))
    A6.01 Dashboard sàn
      GMV, Đơn, Đối tác mới, SOS
    Đối tác garage
      A6.10 Hồ sơ chờ duyệt
      A6.11 Đối tác đang hoạt động
      A6.12 Tạm khoá / Chấm dứt
      A6.13 Gói dịch vụ & Hợp đồng
    Danh mục chuẩn
      A6.20 Sản phẩm chuẩn SKU
      A6.21 Dịch vụ chuẩn
      A6.22 Thương hiệu, Thuộc tính
      A6.23 Hãng / Dòng / Đời xe
      A6.24 Đề xuất danh mục từ garage
    Kiểm duyệt
      A6.30 Tin đăng sản phẩm
      A6.31 Tin xe cũ
      A6.32 Bài cộng đồng
      A6.33 Đánh giá bị báo cáo
    Giao dịch
      A6.40 Đơn hàng sàn
      A6.41 Khiếu nại & Tranh chấp
      A6.42 Hoàn tiền
    Tài chính
      A6.50 Giao dịch & Ví
      A6.51 Đối soát theo kỳ
      A6.52 Hoa hồng & Phí
      A6.53 Duyệt Payout
      A6.54 Hoá đơn phí sàn
    A6.60 Khuyến mại sàn
    A6.61 Điều phối cứu hộ
    A6.62 Nội dung: Blog, Banner, Sách nói
    A6.63 Thông báo: Template, Chiến dịch
    A6.70 Người dùng & Nhân sự sàn
    A6.80 Báo cáo sàn
    A6.90 Cấu hình
      Phí & hoa hồng theo danh mục
      Gói đối tác, Thuế
      Tích hợp, Nhật ký thao tác
```
