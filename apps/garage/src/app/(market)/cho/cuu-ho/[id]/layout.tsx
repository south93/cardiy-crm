import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Theo dõi cứu hộ SOS',
  robots: { index: false, follow: false },
};

export default function PublicSosTrackLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
