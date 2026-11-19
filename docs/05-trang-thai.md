# 05 · Máy trạng thái

> Mỗi lần chuyển trạng thái phải: kiểm tra quyền, ghi `audit_log`, phát `domain_event`. Chuyển trạng thái **chỉ** theo đúng mũi tên trong sơ đồ; mọi chuyển khác đều bị API từ chối.

## S1 · Lệnh sửa chữa (RO)

```mermaid
stateDiagram-v2
  [*] --> TIEP_NHAN: Check-in / từ booking / từ SOS
  TIEP_NHAN --> KIEM_TRA: Giao KTV
  KIEM_TRA --> BAO_GIA: KTV gửi kết quả
  BAO_GIA --> CHO_DUYET: Gửi khách
  CHO_DUYET --> DANG_SUA: Khách duyệt (toàn bộ hoặc một phần)
  CHO_DUYET --> HUY: Khách từ chối, thu phí kiểm tra
  DANG_SUA --> CHO_PHU_TUNG: Thiếu hàng
  CHO_PHU_TUNG --> DANG_SUA: Hàng về
  DANG_SUA --> CHO_DUYET: Phát sinh hạng mục
  DANG_SUA --> KIEM_TRA_CL: KTV báo xong
  KIEM_TRA_CL --> DANG_SUA: Không đạt
  KIEM_TRA_CL --> HOAN_THANH: Đạt
  HOAN_THANH --> DA_THANH_TOAN: Thu đủ tiền
  HOAN_THANH --> CONG_NO: Khách doanh nghiệp ghi nợ
  CONG_NO --> DA_THANH_TOAN: Tất toán
  DA_THANH_TOAN --> DA_GIAO_XE: Giao xe
  DA_GIAO_XE --> [*]
  TIEP_NHAN --> HUY
  KIEM_TRA --> HUY
  HUY --> [*]
```

## S2 · Booking

```mermaid
stateDiagram-v2
  [*] --> CHO_XAC_NHAN
  CHO_XAC_NHAN --> DA_XAC_NHAN: Garage xác nhận
  CHO_XAC_NHAN --> TU_CHOI: Garage từ chối / hết chỗ
  DA_XAC_NHAN --> DA_DEN: Check-in → tạo RO
  DA_XAC_NHAN --> KHONG_DEN: Quá giờ 60 phút
  DA_XAC_NHAN --> KHACH_HUY: Khách huỷ
  CHO_XAC_NHAN --> KHACH_HUY
  DA_DEN --> [*]
  TU_CHOI --> [*]
  KHONG_DEN --> [*]
  KHACH_HUY --> [*]
```

## S3 · Đơn hàng sàn

```mermaid
stateDiagram-v2
  [*] --> CHO_THANH_TOAN
  CHO_THANH_TOAN --> DA_THANH_TOAN: Thanh toán thành công
  CHO_THANH_TOAN --> HUY: Hết 30 phút giữ hàng
  CHO_THANH_TOAN --> CHO_GARAGE_XAC_NHAN: Chọn trả tại garage
  DA_THANH_TOAN --> CHO_GARAGE_XAC_NHAN
  CHO_GARAGE_XAC_NHAN --> DANG_CHUAN_BI: Garage xác nhận
  CHO_GARAGE_XAC_NHAN --> HUY: Garage từ chối → hoàn tiền
  DANG_CHUAN_BI --> DANG_LAP_DAT: Khách đến, tạo RO lắp
  DANG_CHUAN_BI --> DANG_GIAO: Giao tận nơi
  DANG_LAP_DAT --> HOAN_THANH
  DANG_GIAO --> HOAN_THANH
  HOAN_THANH --> KHIEU_NAI: Trong hạn khiếu nại
  KHIEU_NAI --> HOAN_TIEN: Sàn xử khách thắng
  KHIEU_NAI --> DA_DOI_SOAT: Garage thắng
  HOAN_THANH --> DA_DOI_SOAT: Hết hạn khiếu nại
  HOAN_TIEN --> [*]
  DA_DOI_SOAT --> [*]
  HUY --> [*]
```

## S4 · Đối tác garage (tenant)

