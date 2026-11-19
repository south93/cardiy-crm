/**
 * Danh mục quyền CARDIY. Nguồn: docs/02-vai-tro-phan-quyen.md (ma trận quyền).
 * Quyền có dạng `module.hanh_dong`. Vai trò = tập quyền. Thêm quyền mới: thêm vào đây rồi chạy seed.
 */

/** PLATFORM: sàn CARDIY · TENANT: garage PLG (CRM) · PARTNER: đối tác (cổng đối tác, 1 tài khoản) */
export type PermissionScope = 'PLATFORM' | 'TENANT' | 'PARTNER';

/** Loại không gian làm việc (tenant). */
export type TenantKind = 'PLATFORM' | 'GARAGE' | 'PARTNER';

/** Phạm vi quyền ứng với từng loại không gian làm việc. */
export function scopeOfTenant(kind: TenantKind): PermissionScope {
  return kind === 'PLATFORM' ? 'PLATFORM' : kind === 'PARTNER' ? 'PARTNER' : 'TENANT';
}

export interface PermissionDef {
  code: string;
  group: string;
  label: string;
  scope: PermissionScope;
}

const P = (code: string, group: string, label: string, scope: PermissionScope = 'TENANT'): PermissionDef => ({
  code,
  group,
  label,
  scope,
});

