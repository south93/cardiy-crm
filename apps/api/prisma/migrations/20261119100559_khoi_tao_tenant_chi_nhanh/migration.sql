-- CreateEnum
CREATE TYPE "TenantType" AS ENUM ('PLATFORM', 'GARAGE');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('NHAP', 'CHO_DUYET', 'CAN_BO_SUNG', 'TU_CHOI', 'CHO_KY_HOP_DONG', 'DANG_THIET_LAP', 'HOAT_DONG', 'TAM_KHOA', 'CHAM_DUT');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "type" "TenantType" NOT NULL DEFAULT 'GARAGE',
    "name" TEXT NOT NULL,
    "tax_code" TEXT,
    "status" "TenantStatus" NOT NULL DEFAULT 'NHAP',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "bays" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_tax_code_key" ON "tenants"("tax_code");

-- CreateIndex
CREATE INDEX "branches_tenant_id_idx" ON "branches"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenant_id_code_key" ON "branches"("tenant_id", "code");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
