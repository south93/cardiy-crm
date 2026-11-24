-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('CHO_DUYET', 'CAN_BO_SUNG', 'TU_CHOI', 'DA_DUYET');

-- CreateEnum
CREATE TYPE "PlatformInvoiceStatus" AS ENUM ('DA_PHAT_HANH', 'DA_THANH_TOAN', 'HUY');

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthly_fee" BIGINT NOT NULL,
    "billing_months" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_applications" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'CHO_DUYET',
    "garage_name" TEXT NOT NULL,
    "tax_code" TEXT,
    "address" TEXT NOT NULL,
    "province" TEXT,
    "representative" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "plan_id" UUID,
    "note" TEXT,
    "documents" JSONB NOT NULL DEFAULT '[]',
    "access_hash" TEXT NOT NULL,
    "review_note" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "tenant_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "monthly_fee" BIGINT NOT NULL,
    "billing_months" INTEGER NOT NULL,
    "start_at" DATE NOT NULL,
    "paid_through" DATE NOT NULL,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_invoices" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "amount" BIGINT NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "PlatformInvoiceStatus" NOT NULL DEFAULT 'DA_PHAT_HANH',
    "paid_at" TIMESTAMP(3),
    "paid_method" TEXT,
    "paid_note" TEXT,
    "recorded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "partner_applications_code_key" ON "partner_applications"("code");

-- CreateIndex
CREATE UNIQUE INDEX "partner_applications_tenant_id_key" ON "partner_applications"("tenant_id");

-- CreateIndex
CREATE INDEX "partner_applications_status_created_at_idx" ON "partner_applications"("status", "created_at");

-- CreateIndex
CREATE INDEX "subscriptions_tenant_id_idx" ON "subscriptions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_invoices_code_key" ON "platform_invoices"("code");

-- CreateIndex
CREATE INDEX "platform_invoices_tenant_id_period_from_idx" ON "platform_invoices"("tenant_id", "period_from");

-- CreateIndex
CREATE INDEX "platform_invoices_status_due_date_idx" ON "platform_invoices"("status", "due_date");

-- AddForeignKey
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
