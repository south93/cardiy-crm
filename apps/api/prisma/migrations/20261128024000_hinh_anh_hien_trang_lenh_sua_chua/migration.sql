-- CreateEnum
CREATE TYPE "OrderPhotoStage" AS ENUM ('TIEP_NHAN', 'KIEM_TRA', 'HOAN_TAT');

-- CreateTable
CREATE TABLE "order_intakes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "fuel_level" TEXT,
    "warning_lights" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exterior_note" TEXT,
    "belongings" TEXT,
    "has_spare_and_tool" BOOLEAN,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_intakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_photos" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "stage" "OrderPhotoStage" NOT NULL,
    "tag" TEXT,
    "caption" TEXT,
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_intakes_order_id_key" ON "order_intakes"("order_id");

-- CreateIndex
CREATE INDEX "order_intakes_tenant_id_idx" ON "order_intakes"("tenant_id");

-- CreateIndex
CREATE INDEX "order_photos_order_id_stage_created_at_idx" ON "order_photos"("order_id", "stage", "created_at");

-- CreateIndex
CREATE INDEX "order_photos_tenant_id_created_at_idx" ON "order_photos"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "order_intakes" ADD CONSTRAINT "order_intakes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "repair_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_photos" ADD CONSTRAINT "order_photos_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "repair_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
