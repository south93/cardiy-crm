-- CreateEnum
CREATE TYPE "SerialKind" AS ENUM ('LOP', 'AC_QUY', 'PIN_LITHIUM');

-- CreateEnum
CREATE TYPE "SerialStatus" AS ENUM ('TRONG_KHO', 'DANG_SU_DUNG', 'DA_THAO', 'BAO_HANH', 'LOAI_BO');

-- CreateEnum
CREATE TYPE "SerialEventAction" AS ENUM ('NHAP_KHO', 'LAP_MOI', 'LAP_LAI', 'DAO_VI_TRI', 'CHUYEN_XE', 'THAO_RA', 'DOI_BAO_HANH', 'LOAI_BO');

-- CreateTable
CREATE TABLE "vehicle_compliance" (
    "vehicle_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "badge_no" TEXT,
    "badge_type" TEXT,
    "badge_expiry" DATE,
    "registration_remind_days" INTEGER,
    "insurance_remind_days" INTEGER,
    "badge_remind_days" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_compliance_pkey" PRIMARY KEY ("vehicle_id")
);

-- CreateTable
CREATE TABLE "maintenance_rules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "interval_km" INTEGER,
    "interval_months" INTEGER,
    "remind_before_km" INTEGER NOT NULL DEFAULT 500,
    "remind_before_days" INTEGER NOT NULL DEFAULT 15,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_maintenance_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "category_code" TEXT NOT NULL,
    "item_name" TEXT NOT NULL,
    "product_id" UUID,
    "order_id" UUID,
    "installed_at" DATE NOT NULL,
    "installed_km" INTEGER,
    "interval_km" INTEGER,
    "interval_months" INTEGER,
    "remind_before_km" INTEGER NOT NULL DEFAULT 500,
    "remind_before_days" INTEGER NOT NULL DEFAULT 15,
    "next_due_km" INTEGER,
    "next_due_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'DANG_THEO_DOI',
    "note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_maintenance_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "serial_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "serial_no" TEXT NOT NULL,
    "kind" "SerialKind" NOT NULL,
    "product_id" UUID,
    "product_name" TEXT NOT NULL,
    "brand" TEXT,
    "dot_or_mfg" TEXT,
    "status" "SerialStatus" NOT NULL DEFAULT 'TRONG_KHO',
    "current_vehicle_id" UUID,
    "position" TEXT,
    "installed_at" DATE,
    "installed_km" INTEGER,
    "warranty_months" INTEGER,
    "warranty_km" INTEGER,
    "warranty_expires_at" DATE,
    "warranty_max_km" INTEGER,
    "note" TEXT,
    "search_text" TEXT NOT NULL DEFAULT '',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "serial_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "serial_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "serial_id" UUID NOT NULL,
    "action" "SerialEventAction" NOT NULL,
    "from_vehicle_id" UUID,
    "to_vehicle_id" UUID,
    "from_position" TEXT,
    "to_position" TEXT,
    "order_id" UUID,
    "odometer_km" INTEGER,
    "performed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "serial_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_configs" (
    "tenant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL DEFAULT 'ESMS',
    "mode" TEXT NOT NULL DEFAULT 'development',
    "endpoint_url" TEXT,
    "brandname" TEXT,
    "api_key" TEXT,
    "api_secret_enc" TEXT,
    "template_text" TEXT NOT NULL DEFAULT '[{garage_name}] Xe {plate}: {care_title} (han {due_date}). LH {branch_phone} hoac dat lich tai {app_link}',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_configs_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "sms_messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "msg_id" TEXT,
    "error" TEXT,
    "ref_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_dispatches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "customer_id" UUID NOT NULL,
    "vehicle_id" UUID,
    "channel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_compliance_tenant_id_badge_expiry_idx" ON "vehicle_compliance"("tenant_id", "badge_expiry");

-- CreateIndex
CREATE INDEX "maintenance_rules_tenant_id_active_idx" ON "maintenance_rules"("tenant_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_rules_tenant_id_code_key" ON "maintenance_rules"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "vehicle_maintenance_items_vehicle_id_status_idx" ON "vehicle_maintenance_items"("vehicle_id", "status");

-- CreateIndex
CREATE INDEX "vehicle_maintenance_items_tenant_id_status_next_due_date_idx" ON "vehicle_maintenance_items"("tenant_id", "status", "next_due_date");

-- CreateIndex
CREATE INDEX "vehicle_maintenance_items_tenant_id_status_next_due_km_idx" ON "vehicle_maintenance_items"("tenant_id", "status", "next_due_km");

-- CreateIndex
CREATE INDEX "serial_items_tenant_id_kind_status_idx" ON "serial_items"("tenant_id", "kind", "status");

-- CreateIndex
CREATE INDEX "serial_items_current_vehicle_id_idx" ON "serial_items"("current_vehicle_id");

-- CreateIndex
CREATE INDEX "serial_items_tenant_id_search_text_idx" ON "serial_items"("tenant_id", "search_text");

-- CreateIndex
CREATE UNIQUE INDEX "serial_items_tenant_id_serial_no_key" ON "serial_items"("tenant_id", "serial_no");

-- CreateIndex
CREATE INDEX "serial_events_serial_id_performed_at_idx" ON "serial_events"("serial_id", "performed_at");

-- CreateIndex
CREATE INDEX "serial_events_from_vehicle_id_idx" ON "serial_events"("from_vehicle_id");

-- CreateIndex
CREATE INDEX "serial_events_to_vehicle_id_idx" ON "serial_events"("to_vehicle_id");

-- CreateIndex
CREATE INDEX "serial_events_order_id_idx" ON "serial_events"("order_id");

-- CreateIndex
CREATE INDEX "sms_messages_tenant_id_created_at_idx" ON "sms_messages"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "reminder_dispatches_tenant_id_created_at_idx" ON "reminder_dispatches"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "reminder_dispatches_vehicle_id_idx" ON "reminder_dispatches"("vehicle_id");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_dispatches_tenant_id_dedupe_key_key" ON "reminder_dispatches"("tenant_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "vehicle_compliance" ADD CONSTRAINT "vehicle_compliance_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_maintenance_items" ADD CONSTRAINT "vehicle_maintenance_items_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_items" ADD CONSTRAINT "serial_items_current_vehicle_id_fkey" FOREIGN KEY ("current_vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_events" ADD CONSTRAINT "serial_events_serial_id_fkey" FOREIGN KEY ("serial_id") REFERENCES "serial_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_events" ADD CONSTRAINT "serial_events_from_vehicle_id_fkey" FOREIGN KEY ("from_vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_events" ADD CONSTRAINT "serial_events_to_vehicle_id_fkey" FOREIGN KEY ("to_vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

