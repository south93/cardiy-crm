-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('PERSON', 'COMPANY');

-- CreateEnum
CREATE TYPE "CustomerTier" AS ENUM ('THUONG', 'BAC', 'VANG', 'KIM_CUONG');

-- CreateEnum
CREATE TYPE "CustomerSource" AS ENUM ('TAI_QUAY', 'GIOI_THIEU', 'ZALO', 'FACEBOOK', 'WEBSITE', 'SAN_CARDIY', 'NHAP_FILE', 'KHAC');

-- CreateTable
CREATE TABLE "tenant_counters" (
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tenant_counters_pkey" PRIMARY KEY ("tenant_id","key")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "CustomerType" NOT NULL DEFAULT 'PERSON',
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phone2" TEXT,
    "email" TEXT,
    "address" TEXT,
    "tax_code" TEXT,
    "birthday" DATE,
    "tier" "CustomerTier" NOT NULL DEFAULT 'THUONG',
    "source" "CustomerSource" NOT NULL DEFAULT 'TAI_QUAY',
    "note" TEXT,
    "marketing_consent" BOOLEAN NOT NULL DEFAULT false,
    "search_text" TEXT NOT NULL DEFAULT '',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plate_no" TEXT NOT NULL,
    "vin" TEXT,
    "make" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "color" TEXT,
    "fuel" TEXT,
    "odometer_km" INTEGER,
    "registration_expiry" DATE,
    "insurance_expiry" DATE,
    "note" TEXT,
    "search_text" TEXT NOT NULL DEFAULT '',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_ownerships" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "from_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "to_date" TIMESTAMP(3),

    CONSTRAINT "vehicle_ownerships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "odometer_readings" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "km" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "recorded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "odometer_readings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_tenant_id_search_text_idx" ON "customers"("tenant_id", "search_text");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_code_key" ON "customers"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_phone_key" ON "customers"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "vehicles_tenant_id_search_text_idx" ON "vehicles"("tenant_id", "search_text");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_tenant_id_plate_no_key" ON "vehicles"("tenant_id", "plate_no");

-- CreateIndex
CREATE INDEX "vehicle_ownerships_vehicle_id_idx" ON "vehicle_ownerships"("vehicle_id");

-- CreateIndex
CREATE INDEX "vehicle_ownerships_customer_id_idx" ON "vehicle_ownerships"("customer_id");

-- CreateIndex
CREATE INDEX "odometer_readings_vehicle_id_created_at_idx" ON "odometer_readings"("vehicle_id", "created_at");

-- AddForeignKey
ALTER TABLE "vehicle_ownerships" ADD CONSTRAINT "vehicle_ownerships_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_ownerships" ADD CONSTRAINT "vehicle_ownerships_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "odometer_readings" ADD CONSTRAINT "odometer_readings_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mỗi xe chỉ có tối đa 1 chủ hiện tại
CREATE UNIQUE INDEX "vehicle_ownerships_one_current_owner" ON "vehicle_ownerships" ("vehicle_id") WHERE "to_date" IS NULL;