export const PERMISSIONS = [
  // ---- Cấp sàn ----
  P('platform.partner.review', 'Sàn: Đối tác', 'Duyệt / khoá đối tác garage', 'PLATFORM'),
  P('platform.catalog.manage', 'Sàn: Danh mục chuẩn', 'Quản lý danh mục sản phẩm, dịch vụ chuẩn', 'PLATFORM'),
  P('platform.fee.manage', 'Sàn: Phí đối tác', 'Gói, hoá đơn phí, ghi nhận thanh toán phí', 'PLATFORM'),
  P('platform.report.handle', 'Sàn: Giám sát', 'Xử lý phản ánh, vi phạm, giám sát cứu hộ', 'PLATFORM'),
  P('platform.content.manage', 'Sàn: Nội dung', 'Blog, banner, chương trình chung', 'PLATFORM'),
  P('platform.config.manage', 'Sàn: Cấu hình', 'Cấu hình sàn, nhân sự sàn', 'PLATFORM'),

  // ---- Cổng đối tác (đối tác chỉ có 1 tài khoản, mọi dịch vụ xử lý qua đây) ----
  P('partner.shop.manage', 'Đối tác: Gian hàng', 'Hồ sơ gian hàng, giờ mở cửa, chính sách', 'PARTNER'),
  P('partner.listing.manage', 'Đối tác: Gian hàng', 'Đăng sản phẩm & dịch vụ (cứu hộ, thuê xe, kiểm định…)', 'PARTNER'),
  P('partner.request.manage', 'Đối tác: Yêu cầu', 'Nhận và xử lý yêu cầu từ khách: đặt hàng, đặt lịch, cứu hộ, thuê xe, kiểm định', 'PARTNER'),
  P('partner.promotion.manage', 'Đối tác: Gian hàng', 'Voucher của đối tác', 'PARTNER'),
  P('partner.review.reply', 'Đối tác: Yêu cầu', 'Trả lời đánh giá', 'PARTNER'),
  P('partner.report.view', 'Đối tác: Thống kê', 'Lượt xem, yêu cầu, doanh số', 'PARTNER'),
  P('partner.billing.view', 'Đối tác: Phí', 'Gói đối tác, hoá đơn phí', 'PARTNER'),

  // ---- Cấp garage PLG (CRM) ----
  P('dashboard.view', 'Tổng quan', 'Xem tổng quan'),
  P('customer.view', 'Khách hàng & Xe', 'Xem khách hàng'),
  P('customer.manage', 'Khách hàng & Xe', 'Thêm / sửa khách hàng'),
  P('vehicle.view', 'Khách hàng & Xe', 'Xem xe'),
  P('vehicle.manage', 'Khách hàng & Xe', 'Thêm / sửa xe'),
  P('booking.view', 'Lịch hẹn', 'Xem lịch hẹn'),
  P('booking.manage', 'Lịch hẹn', 'Tạo / xác nhận lịch hẹn'),
  P('ro.view', 'Lệnh sửa chữa', 'Xem lệnh sửa chữa'),
  P('ro.manage', 'Lệnh sửa chữa', 'Tạo / cập nhật lệnh sửa chữa'),
  P('ro.approve', 'Lệnh sửa chữa', 'Duyệt giảm giá, huỷ lệnh'),
  P('ro.task.update', 'Lệnh sửa chữa', 'Cập nhật công việc được giao'),
  P('quote.manage', 'Lệnh sửa chữa', 'Lập báo giá'),
  P('inventory.view', 'Kho hàng', 'Xem tồn kho'),
  P('inventory.manage', 'Kho hàng', 'Nhập / xuất / chuyển kho'),
  P('inventory.adjust.approve', 'Kho hàng', 'Duyệt điều chỉnh kiểm kê'),
  P('purchase.manage', 'Kho hàng', 'Đặt hàng nhà cung cấp'),
  P('purchase.approve', 'Kho hàng', 'Duyệt đơn nhập hàng'),
  P('finance.view', 'Tài chính', 'Xem thu chi, công nợ'),
  P('finance.manage', 'Tài chính', 'Ghi thu chi, công nợ'),
  P('invoice.manage', 'Tài chính', 'Xuất hoá đơn điện tử'),
  P('staff.view', 'Nhân sự', 'Xem nhân viên'),
  P('staff.manage', 'Nhân sự', 'Thêm / khoá nhân viên, đặt lại mật khẩu'),
  P('shop.manage', 'Kênh người bán', 'Quản lý gian hàng, tin đăng'),
  P('order_request.manage', 'Kênh người bán', 'Xử lý yêu cầu đặt hàng từ sàn'),
  P('promotion.manage', 'Kênh người bán', 'Quản lý voucher'),
  P('sos.manage', 'Cứu hộ', 'Nhận ca, điều đội cứu hộ'),
  P('sos.handle', 'Cứu hộ', 'Thực hiện ca cứu hộ'),
  P('marketing.manage', 'Marketing', 'Phân khúc, chiến dịch'),
  P('report.view', 'Báo cáo', 'Xem báo cáo'),
  P('branch.manage', 'Cài đặt', 'Quản lý chi nhánh'),
  P('role.manage', 'Cài đặt', 'Tạo / sửa vai trò tuỳ chỉnh'),
  P('settings.manage', 'Cài đặt', 'Cài đặt garage'),
  P('audit.view', 'Cài đặt', 'Xem nhật ký thao tác'),
  P('file.upload', 'Chung', 'Tải ảnh, chứng từ lên'),
] as const satisfies readonly PermissionDef[];

export type PermissionCode = (typeof PERMISSIONS)[number]['code'];

export const PERMISSION_CODES: PermissionCode[] = PERMISSIONS.map((p) => p.code);

const TENANT_ALL = PERMISSIONS.filter((p) => p.scope === 'TENANT').map((p) => p.code);
const PLATFORM_ALL = PERMISSIONS.filter((p) => p.scope === 'PLATFORM').map((p) => p.code);
const PARTNER_ALL = PERMISSIONS.filter((p) => p.scope === 'PARTNER').map((p) => p.code);

export interface SystemRoleDef {
  code: string;
  name: string;
  scope: PermissionScope;
  /** Vai trò bắt buộc bật xác thực 2 lớp */
  require2fa: boolean;
  permissions: PermissionCode[];
}

