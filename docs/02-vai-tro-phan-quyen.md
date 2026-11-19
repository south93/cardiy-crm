# 02 · Vai trò & phân quyền

## 2.1 Ba cấp người dùng và phạm vi dữ liệu

```mermaid
flowchart TB
  classDef p fill:#dce6f6,stroke:#1f4e9c,color:#1e293b
  classDef t fill:#e3f4e6,stroke:#3e8a4f,color:#1e293b
  classDef c fill:#fff0e0,stroke:#b8692a,color:#1e293b

  subgraph P["CẤP SÀN · phạm vi: toàn hệ thống"]
    P1["SA · Super Admin"]:::p
    P2["AV · Admin vận hành sàn<br/>duyệt đối tác, kiểm duyệt, tranh chấp"]:::p
    P3["KS · Kế toán sàn<br/>phí gói đối tác, hoá đơn sàn"]:::p
    P4["MK · Marketing & Nội dung sàn"]:::p
    P5["GS · Giám sát chất lượng<br/>phản ánh, cứu hộ, vi phạm"]:::p
  end

  subgraph T["CẤP GARAGE / TENANT · phạm vi: garage của mình"]
    T1["CG · Chủ garage<br/>toàn quyền trong tenant"]:::t
    T2["QL · Quản lý chi nhánh<br/>phạm vi: chi nhánh"]:::t
    T3["BH · Bán hàng / Cố vấn dịch vụ"]:::t
    T4["KTV · Kỹ thuật viên<br/>phạm vi: việc được giao"]:::t
    T5["TK · Thủ kho"]:::t
    T6["KT · Kế toán garage"]:::t
    T7["CS · CSKH garage"]:::t
    T8["CH · Đội cứu hộ của garage"]:::t
  end

  subgraph C["CẤP KHÁCH · phạm vi: dữ liệu của chính mình"]
    C1["CX · Chủ xe cá nhân"]:::c
    C2["DN · Khách doanh nghiệp<br/>đội xe, nhiều tài xế"]:::c
    C3["Khách vãng lai<br/>chỉ xem"]:::c
  end

  P1 --> P2 & P3 & P4 & P5
  P2 -->|"duyệt / khoá"| T1
  T1 --> T2 --> T3 & T4 & T5 & T6 & T7 & T8
  C1 -.->|"đặt lịch, mua hàng"| T3
  C2 -.-> T3
```

**Quy tắc:**
- Một người có thể giữ **nhiều vai trò** và làm ở **nhiều chi nhánh**. Ví dụ: Quản lý kiêm Bán hàng.
- Một tài khoản chủ xe có thể đồng thời là nhân sự garage. Hai vai trò dùng chung đăng nhập, tách theo "không gian làm việc".
- Chủ garage tự tạo **vai trò tuỳ chỉnh** từ danh sách quyền có sẵn.

## 2.2 Ma trận quyền

Ký hiệu: **Q** toàn quyền · **T** tạo/sửa · **D** duyệt · **X** chỉ xem · **R** của mình · **—** không có quyền.

| Module | SA | AV | KS | CG | QL | BH | KTV | TK | KT | CS | CH | CX |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Dashboard garage | X | X | X | Q | X (CN) | X (bán hàng) | — | X (kho) | X (tài chính) | X (CSKH) | — | — |
| Khách hàng & Xe | X | X | — | Q | T | T | X (xe được giao) | — | X | T | X | R |
| Booking / Lịch hẹn | X | X | — | Q | T | T | X | — | — | T | — | R (tạo, huỷ) |
| Lệnh sửa chữa (RO) | X | X | — | Q | T + D | T | T (tiến độ, ảnh, checklist) | X | X | X | — | R (theo dõi) |
| Báo giá | X | X | — | Q | D (vượt ngưỡng) | T | Đề xuất phát sinh | — | X | — | — | D (duyệt online) |
| Kho & Phụ tùng | X | — | — | Q | X | X (tồn) | Yêu cầu xuất | Q | X | — | — | — |
| Nhập hàng / NCC | X | — | — | Q | D | — | — | T | X | — | — | — |
| Thu chi & Công nợ | X | — | X | Q | X | Thu tiền tại quầy | — | — | Q | — | — | R (hoá đơn) |
| Hoá đơn điện tử | X | — | X | Q | — | — | — | — | Q | — | — | R |
| Nhân sự & Hoa hồng | X | — | — | Q | T (CN) | R | R | R | T | R | R | — |
| Gian hàng trên sàn | Q | D | — | Q | T | T | — | T (tồn kho) | X | — | — | X |
| Yêu cầu đặt hàng từ sàn | X | X + phản ánh | — | Q | T | T | — | T (xuất kho) | X | T | — | R (gửi, huỷ) |
| Khuyến mại garage | X | X | — | Q | T | — | — | — | X | — | — | Dùng |
| Chương trình chung của sàn (garage tự tài trợ) | Q | T | — | Tham gia | — | — | — | — | — | — | — | Dùng |
| Phí đối tác & Hoá đơn sàn | Q | X | Q | R (xem, thanh toán) | — | — | — | — | R | — | — | — |
| Đánh giá | Q | Kiểm duyệt | — | Phản hồi | Phản hồi | — | — | — | — | Phản hồi | — | T (sau dịch vụ) |
| SOS Cứu hộ | X | X (giám sát) | — | Q | T | — | — | — | — | T | T (nhận ca) | T (gửi SOS) |
| Thuê xe | X | Kiểm duyệt tin | — | Q | T | T | — | — | X | T | — | T (thuê) |
| Xe cũ | Q | Kiểm duyệt | — | T (đăng, kiểm định) | T | T | Kiểm định | — | — | — | — | T (đăng bán) |
| Cộng đồng | Q | Kiểm duyệt | — | T | — | — | — | — | — | — | — | T |
| Marketing | Q | X | — | Q | T | — | — | — | — | T | — | Nhận tin (có đồng ý) |
| Trợ lý AI | Q | X | X | Q | X | X | X | X | X | X | — | Chatbot |
| Đối tác & Gói dịch vụ | Q | D | X | R (gói của mình) | — | — | — | — | — | — | — | — |
| Danh mục chuẩn | Q | T | — | Đề xuất mới | — | — | — | — | — | — | — | — |
| Cài đặt garage | X | — | — | Q | T (CN) | — | — | — | T (thuế) | — | — | — |
| Cấu hình sàn | Q | X | T (phí) | — | — | — | — | — | — | — | — | — |
| Nhật ký thao tác | X | X | X | X (tenant) | X (CN) | — | — | — | — | — | — | — |

## 2.3 Ngưỡng duyệt (cấu hình được theo tenant)

| Hành động | Ai tạo | Ai duyệt | Mặc định |
|---|---|---|---|
| Giảm giá trên RO | BH | QL nếu > 10% · CG nếu > 20% | 10% / 20% |
| Huỷ RO đã có thanh toán | QL | CG | Luôn cần duyệt |
| Điều chỉnh tồn kho (kiểm kê lệch) | TK | QL | Luôn cần duyệt |
| Chi tiền > ngưỡng | KT | CG | 5.000.000 đ |
| Hoàn tiền cho khách (garage tự hoàn) | QL | CG | Luôn cần duyệt |
