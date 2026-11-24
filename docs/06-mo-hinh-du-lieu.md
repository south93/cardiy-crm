# 06 · Mô hình dữ liệu (ERD)

> Quy ước: khoá chính `id uuid`. Bảng nghiệp vụ nào cũng có `tenant_id`, `created_at`, `updated_at`, `created_by`, `deleted_at` (xoá mềm). Tiền lưu `bigint` VND. Tên bảng tiếng Anh, số nhiều, snake_case.

## D1 · Định danh, tenant, phân quyền

```mermaid
erDiagram
  users ||--o{ memberships : "làm việc tại"
  tenants ||--o{ memberships : "có"
  tenants ||--o{ branches : "có"
  memberships }o--o{ roles : "gán"
  roles }o--o{ permissions : "gồm"
  memberships }o--o{ branches : "phạm vi"
  tenants ||--o{ partner_applications : "hồ sơ đăng ký"
  tenants ||--o{ subscriptions : "gói"
  plans ||--o{ subscriptions : ""
  users ||--o{ consents : "đồng ý"
  users ||--o{ audit_logs : "thực hiện"

  users { uuid id PK
    string phone UK
    string email
    string full_name
    string password_hash
    bool two_factor
    string status }
  tenants { uuid id PK
    string type "PLATFORM|GARAGE"
    string name
    string tax_code UK
    string status "theo S4" }
  branches { uuid id PK
    uuid tenant_id FK
    string name
    string address
    float lat
    float lng
    json opening_hours
    int bays }
  memberships { uuid id PK
    uuid user_id FK
    uuid tenant_id FK
    string status }
  roles { uuid id PK
    uuid tenant_id FK "null = vai trò hệ thống"
    string code
    string name }
  permissions { string code PK "vd ro.approve" }
  partner_applications { uuid id PK
    uuid tenant_id FK
    json documents
    string ekyc_status
    string status
    uuid reviewed_by
    string reject_reason }
  plans { uuid id PK
    string code UK
    string name
    bigint monthly_fee
    int billing_months "1|3|6|12"
    string_arr features
    bool active }
  subscriptions { uuid id PK
    uuid tenant_id FK
    uuid plan_id FK
    bigint monthly_fee "chụp giá lúc duyệt"
    int billing_months
    date start_at
    date paid_through "đã lập hoá đơn tới"
    datetime ended_at }
  consents { uuid id PK
    uuid user_id FK
    string channel
    string purpose
    bool granted
    datetime at }
  audit_logs { bigint id PK
    uuid tenant_id
    uuid actor_id
    string entity
    uuid entity_id
    string action
    json before
    json after
    datetime at }
```

**Vòng 3.1 (đã làm):** `partner_applications` (mã HS…, trạng thái CHO_DUYET → CAN_BO_SUNG / TU_CHOI / DA_DUYET, giấy tờ dạng JSON trỏ tới `files` của tenant sàn, băm mã bí mật của link theo dõi, `tenant_id` tạo ra khi duyệt) và `platform_invoices` (mã PHI…, kỳ, số tiền, hạn trả, DA_PHAT_HANH / DA_THANH_TOAN / HUY; ghi nhận thu ngay trên hoá đơn: ngày, hình thức, ghi chú, người ghi — chưa tách `platform_fee_payments`). Quá hạn tính khi đọc (chưa trả và qua hạn), không lưu cột.

## D2 · Khách hàng, xe, booking, lệnh sửa chữa

