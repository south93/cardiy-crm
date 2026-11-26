import type { PermissionCode, TenantKind } from '@cardiy/shared';
import type { Tone } from '@cardiy/ui';
import {
  Boxes,
  CalendarDays,
  ChartColumn,
  CircleCheck,
  House,
  IdCard,
  LayoutGrid,
  Megaphone,
  PhoneCall,
  Settings,
  ShoppingCart,
  Sparkles,
  Store,
  Truck,
  Users,
  Wallet,
  Warehouse,
  Wrench,
  Car,
  CarFront,
  ChartLine,
  ClipboardCheck,
  ClipboardList,
  Inbox,
  LifeBuoy,
  Package,
  Star,
  TicketPercent,
  BookOpen,
  Building2,
  Flag,
  MessageSquare,
  Receipt,
  type LucideIcon,
  ShieldCheck,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Mã màn hình theo docs/03-so-do-man-hinh.md */
  screen: string;
  /** Vòng dự kiến làm màn hình này (docs/08-lo-trinh.md) */
  round: string;
  tone: Tone;
  /** Cần quyền này mới thấy mục menu (không đặt = ai cũng thấy) */
  permission?: PermissionCode;
  /** Mục thuộc không gian làm việc nào */
  workspace?: TenantKind | 'ALL';
  /** Màn hình đã làm xong (không hiện trang chờ) */
  built?: boolean;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: null,
    items: [
      { href: '/', label: 'Tổng quan', icon: LayoutGrid, screen: 'A3.01', round: '0.1', tone: 'brand', permission: 'dashboard.view', built: true },
      { href: '/trang-chu', label: 'Trang chủ', icon: House, screen: 'A3.02', round: '0.1', tone: 'brand', workspace: 'ALL', built: true },
    ],
  },
  {
    label: 'Kinh doanh',
    items: [
      { href: '/ban-hang', label: 'Bán hàng', icon: ShoppingCart, screen: 'A3.10', round: '1.2', tone: 'sky', permission: 'ro.manage', built: true },
      { href: '/don-dang-xu-ly', label: 'Đơn đang xử lý', icon: Wrench, screen: 'A3.11', round: '1.2', tone: 'peach', permission: 'ro.view', built: true },
      { href: '/don-hoan-thanh', label: 'Đơn hoàn thành', icon: CircleCheck, screen: 'A3.13', round: '1.2', tone: 'mint', permission: 'ro.view', built: true },
    ],
  },
  {
    label: 'Kho hàng',
    items: [
      { href: '/danh-muc', label: 'Danh mục sản phẩm', icon: Boxes, screen: 'A3.20', round: '1.4', tone: 'lav', permission: 'inventory.view', built: true },
      { href: '/ton-kho', label: 'Tồn kho chi nhánh', icon: Warehouse, screen: 'A3.21', round: '1.4', tone: 'sky', permission: 'inventory.view', built: true },
    ],
  },
  {
    label: 'Đối tác',
    items: [
      { href: '/khach-hang', label: 'Khách hàng', icon: Users, screen: 'A3.30', round: '1.1', tone: 'mint', permission: 'customer.view', built: true },
      { href: '/xe', label: 'Xe', icon: Car, screen: 'A3.32', round: '1.1', tone: 'sky', permission: 'vehicle.view', built: true },
      { href: '/nha-cung-cap', label: 'Nhà cung cấp', icon: Truck, screen: 'A3.24', round: '1.4', tone: 'peach', permission: 'purchase.manage', built: true },
    ],
  },
  {
    label: 'Nhân sự & Tài chính',
    items: [
      { href: '/nhan-vien', label: 'Nhân viên', icon: IdCard, screen: 'A3.70', round: '0.2', tone: 'lav', permission: 'staff.view', workspace: 'ALL', built: true },
      { href: '/thu-chi', label: 'Thu chi & công nợ', icon: Wallet, screen: 'A3.72', round: '1.5', tone: 'mint', permission: 'finance.view', built: true },
    ],
  },
  {
    label: 'Dịch vụ',
    items: [
      { href: '/viec-cua-toi', label: 'Việc của tôi', icon: ClipboardList, screen: 'A4.01', round: '1.5', tone: 'sky', permission: 'ro.task.update', built: true },
      { href: '/lich-sua-chua', label: 'Lịch sửa chữa', icon: CalendarDays, screen: 'A3.40', round: '1.5', tone: 'peach', permission: 'booking.view', built: true },
      { href: '/lich-goi', label: 'Lịch gọi', icon: PhoneCall, screen: 'A3.41', round: '1.5', tone: 'rose', permission: 'customer.view', built: true },
      { href: '/cuu-ho', label: 'Ca cứu hộ', icon: LifeBuoy, screen: 'A3.43', round: '4.1', tone: 'rose', permission: 'sos.manage', built: true },
      { href: '/doi-cuu-ho', label: 'Đội cứu hộ', icon: Truck, screen: 'A5.01', round: '4.1', tone: 'rose', permission: 'sos.handle', built: true },
    ],
  },
  {
    label: 'Kênh người bán',
    items: [
      { href: '/gian-hang', label: 'Gian hàng trên sàn', icon: Store, screen: 'A3.50', round: '3.2', tone: 'sky', permission: 'shop.manage', built: true },
      { href: '/yeu-cau-san', label: 'Yêu cầu từ sàn', icon: Inbox, screen: 'A3.53', round: '3.4', tone: 'peach', permission: 'order_request.manage', built: true },
      { href: '/khuyen-mai', label: 'Voucher', icon: TicketPercent, screen: 'A3.54', round: '3.4', tone: 'rose', permission: 'promotion.manage', built: true },
      { href: '/danh-gia-san', label: 'Đánh giá & phản ánh', icon: Star, screen: 'A3.55', round: '3.5', tone: 'peach', permission: 'order_request.manage', built: true },
      { href: '/thong-ke-san', label: 'Thống kê gian hàng', icon: ChartLine, screen: 'A3.57', round: '3.5', tone: 'lav', permission: 'shop.manage', built: true },
    ],
  },
  {
    label: 'Mở rộng',
    items: [
      { href: '/thue-xe', label: 'Thuê xe', icon: CarFront, screen: 'A3.60', round: '4.2', tone: 'mint', permission: 'rental.view', built: true },
      { href: '/xe-cu', label: 'Xe cũ & kiểm định', icon: ClipboardCheck, screen: 'A3.61', round: '4.3', tone: 'lav', permission: 'used_car.appraise', built: true },
      { href: '/cong-dong', label: 'Cộng đồng chủ xe', icon: MessageSquare, screen: 'A3.64', round: '4.4', tone: 'sky', permission: 'community.manage', built: true },
    ],
  },
  {
    label: 'Phân tích',
    items: [
      { href: '/bao-cao', label: 'Báo cáo', icon: ChartColumn, screen: 'A3.80', round: '4.4', tone: 'lav', permission: 'report.view', built: true },
      { href: '/marketing', label: 'Marketing', icon: Megaphone, screen: 'A3.62', round: '5.1', tone: 'peach', permission: 'marketing.manage', built: true },
      { href: '/tro-ly-ai', label: 'Trợ lý AI', icon: Sparkles, screen: 'A3.63', round: 'P5', tone: 'lav', permission: 'dashboard.view' },
    ],
  },
  // ---- Cổng đối tác (A7): đối tác 1 tài khoản, mọi dịch vụ xử lý ở đây ----
  {
    label: 'Gian hàng',
    items: [
      { href: '/doi-tac/gian-hang', label: 'Hồ sơ gian hàng', icon: Store, screen: 'A7.10', round: '3.2', tone: 'sky', permission: 'partner.shop.manage', workspace: 'PARTNER', built: true },
      { href: '/doi-tac/san-pham', label: 'Sản phẩm', icon: Package, screen: 'A7.11', round: '3.2', tone: 'lav', permission: 'partner.listing.manage', workspace: 'PARTNER', built: true },
      { href: '/doi-tac/dich-vu', label: 'Dịch vụ', icon: Wrench, screen: 'A7.12', round: '3.2', tone: 'mint', permission: 'partner.listing.manage', workspace: 'PARTNER', built: true },
      { href: '/doi-tac/khuyen-mai', label: 'Khuyến mại', icon: TicketPercent, screen: 'A7.13', round: '3.4', tone: 'peach', permission: 'partner.promotion.manage', workspace: 'PARTNER', built: true },
    ],
  },
  {
    label: 'Yêu cầu từ khách',
    items: [
      { href: '/doi-tac/yeu-cau', label: 'Đặt hàng & đặt lịch', icon: Inbox, screen: 'A7.20', round: '3.4', tone: 'sky', permission: 'partner.request.manage', workspace: 'PARTNER', built: true },
      { href: '/doi-tac/cuu-ho', label: 'Cứu hộ', icon: LifeBuoy, screen: 'A7.21', round: '4.1', tone: 'rose', permission: 'partner.request.manage', workspace: 'PARTNER', built: true },
      { href: '/doi-tac/thue-xe', label: 'Thuê xe', icon: CarFront, screen: 'A7.22', round: '4.2', tone: 'mint', permission: 'partner.request.manage', workspace: 'PARTNER', built: true },
      { href: '/doi-tac/kiem-dinh', label: 'Kiểm định xe cũ', icon: ClipboardCheck, screen: 'A7.23', round: '4.3', tone: 'lav', permission: 'partner.request.manage', workspace: 'PARTNER', built: true },
      { href: '/doi-tac/danh-gia', label: 'Đánh giá', icon: Star, screen: 'A7.24', round: '3.5', tone: 'peach', permission: 'partner.review.reply', workspace: 'PARTNER', built: true },
    ],
  },
  {
    label: 'Báo cáo & phí',
    items: [
      { href: '/doi-tac/thong-ke', label: 'Thống kê', icon: ChartLine, screen: 'A7.30', round: '3.5', tone: 'sky', permission: 'partner.report.view', workspace: 'PARTNER', built: true },
      { href: '/doi-tac/phi', label: 'Phí & hoá đơn', icon: Receipt, screen: 'A7.31', round: '3.1', tone: 'mint', permission: 'partner.billing.view', workspace: 'PARTNER', built: true },
    ],
  },
  {
    label: 'Quản trị sàn',
    items: [
      { href: '/san/bao-cao', label: 'Dashboard & Báo cáo sàn', icon: ChartColumn, screen: 'A6.01', round: '4.4', tone: 'brand', permission: 'platform.report.view', workspace: 'PLATFORM', built: true },
      { href: '/san/doi-tac', label: 'Đối tác garage', icon: Building2, screen: 'A6.10', round: '3.1', tone: 'sky', permission: 'platform.partner.review', workspace: 'PLATFORM', built: true },
      { href: '/san/danh-muc-chuan', label: 'Danh mục chuẩn', icon: BookOpen, screen: 'A6.20', round: '3.2', tone: 'lav', permission: 'platform.catalog.manage', workspace: 'PLATFORM', built: true },
      { href: '/san/tin-dang', label: 'Kiểm duyệt tin đăng', icon: ShieldCheck, screen: 'A6.30', round: '3.2', tone: 'peach', permission: 'platform.partner.review', workspace: 'PLATFORM', built: true },
      { href: '/san/thue-xe', label: 'Kiểm duyệt xe thuê', icon: CarFront, screen: 'A6.30b', round: '4.2', tone: 'mint', permission: 'platform.partner.review', workspace: 'PLATFORM', built: true },
      { href: '/san/xe-cu', label: 'Kiểm duyệt xe cũ', icon: Car, screen: 'A6.31', round: '4.3', tone: 'lav', permission: 'platform.partner.review', workspace: 'PLATFORM', built: true },
      { href: '/san/cong-dong', label: 'Cộng đồng & Nội dung', icon: MessageSquare, screen: 'A6.32', round: '4.4', tone: 'peach', permission: 'platform.report.view', workspace: 'PLATFORM', built: true },
      { href: '/san/thong-bao', label: 'Mẫu tin & Chiến dịch', icon: Megaphone, screen: 'A6.63', round: '5.1', tone: 'peach', permission: 'platform.report.view', workspace: 'PLATFORM', built: true },
      { href: '/san/phi-doi-tac', label: 'Phí đối tác', icon: Receipt, screen: 'A6.50', round: '3.1', tone: 'mint', permission: 'platform.fee.manage', workspace: 'PLATFORM', built: true },
      { href: '/san/phan-anh', label: 'Phản ánh & vi phạm', icon: Flag, screen: 'A6.41', round: '3.5', tone: 'rose', permission: 'platform.report.handle', workspace: 'PLATFORM', built: true },
      { href: '/san/cuu-ho', label: 'Giám sát cứu hộ', icon: LifeBuoy, screen: 'A6.61', round: '4.1', tone: 'rose', permission: 'platform.report.handle', workspace: 'PLATFORM', built: true },
    ],
  },
  {
    label: 'Hệ thống',
    items: [{ href: '/cai-dat', label: 'Cài đặt', icon: Settings, screen: 'A3.90', round: '0.2', tone: 'slate', permission: 'audit.view', workspace: 'ALL', built: true }],
  },
];

