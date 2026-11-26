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

## S3 · Yêu cầu đặt hàng từ sàn

```mermaid
stateDiagram-v2
  [*] --> CHO_GARAGE_XAC_NHAN: Khách gửi yêu cầu, giữ tồn tạm
  CHO_GARAGE_XAC_NHAN --> DA_XAC_NHAN: Garage xác nhận, chốt giá
  CHO_GARAGE_XAC_NHAN --> TU_CHOI: Garage từ chối
  CHO_GARAGE_XAC_NHAN --> HET_HAN: Quá 24 giờ, nhả tồn
  CHO_GARAGE_XAC_NHAN --> KHACH_HUY
  DA_XAC_NHAN --> KHACH_HUY
  DA_XAC_NHAN --> DANG_LAP_DAT: Khách đến, tạo RO lắp
  DA_XAC_NHAN --> DANG_GIAO: Garage giao tận nơi
  DA_XAC_NHAN --> KHONG_DEN: Quá giờ hẹn
  DANG_LAP_DAT --> HOAN_THANH: Garage ghi nhận đã thu tiền
  DANG_GIAO --> HOAN_THANH: Garage ghi nhận đã thu tiền
  HOAN_THANH --> [*]
  TU_CHOI --> [*]
  HET_HAN --> [*]
  KHACH_HUY --> [*]
  KHONG_DEN --> [*]
```

> **Đã làm (vòng 3.4), bản rút gọn:** `CHO_XAC_NHAN → DA_XAC_NHAN → HOAN_THANH`, cùng `TU_CHOI`, `HET_HAN` (24 giờ, tính khi đọc), `KHACH_HUY`, `KHONG_DEN`. Chưa tách `DANG_LAP_DAT` / `DANG_GIAO`: garage xác nhận rồi bấm Hoàn tất khi khách đã đến lắp / nhận và đã trả tiền. PLG chưa tự tạo lệnh sửa chữa từ yêu cầu (nhân viên lập đơn trong CRM như thường).

> Không có trạng thái thanh toán, hoàn tiền hay đối soát vì tiền không đi qua sàn. Phản ánh của khách là một đối tượng riêng (`market_reports`: `MOI → CHO_GIAI_TRINH → DA_GIAI_TRINH → DA_XU_LY | TU_CHOI`), không làm thay đổi trạng thái yêu cầu.

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
  MOI --> DANG_TIM_GARAGE
  DANG_TIM_GARAGE --> DA_NHAN: Một garage nhận ca
  DANG_TIM_GARAGE --> KHONG_CO_GARAGE: Hết 3 phút, hiện hotline các garage
  DA_NHAN --> DANG_DEN: Garage điều đội
  DANG_DEN --> TAI_HIEN_TRUONG
  TAI_HIEN_TRUONG --> XU_LY_TAI_CHO
  TAI_HIEN_TRUONG --> DANG_KEO_XE
  DANG_KEO_XE --> DA_VE_GARAGE: Tạo RO tại garage nhận ca
  XU_LY_TAI_CHO --> HOAN_THANH: Garage ghi nhận đã thu
  DA_VE_GARAGE --> HOAN_THANH
  MOI --> KHACH_HUY
  DANG_TIM_GARAGE --> KHACH_HUY
  DA_NHAN --> KHACH_HUY: Theo chính sách huỷ của garage
  HOAN_THANH --> [*]
  KHACH_HUY --> [*]
  KHONG_CO_GARAGE --> [*]
```

## S7 · Hoá đơn phí đối tác

```mermaid
stateDiagram-v2
  [*] --> DA_PHAT_HANH: Đầu kỳ, theo gói
  DA_PHAT_HANH --> DA_THANH_TOAN: Kế toán sàn ghi nhận
  DA_PHAT_HANH --> QUA_HAN: Quá hạn thanh toán
  QUA_HAN --> DA_THANH_TOAN
  QUA_HAN --> GIAN_HANG_TAM_AN: Quá hạn 15 ngày
  GIAN_HANG_TAM_AN --> DA_THANH_TOAN: Thanh toán, hiện lại gian hàng
  DA_THANH_TOAN --> [*]
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
