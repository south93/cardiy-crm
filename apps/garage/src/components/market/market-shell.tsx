/* eslint-disable @next/next/no-img-element */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { MarketIcon } from './market-icons';

/** Khung giao diện Sàn CARDIY (/cho): Topbar Navy + Navbar Sticky + Nội dung + Footer đồng bộ nhận diện thương hiệu. */
export function MarketShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/cho';
  const isHome = pathname === '/cho';
  const isServices =
    pathname.startsWith('/cho/dich-vu') ||
    pathname.startsWith('/cho/cuu-ho') ||
    pathname.startsWith('/cho/thue-xe') ||
    pathname.startsWith('/cho/xe-cu') ||
    pathname.startsWith('/cho/cong-dong');
  const isProducts = pathname.startsWith('/cho/san-pham');
  const isStations = pathname.startsWith('/cho/tim-garage') || pathname.startsWith('/cho/garage');
  const isChatbot = pathname.startsWith('/cho/tro-ly-ai');

  return (
    <div className={`cd-market ${isHome ? '' : 'cd-market-sub'}`}>
      {/* Tầng 1: Thanh thương hiệu Navy (#073477) */}
      <header className="cd-topbar">
        <div className="cd-wrap cd-top">
          <Link href="/cho" className="cd-logo" aria-label="Trang chủ Sàn CARDIY">
            <img src="/cho/images/logo.png" alt="CARDIY" />
          </Link>
          <div className="cd-tagline">
            Nền tảng dịch vụ ô tô <span>Hệ thống trạm CARDIY</span>
          </div>
          <div className="cd-toplinks">
            <Link href="/cho/tim-garage" className="cd-toplink">
              <MarketIcon name="pin" className="h-5 w-5" />
              Tìm trạm gần bạn
            </Link>
            <Link href="/cho/cuu-ho" className="cd-toplink">
              <MarketIcon name="headset" className="h-5 w-5" />
              Hỗ trợ 24/7
            </Link>
            <Link href="/app" className="cd-toplink">
              <MarketIcon name="user" className="h-5 w-5" />
              Đăng nhập
            </Link>
            <Link href="/cho/dich-vu" className="cd-yellow">
              <MarketIcon name="calendar" className="h-5 w-5" />
              Đặt lịch ngay
            </Link>
          </div>
        </div>
      </header>

      {/* Tầng 2: Thanh điều hướng nền trắng (Sticky) + Ô tìm kiếm toàn sàn */}
      <nav className="cd-navbar" aria-label="Sàn">
        <div className="cd-wrap cd-nav">
          <div className="cd-nav-links">
            <Link href="/cho" className={`cd-nav-item ${isHome ? 'active' : ''}`}>
              Trang chủ
            </Link>

            <div className="cd-nav-dropdown">
              <Link href="/cho/dich-vu" className={`cd-nav-item ${isServices ? 'active' : ''}`}>
                Dịch vụ <MarketIcon name="chevron-down" className="h-3.5 w-3.5" />
              </Link>
              <div className="cd-nav-dropdown-menu">
                <Link href="/cho/dich-vu">
                  <span>Bảo dưỡng &amp; Sửa chữa</span>
                  <MarketIcon name="chevron" className="h-3.5 w-3.5 text-slate-400" />
                </Link>
                <Link href="/cho/san-pham">
                  <span>Lốp &amp; Phụ tùng chính hãng</span>
                  <MarketIcon name="chevron" className="h-3.5 w-3.5 text-slate-400" />
                </Link>
                <Link href="/cho/cuu-ho">
                  <span className="text-rose-600">Cứu hộ SOS 24/7</span>
                  <MarketIcon name="chevron" className="h-3.5 w-3.5 text-rose-500" />
                </Link>
                <Link href="/cho/thue-xe">
                  <span>Thuê xe tự lái</span>
                  <MarketIcon name="chevron" className="h-3.5 w-3.5 text-slate-400" />
                </Link>
                <Link href="/cho/xe-cu">
                  <span>Xe cũ đã kiểm định</span>
                  <MarketIcon name="chevron" className="h-3.5 w-3.5 text-slate-400" />
                </Link>
                <Link href="/cho/cong-dong">
                  <span>Cộng đồng &amp; Sách nói</span>
                  <MarketIcon name="chevron" className="h-3.5 w-3.5 text-slate-400" />
                </Link>
              </div>
            </div>

            <Link href="/cho/san-pham" className={`cd-nav-item ${isProducts ? 'active' : ''}`}>
              Lốp theo xe
            </Link>
            <Link href="/cho#offers" className="cd-nav-item">
              Ưu đãi
            </Link>
            <Link href="/cho/dich-vu" className="cd-nav-item">
              Đặt lịch
            </Link>
            <Link href="/cho/tim-garage" className={`cd-nav-item ${isStations ? 'active' : ''}`}>
              Hệ thống trạm
            </Link>
            <Link
              href="/cho/tro-ly-ai"
              data-testid="market-chatbot-link"
              className={`cd-nav-item ${isChatbot ? 'active' : ''}`}
            >
              <MarketIcon name="sparkles" className="h-4 w-4 text-[#0962ba]" />
              Trợ lý AI
            </Link>
            <Link href="/dang-ky-doi-tac" className="cd-nav-item">
              Doanh nghiệp &amp; Nhượng quyền
            </Link>
            <Link href="/cho#gioi-thieu" className="cd-nav-item">
              Giới thiệu
            </Link>
          </div>

          <form action="/cho/san-pham" className="cd-search-form">
            <input
              name="q"
              aria-label="Tìm trên sàn"
              placeholder="Tìm lốp 185/65R15, dầu 5W-30…"
              className="cd-search-input"
            />
            <button type="submit" aria-label="Tìm kiếm" className="cd-search-btn">
              <MarketIcon name="search" className="h-4 w-4" />
            </button>
          </form>
        </div>
      </nav>

      {/* Nội dung trang: Trang chủ tràn viền cho Hero, các trang con căn khung chuẩn */}
      {isHome ? (
        <main className="flex-1">{children}</main>
      ) : (
        <main className="mx-auto w-[93.2%] max-w-6xl flex-1 py-6 md:py-8">{children}</main>
      )}

      {/* Footer đồng bộ thương hiệu CARDIY */}
      <footer id="gioi-thieu" className="cd-footer" data-testid="market-footer">
        {/* Dải CTA hợp tác garage & nhượng quyền trạm */}
        <div className="cd-footer-cta">
          <div className="cd-wrap cd-footer-cta-inner">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-[#ffd400]">
                DOANH NGHIỆP &amp; NHƯỢNG QUYỀN TRẠM CARDIY
              </div>
              <h2 className="mt-2 text-xl font-extrabold italic tracking-tight text-white md:text-2xl">
                Đưa garage của bạn lên Sàn CARDIY hoặc mở trạm dịch vụ chuẩn hoá
              </h2>
              <p className="mt-1 text-sm text-blue-100/85">
                Tiếp cận hàng nghìn chủ xe khu vực phía Nam, đồng bộ bảng giá minh bạch, nhận lịch hẹn trực tuyến và phần mềm quản trị CRM chuyên sâu.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/dang-ky-doi-tac" className="cd-yellow text-sm">
                Đăng ký đối tác garage
                <MarketIcon name="chevron" className="h-4 w-4" />
              </Link>
              <Link href="/cho/tro-ly-ai" className="cd-outline text-sm">
                <MarketIcon name="sparkles" className="h-4 w-4 text-[#ffd400]" />
                Tư vấn nhanh cùng AI
              </Link>
            </div>
          </div>
        </div>

        {/* 4 cột thông tin chính */}
        <div className="cd-wrap cd-footer-grid">
          {/* Cột 1: Nhận diện thương hiệu & Liên hệ */}
          <div className="space-y-4">
            <Link href="/cho" className="inline-block w-44">
              <img src="/cho/images/logo.png" alt="CARDIY" className="h-auto w-full" />
            </Link>
            <p className="text-sm leading-relaxed text-blue-100/85">
              Nền tảng dịch vụ ô tô &amp; Hệ thống trạm CARDIY — Một điểm đến, đa dịch vụ: lốp chính hãng, bảo dưỡng nhanh, gầm máy, chăm sóc xe và cứu hộ 24/7.
            </p>
            <ul className="space-y-2.5 text-sm text-blue-100/90">
              <li className="flex items-start gap-2.5">
                <MarketIcon name="pin" className="mt-0.5 h-4 w-4 text-[#ffd400]" />
                <span>Hệ thống trạm: Bình Dương – TP.HCM – Đồng Nai – Bình Phước</span>
              </li>
              <li className="flex items-center gap-2.5">
                <MarketIcon name="headset" className="h-4 w-4 text-[#ffd400]" />
                <span>
                  Tổng đài &amp; Cứu hộ 24/7:{' '}
                  <a href="tel:19006868" className="font-bold text-[#ffd400] hover:underline">
                    1900 6868
                  </a>
                </span>
              </li>
              <li className="flex items-center gap-2.5">
                <MarketIcon name="mail" className="h-4 w-4 text-[#ffd400]" />
                <a href="mailto:cskh@cardiy.vn" className="hover:text-[#ffd400]">
                  cskh@cardiy.vn
                </a>
              </li>
              <li className="flex items-center gap-2.5">
                <MarketIcon name="clock" className="h-4 w-4 text-[#ffd400]" />
                <span>Giờ mở cửa trạm: 07:30 – 18:00 (Thứ 2 – Chủ nhật)</span>
              </li>
            </ul>
          </div>

          {/* Cột 2: Dịch vụ & Sản phẩm */}
          <div>
            <h3 className="cd-footer-heading">Dịch vụ &amp; Sản phẩm</h3>
            <ul className="cd-footer-links">
              <li>
                <Link href="/cho/san-pham?q=Lốp">
                  <MarketIcon name="chevron" className="h-3.5 w-3.5 text-[#ffd400]" />
                  Tra cứu lốp theo xe
                </Link>
              </li>
              <li>
                <Link href="/cho/dich-vu">
                  <MarketIcon name="chevron" className="h-3.5 w-3.5 text-[#ffd400]" />
                  Bảo dưỡng nhanh định kỳ
                </Link>
              </li>
              <li>
                <Link href="/cho/dich-vu?q=Gầm">
                  <MarketIcon name="chevron" className="h-3.5 w-3.5 text-[#ffd400]" />
                  Chăm sóc gầm – thước lái – giảm xóc
                </Link>
              </li>
              <li>
                <Link href="/cho/san-pham">
                  <MarketIcon name="chevron" className="h-3.5 w-3.5 text-[#ffd400]" />
                  Dầu nhớt, ắc quy &amp; phụ tùng chính hãng
                </Link>
              </li>
              <li>
                <Link href="/cho/cuu-ho">
                  <MarketIcon name="chevron" className="h-3.5 w-3.5 text-[#ffd400]" />
                  Cứu hộ giao thông SOS 24/7
                </Link>
              </li>
              <li>
                <Link href="/cho/tro-ly-ai">
                  <MarketIcon name="chevron" className="h-3.5 w-3.5 text-[#ffd400]" />
                  Trợ lý AI tư vấn mốc bảo dưỡng
                </Link>
              </li>
            </ul>
          </div>

          {/* Cột 3: Hệ sinh thái CARDIY */}
          <div>
            <h3 className="cd-footer-heading">Hệ sinh thái CARDIY</h3>
            <ul className="cd-footer-links">
              <li>
                <Link href="/cho/tim-garage">
                  <MarketIcon name="chevron" className="h-3.5 w-3.5 text-[#ffd400]" />
                  Tìm trạm &amp; garage gần bạn
                </Link>
              </li>
              <li>
                <Link href="/cho/xe-cu">
                  <MarketIcon name="chevron" className="h-3.5 w-3.5 text-[#ffd400]" />
                  Xe cũ đã kiểm định chất lượng
                </Link>
              </li>
              <li>
                <Link href="/cho/thue-xe">
                  <MarketIcon name="chevron" className="h-3.5 w-3.5 text-[#ffd400]" />
                  Thuê xe tự lái &amp; hợp đồng
                </Link>
              </li>
              <li>
                <Link href="/cho/cong-dong">
                  <MarketIcon name="chevron" className="h-3.5 w-3.5 text-[#ffd400]" />
                  Cộng đồng chủ xe &amp; Sách nói
                </Link>
              </li>
              <li>
                <Link href="/dang-ky-doi-tac">
                  <MarketIcon name="chevron" className="h-3.5 w-3.5 text-[#ffd400]" />
                  Đăng ký làm đối tác garage
                </Link>
              </li>
            </ul>
          </div>

          {/* Cột 4: Cam kết dịch vụ & Cổng thành viên */}
          <div className="space-y-4">
            <h3 className="cd-footer-heading">Cam kết &amp; Cổng thành viên</h3>
            <div className="grid grid-cols-1 gap-2 text-xs text-blue-100/90">
              <div className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
                <MarketIcon name="shield" className="h-4 w-4 text-[#ffd400]" />
                <span>Niêm yết giá minh bạch – Báo giá trước khi làm</span>
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
                <MarketIcon name="badge" className="h-4 w-4 text-[#ffd400]" />
                <span>100% phụ tùng &amp; lốp xe nguồn gốc chính hãng</span>
              </div>
            </div>

            <div className="rounded-2xl border border-white/15 bg-white/10 p-3.5">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#ffd400]">Dành cho chủ xe &amp; quản trị</div>
              <div className="mt-2.5 flex flex-col gap-2">
                <Link
                  href="/app"
                  className="inline-flex items-center justify-between rounded-xl bg-white px-3.5 py-2 text-sm font-bold text-[#073477] transition hover:bg-[#ffd400] hover:text-slate-950"
                >
                  <span className="inline-flex items-center gap-2">
                    <MarketIcon name="car" className="h-4 w-4" />
                    Sổ theo dõi Xe của tôi
                  </span>
                  <MarketIcon name="chevron" className="h-4 w-4" />
                </Link>
                <Link
                  href="/dang-nhap"
                  className="inline-flex items-center justify-between rounded-xl border border-white/25 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
                >
                  <span>Cổng Quản trị Garage / Đối tác</span>
                  <MarketIcon name="chevron" className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Thanh bản quyền & miễn trừ trách nhiệm sàn */}
        <div className="cd-footer-bottom">
          <div className="cd-wrap flex flex-col justify-between gap-2 py-4 md:flex-row md:items-center">
            <p className="font-medium text-white/85">
              © {new Date().getFullYear()} CARDIY Vietnam · Hệ thống trạm dịch vụ &amp; Sàn thương mại ô tô.
            </p>
            <p className="max-w-2xl text-xs text-blue-100/70 md:text-right">
              Sàn kết nối chủ xe với hệ thống trạm &amp; garage. Giá, tồn kho, bảo hành do từng garage công bố và chịu trách nhiệm; khách thanh toán trực tiếp cho garage.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
