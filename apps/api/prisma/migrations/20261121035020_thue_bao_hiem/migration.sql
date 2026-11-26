-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'BAO_HIEM';

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "section" TEXT,
ADD COLUMN     "vat_rate" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "repair_orders" ADD COLUMN     "insurance_amount" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "vat_total" BIGINT NOT NULL DEFAULT 0;