```mermaid
erDiagram
  customers ||--o{ vehicle_ownerships : "sở hữu"
  vehicles ||--o{ vehicle_ownerships : ""
  vehicle_models ||--o{ vehicles : ""
  vehicles ||--o{ odometer_readings : "km"
  vehicles ||--o{ maintenance_reminders : "nhắc"
  maintenance_schedules ||--o{ maintenance_reminders : ""
  vehicle_models ||--o{ maintenance_schedules : ""
  customers ||--o{ bookings : "đặt"
  bookings |o--o| repair_orders : "tạo"
  vehicles ||--o{ repair_orders : ""
  repair_orders ||--o{ ro_items : "hạng mục"
  repair_orders ||--o{ ro_tasks : "giao việc"
  repair_orders ||--o{ quotes : "báo giá"
  quotes ||--o{ quote_items : ""
  repair_orders ||--o{ media : "ảnh/video"
  repair_orders ||--o{ ro_status_history : ""
  repair_orders ||--o{ warranties : ""
  customers ||--o{ call_tasks : "lịch gọi"

  customers { uuid id PK
    uuid tenant_id FK
    uuid user_id FK "null nếu chưa có app"
    string type "PERSON|COMPANY"
    string name
    string phone
    string tier
    bigint credit_limit }
  vehicles { uuid id PK
    string plate_no "chuẩn hoá, UK theo hệ thống"
    string vin UK
    uuid model_id FK
    int year
    date registration_expiry
    date insurance_expiry }
  vehicle_models { uuid id PK
    string make
    string model
    string generation }
  vehicle_ownerships { uuid id PK
    uuid vehicle_id FK
    uuid customer_id FK
    date from_date
    date to_date }
  odometer_readings { uuid id PK
    uuid vehicle_id FK
    int km
    string source
    datetime at }
  bookings { uuid id PK
    uuid tenant_id FK
    uuid branch_id FK
    uuid customer_id FK
    uuid vehicle_id FK
    datetime slot_at
    string status "theo S2"
    string source "APP|WEB|PHONE|MARKETPLACE|SOS" }
  repair_orders { uuid id PK
    uuid tenant_id FK
    uuid branch_id FK
    string code UK
    uuid vehicle_id FK
    uuid customer_id FK
    uuid advisor_id FK
    int odometer_in
    string status "theo S1"
    bigint total
    bigint paid }
  ro_items { uuid id PK
    uuid ro_id FK
    string type "PART|LABOR|PACKAGE"
    uuid product_id FK
    decimal qty
    bigint unit_price
    bigint discount
    string approval "PENDING|APPROVED|REJECTED" }
  ro_tasks { uuid id PK
    uuid ro_id FK
    uuid technician_id FK
    string status
    int minutes_spent
    json checklist }
  quotes { uuid id PK
    uuid ro_id FK
    int version
    string status
    datetime sent_at
    datetime decided_at }
  quote_items { uuid id PK
    uuid quote_id FK
    uuid ro_item_id FK }
  media { uuid id PK
    string owner_type
    uuid owner_id
    string url
    string stage "BEFORE|DURING|AFTER" }
  ro_status_history { bigint id PK
    uuid ro_id FK
    string from_status
    string to_status
    uuid actor_id
    datetime at }
  warranties { uuid id PK
    uuid ro_item_id FK
    date until
    int km_limit }
  maintenance_schedules { uuid id PK
    uuid model_id FK
    int every_km
    int every_months
    json items }
  maintenance_reminders { uuid id PK
    uuid vehicle_id FK
    date due_date
    int due_km
    string status }
  call_tasks { uuid id PK
    uuid tenant_id FK
    uuid customer_id FK
    string reason
    datetime due_at
    string result
    uuid assignee_id FK }
```

## D2b · Phiếu kiểm tra xe & app chủ xe (đã làm: vòng 1.5e, 2.1)

```mermaid
erDiagram
  repair_orders ||--o| inspections : "phiếu kiểm tra"
  users ||--o{ customer_links : "là chủ xe"
  customers ||--o| customer_links : "liên kết app"
  customers ||--o{ customer_invites : "lời mời"
  users ||--o{ owner_sessions : "phiên app"
  repair_orders ||--o{ order_quotes : "báo giá gửi khách"
  repair_orders ||--o| order_reviews : "đánh giá"
  tenants ||--o| zalo_tokens : "token OA (mã hoá)"
  tenants ||--o{ zalo_messages : "tin ZNS đã gửi"
  inspections { uuid id PK
    uuid order_id FK "1 đơn 1 phiếu"
    json data "lốp, an toàn, gầm, khuyến nghị, kiểm tra cuối"
    uuid inspector_id
    datetime completed_at }
  customer_links { uuid id PK
    uuid user_id FK
    uuid tenant_id
    uuid customer_id FK "unique"
    datetime created_at }
  customer_invites { uuid id PK
    uuid customer_id FK
    string token_hash "chỉ lưu băm, dùng 1 lần"
    datetime expires_at "30 ngày"
    datetime used_at
    datetime revoked_at }
  order_reviews { uuid id PK
    uuid order_id FK "1 đơn 1 đánh giá"
    int rating "1–5"
    string comment
    string reply "garage trả lời" }
  zalo_messages { uuid id PK
    string event "OTP · BOOKING_CONFIRMED · QUOTE_SENT · ORDER_DONE · CARE_REMINDER"
    string phone
    string status "SENT · FAILED" }
  order_quotes { uuid id PK
    uuid order_id FK
    string status "CHO_DUYET · DA_DUYET · DUYET_MOT_PHAN · TU_CHOI · HET_HIEU_LUC"
    json items "chụp hạng mục lúc gửi"
    uuid_array approved_ids "dòng khách đồng ý"
    bool applied "đã bỏ dòng bị từ chối khỏi đơn" }
  owner_sessions { uuid id PK
    uuid user_id FK
    string token_hash
    datetime expires_at
    datetime revoked_at }
```

