import type { MetadataRoute } from 'next';

const SITE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
const API = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export const dynamic = 'force-dynamic';

/** sitemap.xml: trang chủ sàn, gian hàng, sản phẩm / dịch vụ đang có garage bán */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const fixed: MetadataRoute.Sitemap = ['/cho', '/cho/tim-garage', '/cho/san-pham', '/cho/dich-vu', '/cho/cuu-ho', '/dang-ky-doi-tac'].map((p) => ({ url: `${SITE}${p}` }));
  try {
    const res = await fetch(`${API}/api/public/market/sitemap`, { cache: 'no-store' });
    if (!res.ok) return fixed;
    const d = (await res.json()) as { shops: { slug: string; updatedAt: string }[]; items: { code: string; kind: string; updatedAt: string }[] };
    return [
      ...fixed,
      ...d.shops.map((s) => ({ url: `${SITE}/cho/garage/${s.slug}`, lastModified: s.updatedAt })),
      ...d.items.map((i) => ({ url: `${SITE}/cho/${i.kind === 'SERVICE' ? 'dich-vu' : 'san-pham'}/${encodeURIComponent(i.code.toLowerCase())}`, lastModified: i.updatedAt })),
    ];
  } catch {
    return fixed;
  }
}
