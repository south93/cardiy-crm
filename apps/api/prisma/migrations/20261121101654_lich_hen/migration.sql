-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('CHO_XAC_NHAN', 'DA_XAC_NHAN', 'DA_DEN', 'KHONG_DEN', 'KHACH_HUY', 'TU_CHOI');

-- CreateEnum
CREATE TYPE "BookingChannel" AS ENUM ('GOI_DIEN', 'ZALO', 'FACEBOOK', 'TRUC_TIEP', 'WEBSITE', 'KHAC');

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "vehicle_id" UUID,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "duration_min" INTEGER NOT NULL DEFAULT 60,
    "service" TEXT NOT NULL,
    "note" TEXT,
    "channel" "BookingChannel" NOT NULL DEFAULT 'GOI_DIEN',
    "status" "BookingStatus" NOT NULL DEFAULT 'CHO_XAC_NHAN',
    "technician_id" UUID,
    "order_id" UUID,
    "reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_order_id_key" ON "bookings"("order_id");

-- CreateIndex
CREATE INDEX "bookings_tenant_id_branch_id_scheduled_at_idx" ON "bookings"("tenant_id", "branch_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "bookings_customer_id_idx" ON "bookings"("customer_id");

-- CreateIndex
CREATE INDEX "bookings_vehicle_id_idx" ON "bookings"("vehicle_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_tenant_id_code_key" ON "bookings"("tenant_id", "code");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "repair_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
