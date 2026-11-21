-- CreateEnum
CREATE TYPE "CashType" AS ENUM ('THU', 'CHI');

-- CreateTable
CREATE TABLE "cash_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "CashType" NOT NULL,
    "category" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "counterparty" TEXT,
    "customer_id" UUID,
    "supplier_id" UUID,
    "note" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),
    "voided_by" UUID,
    "void_reason" TEXT,

    CONSTRAINT "cash_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_entries_tenant_id_branch_id_occurred_at_idx" ON "cash_entries"("tenant_id", "branch_id", "occurred_at");

-- CreateIndex
CREATE INDEX "cash_entries_customer_id_idx" ON "cash_entries"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_entries_tenant_id_code_key" ON "cash_entries"("tenant_id", "code");