- Chủ xe dùng chung bảng `users` (một người vừa là nhân viên vừa là khách vẫn một tài khoản), nhưng **phiên đăng nhập tách riêng**: token loại `owner`, cookie `cardiy_ort`, bảng `owner_sessions`. Token nhân viên không gọi được API chủ xe và ngược lại.
- Báo giá (vòng 2.2): garage gửi → chụp lại hạng mục; nhân viên sửa hạng mục / gửi bản mới / giao xe / huỷ đơn thì bản đang chờ **hết hiệu lực**. Khách trả lời → dòng bị từ chối được bỏ khỏi đơn và tính lại tổng (nếu đơn đã thu nhiều hơn tổng mới thì chỉ ghi nhận, `applied = false`, garage xử lý tay). Lịch khách tự đặt có `bookings.channel = APP`.
- Chủ xe chỉ thấy xe **đang** đứng tên hồ sơ khách đã liên kết, và chỉ đơn của chính hồ sơ đó (không thấy đơn của chủ cũ). Bán xe (chuyển chủ) là hết quyền xem.

## D3 · Kho, danh mục chuẩn, gian hàng trên sàn

> Đã làm (vòng 1.4c): `products.sale_price` = giá Bình Phước (giá chính), `products.sale_price_bd` = giá Bình Dương (trống thì dùng giá chính), `products.vat_price` = giá xuất hoá đơn VAT; `branches.price_zone` (`BP` | `BD`) quyết định giá mặc định khi thêm sản phẩm vào đơn ở chi nhánh đó. Nhập file Excel AppSheet tạo lô nhập `import_batches.kind = PRODUCTS`; tồn đầu kỳ ghi bằng phiếu kiểm kê (PK) mỗi chi nhánh.

> **Đã làm (vòng 3.2), khác sơ đồ dự kiến:** sản phẩm chuẩn và dịch vụ chuẩn chung một bảng `catalog_items` (`kind` = PRODUCT | SERVICE, `code` = SKU / mã dịch vụ, thương hiệu là chữ, thông số `specs` dạng [{label, value}]); nhóm `catalog_categories` 2 cấp theo loại; `catalog_proposals` = đề xuất của garage. `shops` = hồ sơ gian hàng (1 / tenant, `slug` duy nhất, giờ mở cửa JSON). `offers`: chi nhánh bán lưu mảng `branch_ids` (chưa tách `offer_branches`); `product_id` (chỉ PLG) → tồn khả dụng = tổng `stock_levels` của các chi nhánh bán, tính khi đọc; đối tác dùng `manual_stock`. Trạng thái S5 không lưu HET_HANG: hết hàng = đang bán + tồn khả dụng 0. Chưa có giữ tồn cho đơn sàn (vòng 3.4), chưa liên kết `products.catalog_product_id`, chưa có bảng hãng / dòng xe tương thích.

