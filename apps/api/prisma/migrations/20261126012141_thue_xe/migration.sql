-- CreateEnum
CREATE TYPE "RentalOwnerType" AS ENUM ('GARAGE', 'CONSIGN');

-- CreateEnum
CREATE TYPE "RentalListingStatus" AS ENUM ('NHAP', 'CHO_DUYET', 'DANG_CHO_THUE', 'BI_TU_CHOI', 'TAM_AN', 'BI_GO');

-- CreateEnum
CREATE TYPE "RentalContractStatus" AS ENUM ('DAT_TRUOC', 'DA_XAC_MINH', 'DA_KY_COC', 'DANG_THUE', 'QUA_HAN', 'DA_TRA_XE', 'DA_QUYET_TOAN', 'HUY');

-- CreateTable
CREATE TABLE "rental_vehicles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "vehicle_id" UUID,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "plate_no" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 5,
    "transmission" TEXT NOT NULL DEFAULT 'TU_DONG',
    "fuel" TEXT NOT NULL DEFAULT 'XANG',
    "owner_type" "RentalOwnerType" NOT NULL DEFAULT 'GARAGE',
    "daily_price" BIGINT NOT NULL,
    "deposit" BIGINT NOT NULL,
    "km_limit_per_day" INTEGER NOT NULL DEFAULT 300,
    "over_km_fee" BIGINT NOT NULL DEFAULT 5000,
    "province" TEXT,
    "pickup_address" TEXT,
    "terms" TEXT,
    "description" TEXT,
    "image_file_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "status" "RentalListingStatus" NOT NULL DEFAULT 'NHAP',
    "review_note" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "search_text" TEXT NOT NULL DEFAULT '',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_contracts" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "rental_vehicle_id" UUID NOT NULL,
    "renter_user_id" UUID,
    "customer_id" UUID,
    "customer_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "id_card_no" TEXT,
    "driver_license_no" TEXT,
    "kyc_note" TEXT,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "rental_days" INTEGER NOT NULL,
    "daily_price" BIGINT NOT NULL,
    "deposit_required" BIGINT NOT NULL,
    "deposit_paid" BIGINT NOT NULL DEFAULT 0,
    "base_total" BIGINT NOT NULL,
    "extra_fee" BIGINT NOT NULL DEFAULT 0,
    "discount" BIGINT NOT NULL DEFAULT 0,
    "final_total" BIGINT,
    "deposit_refund" BIGINT,
    "payment_method" "PaymentMethod",
    "cash_entry_id" UUID,
    "handover_km" INTEGER,
    "handover_fuel" INTEGER,
    "handover_note" TEXT,
    "handover_image_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "handed_over_at" TIMESTAMP(3),
    "return_km" INTEGER,
    "return_fuel" INTEGER,
    "return_note" TEXT,
    "return_image_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "returned_at" TIMESTAMP(3),
    "customer_note" TEXT,
    "seller_note" TEXT,
    "cancel_reason" TEXT,
    "status" "RentalContractStatus" NOT NULL DEFAULT 'DAT_TRUOC',
    "access_hash" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3),
    "deposit_signed_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "handled_by" UUID,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rental_vehicles_tenant_id_status_idx" ON "rental_vehicles"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "rental_vehicles_status_province_idx" ON "rental_vehicles"("status", "province");

-- CreateIndex
CREATE INDEX "rental_vehicles_status_submitted_at_idx" ON "rental_vehicles"("status", "submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "rental_vehicles_tenant_id_code_key" ON "rental_vehicles"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "rental_contracts_cash_entry_id_key" ON "rental_contracts"("cash_entry_id");

-- CreateIndex
CREATE INDEX "rental_contracts_rental_vehicle_id_status_start_at_end_at_idx" ON "rental_contracts"("rental_vehicle_id", "status", "start_at", "end_at");

-- CreateIndex
CREATE INDEX "rental_contracts_tenant_id_status_created_at_idx" ON "rental_contracts"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "rental_contracts_renter_user_id_created_at_idx" ON "rental_contracts"("renter_user_id", "created_at");

-- CreateIndex
CREATE INDEX "rental_contracts_phone_status_idx" ON "rental_contracts"("phone", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rental_contracts_tenant_id_code_key" ON "rental_contracts"("tenant_id", "code");

-- AddForeignKey
ALTER TABLE "rental_contracts" ADD CONSTRAINT "rental_contracts_rental_vehicle_id_fkey" FOREIGN KEY ("rental_vehicle_id") REFERENCES "rental_vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
