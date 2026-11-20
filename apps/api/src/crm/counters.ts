import type { Prisma } from '@prisma/client';

/**
 * Lấy dải số tiếp theo của bộ đếm (nguyên tử, an toàn khi nhiều người tạo cùng lúc).
 * Trả về số đầu tiên của dải [first, first + count - 1].
 */
export async function reserveNumbers(tx: Prisma.TransactionClient, tenantId: string, key: string, count = 1): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO tenant_counters (tenant_id, key, value) VALUES (${tenantId}::uuid, ${key}, ${count})
    ON CONFLICT (tenant_id, key) DO UPDATE SET value = tenant_counters.value + ${count}
    RETURNING value`;
  return rows[0]!.value - count + 1;
}

export const customerCode = (n: number) => `KH${String(n).padStart(6, '0')}`;