```mermaid
erDiagram
  catalog_products ||--o{ products : "liên kết SKU chuẩn"
  catalog_products ||--o{ offers : "được bán bởi"
  catalog_services ||--o{ offers : ""
  catalog_products }o--o{ vehicle_models : "tương thích"
  brands ||--o{ catalog_products : ""
  categories ||--o{ catalog_products : ""
  tenants ||--o{ products : "danh mục nội bộ"
  products ||--o{ stock_levels : ""
  warehouses ||--o{ stock_levels : ""
  branches ||--o{ warehouses : ""
  stock_movements }o--|| products : ""
  suppliers ||--o{ purchase_orders : ""
  purchase_orders ||--o{ stock_movements : "nhập"
  tenants ||--o{ offers : "đăng bán"
  offers ||--o{ offer_branches : "bán tại chi nhánh"
  products |o--o{ offers : "trừ tồn từ"

  catalog_products { uuid id PK
    string sku UK
    uuid brand_id FK
    uuid category_id FK
    string name
    json specs "kích cỡ, mã gai, la-zăng..."
    string status }
  catalog_services { uuid id PK
    string code UK
    string name
    uuid category_id FK }
  brands { uuid id PK
    string name }
  categories { uuid id PK
    uuid parent_id
    string name
    int sort_order }
  products { uuid id PK
    uuid tenant_id FK
    string internal_code
    uuid catalog_product_id FK "nullable"
    string name
    string unit
    bigint cost_price
    bigint sell_price
    int min_stock }
  warehouses { uuid id PK
    uuid branch_id FK
    string name }
  stock_levels { uuid product_id FK
    uuid warehouse_id FK
    decimal on_hand
    decimal reserved }
  stock_movements { uuid id PK
    uuid product_id FK
    uuid warehouse_id FK
    string type "IN|OUT|TRANSFER|ADJUST|RESERVE|RELEASE"
    decimal qty
    string ref_type
    uuid ref_id }
  suppliers { uuid id PK
    uuid tenant_id FK
    string name
    bigint payable }
  purchase_orders { uuid id PK
    uuid supplier_id FK
    string status
    bigint total }
  offers { uuid id PK
    uuid tenant_id FK
    string kind "PRODUCT|SERVICE"
    uuid catalog_product_id FK
    uuid catalog_service_id FK
    uuid product_id FK "kho nội bộ"
    bigint price
    bigint list_price
    bool install_included
    int manufacture_year
    string status "theo S5"
    int sold_count
    float rating }
  offer_branches { uuid offer_id FK
    uuid branch_id FK }
```

## D4 · Yêu cầu đặt hàng, thanh toán tại garage, voucher, phí đối tác

> Sàn **không** có ví, sổ cái thu hộ, đối soát hay chi trả. `payments` là tiền **garage thu** (thuộc tenant). `platform_invoices` là phí gói **sàn thu của garage**.

```mermaid
erDiagram
  users ||--o{ order_requests : "gửi"
  tenants ||--o{ order_requests : "nhận"
  order_requests ||--o{ order_request_items : ""
  offers ||--o{ order_request_items : ""
  order_requests |o--o| bookings : "lịch lắp"
  order_requests |o--o| repair_orders : "RO lắp đặt"
  repair_orders ||--o{ payments : "garage thu"
  payments ||--o| cash_book_entries : "vào sổ quỹ"
  tenants ||--o{ cash_book_entries : ""
  tenants ||--o{ vouchers : "phát hành"
  vouchers ||--o{ voucher_redemptions : ""
  repair_orders ||--o{ voucher_redemptions : ""
  order_requests ||--o{ reports : "phản ánh"
  tenants ||--o{ reports : "bị phản ánh"
  repair_orders ||--o{ reviews : ""
  repair_orders ||--o{ invoices : "garage xuất"
  subscriptions ||--o{ platform_invoices : "phí theo kỳ"
  platform_invoices ||--o{ platform_fee_payments : ""

  order_requests { uuid id PK
    string code UK
    uuid buyer_id FK
    uuid seller_tenant_id FK
    uuid branch_id FK
    string status "theo S3"
    bigint estimated_total
    bigint final_total "garage chốt"
    datetime expires_at }
  order_request_items { uuid id PK
    uuid order_request_id FK
    uuid offer_id FK
    int qty
    bigint unit_price }
  payments { uuid id PK
    uuid tenant_id FK "garage thu"
    string ref_type "RO|ORDER_REQUEST|RENTAL|SOS"
    uuid ref_id
    string method "VIETQR|CARD|CASH|TRANSFER"
    bigint amount
    uuid recorded_by FK
    string status }
  cash_book_entries { uuid id PK
    uuid tenant_id FK
    uuid branch_id FK
    string type "THU|CHI"
    bigint amount
    string category
    uuid payment_id FK }
  vouchers { uuid id PK
    uuid tenant_id FK "garage phát hành"
    uuid campaign_id "chương trình chung của sàn, nếu có"
    string code
    string type "PERCENT|AMOUNT"
    bigint value
    json conditions
    int quota
    datetime expires_at }
  voucher_redemptions { uuid id PK
    uuid voucher_id FK
    uuid ro_id FK
    bigint amount }
  reports { uuid id PK
    uuid reporter_id FK
    uuid tenant_id FK
    string ref_type
    uuid ref_id
    string reason
    string status
    string resolution }
  reviews { uuid id PK
    string target_type "GARAGE|OFFER|TECHNICIAN"
    uuid target_id
    int stars
    string content
    string status }
  invoices { uuid id PK
    uuid tenant_id FK
    string ref_type
    uuid ref_id
    string provider_no
    string pdf_url
    string status }
  platform_invoices { uuid id PK
    uuid tenant_id FK
    uuid subscription_id FK
    date period_from
    date period_to
    bigint amount
    date due_date
    string status "theo S7" }
  platform_fee_payments { uuid id PK
    uuid platform_invoice_id FK
    bigint amount
    string method
    uuid recorded_by FK
    datetime paid_at }
```

