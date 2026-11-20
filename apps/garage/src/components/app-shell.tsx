'use client';

import { cn, Spinner } from '@cardiy/ui';
import { Bell, ChevronsUpDown, KeyRound, LogOut, MapPin, Menu, PanelLeftClose, Repeat, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { QuickSearch } from '@/components/quick-search';
import { homeFor, sectionOf, visibleNav } from '@/lib/nav';

const SIDEBAR_KEY = 'cardiy.sidebar';
const BRANCH_KEY = 'cardiy.branch';

function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStore(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* trình duyệt chặn lưu trữ: bỏ qua */
  }
}

/** Đường dẫn vẫn mở được khi tài khoản đang bị giới hạn (chưa bật 2FA bắt buộc). */
const LIMITED_OK = ['/bao-mat'];

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(-2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const { status, me } = auth;
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [branchId, setBranchId] = useState<string>('');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setCollapsed(readStore(SIDEBAR_KEY) === 'collapsed'), []);
  useEffect(() => {
    setMobileOpen(false);
    setMenuOpen(false);
  }, [pathname]);

  // Chặn trang khi chưa đăng nhập / tài khoản cần hoàn tất bảo mật
  useEffect(() => {
    if (status === 'anon') router.replace(`/dang-nhap?next=${encodeURIComponent(pathname)}`);
    else if (status === 'authed' && auth.mustChangePassword) router.replace('/doi-mat-khau');
    else if (status === 'authed' && auth.mustSetup2fa && !LIMITED_OK.includes(pathname)) router.replace('/bao-mat?batbuoc=1');
  }, [status, auth.mustChangePassword, auth.mustSetup2fa, pathname, router]);

  // Chi nhánh đang làm việc: nhớ theo trình duyệt, chỉ trong phạm vi được phép
  useEffect(() => {
    if (!me?.branches.length) return;
    const saved = readStore(BRANCH_KEY);
    setBranchId(me.branches.some((b) => b.id === saved) ? saved! : me.branches[0]!.id);
  }, [me]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenuOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  if (status !== 'authed' || !me || auth.mustChangePassword || (auth.mustSetup2fa && !LIMITED_OK.includes(pathname))) {
    return (
      <div className="grid h-screen place-items-center text-slate-500" data-testid="auth-loading">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  }

  const workspace = me.workspace.tenantType;
  const nav = visibleNav(me.permissions, workspace);
  const item = sectionOf(pathname);
  const SUB_TITLES: Record<string, string> = { '/bao-mat': 'Tài khoản & bảo mật', '/khach-hang/nhap': 'Nhập dữ liệu từ AppSheet' };
  const title = SUB_TITLES[pathname] ?? item?.label ?? 'Booking Cardiy';

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      writeStore(SIDEBAR_KEY, c ? 'open' : 'collapsed');
      return !c;
    });

  const roleNames = [...new Set(me.roles.map((r) => r.name))].join(', ');
  const others = me.memberships.filter((m) => m.membershipId !== me.workspace.membershipId);

  return (
    <div className="flex h-screen overflow-hidden lg:gap-3 lg:p-3">
      {/* ===== Menu bên trái ===== */}
      <aside
        data-testid="sidebar"
        data-collapsed={collapsed}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[248px] shrink-0 flex-col border border-white/90 bg-white shadow-card transition-[width,transform] duration-200 lg:bg-white/90',
          'lg:static lg:translate-x-0 lg:rounded-card',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed && 'lg:w-[84px]',
        )}
      >
        <div className="flex h-[68px] shrink-0 items-center gap-2.5 px-5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-600 text-xs font-extrabold italic text-white">PLG</span>
          <div className={cn('min-w-0 leading-tight', collapsed && 'lg:hidden')}>
            <div className="whitespace-nowrap text-[15px] font-semibold tracking-wide">BOOKING CARDIY</div>
            <div className="truncate text-xs text-slate-500" data-testid="workspace-name">
              {me.workspace.tenantName}
            </div>
          </div>
        </div>

        <nav className="scroll-thin flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3 text-sm" aria-label="Menu chính">
          {nav.map((group, gi) => (
            <div key={gi}>
              {group.label && (
                <>
                  <div className={cn('mb-1.5 mt-5 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400', collapsed && 'lg:hidden')}>
                    {group.label}
                  </div>
                  <div className={cn('mx-[18px] my-2.5 hidden h-px bg-slate-200', collapsed && 'lg:block')} />
                </>
              )}
              {group.items.map((it) => {
                const active = it.href === item?.href;
                const Icon = it.icon;
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    title={it.label}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'my-0.5 flex items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-slate-600',
                      active ? 'bg-brand-600 font-semibold text-white' : 'hover:bg-brand-50',
                      collapsed && 'lg:mx-auto lg:h-11 lg:w-11 lg:justify-center lg:rounded-full lg:px-0',
                    )}
                  >
                    <Icon className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-white' : 'text-slate-400')} />
                    <span className={cn('flex-1', collapsed && 'lg:hidden')}>{it.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-slate-100 p-3">
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
        </div>
      </aside>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden />}

      {/* ===== Nội dung ===== */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[68px] shrink-0 items-center gap-3 px-4 lg:px-3">
          <button type="button" className="-ml-1 rounded-xl p-2 hover:bg-white/70 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Mở menu" data-testid="mobile-menu">
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="truncate whitespace-nowrap text-xl font-semibold lg:text-2xl" data-testid="page-title">
            {title}
          </h1>
          <div className="flex-1" />
          <QuickSearch />
          <button type="button" className="hidden h-10 w-10 place-items-center rounded-full bg-white/80 sm:grid" aria-label="Thông báo">
            <Bell className="h-[18px] w-[18px] text-slate-600" />
          </button>
          {me.branches.length > 0 && (
            <label className="hidden items-center gap-2 rounded-full bg-white/80 py-1.5 pl-1.5 pr-2 text-sm md:flex">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-600 text-white">
                <MapPin className="h-3.5 w-3.5" />
              </span>
              <select
                aria-label="Chi nhánh đang làm việc"
                data-testid="branch-select"
                value={branchId}
                onChange={(e) => {
                  setBranchId(e.target.value);
                  writeStore(BRANCH_KEY, e.target.value);
                }}
                className="max-w-[180px] cursor-pointer bg-transparent font-medium outline-none"
              >
                {me.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-2 rounded-full bg-white/80 p-1 pr-2"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              data-testid="user-menu"
            >
              {me.user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={me.user.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
              ) : (
                <span className="grid h-8 w-8 place-items-center rounded-full bg-lav-100 text-xs font-semibold text-lav-700">{initials(me.user.fullName)}</span>
              )}
              <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 top-12 z-50 w-72 rounded-2xl border border-slate-100 bg-white p-2 shadow-card">
                <div className="px-3 py-2">
                  <div className="font-semibold" data-testid="user-name">
                    {me.user.fullName}
                  </div>
                  <div className="text-xs text-slate-500">{me.user.phone}</div>
                  <div className="mt-1 text-xs text-brand-700">{roleNames}</div>
                </div>
                {others.length > 0 && (
                  <div className="border-t border-slate-100 py-1">
                    <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Chuyển không gian làm việc</div>
                    {others.map((m) => (
                      <button
                        key={m.membershipId}
                        role="menuitem"
                        type="button"
                        onClick={async () => {
                          setMenuOpen(false);
                          await auth.switchWorkspace(m.membershipId);
                          router.push('/trang-chu');
                        }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm hover:bg-brand-50"
                      >
                        <Repeat className="h-4 w-4 text-slate-400" />
                        <span className="flex-1">{m.tenantName}</span>
                        <span className="text-[11px] text-slate-400">{m.tenantType === 'PLATFORM' ? 'Sàn' : m.tenantType === 'PARTNER' ? 'Đối tác' : 'Garage'}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="border-t border-slate-100 pt-1">
                  <Link role="menuitem" href="/bao-mat" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm hover:bg-brand-50">
                    {me.user.totpEnabled ? <ShieldCheck className="h-4 w-4 text-mint-700" /> : <KeyRound className="h-4 w-4 text-slate-400" />}
                    Tài khoản & bảo mật
                  </Link>
                  <button
                    role="menuitem"
                    type="button"
                    data-testid="logout"
                    onClick={async () => {
                      await auth.logout();
                      router.replace('/dang-nhap');
                    }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-100"
                  >
                    <LogOut className="h-4 w-4" />
                    Đăng xuất
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>
        <main className="scroll-thin flex-1 overflow-y-auto px-4 pb-6 lg:px-3">{children}</main>
      </div>
    </div>
  );
}

/** Dùng trong trang: chuyển về trang chủ phù hợp nếu không có quyền xem trang này. */
export function useHomePath(): string {
  const { me } = useAuth();
  return me ? homeFor(me.permissions, me.workspace.tenantType) : '/dang-nhap';
}
