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
  type LucideIcon,
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
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: null,
    items: [
      { href: '/', label: 'Tổng quan', icon: LayoutGrid, screen: 'A3.01', round: '0.1', tone: 'brand' },
      { href: '/trang-chu', label: 'Trang chủ', icon: House, screen: 'A3.02', round: '0.1', tone: 'brand' },
    ],
  },
  {
    label: 'Kinh doanh',
    items: [
      { href: '/ban-hang', label: 'Bán hàng', icon: ShoppingCart, screen: 'A3.10', round: '1.2', tone: 'sky' },
      { href: '/don-dang-xu-ly', label: 'Đơn đang xử lý', icon: Wrench, screen: 'A3.11', round: '1.2', tone: 'peach' },
      { href: '/don-hoan-thanh', label: 'Đơn hoàn thành', icon: CircleCheck, screen: 'A3.13', round: '1.3', tone: 'mint' },
    ],
  },
  {
    label: 'Kho hàng',
    items: [
      { href: '/danh-muc', label: 'Danh mục sản phẩm', icon: Boxes, screen: 'A3.20', round: '1.4', tone: 'lav' },
      { href: '/ton-kho', label: 'Tồn kho chi nhánh', icon: Warehouse, screen: 'A3.21', round: '1.4', tone: 'sky' },
    ],
  },
  {
    label: 'Đối tác',
    items: [
      { href: '/khach-hang', label: 'Khách hàng', icon: Users, screen: 'A3.30', round: '1.1', tone: 'mint' },
      { href: '/xe', label: 'Xe', icon: Car, screen: 'A3.32', round: '1.1', tone: 'sky' },
      { href: '/nha-cung-cap', label: 'Nhà cung cấp', icon: Truck, screen: 'A3.24', round: '1.4', tone: 'peach' },
    ],
  },
  {
    label: 'Nhân sự & Tài chính',
    items: [
      { href: '/nhan-vien', label: 'Nhân viên', icon: IdCard, screen: 'A3.70', round: '0.2', tone: 'lav' },
      { href: '/thu-chi', label: 'Thu chi & công nợ', icon: Wallet, screen: 'A3.72', round: '1.5', tone: 'mint' },
    ],
  },
  {
    label: 'Dịch vụ',
    items: [
      { href: '/lich-sua-chua', label: 'Lịch sửa chữa', icon: CalendarDays, screen: 'A3.40', round: '1.5', tone: 'peach' },
      { href: '/lich-goi', label: 'Lịch gọi', icon: PhoneCall, screen: 'A3.41', round: '1.5', tone: 'rose' },
    ],
  },
  {
    label: 'Kênh người bán',
    items: [{ href: '/gian-hang', label: 'Gian hàng trên sàn', icon: Store, screen: 'A3.50', round: '3.2', tone: 'sky' }],
  },
  {
    label: 'Phân tích',
    items: [
      { href: '/bao-cao', label: 'Báo cáo', icon: ChartColumn, screen: 'A3.80', round: '1.5', tone: 'lav' },
      { href: '/marketing', label: 'Marketing', icon: Megaphone, screen: 'A3.62', round: 'P5', tone: 'peach' },
      { href: '/tro-ly-ai', label: 'Trợ lý AI', icon: Sparkles, screen: 'A3.63', round: 'P5', tone: 'lav' },
    ],
  },
  {
    label: 'Hệ thống',
    items: [{ href: '/cai-dat', label: 'Cài đặt', icon: Settings, screen: 'A3.90', round: '0.2', tone: 'slate' }],
  },
];

export const NAV_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);

export function findNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((i) => i.href === pathname);
}
