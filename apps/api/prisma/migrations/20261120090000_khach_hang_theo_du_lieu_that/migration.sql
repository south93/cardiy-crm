-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('CUSTOMERS', 'VEHICLES');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PREVIEW', 'DONE');

-- AlterEnum
BEGIN;
CREATE TYPE "CustomerSource_new" AS ENUM ('ZALO', 'FACEBOOK', 'TIKTOK', 'GIOI_THIEU', 'KHACH_CU', 'VANG_LAI', 'WEBSITE', 'CUOC_GOI', 'GARA', 'CHAM_SOC_XE', 'DAI_LY', 'SAN_CARDIY', 'KHAC');
ALTER TABLE "public"."customers" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "customers" ALTER COLUMN "source" TYPE "CustomerSource_new" USING ("source"::text::"CustomerSource_new");
ALTER TYPE "CustomerSource" RENAME TO "CustomerSource_old";
ALTER TYPE "CustomerSource_new" RENAME TO "CustomerSource";
DROP TYPE "public"."CustomerSource_old";
ALTER TABLE "customers" ALTER COLUMN "source" SET DEFAULT 'VANG_LAI';
COMMIT;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "branch_id" UUID,
ADD COLUMN     "import_batch_id" UUID,
ADD COLUMN     "opening_debt" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "representative" TEXT,
ALTER COLUMN "phone" DROP NOT NULL,
ALTER COLUMN "source" SET DEFAULT 'VANG_LAI';

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "import_batch_id" UUID,
ADD COLUMN     "plate_valid" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "tire_size" TEXT,
ADD COLUMN     "transmission" TEXT;

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PREVIEW',
    "file_name" TEXT NOT NULL,
    "encoding" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "plan" JSONB,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" TIMESTAMP(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batches_tenant_id_created_at_idx" ON "import_batches"("tenant_id", "created_at");

