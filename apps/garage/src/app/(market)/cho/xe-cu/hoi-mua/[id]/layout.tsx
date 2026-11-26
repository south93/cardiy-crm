import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Hội thoại & Lịch hẹn xem xe',
  robots: { index: false, follow: false },
};

export default function UsedCarInquiryLayout({ children }: { children: ReactNode }) {
  return children;
}
