import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center p-6 text-center">
      <div>
        <p className="text-5xl font-semibold text-brand-600">404</p>
        <p className="mt-2 text-slate-600">Không tìm thấy trang này.</p>
        <Link href="/" className="mt-4 inline-block rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white">
          Về trang Tổng quan
        </Link>
      </div>
    </div>
  );
}
