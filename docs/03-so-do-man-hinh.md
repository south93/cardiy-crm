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
        Giá, gồm lắp đặt hay không, voucher của garage
        Chọn năm sản xuất, số lượng
        Gửi yêu cầu đặt hàng + lịch lắp tới garage
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
      Kết nối garage có dịch vụ cứu hộ gần nhất
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
      Gửi yêu cầu tới garage
      Yêu cầu của tôi
      Thông tin thanh toán của garage
    A2.07 Thanh toán & Hoá đơn
      Lịch sử thanh toán tại các garage
      Hoá đơn điện tử do garage xuất
      Voucher & Điểm thưởng
    A2.08 Thuê xe
      Đơn thuê, hợp đồng, bàn giao
    A2.09 Xe cũ
      Tin đăng của tôi
      Đăng bán + đặt kiểm định
      Tin đã lưu, chat
    A2.10 SOS
      Gửi yêu cầu + vị trí GPS
      Theo dõi đội cứu hộ của garage, ETA
      Giá do garage báo, trả trực tiếp cho garage
    A2.11 Cộng đồng
    A2.12 Thông báo
    A2.13 Tài khoản
      Hồ sơ, Bảo mật
      Đồng ý nhận tin
      Xuất / xoá dữ liệu
      Doanh nghiệp: quản lý tài xế
```

## A3 · CRM garage PLG (chỉ PLG dùng)

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
      A3.43 Ca cứu hộ: nhận ca, điều đội
    Kênh người bán
      A3.50 Hồ sơ gian hàng
      A3.51 Sản phẩm đăng bán
      A3.52 Dịch vụ đăng bán + bảng giá
      A3.53 Yêu cầu đặt hàng từ sàn
      A3.54 Khuyến mại & Voucher
      A3.55 Đánh giá & phản hồi
      A3.56 Phí gói & Hoá đơn sàn
      A3.57 Thống kê gian hàng: lượt xem, yêu cầu
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

## A4 · App kỹ thuật viên & A5 · App cứu hộ của PLG (PWA, tối ưu điện thoại)

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

## A7 · Cổng đối tác (1 tài khoản / đối tác, trên web của PLG)

```mermaid
mindmap
  root((A7 Cổng đối tác))
    A7.01 Trang chủ
      Việc cần xử lý hôm nay
      Yêu cầu mới, ca cứu hộ đang chờ
    Gian hàng
      A7.10 Hồ sơ gian hàng
        Thông tin, địa chỉ trên bản đồ, giờ mở cửa
        Chính sách đổi trả, huỷ, bảo hành
      A7.11 Sản phẩm
        Chọn từ danh mục chuẩn của sàn
        Giá, số lượng tồn, gồm lắp đặt hay không
      A7.12 Dịch vụ
        Bảo dưỡng, sửa chữa, đồng sơn
        Cứu hộ: vùng phục vụ, giá, hotline
        Thuê xe: xe, giá ngày, đặt cọc
        Kiểm định xe cũ
      A7.13 Khuyến mại
    Yêu cầu từ khách
      A7.20 Đặt hàng và đặt lịch
        Xác nhận, chốt giá, từ chối
        Đánh dấu đã thu tiền, hoàn tất
      A7.21 Cứu hộ: nhận ca, cập nhật vị trí, chốt giá
      A7.22 Thuê xe: xác minh, bàn giao, trả xe
      A7.23 Kiểm định xe cũ: checklist, báo cáo
      A7.24 Đánh giá: trả lời
    Báo cáo và phí
      A7.30 Thống kê: lượt xem, yêu cầu, tỉ lệ chốt
      A7.31 Phí gói và hoá đơn
    A7.40 Tài khoản và bảo mật
```

## A6 · Admin sàn

```mermaid
mindmap
  root((A6 Admin sàn))
    A6.01 Dashboard sàn
      Lượt xem, Yêu cầu gửi garage, Đối tác mới, SOS
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
    Giám sát
      A6.40 Yêu cầu đặt hàng: theo dõi
      A6.41 Phản ánh của khách
      A6.42 Xử lý vi phạm garage
    Phí đối tác
      A6.50 Gói & Bảng giá
      A6.51 Hoá đơn phí theo kỳ
      A6.52 Ghi nhận thanh toán phí
      A6.53 Công nợ phí, nhắc phí
      A6.54 Xuất hoá đơn điện tử phí
    A6.60 Chương trình khuyến mại chung
    A6.61 Giám sát cứu hộ
    A6.62 Nội dung: Blog, Banner, Sách nói
    A6.63 Thông báo: Template, Chiến dịch
    A6.70 Người dùng & Nhân sự sàn
    A6.80 Báo cáo sàn
    A6.90 Cấu hình
      Phí theo gói
      Gói đối tác, Thuế
      Tích hợp, Nhật ký thao tác
```
