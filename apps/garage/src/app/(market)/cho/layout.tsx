import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { MarketShell } from '@/components/market/market-shell';
import './market.css';

export const metadata: Metadata = {
  title: { default: 'Sàn CARDIY · Nâng tầm trải nghiệm lái — Tìm trạm, so giá lốp & bảo dưỡng', template: '%s · Sàn CARDIY' },
  description:
    'Nền tảng dịch vụ ô tô & Hệ thống trạm CARDIY: tra cứu lốp theo xe, bảo dưỡng nhanh, gầm xe, dịch vụ ngoại thất, cứu hộ SOS 24/7 và so giá minh bạch giữa nhiều garage.',
  robots: { index: true, follow: true },
};

/** A1 Web sàn công khai: không cần đăng nhập để xem */
export default function MarketLayout({ children }: { children: ReactNode }) {
  return <MarketShell>{children}</MarketShell>;
}
