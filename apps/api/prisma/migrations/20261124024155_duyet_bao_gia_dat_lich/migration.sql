-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('CHO_DUYET', 'DA_DUYET', 'DUYET_MOT_PHAN', 'TU_CHOI', 'HET_HIEU_LUC');

-- AlterEnum
ALTER TYPE "BookingChannel" ADD VALUE 'APP';

-- CreateTable
CREATE TABLE "order_quotes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'CHO_DUYET',
    "items" JSONB NOT NULL,
    "total" BIGINT NOT NULL,
    "message" TEXT,
    "sent_by" UUID,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "customer_note" TEXT,
    "responded_at" TIMESTAMP(3),
    "applied" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "order_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_quotes_order_id_sent_at_idx" ON "order_quotes"("order_id", "sent_at");

-- CreateIndex
CREATE INDEX "order_quotes_tenant_id_status_idx" ON "order_quotes"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "order_quotes" ADD CONSTRAINT "order_quotes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "repair_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
