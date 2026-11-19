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
    string status "theo S4"
    int commission_override_bp }
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
    string name
    bigint monthly_fee
    json limits }
  subscriptions { uuid id PK
    uuid tenant_id FK
    uuid plan_id FK
    date start_at
    date end_at
    string contract_url }
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

## D3 · Kho, danh mục chuẩn, gian hàng trên sàn

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
    int commission_bp "hoa hồng sàn" }
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

## D4 · Đơn hàng sàn, thanh toán, ví, đối soát, khuyến mại

```mermaid
erDiagram
  users ||--o{ carts : ""
  carts ||--o{ cart_items : ""
  users ||--o{ orders : "đặt"
  orders ||--o{ order_items : ""
  offers ||--o{ order_items : ""
  orders |o--o| bookings : "lịch lắp"
  orders |o--o| repair_orders : "RO lắp đặt"
  orders ||--o{ payments : ""
  repair_orders ||--o{ payments : ""
  payments ||--o{ refunds : ""
  wallets ||--o{ ledger_entries : ""
  payments ||--o{ ledger_entries : "sinh bút toán"
  tenants ||--|| wallets : "ví người bán"
  users ||--o| wallets : "ví khách"
  tenants ||--o{ settlements : "kỳ đối soát"
  settlements ||--o{ settlement_lines : ""
  order_items ||--o{ settlement_lines : ""
  wallets ||--o{ payouts : "rút tiền"
  vouchers ||--o{ voucher_redemptions : ""
  orders ||--o{ voucher_redemptions : ""
  orders ||--o{ disputes : ""
  orders ||--o{ reviews : ""
  repair_orders ||--o{ reviews : ""
  repair_orders ||--o{ invoices : ""
  orders ||--o{ invoices : ""

  orders { uuid id PK
    string code UK
    uuid buyer_id FK
    uuid seller_tenant_id FK
    uuid branch_id FK
    string status "theo S3"
    bigint subtotal
    bigint discount_seller
    bigint discount_platform
    bigint total
    string payment_mode "PREPAID|PAY_AT_GARAGE" }
  order_items { uuid id PK
    uuid order_id FK
    uuid offer_id FK
    int qty
    bigint unit_price
    int commission_bp }
  carts { uuid id PK
    uuid user_id FK }
  cart_items { uuid id PK
    uuid cart_id FK
    uuid offer_id FK
    int qty }
  payments { uuid id PK
    string ref_type "ORDER|RO|RENTAL|SOS|SUBSCRIPTION"
    uuid ref_id
    string method "VIETQR|CARD|WALLET|CASH"
    bigint amount
    string gateway_txn_id UK
    string status }
  refunds { uuid id PK
    uuid payment_id FK
    bigint amount
    string reason
    string status }
  wallets { uuid id PK
    string owner_type "USER|TENANT|PLATFORM"
    uuid owner_id
    bigint pending
    bigint available }
  ledger_entries { bigint id PK
    uuid wallet_id FK
    uuid txn_id "nhóm bút toán kép"
    bigint debit
    bigint credit
    string memo }
  settlements { uuid id PK
    uuid tenant_id FK
    date period_from
    date period_to
    bigint gross
    bigint commission
    bigint net
    string status }
  settlement_lines { uuid id PK
    uuid settlement_id FK
    uuid order_item_id FK
    bigint amount }
  payouts { uuid id PK
    uuid wallet_id FK
    bigint amount
    string bank_account
    string status "theo S7" }
  vouchers { uuid id PK
    string issuer "PLATFORM|TENANT"
    uuid tenant_id
    string code
    string type "PERCENT|AMOUNT"
    bigint value
    json conditions
    int quota
    datetime expires_at }
  voucher_redemptions { uuid id PK
    uuid voucher_id FK
    uuid order_id FK
    bigint amount }
  disputes { uuid id PK
    uuid order_id FK
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
    string ref_type
    uuid ref_id
    string provider_no
    string pdf_url
    string status }
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
  used_car_listings |o--o| inspections : "kiểm định"
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
    bigint quoted_price
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
    string owner_type "GARAGE|CONSIGN" }
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
  inspections { uuid id PK
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
