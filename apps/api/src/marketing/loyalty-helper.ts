import type { Prisma } from '@prisma/client';
import {
  calcEarnedPoints,
  computeTierForPoints,
  DEFAULT_LOYALTY_CONFIG,
  TIER_LABEL,
  type CustomerTierCode,
} from './marketing-rules';

/**
 * Tự động cộng điểm tích luỹ & nâng hạng thành viên khi đơn sửa chữa chuyển sang DA_GIAO.
 * Chống cộng trùng nhờ kiểm tra giao dịch EARN của chính đơn đó.
 */
export async function awardOrderLoyaltyPoints(
  tx: Prisma.TransactionClient,
  opts: {
    tenantId: string;
    customerId: string;
    orderId: string;
    orderCode: string;
    orderTotal: number;
    actorId?: string | null;
  },
): Promise<{ earned: number; balanceAfter: number } | null> {
  const existing = await tx.loyaltyTransaction.findUnique({
    where: {
      tenantId_orderId_type: {
        tenantId: opts.tenantId,
        orderId: opts.orderId,
        type: 'EARN',
      },
    },
    select: { id: true },
  });
  if (existing) return null;

  const cfgRow = await tx.loyaltyConfig.findUnique({ where: { tenantId: opts.tenantId } });
  const cfg = cfgRow ?? DEFAULT_LOYALTY_CONFIG;

  const points = calcEarnedPoints(opts.orderTotal, cfg.vndPerPoint, cfg.enabled);
  if (points <= 0) return null;

  const [balAgg, earnedAgg, customer] = await Promise.all([
    tx.loyaltyTransaction.aggregate({
      where: { tenantId: opts.tenantId, customerId: opts.customerId },
      _sum: { points: true },
    }),
    tx.loyaltyTransaction.aggregate({
      where: { tenantId: opts.tenantId, customerId: opts.customerId, type: 'EARN' },
      _sum: { points: true },
    }),
    tx.customer.findUnique({ where: { id: opts.customerId }, select: { tier: true } }),
  ]);
  if (!customer) return null;

  const balanceAfter = (balAgg._sum.points ?? 0) + points;
  const lifetimeEarned = (earnedAgg._sum.points ?? 0) + points;

  await tx.loyaltyTransaction.create({
    data: {
      tenantId: opts.tenantId,
      customerId: opts.customerId,
      orderId: opts.orderId,
      type: 'EARN',
      points,
      balanceAfter,
      note: `Tích điểm giao xe đơn ${opts.orderCode}`,
      createdBy: opts.actorId ?? null,
    },
  });

  const currentTier = customer.tier as CustomerTierCode;
  const nextTier = computeTierForPoints(lifetimeEarned, currentTier, cfg);
  if (nextTier !== currentTier) {
    await tx.customer.update({
      where: { id: opts.customerId },
      data: { tier: nextTier },
    });
  }

  const link = await tx.customerLink.findUnique({ where: { customerId: opts.customerId }, select: { userId: true } });
  if (link) {
    const tierNote = nextTier !== currentTier ? ` · Chúc mừng bạn đạt ${TIER_LABEL[nextTier]}!` : '';
    await tx.ownerNotification.create({
      data: {
        userId: link.userId,
        tenantId: opts.tenantId,
        kind: 'LOYALTY',
        title: `Cộng +${points} điểm thưởng`,
        body: `Bạn vừa tích thêm +${points} điểm từ đơn ${opts.orderCode} (số dư: ${balanceAfter} điểm)${tierNote}`,
      },
    });
  }

  return { earned: points, balanceAfter };
}
