-- CreateEnum
CREATE TYPE "OrderRequestStatus" AS ENUM ('CHO_XAC_NHAN', 'DA_XAC_NHAN', 'HOAN_THANH', 'TU_CHOI', 'HET_HAN', 'KHACH_HUY', 'KHONG_DEN');

-- CreateEnum
CREATE TYPE "VoucherKind" AS ENUM ('PERCENT', 'AMOUNT');

-- CreateTable
CREATE TABLE "vouchers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "VoucherKind" NOT NULL,
    "value" INTEGER NOT NULL,
    "min_order" BIGINT NOT NULL DEFAULT 0,
    "max_discount" BIGINT,
    "applies_to" TEXT NOT NULL DEFAULT 'ALL',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "usage_limit" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_requests" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "status" "OrderRequestStatus" NOT NULL DEFAULT 'CHO_XAC_NHAN',
    "customer_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "plate_no" TEXT,
    "note" TEXT,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "voucher_id" UUID,
    "voucher_code" TEXT,
    "subtotal" BIGINT NOT NULL,
    "discount" BIGINT NOT NULL DEFAULT 0,
    "estimated_total" BIGINT NOT NULL,
    "final_total" BIGINT,
    "seller_note" TEXT,
    "access_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "handled_by" UUID,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_request_items" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "kind" "CatalogKind" NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "install_included" BOOLEAN NOT NULL DEFAULT false,
    "mfg_year" INTEGER,

    CONSTRAINT "order_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_tenant_id_code_key" ON "vouchers"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "order_requests_tenant_id_status_created_at_idx" ON "order_requests"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "order_requests_phone_status_idx" ON "order_requests"("phone", "status");

-- CreateIndex
CREATE INDEX "order_requests_status_expires_at_idx" ON "order_requests"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_requests_tenant_id_code_key" ON "order_requests"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "order_request_items_offer_id_idx" ON "order_request_items"("offer_id");

-- CreateIndex
CREATE INDEX "order_request_items_request_id_idx" ON "order_request_items"("request_id");

-- AddForeignKey
ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_request_items" ADD CONSTRAINT "order_request_items_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "order_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
