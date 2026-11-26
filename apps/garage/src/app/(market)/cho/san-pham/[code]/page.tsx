import type { Metadata } from 'next';
import { ItemDetailView, itemMeta } from '@/components/market/item-pages';
import type { SP } from '@/lib/market';

export const dynamic = 'force-dynamic';
type P = { params: Promise<{ code: string }>; searchParams: SP };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  return itemMeta('PRODUCT', decodeURIComponent((await params).code));
}

/** A1.05 Chi tiết: các garage đang bán, so giá */
export default async function Page({ params, searchParams }: P) {
  return <ItemDetailView kind="PRODUCT" code={decodeURIComponent((await params).code)} searchParams={searchParams} />;
}