```mermaid
stateDiagram-v2
  [*] --> NHAP: Bắt đầu đăng ký
  NHAP --> CHO_DUYET: Gửi hồ sơ
  CHO_DUYET --> CAN_BO_SUNG: Thiếu giấy tờ
  CAN_BO_SUNG --> CHO_DUYET: Bổ sung
  CHO_DUYET --> TU_CHOI
  CHO_DUYET --> CHO_KY_HOP_DONG: Duyệt
  CHO_KY_HOP_DONG --> DANG_THIET_LAP: Ký xong
  DANG_THIET_LAP --> HOAT_DONG: Có ít nhất 1 dịch vụ/sản phẩm được duyệt
  HOAT_DONG --> TAM_KHOA: Vi phạm / quá hạn phí
  TAM_KHOA --> HOAT_DONG: Khắc phục
  HOAT_DONG --> CHAM_DUT: Hết hợp đồng / chấm dứt
  TAM_KHOA --> CHAM_DUT
  TU_CHOI --> [*]
  CHAM_DUT --> [*]
```

## S5 · Tin đăng sản phẩm / dịch vụ của garage (offer)

```mermaid
stateDiagram-v2
  [*] --> NHAP
  NHAP --> CHO_DUYET: Gửi duyệt (lần đầu hoặc đổi thông tin quan trọng)
  CHO_DUYET --> DANG_BAN: Đạt
  CHO_DUYET --> BI_TU_CHOI: Không đạt + lý do
  BI_TU_CHOI --> NHAP: Sửa lại
  DANG_BAN --> HET_HANG: Tồn khả dụng = 0
  HET_HANG --> DANG_BAN: Nhập thêm
  DANG_BAN --> TAM_AN: Garage tự ẩn
  TAM_AN --> DANG_BAN
  DANG_BAN --> BI_GO: Sàn gỡ do vi phạm
  BI_GO --> [*]
```

## S6 · Ca cứu hộ SOS

```mermaid
stateDiagram-v2
  [*] --> MOI
  MOI --> DANG_TIM_DOI
  DANG_TIM_DOI --> DA_NHAN: Đội nhận ca
  DANG_TIM_DOI --> DIEU_PHOI_TAY: Hết 2 phút
  DIEU_PHOI_TAY --> DA_NHAN
  DA_NHAN --> DANG_DEN
  DANG_DEN --> TAI_HIEN_TRUONG
  TAI_HIEN_TRUONG --> XU_LY_TAI_CHO
  TAI_HIEN_TRUONG --> DANG_KEO_XE
  DANG_KEO_XE --> DA_BAN_GIAO_GARAGE: Tạo RO
  XU_LY_TAI_CHO --> HOAN_THANH
  DA_BAN_GIAO_GARAGE --> HOAN_THANH
  MOI --> KHACH_HUY
  DANG_TIM_DOI --> KHACH_HUY
  DA_NHAN --> KHACH_HUY: Có thể tính phí huỷ
  HOAN_THANH --> [*]
  KHACH_HUY --> [*]
```

## S7 · Yêu cầu rút tiền (payout)

```mermaid
stateDiagram-v2
  [*] --> YEU_CAU
  YEU_CAU --> DANG_KIEM_TRA: Kế toán sàn nhận
  DANG_KIEM_TRA --> DA_DUYET
  DANG_KIEM_TRA --> TU_CHOI: Sai thông tin / đang tranh chấp
  DA_DUYET --> DANG_CHUYEN
  DANG_CHUYEN --> THANH_CONG
  DANG_CHUYEN --> THAT_BAI: Ngân hàng trả về
  THAT_BAI --> YEU_CAU: Tiền về lại ví
  THANH_CONG --> [*]
  TU_CHOI --> [*]
```

## S8 · Hợp đồng thuê xe

```mermaid
stateDiagram-v2
  [*] --> DAT_TRUOC
  DAT_TRUOC --> DA_XAC_MINH: eKYC đạt
  DAT_TRUOC --> HUY
  DA_XAC_MINH --> DA_KY_COC: Ký hợp đồng + cọc
  DA_KY_COC --> DANG_THUE: Bàn giao xe
  DANG_THUE --> DA_TRA_XE
  DANG_THUE --> QUA_HAN: Quá giờ trả
  QUA_HAN --> DA_TRA_XE
  DA_TRA_XE --> DA_QUYET_TOAN: Hoàn cọc / trừ phát sinh
  DA_QUYET_TOAN --> [*]
  HUY --> [*]
```
