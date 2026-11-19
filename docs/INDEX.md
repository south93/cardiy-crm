# CARDIY · Bộ đặc tả sơ đồ hệ thống

Phần mềm quản lý chuỗi garage ô tô + sàn dịch vụ cho chủ xe + kênh đối tác garage.

| File | Nội dung |
|---|---|
| [01-tong-quan-he-thong.md](01-tong-quan-he-thong.md) | Ngữ cảnh, kiến trúc, 30+ module backend, nguyên tắc bắt buộc |
| [02-vai-tro-phan-quyen.md](02-vai-tro-phan-quyen.md) | 3 cấp người dùng, 15 vai trò, ma trận quyền, ngưỡng duyệt |
| [03-so-do-man-hinh.md](03-so-do-man-hinh.md) | Sitemap 6 ứng dụng A1–A6, có mã màn hình |
| [04-luong-nghiep-vu.md](04-luong-nghiep-vu.md) | 9 luồng F1–F9: đối tác, sửa chữa, mua hàng, dòng tiền, SOS, nhắc bảo dưỡng, tồn kho, xe cũ, thuê xe |
| [05-trang-thai.md](05-trang-thai.md) | 8 máy trạng thái S1–S8 |
| [06-mo-hinh-du-lieu.md](06-mo-hinh-du-lieu.md) | ERD 5 nhóm D1–D5, khoảng 70 bảng |
| [07-ke-hoach-xay-dung.md](07-ke-hoach-xay-dung.md) | Pha P0–P5, tiêu chí nghiệm thu, cách giao cho AI, câu hỏi cần chốt |

**Cách xem sơ đồ:**
- Mở `so-do-he-thong.html` (các sơ đồ đã được vẽ sẵn, xem không cần mạng).
- Hoặc đưa thư mục lên GitHub: GitHub tự vẽ khối ` ```mermaid `.
- Hoặc dùng VS Code với extension *Markdown Preview Mermaid Support*.
- Muốn sửa nhanh một sơ đồ: dán vào https://mermaid.live.

**Quy ước mã:** `A` ứng dụng/màn hình · `M` module · `F` luồng · `S` trạng thái · `D` nhóm dữ liệu · `P` pha.
