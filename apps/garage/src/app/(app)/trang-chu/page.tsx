'use client';

import { Card, IconTile } from '@cardiy/ui';
import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { visibleNav } from '@/lib/nav';

/** Lưới chức năng giữ bố cục quen thuộc của hệ thống cũ (A3.02). Chỉ hiện mục người dùng có quyền. */
export default function HomeGridPage() {
  const { me } = useAuth();
  if (!me) return null;
  const groups = visibleNav(me.permissions, me.workspace.tenantType).filter((g) => g.label !== null);
  return (
    <div className="space-y-6" data-testid="home-grid">
      <p className="text-sm text-slate-500">
        Xin chào <span className="font-medium text-slate-700">{me.user.fullName}</span> · {me.workspace.tenantName}
      </p>
      {groups.map((group, gi) => (
        <section key={group.label}>
          <h2 className="mb-2.5 text-sm font-semibold text-slate-500">
            {gi + 1}. {group.label}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {group.items.map(({ href, label, icon: Icon, tone }) => (
              <Link key={href} href={href} className="block transition hover:-translate-y-0.5">
                <Card className="flex items-center gap-4 rounded-2xl p-4">
                  <IconTile tone={tone}>
                    <Icon className="h-6 w-6" />
                  </IconTile>
                  <span className="flex-1 font-medium">{label}</span>
                  <ArrowUpRight className="h-4 w-4 text-slate-300" />
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
