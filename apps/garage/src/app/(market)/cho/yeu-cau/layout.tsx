import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** Trang riêng của khách (đặt yêu cầu / theo dõi bằng link bí mật): không lập chỉ mục */
export const metadata: Metadata = { title: 'Yêu cầu đặt hàng', robots: { index: false, follow: false } };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
