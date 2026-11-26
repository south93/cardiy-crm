# QUY TẮC PHÁT TRIỂN DỰ ÁN CARDIY-CRM (TỪ VÒNG 3.5)

1. **Kế thừa & Kiến trúc:** Dự án đã hoàn thiện đến hết vòng 3.4 (PR #29 đã merge vào `develop`), bao gồm: CRM cốt lõi, Cổng đối tác (`Cổng đối tác`), và Sàn thương mại (`/cho`, đặt hàng/đặt lịch, giữ tồn, voucher). Giữ nguyên toàn bộ cấu trúc thư mục, coding style, UI components và luồng xử lý hiện tại.
2. **Bảo vệ dữ liệu & Phân quyền:** Mọi query dữ liệu mới bắt buộc tuân thủ middleware phân quyền giữa PLG (Admin sàn/CRM) và Đối tác (Partner), đồng thời đảm bảo lọc dữ liệu chính xác theo từng gian hàng / chi nhánh.
3. **Database:** Không sửa đổi hoặc xóa cột/bảng của các vòng trước (từ 0.1 đến 3.4). Chỉ tạo migration mới phục vụ cho vòng 3.5.
4. **Chất lượng code & CI:** Repo có hệ thống CI tự động kiểm tra (lint, unit tests, build, E2E, Docker). Trước khi báo cáo hoàn thành bất kỳ phần nào, bắt buộc chạy kiểm tra lint, type-check và test cục bộ để đảm bảo không làm vỡ build hay các test E2E cũ.
5. **Thư viện:** Không tự ý cài thêm package ngoài nếu chưa được xác nhận.
