import type { Metadata } from 'next';
import { ItemList } from '@/components/market/item-pages';
import type { SP } from '@/lib/market';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Dịch vụ', description: 'Bảo dưỡng, sửa chữa, đồng sơn: so giá giữa các garage trên sàn CARDIY.' };

/** A1.06 Dịch vụ */
export default function Page({ searchParams }: { searchParams: SP }) {
  return <ItemList kind="SERVICE" searchParams={searchParams} />;
}
