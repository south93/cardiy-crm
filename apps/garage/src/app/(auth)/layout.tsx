import type { ReactNode } from 'react';

/** Bố cục trang đăng nhập / đổi mật khẩu: thẻ ở giữa màn hình. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-600 text-sm font-extrabold italic text-white">PLG</span>
          <span className="text-lg font-semibold tracking-wide">BOOKING CARDIY</span>
        </div>
        {children}
      </div>
    </div>
  );
}
