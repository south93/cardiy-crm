import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { OwnerShell } from './shell';

export const metadata: Metadata = {
  title: { default: 'Xe của tôi', template: '%s · Xe của tôi' },
  description: 'Theo dõi xe, lịch sử sửa chữa và đơn đang làm tại garage',
  manifest: '/app/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Xe của tôi', statusBarStyle: 'default' },
  icons: { apple: '/app/icon-192.png' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1f4e9c' };

export default function OwnerLayout({ children }: { children: ReactNode }) {
  return <OwnerShell>{children}</OwnerShell>;
}