## D5 · Mở rộng: cứu hộ, thuê xe, xe cũ, cộng đồng, thông báo, AI

```mermaid
erDiagram
  users ||--o{ sos_requests : "gửi"
  sos_requests ||--o{ sos_tracks : "GPS"
  sos_requests |o--o| repair_orders : "kéo về garage"
  tenants ||--o{ rental_vehicles : ""
  rental_vehicles ||--o{ rental_contracts : ""
  users ||--o{ rental_contracts : "thuê"
  users ||--o{ used_car_listings : "đăng"
  used_car_listings |o--o| used_car_appraisals : "kiểm định"
  used_car_listings ||--o{ chat_threads : ""
  users ||--o{ posts : ""
  posts ||--o{ comments : ""
  notification_templates ||--o{ notifications : ""
  users ||--o{ notifications : "nhận"
  domain_events ||--o{ notifications : "kích hoạt"
  ai_documents ||--o{ ai_chunks : "nhúng vector"

  sos_requests { uuid id PK
    uuid user_id FK
    uuid vehicle_id FK
    float lat
    float lng
    string issue_type
    uuid assigned_tenant_id FK
    uuid assigned_staff_id FK
    bigint quoted_price "garage báo"
    string status "theo S6" }
  sos_tracks { bigint id PK
    uuid sos_id FK
    float lat
    float lng
    datetime at }
  rental_vehicles { uuid id PK
    uuid tenant_id FK
    uuid vehicle_id FK
    bigint daily_price
    bigint deposit
    string owner_type "GARAGE|CONSIGN do garage quản lý" }
  rental_contracts { uuid id PK
    uuid rental_vehicle_id FK
    uuid renter_id FK
    datetime start_at
    datetime end_at
    string status "theo S8"
    bigint total }
  used_car_listings { uuid id PK
    uuid seller_user_id FK
    uuid seller_tenant_id FK
    uuid vehicle_id FK
    bigint price
    string status }
  used_car_appraisals { uuid id PK
    uuid listing_id FK
    uuid tenant_id FK
    json checklist
    int score
    string report_url }
  chat_threads { uuid id PK
    string context_type
    uuid context_id }
  posts { uuid id PK
    uuid author_id FK
    string type "BLOG|AUDIO|PLAYLIST|QA"
    string title
    string status }
  comments { uuid id PK
    uuid post_id FK
    uuid author_id FK
    string content }
  notification_templates { uuid id PK
    string code UK
    string channel "ZNS|SMS|EMAIL|PUSH"
    string body }
  notifications { uuid id PK
    uuid user_id FK
    uuid template_id FK
    json payload
    string status
    datetime sent_at }
  domain_events { bigint id PK
    uuid tenant_id
    string type "vd ro.status_changed"
    json payload
    datetime at }
  ai_documents { uuid id PK
    uuid tenant_id
    string source_type
    uuid source_id }
  ai_chunks { uuid id PK
    uuid document_id FK
    string content
    vector embedding }
```