export const NAV_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);

export function findNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((i) => i.href === pathname);
}

/** Mục menu chứa trang này (VD /khach-hang/abc thuộc mục Khách hàng). */
export function sectionOf(pathname: string): NavItem | undefined {
  // Chi tiết đơn nằm ở /don-hang/:id, thuộc mục "Đơn đang xử lý"
  if (pathname.startsWith('/don-hang/')) return findNavItem('/don-dang-xu-ly');
  return findNavItem(pathname) ?? NAV_ITEMS.filter((i) => i.href !== '/' && pathname.startsWith(i.href + '/')).sort((a, b) => b.href.length - a.href.length)[0];
}

/** Mục menu người dùng được thấy, theo quyền và không gian làm việc (garage PLG / đối tác / sàn). */
export function visibleNav(permissions: readonly string[], workspace: TenantKind): NavGroup[] {
  const allowed = (i: NavItem) =>
    (i.workspace ?? 'GARAGE') === workspace || i.workspace === 'ALL' ? !i.permission || permissions.includes(i.permission) : false;
  return NAV.map((g) => ({ ...g, items: g.items.filter(allowed) })).filter((g) => g.items.length > 0);
}

/** Trang đầu tiên người dùng được vào (KTV / Đội cứu hộ không có Tổng quan → vào thẳng màn hình việc). */
export function homeFor(permissions: readonly string[], workspace: TenantKind): string {
  if (workspace === 'GARAGE' && permissions.includes('dashboard.view')) return '/';
  if (workspace === 'GARAGE' && permissions.includes('ro.task.update')) return '/viec-cua-toi';
  if (workspace === 'GARAGE' && permissions.includes('sos.handle')) return '/doi-cuu-ho';
  return '/trang-chu';
}
