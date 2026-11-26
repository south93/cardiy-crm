-- CreateTable
CREATE TABLE "inspections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "inspector_id" UUID,
    "completed_at" TIMESTAMP(3),
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inspections_order_id_key" ON "inspections"("order_id");

-- CreateIndex
CREATE INDEX "inspections_tenant_id_idx" ON "inspections"("tenant_id");

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "repair_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