/** Vai trò hệ thống: không sửa được. Chủ garage có thể tạo vai trò tuỳ chỉnh từ danh mục quyền. */
export const SYSTEM_ROLES: SystemRoleDef[] = [
  { code: 'SA', name: 'Super Admin sàn', scope: 'PLATFORM', require2fa: true, permissions: [...PLATFORM_ALL, 'audit.view', 'staff.view', 'staff.manage', 'role.manage', 'file.upload'] },
  { code: 'AV', name: 'Admin vận hành sàn', scope: 'PLATFORM', require2fa: true, permissions: ['platform.partner.review', 'platform.catalog.manage', 'platform.report.handle', 'audit.view', 'file.upload'] },
  { code: 'KS', name: 'Kế toán sàn', scope: 'PLATFORM', require2fa: true, permissions: ['platform.fee.manage', 'file.upload'] },
  { code: 'MK', name: 'Marketing & Nội dung sàn', scope: 'PLATFORM', require2fa: false, permissions: ['platform.content.manage', 'file.upload'] },
  { code: 'GS', name: 'Giám sát chất lượng sàn', scope: 'PLATFORM', require2fa: false, permissions: ['platform.report.handle', 'file.upload'] },

  // Đối tác: 1 tài khoản duy nhất, không quản lý nhân viên, không có CRM
  { code: 'DT', name: 'Đối tác', scope: 'PARTNER', require2fa: false, permissions: [...PARTNER_ALL, 'file.upload'] },

  { code: 'CG', name: 'Chủ garage', scope: 'TENANT', require2fa: true, permissions: TENANT_ALL },
  {
    code: 'QL', name: 'Quản lý chi nhánh', scope: 'TENANT', require2fa: true,
    permissions: ['dashboard.view', 'customer.view', 'customer.manage', 'vehicle.view', 'vehicle.manage', 'booking.view', 'booking.manage', 'ro.view', 'ro.manage', 'ro.approve', 'ro.task.update', 'quote.manage', 'inventory.view', 'inventory.adjust.approve', 'purchase.approve', 'finance.view', 'staff.view', 'staff.manage', 'shop.manage', 'order_request.manage', 'promotion.manage', 'sos.manage', 'sos.handle', 'marketing.manage', 'report.view', 'audit.view', 'file.upload'],
  },
  {
    code: 'BH', name: 'Bán hàng / Cố vấn dịch vụ', scope: 'TENANT', require2fa: false,
    permissions: ['dashboard.view', 'customer.view', 'customer.manage', 'vehicle.view', 'vehicle.manage', 'booking.view', 'booking.manage', 'ro.view', 'ro.manage', 'quote.manage', 'inventory.view', 'shop.manage', 'order_request.manage', 'file.upload'],
  },
  { code: 'KTV', name: 'Kỹ thuật viên', scope: 'TENANT', require2fa: false, permissions: ['ro.view', 'ro.task.update', 'vehicle.view', 'file.upload'] },
  { code: 'TK', name: 'Thủ kho', scope: 'TENANT', require2fa: false, permissions: ['dashboard.view', 'inventory.view', 'inventory.manage', 'purchase.manage', 'order_request.manage', 'ro.view', 'file.upload'] },
  { code: 'KT', name: 'Kế toán garage', scope: 'TENANT', require2fa: false, permissions: ['dashboard.view', 'finance.view', 'finance.manage', 'invoice.manage', 'ro.view', 'customer.view', 'inventory.view', 'report.view', 'file.upload'] },
  { code: 'CS', name: 'Chăm sóc khách hàng', scope: 'TENANT', require2fa: false, permissions: ['dashboard.view', 'customer.view', 'customer.manage', 'vehicle.view', 'booking.view', 'booking.manage', 'ro.view', 'order_request.manage', 'sos.manage', 'marketing.manage', 'file.upload'] },
  { code: 'CH', name: 'Đội cứu hộ', scope: 'TENANT', require2fa: false, permissions: ['sos.handle', 'vehicle.view', 'file.upload'] },
];

export function isPermissionCode(code: string): code is PermissionCode {
  return (PERMISSION_CODES as string[]).includes(code);
}
