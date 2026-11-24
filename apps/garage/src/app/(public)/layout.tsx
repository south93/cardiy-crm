import type { ReactNode } from 'react';

/** Trang công khai (không cần đăng nhập): đăng ký đối tác, theo dõi hồ sơ */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen px-4 py-6 md:py-10">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-600 text-lg font-extrabold italic text-white">C</span>
          <span className="text-lg font-semibold tracking-wide">Sàn dịch vụ ô tô CARDIY</span>
        </div>
        {children}
      </div>
    </div>
  );
}
