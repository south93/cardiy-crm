-- AlterEnum
ALTER TYPE "ImportKind" ADD VALUE 'PRODUCTS';

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "price_zone" TEXT NOT NULL DEFAULT 'BP';

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "sale_price_bd" BIGINT,
ADD COLUMN     "vat_price" BIGINT;
