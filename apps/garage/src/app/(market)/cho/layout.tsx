import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Search } from 'lucide-react';

export const metadata: Metadata = {
  title: { default: 'Sàn CARDIY · Tìm garage, so giá lốp, dầu nhớt, bảo dưỡng', template: '%s · Sàn CARDIY' },
  description: 'Tìm garage ô tô gần bạn, so giá lốp, ắc quy, dầu nhớt và dịch vụ bảo dưỡng giữa nhiều garage. Đặt lịch, gọi hoặc nhắn Zalo trực tiếp cho garage.',
  robots: { index: true, follow: true },
};

const NAV = [
  { href: '/cho/tim-garage', label: 'Tìm garage' },
  { href: '/cho/san-pham', label: 'Sản phẩm' },
  { href: '/cho/dich-vu', label: 'Dịch vụ' },
  { href: '/cho/cuu-ho', label: 'Cứu hộ SOS' },
  { href: '/dang-ky-doi-tac', label: 'Dành cho garage' },
];

/** A1 Web sàn công khai: không cần đăng nhập để xem */
export default function MarketLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50/60">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/cho" className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-base font-extrabold italic text-white">C</span>
            <span className="font-bold tracking-wide text-brand-700">CARDIY</span>
          </Link>
          <form action="/cho/san-pham" className="relative order-last w-full md:order-none md:w-auto md:flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              name="q"
              placeholder="Tìm lốp 205/55R16, dầu 5W-30, ắc quy…"
              aria-label="Tìm sản phẩm"
              className="w-full rounded-full border border-slate-200 bg-slate-50 py-2 pl-10 pr-4 text-sm focus:border-brand-500 focus:bg-white focus:outline-none"
            />
          </form>
          <nav
            className="-mx-4 flex w-[calc(100%+2rem)] items-center gap-4 overflow-x-auto whitespace-nowrap px-4 text-sm font-medium text-slate-600 md:mx-0 md:w-auto md:overflow-visible md:px-0"
            aria-label="Sàn"
          >
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={`hover:text-brand-700 ${n.href === '/dang-ky-doi-tac' ? 'hidden sm:inline' : ''}`}>
                {n.label}
              </Link>
            ))}
            <Link href="/app" className="ml-auto shrink-0 rounded-full bg-brand-600 px-3 py-1.5 text-white hover:bg-brand-700">
              Xe của tôi
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      <footer className="mt-10 border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl space-y-1 px-4 py-6 text-sm text-slate-500">
          <div className="font-semibold text-slate-700">Sàn CARDIY</div>
          <p>Sàn kết nối chủ xe với garage. Giá, tồn kho, bảo hành do từng garage công bố và chịu trách nhiệm; khách thanh toán trực tiếp cho garage.</p>
          <p>
            <Link href="/dang-ky-doi-tac" className="text-brand-700 hover:underline">
              Đăng ký làm đối tác garage
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
