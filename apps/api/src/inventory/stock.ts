import { Prisma, type StockMoveKind } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Ghi một dòng sổ kho và cập nhật tồn (nguyên tử: cộng trực tiếp trong SQL, khoá dòng tồn).
 * Cho phép tồn âm (bán trước, nhập sau) như cách garage đang làm trên AppSheet.
 */
export async function applyMovement(
  tx: Tx,
  m: {
    tenantId: string;
    branchId: string;
    productId: string;
    kind: StockMoveKind;
    quantity: Prisma.Decimal | string | number;
    unitCost?: bigint | number | null;
    documentId?: string | null;
    orderId?: string | null;
    note?: string | null;
    actorId?: string | null;
  },
) {
  const q = new Prisma.Decimal(m.quantity);
  const rows = await tx.$queryRaw<{ quantity: Prisma.Decimal }[]>`
    INSERT INTO stock_levels (product_id, branch_id, quantity, updated_at)
    VALUES (${m.productId}::uuid, ${m.branchId}::uuid, ${q}::numeric, now())
    ON CONFLICT (product_id, branch_id) DO UPDATE SET quantity = stock_levels.quantity + EXCLUDED.quantity, updated_at = now()
    RETURNING quantity`;
  const balance = rows[0]!.quantity;
  await tx.stockMovement.create({
    data: {
      tenantId: m.tenantId,
      branchId: m.branchId,
      productId: m.productId,
      kind: m.kind,
      quantity: q,
      balance,
      unitCost: m.unitCost == null ? null : BigInt(m.unitCost),
      documentId: m.documentId ?? null,
      orderId: m.orderId ?? null,
      note: m.note ?? null,
      createdBy: m.actorId ?? null,
    },
  });
  return balance;
}

/** Tồn hiện tại (0 nếu chưa có dòng) */
export async function currentQty(tx: Tx, productId: string, branchId: string) {
  const s = await tx.stockLevel.findUnique({ where: { productId_branchId: { productId, branchId } } });
  return s?.quantity ?? new Prisma.Decimal(0);
}

/** Nhóm sản phẩm mẫu: tạo khi garage chưa có nhóm nào (sửa / thêm được trong Danh mục) */
export const DEFAULT_CATEGORIES: [string, string[]][] = [
  ['Lốp xe', ['Lốp du lịch', 'Lốp SUV / bán tải', 'Lốp tải nhẹ']],
  ['Mâm xe', ['Mâm đúc', 'Mâm nguyên bản']],
  ['Ắc quy', ['Ắc quy khô (MF)', 'Ắc quy nước']],
  ['Phuộc & giảm xóc', ['Giảm xóc', 'Lò xo', 'Rotuyn & phụ kiện gầm']],
  ['Nội thất', ['Bọc ghế', 'Thảm sàn', 'Màn hình & camera', 'Phụ kiện nội thất']],
  ['Ngoại thất', ['Đèn', 'Phim cách nhiệt', 'Ốp & body kit', 'Gạt mưa']],
  ['Phụ kiện & chăm sóc', ['Hoá chất chăm sóc', 'Phủ ceramic / PPF', 'Phụ kiện khác']],
  ['Dầu nhớt & lọc', ['Dầu động cơ', 'Dầu hộp số', 'Lọc dầu', 'Lọc gió', 'Lọc gió điều hoà']],
  ['Phanh', ['Má phanh', 'Đĩa phanh', 'Dầu phanh']],
  ['Điện & điều hoà', ['Bugi', 'Điều hoà', 'Điện thân xe']],
  ['Dịch vụ', ['Bảo dưỡng', 'Sửa chữa máy gầm', 'Đồng sơn', 'Chăm sóc xe', 'Lắp đặt']],
];

/** Hãng xe hay gặp (gợi ý khi gắn sản phẩm theo hãng; vẫn gõ được hãng khác) */
export const COMMON_MAKES = ['Toyota', 'Hyundai', 'Kia', 'Mazda', 'Ford', 'Honda', 'Mitsubishi', 'VinFast', 'Nissan', 'Suzuki', 'Chevrolet', 'Isuzu', 'Peugeot', 'Mercedes-Benz', 'BMW', 'Lexus', 'Audi', 'Volkswagen', 'Subaru', 'MG'];
