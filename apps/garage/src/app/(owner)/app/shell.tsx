'use client';

import { Spinner } from '@cardiy/ui';
import { CalendarDays, CarFront, KeyRound, Tag, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { OwnerProvider, useOwner } from '@/lib/owner';

const PUBLIC = ['/app/dang-nhap', '/app/kich-hoat', '/app/otp'];

function Guard({ children }: { children: ReactNode }) {
  const { status } = useOwner();
  const path = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC.some((p) => path.startsWith(p));
  useEffect(() => {
    if (status === 'anon' && !isPublic) router.replace(`/app/dang-nhap?next=${encodeURIComponent(path + window.location.search)}`);
  }, [status, isPublic, path, router]);
  if (isPublic) return <>{children}</>;
  if (status !== 'authed')
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  return (
    <>
      {children}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur" data-testid="owner-tabs">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {[
            { href: '/app', label: 'Xe của tôi', icon: CarFront, on: path === '/app' || path.startsWith('/app/xe/') || path.startsWith('/app/don') || path.startsWith('/app/cuu-ho') || path.startsWith('/app/cong-dong') },
            { href: '/app/lich-hen', label: 'Lịch hẹn', icon: CalendarDays, on: path.startsWith('/app/lich-hen') || path.startsWith('/app/dat-lich') },
            { href: '/app/thue-xe', label: 'Thuê xe', icon: KeyRound, on: path.startsWith('/app/thue-xe') },
            { href: '/app/xe-cu', label: 'Xe cũ', icon: Tag, on: path.startsWith('/app/xe-cu') },
            { href: '/app/tai-khoan', label: 'Tài khoản', icon: UserRound, on: path.startsWith('/app/tai-khoan') },
          ].map((t) => (
            <Link key={t.href} href={t.href} className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] ${t.on ? 'font-semibold text-brand-700' : 'text-slate-500'}`}>
              <t.icon className="h-5 w-5" />
              {t.label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}

export function OwnerShell({ children }: { children: ReactNode }) {
  return (
    <OwnerProvider>
      <div className="min-h-screen bg-gradient-to-b from-brand-50 to-slate-50">
        <main className="mx-auto max-w-md px-4 pb-24 pt-5">
          <Guard>{children}</Guard>
        </main>
      </div>
    </OwnerProvider>
  );
}
