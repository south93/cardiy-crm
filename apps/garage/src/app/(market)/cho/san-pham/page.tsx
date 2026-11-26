import type { Metadata } from 'next';
import { ItemList } from '@/components/market/item-pages';
import type { SP } from '@/lib/market';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sản phẩm', description: 'Lốp, ắc quy, dầu nhớt: so giá giữa các garage trên sàn CARDIY.' };

/** A1.04 Sản phẩm */
export default function Page({ searchParams }: { searchParams: SP }) {
  return <ItemList kind="PRODUCT" searchParams={searchParams} />;
}
