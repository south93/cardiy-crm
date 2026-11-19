import { Badge, Card, IconTile } from '@cardiy/ui';
import { PencilRuler } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RequirePermission } from '@/components/require-permission';
import { NAV_ITEMS, findNavItem } from '@/lib/nav';

type Props = { params: Promise<{ slug: string[] }> };

export function generateStaticParams() {
  return NAV_ITEMS.filter((i) => !i.built).map((i) => ({ slug: i.href.slice(1).split('/') }));
}

// Đường dẫn ngoài menu → 404 thật (HTTP 404)
export const dynamicParams = false;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: findNavItem(`/${slug.join('/')}`)?.label ?? 'Không tìm thấy' };
}

/** Màn hình chưa xây dựng: cho biết sẽ làm ở vòng nào. */
export default async function PlaceholderPage({ params }: Props) {
  const { slug } = await params;
  const item = findNavItem(`/${slug.join('/')}`);
  if (!item) notFound();
  const Icon = item.icon;

  return (
    <RequirePermission permission={item.permission}>
    <Card className="p-12 text-center" data-testid="placeholder">
      <IconTile tone="lav" className="mx-auto h-14 w-14">
        <PencilRuler className="h-6 w-6" />
      </IconTile>
      <h2 className="mt-4 flex items-center justify-center gap-2 text-lg font-semibold">
        <Icon className="h-5 w-5 text-slate-400" />
        {item.label}
      </h2>
      <p className="mt-1 text-sm text-slate-500">Màn hình này sẽ được xây dựng ở các vòng tiếp theo.</p>
      <div className="mt-4 flex justify-center gap-2">
        <Badge tone="sky">Mã màn hình {item.screen}</Badge>
        <Badge tone="peach">Dự kiến vòng {item.round}</Badge>
      </div>
    </Card>
    </RequirePermission>
  );
}
