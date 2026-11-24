'use client';

import { Spinner, Tabs } from '@cardiy/ui';
import { useEffect, useState } from 'react';
import { OfferManager } from '@/components/offer-manager';
import { RequirePermission } from '@/components/require-permission';
import { ShopProfile } from '@/components/shop-profile';
import { api } from '@/lib/api';
import type { ShopInfo } from '@/lib/marketplace';

function GarageShop() {
  const [tab, setTab] = useState<'shop' | 'PRODUCT' | 'SERVICE'>('shop');
  const [branches, setBranches] = useState<ShopInfo['branches'] | null>(null);
  useEffect(() => void api<ShopInfo>('/shop').then((s) => setBranches(s.branches)), []);
  return (
    <div className="space-y-4">
      <Tabs
        tabs={[
          { value: 'shop', label: 'Hồ sơ gian hàng' },
          { value: 'PRODUCT', label: 'Sản phẩm trên sàn' },
          { value: 'SERVICE', label: 'Dịch vụ trên sàn' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'shop' ? <ShopProfile /> : branches ? <OfferManager key={tab} kind={tab} garage branches={branches} /> : <Spinner />}
    </div>
  );
}

/** A3.50 Kênh người bán: gian hàng của PLG trên sàn; tồn sản phẩm lấy từ kho CRM */
export default function GarageShopPage() {
  return (
    <RequirePermission permission="shop.manage">
      <GarageShop />
    </RequirePermission>
  );
}
