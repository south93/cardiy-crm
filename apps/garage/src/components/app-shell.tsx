'use client';

import { cn } from '@cardiy/ui';
import { Bell, ChevronsUpDown, MapPin, Menu, PanelLeftClose, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { NAV, findNavItem } from '@/lib/nav';

const STORAGE_KEY = 'cardiy.sidebar';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? 'collapsed' : 'open');
  } catch {
    /* trình duyệt chặn lưu trữ: bỏ qua */
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => setCollapsed(readCollapsed()), []);
  useEffect(() => setMobileOpen(false), [pathname]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      writeCollapsed(!c);
      return !c;
    });
  };

  const title = findNavItem(pathname)?.label ?? 'Booking Cardiy';

  return (
    <div className="flex h-screen overflow-hidden lg:gap-3 lg:p-3">
      {/* ===== Menu bên trái ===== */}
      <aside
        data-testid="sidebar"
        data-collapsed={collapsed}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[248px] shrink-0 flex-col border border-white/90 bg-white shadow-card lg:bg-white/90 transition-[width,transform] duration-200',
          'lg:static lg:translate-x-0 lg:rounded-card',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed && 'lg:w-[84px]',
        )}
      >
        <div className="flex h-[68px] shrink-0 items-center gap-2.5 px-5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-600 text-xs font-extrabold italic text-white">
            PLG
          </span>
          <span className={cn('whitespace-nowrap text-[15px] font-semibold tracking-wide', collapsed && 'lg:hidden')}>
            BOOKING CARDIY
          </span>
        </div>

        <nav className="scroll-thin flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3 text-sm" aria-label="Menu chính">
          {NAV.map((group, gi) => (
            <div key={gi}>
              {group.label && (
                <>
                  <div
                    className={cn(
                      'mb-1.5 mt-5 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400',
                      collapsed && 'lg:hidden',
                    )}
                  >
                    {group.label}
                  </div>
                  <div className={cn('mx-[18px] my-2.5 hidden h-px bg-slate-200', collapsed && 'lg:block')} />
                </>
              )}
              {group.items.map((item) => {
                const active = item.href === pathname;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={item.label}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'my-0.5 flex items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-slate-600',
                      active ? 'bg-brand-600 font-semibold text-white' : 'hover:bg-brand-50',
                      collapsed && 'lg:mx-auto lg:h-11 lg:w-11 lg:justify-center lg:rounded-full lg:px-0',
                    )}
                  >
                    <Icon className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-white' : 'text-slate-400')} />
                    <span className={cn('flex-1', collapsed && 'lg:hidden')}>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="shrink-0 space-y-1 border-t border-slate-100 p-3">
          <button
            type="button"
            onClick={toggleCollapsed}
            data-testid="collapse-toggle"
            title={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'}
            className={cn(
              'hidden w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-500 hover:bg-brand-50 lg:flex',
              collapsed && 'lg:mx-auto lg:h-11 lg:w-11 lg:justify-center lg:px-0',
            )}
          >
            <PanelLeftClose className={cn('h-[18px] w-[18px] transition-transform', collapsed && 'rotate-180')} />
            <span className={cn(collapsed && 'lg:hidden')}>Thu gọn menu</span>
          </button>
          <div className="flex items-center gap-3 rounded-xl p-1.5">
            <div className="mx-auto grid h-10 w-10 shrink-0 place-items-center rounded-full bg-lav-100 text-sm font-semibold text-lav-700">
              QL
            </div>
            <div className={cn('flex-1 text-xs leading-tight', collapsed && 'lg:hidden')}>
              <div className="font-semibold">Quản lý chi nhánh</div>
              <div className="text-slate-500">Đăng nhập ở vòng 0.2</div>
            </div>
          </div>
        </div>
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden />
      )}

      {/* ===== Nội dung ===== */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[68px] shrink-0 items-center gap-3 px-4 lg:px-3">
          <button
            type="button"
            className="-ml-1 rounded-xl p-2 hover:bg-white/70 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Mở menu"
            data-testid="mobile-menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="whitespace-nowrap text-xl font-semibold lg:text-2xl" data-testid="page-title">
            {title}
          </h1>
          <div className="flex-1" />
          <div className="relative hidden w-72 md:block">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="w-full rounded-full bg-white/80 py-2.5 pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand-200"
              placeholder="Biển số, SĐT, mã đơn…"
              aria-label="Tìm kiếm"
            />
          </div>
          <button type="button" className="relative grid h-10 w-10 place-items-center rounded-full bg-white/80" aria-label="Thông báo">
            <Bell className="h-[18px] w-[18px] text-slate-600" />
          </button>
          <button type="button" className="hidden items-center gap-2 rounded-full bg-white/80 py-1.5 pl-1.5 pr-3 text-sm sm:flex">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-600 text-white">
              <MapPin className="h-3.5 w-3.5" />
            </span>
            <span className="font-medium">CN1 · Cầu Giấy</span>
            <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />
          </button>
        </header>
        <main className="scroll-thin flex-1 overflow-y-auto px-4 pb-6 lg:px-3">{children}</main>
      </div>
    </div>
  );
}
